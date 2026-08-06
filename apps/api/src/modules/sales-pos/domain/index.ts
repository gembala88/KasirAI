/**
 * Sales/POS module — domain layer (spec §1.3 FR-1).
 */

export type CustomerTier = 'Retail' | 'Grosir' | 'Member';

export const CUSTOMER_TIERS: CustomerTier[] = ['Retail', 'Grosir', 'Member'];

export interface ProductSearchResult {
  itemCode: string;
  itemName: string;
  stockUom: string;
  priceList: string;
  price: number | null;
}

export interface ProductPrice {
  itemCode: string;
  priceList: string;
  price: number | null;
}

/**
 * One page of the full product catalog (spec §15.3 offline cache) — always
 * Retail-tier pricing, since that's what a cache-served result defaults to
 * for a walk-in customer. Grosir/Member pricing still requires a live
 * lookup; the client is responsible for flagging that (see pwa-scanner's
 * catalog-cache staleness handling).
 */
export interface CatalogItem {
  itemCode: string;
  itemName: string;
  stockUom: string;
  retailPrice: number | null;
}

/**
 * Bulk product onboarding from the Gudang scan screen — a warehouse
 * worker scans a barcode with no matching Item and fills this in on the
 * spot, standing in front of the shelf. Deliberately minimal (spec:
 * "don't require every ERPNext Item field, just the ones listed") —
 * everything else on the Item gets a sensible default (is_stock_item=1,
 * disabled=0, etc.), the same defaults every throwaway test Item this
 * project has created used.
 */
/**
 * A package/selling UOM above the item's base unit — e.g. a "Dus" of 8
 * "Renteng". conversionQty is how many base units make up one of this
 * UOM (ERPNext's own UOM Conversion Factor), and it carries its own
 * Retail/Grosir price(s) since a Dus obviously doesn't sell for the same
 * price as one Renteng.
 */
export interface PackageUomInput {
  uom: string;
  conversionQty: number;
  retailPrice: number;
  grosirPrice?: number | undefined;
}

export interface NewItemInput {
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  retailPrice: number;
  /** Omitted entirely (not just 0) when the item has no separate Grosir price — 0 would be a real, wrong price, not "not applicable". */
  grosirPrice?: number | undefined;
  packageUoms?: PackageUomInput[] | undefined;
}

export interface UomPriceResult {
  uom: string;
  retailPrice: number;
  grosirPrice: number | null;
}

export interface NewItemResult {
  itemCode: string;
  itemName: string;
  retailPrice: number;
  grosirPrice: number | null;
  packageUoms: UomPriceResult[];
}

export interface ItemGroupOption {
  name: string;
}

export interface UomOption {
  name: string;
}

/** Full per-UOM price breakdown for an already-registered item — what "Tambah Produk Baru"'s existing-item card shows (spec: don't hide a Dus price behind a single Retail number once items can be multi-UOM). */
export interface ItemUomPrices {
  itemCode: string;
  itemName: string;
  stockUom: string;
  uoms: {
    uom: string;
    retailPrice: number | null;
    grosirPrice: number | null;
  }[];
}

export interface CartLineInput {
  itemCode: string;
  qty: number;
  /** Explicit rate override; resolved automatically from the tier's Price List when omitted. */
  rate?: number | undefined;
  warehouse?: string | undefined;
}

export interface PaymentInput {
  modeOfPayment: string;
  amount: number;
}

export interface PosTransaction {
  name: string;
  status: string;
  customer: string;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  /** Source Sales Order name, set only for invoices created via the WhatsApp payment flow (§10 Phase 6). */
  poNo?: string;
  /** Customer's phone number, for the dashboard's payment-confirmation UI (§10 Phase 7) to notify without a second lookup. */
  contactMobile?: string;
}
