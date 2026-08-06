/**
 * Bulk product onboarding from the Gudang scan screen (spec: "Tambah
 * Produk Baru" — replaces slow one-by-one desktop Item entry). Shares
 * this module with pricing.ts/transactions.ts rather than a new module,
 * since it's still squarely Item/pricing data (§1.3 FR-1), just a write
 * path instead of a read one.
 */
import { erpNextClient, ErpNextApiError } from '../../../shared/erpnext-client/index.js';
import type {
  ItemGroupOption,
  NewItemInput,
  NewItemResult,
  UomOption,
} from '../domain/index.js';

/**
 * Distinguishable from a plain Error so the sync module's conflict
 * detection (process-action.ts's isConflict) can route this to the same
 * "held for manual review" path as a negative-stock clash, rather than
 * the ordinary Failed/retry path — see createItem's doc comment for why.
 */
export class DuplicateItemError extends Error {}

interface ItemGroupRecord {
  name: string;
}

/** Leaf groups only (is_group=0) — the tree's parent/category nodes (e.g. the "All Item Groups" root) aren't valid values for an Item's own item_group field. */
export async function listItemGroups(): Promise<ItemGroupOption[]> {
  const groups = await erpNextClient.list<ItemGroupRecord>('Item Group', {
    filters: [['is_group', '=', 0]],
    fields: ['name'],
    order_by: 'name asc',
    limit_page_length: '200',
  });
  return groups.map((g) => ({ name: g.name }));
}

interface UomRecord {
  name: string;
}

/** Every UOM master record ERPNext knows about — the form's autocomplete source. Not filtered: unlike Item Group, there's no "category node" concept here to exclude. */
export async function listUoms(): Promise<UomOption[]> {
  const uoms = await erpNextClient.list<UomRecord>('UOM', {
    fields: ['name'],
    order_by: 'name asc',
    limit_page_length: '500',
  });
  return uoms.map((u) => ({ name: u.name }));
}

async function itemExists(itemCode: string): Promise<boolean> {
  try {
    await erpNextClient.get('Item', itemCode);
    return true;
  } catch (error) {
    if (error instanceof ErpNextApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

async function uomExists(uomName: string): Promise<boolean> {
  try {
    await erpNextClient.get('UOM', uomName);
    return true;
  } catch (error) {
    if (error instanceof ErpNextApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

/** A shelf item's UOM (e.g. "Renteng", "Dus") is very often not one of ERPNext's stock units — create it on the spot rather than making staff go register it in the desktop UI first. */
async function ensureUom(uomName: string): Promise<void> {
  if (!(await uomExists(uomName))) {
    await erpNextClient.create('UOM', { uom_name: uomName });
  }
}

/**
 * Idempotent by (item_code, price_list, uom): checked before every write
 * so a retry after a partial failure — this item's Item document already
 * exists, but only some of its price rows were created before a network
 * blip — just fills in whatever's still missing instead of erroring or
 * duplicating rows. Always explicit about uom (including the item's own
 * base unit) so multi-UOM items never have an ambiguous "which row is the
 * base price" — see shared/erpnext-queries's lookupItemPrice, which
 * depends on that.
 */
async function createItemPriceRow(
  itemCode: string,
  priceList: string,
  uom: string,
  rate: number,
): Promise<void> {
  const existing = await erpNextClient.list<{ name: string }>('Item Price', {
    filters: [
      ['item_code', '=', itemCode],
      ['price_list', '=', priceList],
      ['uom', '=', uom],
    ],
    fields: ['name'],
    limit_page_length: '1',
  });
  if (existing.length > 0) {
    return;
  }
  await erpNextClient.create('Item Price', {
    item_code: itemCode,
    price_list: priceList,
    price_list_rate: rate,
    uom,
  });
}

/**
 * Registers the Item document itself (never overwrites an existing one —
 * spec's explicit "confirm item_code doesn't already exist before
 * creating, to avoid duplicates"). Thrown as DuplicateItemError so the
 * sync module surfaces it the same way a negative-stock clash does: held
 * for manual review in the dashboard's "Konflik Sinkron" tab, never
 * silently skipped or overwritten.
 *
 * Deliberately split from createItemPrices (below): the caller
 * (process-action.ts) checkpoints the offline action's UUID against this
 * function's result *before* writing any price rows, so a retry after a
 * partial-price failure resumes at the price step instead of re-running
 * this and wrongly reporting a Conflict against the Item it itself
 * already created.
 */
export async function createItem(
  input: Pick<NewItemInput, 'itemCode' | 'itemName' | 'itemGroup' | 'stockUom' | 'packageUoms'>,
): Promise<{ itemCode: string; itemName: string }> {
  if (await itemExists(input.itemCode)) {
    throw new DuplicateItemError(
      `Item ${input.itemCode} sudah terdaftar — tidak dibuat ulang untuk menghindari duplikat.`,
    );
  }

  const packageUoms = input.packageUoms ?? [];
  await ensureUom(input.stockUom);
  for (const p of packageUoms) {
    await ensureUom(p.uom);
  }

  await erpNextClient.create('Item', {
    item_code: input.itemCode,
    item_name: input.itemName,
    item_group: input.itemGroup,
    stock_uom: input.stockUom,
    is_stock_item: 1,
    disabled: 0,
    ...(packageUoms.length > 0
      ? { uoms: packageUoms.map((p) => ({ uom: p.uom, conversion_factor: p.conversionQty })) }
      : {}),
  });

  return { itemCode: input.itemCode, itemName: input.itemName };
}

/**
 * Always safe to call, whether this is the item's first creation or a
 * retry resuming after one — every row it writes is check-before-create
 * (see createItemPriceRow). Base-unit prices plus one Retail/Grosir pair
 * per package UOM.
 */
export async function createItemPrices(
  input: Omit<NewItemInput, 'itemGroup'>,
): Promise<NewItemResult> {
  await createItemPriceRow(input.itemCode, 'Retail', input.stockUom, input.retailPrice);
  if (input.grosirPrice !== undefined) {
    await createItemPriceRow(input.itemCode, 'Grosir', input.stockUom, input.grosirPrice);
  }

  const packageResults = [];
  for (const p of input.packageUoms ?? []) {
    await createItemPriceRow(input.itemCode, 'Retail', p.uom, p.retailPrice);
    if (p.grosirPrice !== undefined) {
      await createItemPriceRow(input.itemCode, 'Grosir', p.uom, p.grosirPrice);
    }
    packageResults.push({ uom: p.uom, retailPrice: p.retailPrice, grosirPrice: p.grosirPrice ?? null });
  }

  return {
    itemCode: input.itemCode,
    itemName: input.itemName,
    retailPrice: input.retailPrice,
    grosirPrice: input.grosirPrice ?? null,
    packageUoms: packageResults,
  };
}
