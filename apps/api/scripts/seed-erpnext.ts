/**
 * Phase 1 "Core Data Layer" bootstrap (spec §10, §5).
 *
 * Idempotent: safe to re-run against the same site. Creates, via the
 * shared ErpNextClient (not raw DB writes — "the correct way to add
 * business fields", §5):
 *
 *   - Custom Fields on Customer: customer_tier, credit_limit,
 *     payment_term_days
 *   - Price Lists: Retail, Grosir, Member (§5: "use separate Price Lists
 *     ... instead of a custom field — the standard ERPNext pattern")
 *   - UOMs: Pcs, Lusin, Karton, with default UOM Conversion Factors
 *     (1 Karton = 12 Lusin = 144 Pcs, per §1.3 FR-2's example)
 *
 * Usage: npm run seed:erpnext --workspace=apps/api
 */
import { erpNextClient, ErpNextApiError } from '../src/shared/erpnext-client/index.js';
import { logger } from '../src/shared/logger/index.js';

interface CustomFieldSpec {
  fieldname: string;
  label: string;
  fieldtype: string;
  insertAfter: string;
  options?: string;
  default?: string;
  description?: string;
}

const CUSTOMER_CUSTOM_FIELDS: CustomFieldSpec[] = [
  {
    fieldname: 'customer_tier',
    label: 'Customer Tier',
    fieldtype: 'Select',
    insertAfter: 'customer_group',
    options: 'Retail\nGrosir\nMember',
    default: 'Retail',
    description: 'Determines default pricing (Price List) and MOQ — spec §1.3 FR-4.',
  },
  {
    fieldname: 'credit_limit',
    label: 'Credit Limit',
    fieldtype: 'Currency',
    insertAfter: 'customer_tier',
    default: '0',
  },
  {
    fieldname: 'payment_term_days',
    label: 'Payment Term (Days)',
    fieldtype: 'Int',
    insertAfter: 'credit_limit',
    default: '0',
    description: 'Days until piutang (accounts receivable) is due — spec §1.3 FR-4.',
  },
];

const PRICE_LISTS = ['Retail', 'Grosir', 'Member'];

const UOMS = ['Pcs', 'Lusin', 'Karton'];

// UOM Conversion Factor requires a UOM Category (spec §1.3 FR-2's example —
// karton/lusin/pcs are all "how many individual items" units).
const UOM_CATEGORY = 'Quantity';

const UOM_CONVERSIONS: Array<{ from: string; to: string; value: number }> = [
  { from: 'Lusin', to: 'Pcs', value: 12 },
  { from: 'Karton', to: 'Pcs', value: 144 },
  { from: 'Karton', to: 'Lusin', value: 12 },
];

async function existsByFilter(doctype: string, filters: unknown[][]): Promise<boolean> {
  const matches = await erpNextClient.list<{ name: string }>(doctype, { filters });
  return matches.length > 0;
}

async function ensureCustomField(dt: string, field: CustomFieldSpec): Promise<void> {
  const already = await existsByFilter('Custom Field', [
    ['dt', '=', dt],
    ['fieldname', '=', field.fieldname],
  ]);
  if (already) {
    logger.info({ dt, fieldname: field.fieldname }, 'seed.custom_field.exists');
    return;
  }

  await erpNextClient.create('Custom Field', {
    dt,
    fieldname: field.fieldname,
    label: field.label,
    fieldtype: field.fieldtype,
    insert_after: field.insertAfter,
    options: field.options,
    default: field.default,
    description: field.description,
  });
  logger.info({ dt, fieldname: field.fieldname }, 'seed.custom_field.created');
}

async function ensurePriceList(name: string): Promise<void> {
  try {
    await erpNextClient.get('Price List', name);
    logger.info({ name }, 'seed.price_list.exists');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create('Price List', {
    price_list_name: name,
    selling: 1,
    currency: 'IDR',
    enabled: 1,
  });
  logger.info({ name }, 'seed.price_list.created');
}

async function ensureUom(uomName: string): Promise<void> {
  try {
    await erpNextClient.get('UOM', uomName);
    logger.info({ uomName }, 'seed.uom.exists');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create('UOM', { uom_name: uomName, must_be_whole_number: 1 });
  logger.info({ uomName }, 'seed.uom.created');
}

async function ensureUomCategory(name: string): Promise<void> {
  try {
    await erpNextClient.get('UOM Category', name);
    logger.info({ name }, 'seed.uom_category.exists');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create('UOM Category', { category_name: name });
  logger.info({ name }, 'seed.uom_category.created');
}

async function ensureUomConversionFactor(from: string, to: string, value: number): Promise<void> {
  const already = await existsByFilter('UOM Conversion Factor', [
    ['from_uom', '=', from],
    ['to_uom', '=', to],
  ]);
  if (already) {
    logger.info({ from, to, value }, 'seed.uom_conversion.exists');
    return;
  }

  await erpNextClient.create('UOM Conversion Factor', {
    category: UOM_CATEGORY,
    from_uom: from,
    to_uom: to,
    value,
  });
  logger.info({ from, to, value }, 'seed.uom_conversion.created');
}

async function main(): Promise<void> {
  for (const field of CUSTOMER_CUSTOM_FIELDS) {
    await ensureCustomField('Customer', field);
  }

  for (const priceList of PRICE_LISTS) {
    await ensurePriceList(priceList);
  }

  for (const uom of UOMS) {
    await ensureUom(uom);
  }

  await ensureUomCategory(UOM_CATEGORY);

  for (const conversion of UOM_CONVERSIONS) {
    await ensureUomConversionFactor(conversion.from, conversion.to, conversion.value);
  }

  logger.info('seed.done');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error({ err: error }, 'seed.failed');
    process.exit(1);
  });
