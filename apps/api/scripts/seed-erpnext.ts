/**
 * ERPNext bootstrap for Phases 1–2 (spec §10, §5). Idempotent: safe to
 * re-run against the same site. Creates, via the shared ErpNextClient (not
 * raw DB writes — "the correct way to add business fields", §5):
 *
 * Phase 1 "Core Data Layer":
 *   - Custom Fields on Customer: customer_tier, credit_limit,
 *     payment_term_days
 *   - Price Lists: Retail, Grosir, Member (§5: "use separate Price Lists
 *     ... instead of a custom field — the standard ERPNext pattern")
 *   - UOMs: Pcs, Lusin, Karton, with default UOM Conversion Factors
 *     (1 Karton = 12 Lusin = 144 Pcs, per §1.3 FR-2's example). Also seeds
 *     Kg (fractional, not whole-number-only) for weight-sold items like
 *     rice/sugar — made available ahead of time, no conversion factors yet
 *     since no Kg-priced product exists to derive them from.
 *
 * Phase 2 "POS + Inventory" prerequisites — none of this is optional
 * scaffolding: ERPNext's Sales Invoice/Stock Entry/Stock Reconciliation
 * doctypes hard-require a Company (and everything a Company implies: a
 * Fiscal Year, a Chart of Accounts, at least one Warehouse) before they'll
 * accept a single write. There's no Setup Wizard equivalent over the REST
 * API, so this script IS the equivalent, discovered by exercising the real
 * flow end-to-end against a fresh site (see README "Renaming the
 * placeholder company" for what's a placeholder here and why):
 *   - Company "Toko Hermes" (abbr TH) — creating it auto-creates the
 *     Chart of Accounts and a few generic warehouses ERPNext ships with
 *     (Stores/Finished Goods/WIP/Goods In Transit); those are left alone.
 *   - Warehouse "Gudang Utama - TH" — the one warehouse per §12's
 *     confirmed 1-store/1-warehouse MVP scope.
 *   - Fiscal Year covering the current date.
 *   - Item Group tree root + a default leaf group for un-categorized items.
 *   - Stock Entry Types (Material Receipt/Issue/Transfer) and a Warehouse
 *     Type (Transit) — link-validated master lists ERPNext expects to
 *     exist but doesn't ship pre-populated.
 *   - Modes of Payment (Cash, QRIS, Transfer), each posting to its own
 *     account — Cash to the Company's default cash account, QRIS and
 *     Transfer to their own Bank-type accounts created under "Bank
 *     Accounts" — so split payments (§1.3 FR-1) reconcile correctly:
 *     what's physically in the till versus what's settled to the bank.
 *   - "Walk-in Customer" (tier Retail) as the default POS customer.
 *
 * Usage: npm run seed:erpnext --workspace=apps/api
 */
import { env } from '../src/config/env.js';
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

// Receipt personalization (spec: store name/address/WA/logo on the
// receipt, pulled from ERPNext Company settings, not hardcoded). No native
// Company field holds a plain-text address (address_html is a read-only
// rollup of the separate Address doctype, real overkill for one receipt
// line) — company_logo and phone_no already exist natively and are reused
// as-is; phone_no is what appears on the receipt as "No. WhatsApp Toko",
// so the owner should fill it with the store's actual WhatsApp number.
const COMPANY_CUSTOM_FIELDS: CustomFieldSpec[] = [
  {
    fieldname: 'custom_store_address',
    label: 'Store Address (for receipt)',
    fieldtype: 'Small Text',
    insertAfter: 'company_logo',
    description: 'Printed on the receipt below the store name — fill in for it to appear.',
  },
  {
    fieldname: 'custom_receipt_template',
    label: 'Receipt Template',
    fieldtype: 'Select',
    insertAfter: 'custom_store_address',
    options: 'Minimal\nStandard\nDetailed',
    default: 'Standard',
    description:
      "Which of the 3 Hermes receipt layouts to print — also changeable from the app's Settings screen.",
  },
  {
    fieldname: 'custom_receipt_header',
    label: 'Receipt Header Text',
    fieldtype: 'Small Text',
    insertAfter: 'custom_receipt_template',
    description:
      'Shown above the store name on every receipt (e.g. a tagline) — also editable from Settings.',
  },
  {
    fieldname: 'custom_receipt_footer',
    label: 'Receipt Footer Text',
    fieldtype: 'Small Text',
    insertAfter: 'custom_receipt_header',
    description:
      'Shown at the bottom of every receipt, replacing the default "Terima kasih" line — also editable from Settings.',
  },
  {
    fieldname: 'custom_receipt_logo_url',
    label: 'Receipt Logo URL',
    fieldtype: 'Data',
    insertAfter: 'custom_receipt_footer',
    description:
      // A plain hosted URL, not the native company_logo attach field — same
      // reasoning as QRIS_STATIC_IMAGE_URL: a private ERPNext-hosted file
      // (the default for company_logo) needs an authenticated session to
      // load, which the receipt iframe never has, so it silently 403s.
      'Image URL shown at the top of every receipt — must be a publicly reachable URL (a private ERPNext file will not display). Also editable from Settings.',
  },
];

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

// Per-item low-stock override — the alert on Beranda uses a
// store-wide default (10 units) for every item, but a shopkeeper may
// reasonably want a fast-moving staple (rice, cooking oil) flagged
// sooner and a slow-moving item never flagged at 10. Left blank (0/unset)
// on every item by default, meaning "use the store-wide default" — see
// listLowStock()'s doc comment for the exact fallback rule.
const ITEM_CUSTOM_FIELDS: CustomFieldSpec[] = [
  {
    fieldname: 'custom_low_stock_threshold',
    label: 'Low Stock Threshold',
    fieldtype: 'Int',
    insertAfter: 'is_stock_item',
    description:
      'Alert on Beranda when stock falls to or below this many units. Leave blank to use the store-wide default (10 units).',
  },
];

const PRICE_LISTS = ['Retail', 'Grosir', 'Member'];

const UOMS: Array<{ name: string; mustBeWholeNumber: boolean }> = [
  { name: 'Pcs', mustBeWholeNumber: true },
  { name: 'Lusin', mustBeWholeNumber: true },
  { name: 'Karton', mustBeWholeNumber: true },
  { name: 'Kg', mustBeWholeNumber: false },
];

// --- Phase 8 auth prerequisites ---
// hermes_role is a Custom Field on ERPNext's own User doctype rather than
// a parallel Hermes-owned user table — the spec's own data model (§5)
// only calls for a Hermes-side `user_roles_extended` table "if RBAC needs
// finer grain than Frappe's native roles"; a single Select field is not
// that case. Password verification also delegates to ERPNext's own
// `/api/method/login` (see auth module) — Hermes never stores a password.
const USER_ROLE_FIELD: CustomFieldSpec = {
  fieldname: 'hermes_role',
  label: 'Hermes Role',
  fieldtype: 'Select',
  insertAfter: 'first_name',
  options: 'Owner\nManager\nCashier\nWarehouse Staff',
  description:
    "RBAC role for the Hermes application layer (spec §1.4 NFR Security) — distinct from ERPNext's own native Roles.",
};

// Dev-only seed accounts, one per §1.4's required role, so Phase 8's
// auth can be verified end-to-end without a manual ERPNext setup step.
// Same shared password for all four, deliberately simple for local
// verification — change or remove these before any non-local deployment.
const SEED_USER_PASSWORD = 'Hermes123!';
const SEED_USERS: Array<{ email: string; firstName: string; role: string }> = [
  { email: 'owner@hermes.local', firstName: 'Owner', role: 'Owner' },
  { email: 'manager@hermes.local', firstName: 'Manager', role: 'Manager' },
  { email: 'cashier@hermes.local', firstName: 'Cashier', role: 'Cashier' },
  { email: 'warehouse@hermes.local', firstName: 'Warehouse', role: 'Warehouse Staff' },
];

// --- Phase 2 prerequisites ---

const COMPANY_NAME = env.ERPNEXT_DEFAULT_COMPANY;
const COMPANY_ABBR = 'TH';
const COMPANY_CURRENCY = 'IDR';
const COMPANY_COUNTRY = 'Indonesia';
const WAREHOUSE_NAME = 'Gudang Utama';
const ROOT_ITEM_GROUP = 'All Item Groups';
const DEFAULT_ITEM_GROUP = 'Produk Umum';
const STOCK_ENTRY_TYPES: Array<{ name: string; purpose: string }> = [
  { name: 'Material Receipt', purpose: 'Material Receipt' },
  { name: 'Material Issue', purpose: 'Material Issue' },
  { name: 'Material Transfer', purpose: 'Material Transfer' },
];
const WAREHOUSE_TYPE = 'Transit';

// Each Mode of Payment posts to its own account for real reconciliation
// (what's physically in the till vs. what's settled to the bank). Cash
// uses the Company's auto-created default cash account; QRIS and Transfer
// get their own Bank-type accounts under the Company's "Bank Accounts"
// group (also auto-created).
const MODES_OF_PAYMENT: Array<{
  name: string;
  type: 'Cash' | 'Bank';
  dedicatedAccountName?: string;
}> = [
  { name: 'Cash', type: 'Cash' },
  { name: 'QRIS', type: 'Bank', dedicatedAccountName: 'QRIS' },
  { name: 'Transfer', type: 'Bank', dedicatedAccountName: 'Bank Transfer' },
];

// Three Indonesian-language checkout receipt layouts (pre-Phase-9 polish
// pass originally added one; this pass adds the other two plus a real
// store-details header) — replaces ERPNext's own default Sales Invoice
// print format (a full-page, English-language business invoice: "Bill to:",
// "In Words:", A4-sized), real ERPNext content but the wrong *shape* for a
// quick retail receipt. These are real, user-editable ERPNext Print Formats
// (Setup > Printing > Print Format), not app code — the owner can open any
// of them in ERPNext's Print Format designer and change it later without
// touching this repository. Store name/address/WA/logo come from the
// Company doctype (Setup > Company > Toko Hermes) via `frappe.db.get_value`
// — a Jinja print format's sandboxed environment blocks method calls like
// `frappe.get_doc(...).as_json()` (see the existing webhook_json comment
// below for the same constraint hit elsewhere), but `frappe.db.get_value`
// is a plain value lookup and is allowed. Fill in Company.phone_no with the
// store's real WhatsApp number and Company.custom_store_address for them to
// appear correctly — see DEPLOY_CHECKLIST.md.
const RECEIPT_HEADER_LOOKUP =
  '{% set company = frappe.db.get_value("Company", doc.company, ["company_name", "custom_store_address", "phone_no", "website", "company_logo", "custom_receipt_header", "custom_receipt_footer", "custom_receipt_logo_url"], as_dict=True) %}';

// Real bug found live (2026-08-11): items/prices were getting physically
// clipped on 80mm thermal paper. Root cause, confirmed by fetching a real
// /printview response rather than guessing — ERPNext wraps every Print
// Format's HTML in its own `.print-format-gutter > .print-format` shell
// (from Frappe's bundled print.bundle.css), which:
//   1. Sets `.print-format { max-width: 8.3in; padding: 0.75in; }` for
//      on-screen preview (the same markup the app's iframe displays before
//      printing) — 0.75in (72px) of padding *per side* alone eats 144px
//      out of an 80mm/302px page, before our own template's content even
//      starts.
//   2. Sets `.print-format td, .print-format th { padding: 10px !important }`
//      UNSCOPED (applies to screen *and* print, `!important` beats our
//      inline `style=` on every `<td>`) — the old 4-column items table
//      (Barang/Qty/Harga/Subtotal) had each cell silently padded to 10px
//      per side regardless of what padding we requested, on top of a
//      table's `auto` layout algorithm which won't shrink a column below
//      its content's minimum width, and neither of the two together fit an
//      80mm page next to genuinely long item names.
// Neither rule can be fixed from *inside* `.print-format`'s own children —
// they target `.print-format`/`.print-format td` itself, which our
// template's content sits underneath but never controls. The fix is this
// override block, placed first so it's the last matching rule in document
// order (our `<style>` is emitted after ERPNext's own, so equal-specificity
// rules here win the cascade) — and switching the item list to a single
// column with two lines per item, which has no `<td>`/`<th>` at all, so
// the `!important` padding rule above has nothing left to attach to.
const RECEIPT_PRINT_WIDTH_OVERRIDE = `<style>
  @page { size: 80mm auto; margin: 0; }
  body { margin: 0; }
  .print-format-gutter, .print-format {
    background: #fff !important;
    max-width: 302px !important;
    width: 302px !important;
    min-height: 0 !important;
    padding: 0 !important;
    margin: 0 auto !important;
    border-radius: 0 !important;
    box-sizing: border-box !important;
  }
  .print-format td, .print-format th {
    padding: 0 !important;
  }
</style>`;

// Two lines per item (name, then "qty uom x harga = subtotal" right-
// aligned) — deliberately not a table, so nothing here can be squeezed by
// a table's auto-layout column-width algorithm, and ERPNext's own
// `.print-format td { padding: 10px !important }` (see the doc comment on
// RECEIPT_PRINT_WIDTH_OVERRIDE above) has no `<td>` left to apply to.
const RECEIPT_ITEMS_LIST = `<div style="border-top: 1px dashed #999; padding-top: 6px;">
    {% for item in doc.items %}
    <div style="{% if not loop.first %}margin-top:6px;{% endif %} word-wrap: break-word;">{{ item.item_name }}</div>
    <div style="text-align:right; font-size:11px; color:#444;">{{ item.qty|int if item.qty == item.qty|int else item.qty }} {{ item.uom }} x {{ "{:,.0f}".format(item.rate)|replace(",", ".") }} = {{ "{:,.0f}".format(item.amount)|replace(",", ".") }}</div>
    {% endfor %}
  </div>`;

const RECEIPT_TOTALS_BLOCK = `<div style="border-top: 1px dashed #999; margin-top: 8px; padding-top: 8px;">
    {% if doc.discount_amount %}
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Diskon</span><span>Rp {{ "{:,.0f}".format(doc.discount_amount)|replace(",", ".") }}</span>
    </div>
    {% endif %}
    <div style="display:flex; justify-content:space-between; font-size:11px; color:#444;">
      <span>Total item</span><span>{{ doc.items|sum(attribute='qty')|int }}</span>
    </div>
    <div style="display:flex; justify-content:space-between; font-size:15px; font-weight:700; margin-top:4px;">
      <span>TOTAL</span><span>Rp {{ "{:,.0f}".format(doc.grand_total)|replace(",", ".") }}</span>
    </div>
    {% for pmt in doc.payments %}
    <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:4px;">
      <span>{{ pmt.mode_of_payment }}</span><span>Rp {{ "{:,.0f}".format(pmt.amount)|replace(",", ".") }}</span>
    </div>
    {% endfor %}
    {% if doc.change_amount %}
    <div style="display:flex; justify-content:space-between; font-size:11px;">
      <span>Kembalian</span><span>Rp {{ "{:,.0f}".format(doc.change_amount)|replace(",", ".") }}</span>
    </div>
    {% endif %}
  </div>`;

const RECEIPT_PRINT_FORMAT_STANDARD_NAME = 'Hermes Struk Kasir';
const RECEIPT_PRINT_FORMAT_STANDARD_HTML = `${RECEIPT_HEADER_LOOKUP}
${RECEIPT_PRINT_WIDTH_OVERRIDE}
<div style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #171717; width: 302px; max-width: 302px; box-sizing: border-box; padding: 8px; margin: 0 auto;">
  <div style="text-align:center; margin-bottom: 10px;">
    {% if company.custom_receipt_logo_url %}
    <img src="{{ company.custom_receipt_logo_url }}" style="max-height:48px; max-width:160px; margin-bottom:6px;" />
    {% endif %}
    {% if company.custom_receipt_header %}
    <div style="font-size:12px; color:#666; margin-bottom:2px;">{{ company.custom_receipt_header }}</div>
    {% endif %}
    <div style="font-size:15px; font-weight:700;">{{ company.company_name }}</div>
    {% if company.custom_store_address %}
    <div style="font-size:11px; color:#666;">{{ company.custom_store_address }}</div>
    {% endif %}
    {% if company.phone_no %}
    <div style="font-size:11px; color:#666;">No. WhatsApp Toko: {{ company.phone_no }}</div>
    {% endif %}
  </div>
  <div style="text-align:center; margin-bottom: 12px;">
    <div style="font-size: 12px; color:#666;">No. Struk: {{ doc.name }}</div>
    <div style="font-size: 12px; color:#666;">{{ frappe.utils.formatdate(doc.posting_date, "dd-MM-yyyy") }} {{ ((doc.posting_time or "0:0:0")|string).split(".")[0] }}</div>
  </div>
  <div style="border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 8px 0; margin-bottom: 8px;">
    <div style="font-size:12px; color:#666;">Pelanggan: {{ doc.customer_name }}</div>
  </div>
  ${RECEIPT_ITEMS_LIST}
  ${RECEIPT_TOTALS_BLOCK}
  <div style="border-top: 1px dashed #999; text-align:center; margin-top:16px; padding-top:8px; font-size:12px; color:#666;">
    {% if company.custom_receipt_footer %}{{ company.custom_receipt_footer }}{% else %}Terima kasih atas kunjungan Anda!{% endif %}
  </div>
</div>
`;

// Compact — no logo, no address block, tightest spacing/font. Store name
// only (a receipt with literally no store identity isn't useful), for
// shops that want the shortest possible strip on a small thermal printer.
const RECEIPT_PRINT_FORMAT_MINIMAL_NAME = 'Hermes Struk Kasir - Minimal';
const RECEIPT_PRINT_FORMAT_MINIMAL_HTML = `${RECEIPT_HEADER_LOOKUP}
${RECEIPT_PRINT_WIDTH_OVERRIDE}
<div style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #171717; width: 302px; max-width: 302px; box-sizing: border-box; padding: 8px; margin: 0 auto;">
  <div style="text-align:center; margin-bottom: 6px;">
    {% if company.custom_receipt_logo_url %}
    <img src="{{ company.custom_receipt_logo_url }}" style="max-height:32px; max-width:120px; margin-bottom:4px;" />
    {% endif %}
    {% if company.custom_receipt_header %}
    <div style="font-size:9px; color:#666;">{{ company.custom_receipt_header }}</div>
    {% endif %}
    <div style="font-size:13px; font-weight:700;">{{ company.company_name }}</div>
    <div style="font-size:10px; color:#666;">{{ doc.name }} · {{ frappe.utils.formatdate(doc.posting_date, "dd-MM-yyyy") }}</div>
  </div>
  <div style="border-top: 1px dashed #999; padding-top:4px; font-size:10px;">
    {% for item in doc.items %}
    <div style="{% if not loop.first %}margin-top:4px;{% endif %} word-wrap: break-word;">{{ item.item_name }}</div>
    <div style="text-align:right; color:#444;">{{ item.qty|int if item.qty == item.qty|int else item.qty }} {{ item.uom }} x {{ "{:,.0f}".format(item.rate)|replace(",", ".") }} = {{ "{:,.0f}".format(item.amount)|replace(",", ".") }}</div>
    {% endfor %}
  </div>
  <div style="display:flex; justify-content:space-between; font-size:10px; color:#444; margin-top:4px;">
    <span>Total item</span><span>{{ doc.items|sum(attribute='qty')|int }}</span>
  </div>
  <div style="border-top: 1px dashed #999; margin-top: 4px; padding-top: 4px; display:flex; justify-content:space-between; font-size:13px; font-weight:700;">
    <span>TOTAL</span><span>Rp {{ "{:,.0f}".format(doc.grand_total)|replace(",", ".") }}</span>
  </div>
  {% for pmt in doc.payments %}
  <div style="display:flex; justify-content:space-between; font-size:10px;">
    <span>{{ pmt.mode_of_payment }}</span><span>Rp {{ "{:,.0f}".format(pmt.amount)|replace(",", ".") }}</span>
  </div>
  {% endfor %}
  {% if company.custom_receipt_footer %}
  <div style="border-top: 1px dashed #999; text-align:center; margin-top:6px; padding-top:6px; font-size:9px; color:#666;">{{ company.custom_receipt_footer }}</div>
  {% endif %}
</div>
`;

// Detailed — full branding: logo, address, WA, website, a warmer footer,
// for owners who want the receipt to double as a small piece of
// marketing. The old version also drew a decorative border/rounded-corner
// "card" around the whole thing — dropped for 80mm printing: a monochrome
// thermal head can't render rounded corners meaningfully, and 14px of
// padding *per side* on top of that border was stealing 28px out of an
// already-tight 302px page for no functional benefit.
const RECEIPT_PRINT_FORMAT_DETAILED_NAME = 'Hermes Struk Kasir - Detail';
const RECEIPT_PRINT_FORMAT_DETAILED_HTML = `${RECEIPT_HEADER_LOOKUP}
${RECEIPT_PRINT_WIDTH_OVERRIDE}
<div style="font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #171717; width: 302px; max-width: 302px; box-sizing: border-box; padding: 8px; margin: 0 auto;">
  <div style="text-align:center; margin-bottom: 10px;">
    {% if company.custom_receipt_logo_url %}
    <img src="{{ company.custom_receipt_logo_url }}" style="max-height:56px; max-width:160px; margin-bottom:8px;" />
    {% endif %}
    {% if company.custom_receipt_header %}
    <div style="font-size:12px; color:#666; margin-bottom:2px;">{{ company.custom_receipt_header }}</div>
    {% endif %}
    <div style="font-size:16px; font-weight:700;">{{ company.company_name }}</div>
    {% if company.custom_store_address %}
    <div style="font-size:11px; color:#666; margin-top:2px;">{{ company.custom_store_address }}</div>
    {% endif %}
    {% if company.phone_no %}
    <div style="font-size:11px; color:#666;">No. WhatsApp Toko: {{ company.phone_no }}</div>
    {% endif %}
    {% if company.website %}
    <div style="font-size:11px; color:#666;">{{ company.website }}</div>
    {% endif %}
  </div>
  <div style="text-align:center; margin-bottom: 12px;">
    <div style="font-size: 12px; color:#666;">No. Struk: {{ doc.name }}</div>
    <div style="font-size: 12px; color:#666;">{{ frappe.utils.formatdate(doc.posting_date, "dd-MM-yyyy") }} {{ ((doc.posting_time or "0:0:0")|string).split(".")[0] }}</div>
  </div>
  <div style="border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 8px 0; margin-bottom: 8px;">
    <div style="font-size:12px; color:#666;">Pelanggan: {{ doc.customer_name }}</div>
  </div>
  ${RECEIPT_ITEMS_LIST}
  ${RECEIPT_TOTALS_BLOCK}
  <div style="border-top: 1px dashed #999; text-align:center; margin-top:16px; padding-top:8px; font-size:12px; color:#666;">
    {% if company.custom_receipt_footer %}{{ company.custom_receipt_footer }}{% else %}Terima kasih atas kunjungan Anda di {{ company.company_name }}!{% endif %}
    {% if company.phone_no %}<br />Ada pertanyaan? WhatsApp kami di {{ company.phone_no }}.{% endif %}
  </div>
</div>
`;

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

async function ensureUom(uomName: string, mustBeWholeNumber: boolean): Promise<void> {
  try {
    await erpNextClient.get('UOM', uomName);
    logger.info({ uomName }, 'seed.uom.exists');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create('UOM', {
    uom_name: uomName,
    must_be_whole_number: mustBeWholeNumber ? 1 : 0,
  });
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

/** Generic "create if the name doesn't already exist" helper for simple master-list doctypes. */
async function ensureDoc(
  doctype: string,
  name: string,
  createPayload: Record<string, unknown>,
): Promise<void> {
  try {
    await erpNextClient.get(doctype, name);
    logger.info({ doctype, name }, 'seed.doc.exists');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create(doctype, createPayload);
  logger.info({ doctype, name }, 'seed.doc.created');
}

/**
 * Print Format content evolves (this exact seed script upgraded the
 * receipt layout twice already) — unlike the master-list doctypes
 * `ensureDoc` handles, re-running the seed should converge an *existing*
 * Print Format's HTML to the latest version here, not silently leave a
 * stale one in place just because a doc with that name already exists.
 */
async function upsertPrintFormat(
  name: string,
  html: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const payload = {
    doc_type: 'Sales Invoice',
    module: 'Accounts',
    print_format_type: 'Jinja',
    standard: 'No',
    custom_format: 1,
    disabled: 0,
    font_size: 12,
    page_number: 'Hide',
    html,
    ...extra,
  };

  try {
    await erpNextClient.get('Print Format', name);
    await erpNextClient.update('Print Format', name, payload);
    logger.info({ name }, 'seed.print_format.updated');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create('Print Format', { name, ...payload });
  logger.info({ name }, 'seed.print_format.created');
}

async function ensureCompany(): Promise<{ name: string; defaultCashAccount: string }> {
  interface CompanyDoc {
    name: string;
    default_cash_account: string;
  }

  try {
    const existing = await erpNextClient.get<CompanyDoc>('Company', COMPANY_NAME);
    logger.info({ name: COMPANY_NAME }, 'seed.company.exists');
    return { name: existing.name, defaultCashAccount: existing.default_cash_account };
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  // Creating a Company triggers ERPNext's on_update hook, which builds the
  // Chart of Accounts and a handful of generic default warehouses — it
  // needs Warehouse Type "Transit" to already exist for that to succeed.
  await ensureDoc('Warehouse Type', WAREHOUSE_TYPE, { name: WAREHOUSE_TYPE });

  const created = await erpNextClient.create<CompanyDoc>('Company', {
    company_name: COMPANY_NAME,
    abbr: COMPANY_ABBR,
    default_currency: COMPANY_CURRENCY,
    country: COMPANY_COUNTRY,
    valuation_method: 'FIFO',
  });
  logger.info({ name: COMPANY_NAME }, 'seed.company.created');
  return { name: created.name, defaultCashAccount: created.default_cash_account };
}

async function ensureFiscalYear(): Promise<void> {
  const year = new Date().getFullYear();
  await ensureDoc('Fiscal Year', String(year), {
    year: String(year),
    year_start_date: `${year}-01-01`,
    year_end_date: `${year}-12-31`,
  });
}

async function ensureWarehouse(company: string): Promise<void> {
  await ensureDoc('Warehouse', env.ERPNEXT_DEFAULT_WAREHOUSE, {
    warehouse_name: WAREHOUSE_NAME,
    company,
  });
}

async function ensureItemGroups(): Promise<void> {
  await ensureDoc('Item Group', ROOT_ITEM_GROUP, {
    item_group_name: ROOT_ITEM_GROUP,
    is_group: 1,
  });
  await ensureDoc('Item Group', DEFAULT_ITEM_GROUP, {
    item_group_name: DEFAULT_ITEM_GROUP,
    parent_item_group: ROOT_ITEM_GROUP,
    is_group: 0,
  });
}

async function ensureStockEntryTypes(): Promise<void> {
  for (const type of STOCK_ENTRY_TYPES) {
    await ensureDoc('Stock Entry Type', type.name, { name: type.name, purpose: type.purpose });
  }
}

async function ensureBankAccount(accountName: string, company: string): Promise<string> {
  const fullName = `${accountName} - ${COMPANY_ABBR}`;
  await ensureDoc('Account', fullName, {
    account_name: accountName,
    company,
    parent_account: `Bank Accounts - ${COMPANY_ABBR}`,
    account_type: 'Bank',
    is_group: 0,
  });
  return fullName;
}

async function ensureModesOfPayment(company: string, defaultCashAccount: string): Promise<void> {
  for (const mode of MODES_OF_PAYMENT) {
    const account = mode.dedicatedAccountName
      ? await ensureBankAccount(mode.dedicatedAccountName, company)
      : defaultCashAccount;

    await ensureDoc('Mode of Payment', mode.name, {
      mode_of_payment: mode.name,
      type: mode.type,
      accounts: [{ company, default_account: account }],
    });
  }
}

async function ensureWalkInCustomer(): Promise<void> {
  await ensureDoc('Customer', 'Walk-in Customer', {
    customer_name: 'Walk-in Customer',
    customer_type: 'Individual',
    customer_tier: 'Retail',
  });
}

// Doctypes that trigger cache invalidation / cross-module events on
// change, per spec §3.2 — plus Sales Invoice, since sales-pos completes a
// POS sale by submitting a stock-updating Sales Invoice (not a Sales
// Order), which needs the same cache invalidation as a Stock Entry.
// Registered against ERPNext's Webhook doctype so they actually fire
// against apps/api's /webhooks/erpnext (§10 Phase 2).
const ERPNEXT_WEBHOOK_SUBSCRIPTIONS: Array<{ doctype: string; event: string }> = [
  { doctype: 'Stock Entry', event: 'on_submit' },
  { doctype: 'Stock Reconciliation', event: 'on_submit' },
  { doctype: 'Item', event: 'on_update' },
  { doctype: 'Sales Invoice', event: 'on_submit' },
];

async function ensureErpNextWebhooks(): Promise<void> {
  for (const subscription of ERPNEXT_WEBHOOK_SUBSCRIPTIONS) {
    const already = await existsByFilter('Webhook', [
      ['webhook_doctype', '=', subscription.doctype],
      ['webhook_docevent', '=', subscription.event],
      ['request_url', '=', env.ERPNEXT_WEBHOOK_CALLBACK_URL],
    ]);
    if (already) {
      logger.info(subscription, 'seed.webhook.exists');
      continue;
    }

    await erpNextClient.create('Webhook', {
      __newname: `Hermes - ${subscription.doctype} - ${subscription.event}`,
      webhook_doctype: subscription.doctype,
      webhook_docevent: subscription.event,
      request_url: env.ERPNEXT_WEBHOOK_CALLBACK_URL,
      request_method: 'POST',
      request_structure: 'JSON',
      // Without this, Frappe posts an empty `{}` body — webhook_json is a
      // Jinja template. `doc.as_json()` fails under Frappe's sandboxed
      // Jinja environment (method calls blocked); `doc | tojson` is the
      // data-only equivalent and is allowed.
      webhook_json: '{{ doc | tojson }}',
      enabled: 1,
      enable_security: env.ERPNEXT_WEBHOOK_SECRET ? 1 : 0,
      ...(env.ERPNEXT_WEBHOOK_SECRET ? { webhook_secret: env.ERPNEXT_WEBHOOK_SECRET } : {}),
    });
    logger.info(subscription, 'seed.webhook.created');
  }

  if (!env.ERPNEXT_WEBHOOK_SECRET) {
    logger.warn(
      'seed.webhook.no_secret_configured — signature verification will be skipped; set ERPNEXT_WEBHOOK_SECRET before exposing /webhooks/erpnext beyond localhost',
    );
  }
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

async function ensureSeedUser(spec: {
  email: string;
  firstName: string;
  role: string;
}): Promise<void> {
  try {
    await erpNextClient.get('User', spec.email);
    logger.info({ email: spec.email }, 'seed.user.exists');
    return;
  } catch (error) {
    if (!(error instanceof ErpNextApiError) || error.statusCode !== 404) {
      throw error;
    }
  }

  await erpNextClient.create('User', {
    email: spec.email,
    first_name: spec.firstName,
    send_welcome_email: 0,
    new_password: SEED_USER_PASSWORD,
    hermes_role: spec.role,
  });
  logger.info({ email: spec.email, role: spec.role }, 'seed.user.created');
}

async function main(): Promise<void> {
  for (const field of CUSTOMER_CUSTOM_FIELDS) {
    await ensureCustomField('Customer', field);
  }

  for (const priceList of PRICE_LISTS) {
    await ensurePriceList(priceList);
  }

  for (const uom of UOMS) {
    await ensureUom(uom.name, uom.mustBeWholeNumber);
  }

  await ensureUomCategory(UOM_CATEGORY);

  for (const conversion of UOM_CONVERSIONS) {
    await ensureUomConversionFactor(conversion.from, conversion.to, conversion.value);
  }

  const company = await ensureCompany();
  await ensureFiscalYear();
  await ensureWarehouse(company.name);
  await ensureItemGroups();
  await ensureStockEntryTypes();
  await ensureModesOfPayment(company.name, company.defaultCashAccount);
  await ensureWalkInCustomer();
  await ensureErpNextWebhooks();

  for (const field of COMPANY_CUSTOM_FIELDS) {
    await ensureCustomField('Company', field);
  }

  for (const field of ITEM_CUSTOM_FIELDS) {
    await ensureCustomField('Item', field);
  }

  await upsertPrintFormat(RECEIPT_PRINT_FORMAT_STANDARD_NAME, RECEIPT_PRINT_FORMAT_STANDARD_HTML);
  await upsertPrintFormat(RECEIPT_PRINT_FORMAT_MINIMAL_NAME, RECEIPT_PRINT_FORMAT_MINIMAL_HTML);
  await upsertPrintFormat(RECEIPT_PRINT_FORMAT_DETAILED_NAME, RECEIPT_PRINT_FORMAT_DETAILED_HTML);

  await ensureCustomField('User', USER_ROLE_FIELD);
  for (const user of SEED_USERS) {
    await ensureSeedUser(user);
  }

  logger.info('seed.done');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.error({ err: error }, 'seed.failed');
    process.exit(1);
  });
