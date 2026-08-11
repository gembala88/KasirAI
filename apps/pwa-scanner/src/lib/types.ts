export interface AddStockAction {
  type: 'add-stock';
  itemCode: string;
  warehouse?: string;
  qty: number;
  rate: number;
}

export interface ReduceStockAction {
  type: 'reduce-stock';
  itemCode: string;
  warehouse?: string;
  qty: number;
}

export interface TransferAction {
  type: 'transfer';
  itemCode: string;
  fromWarehouse?: string;
  toWarehouse: string;
  qty: number;
}

/**
 * Bulk product onboarding from the Gudang scan screen ("Tambah Produk
 * Baru") — a scanned barcode that doesn't match any existing Item.
 * Deliberately minimal fields (spec: "don't require every ERPNext Item
 * field") — everything else gets a sensible server-side default, same as
 * every throwaway test Item this project has ever created.
 */
/** A package/selling unit above the item's base unit — e.g. a "Dus" of 8 "Renteng". Each carries its own Retail/Grosir price(s), since a Dus obviously doesn't sell for the same price as one Renteng. */
export interface PackageUom {
  uom: string;
  conversionQty: number;
  retailPrice: number;
  grosirPrice?: number;
}

export interface CreateItemAction {
  type: 'create-item';
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  retailPrice: number;
  /** Omitted entirely (not 0) when there's no separate Grosir price — 0 would be a real, wrong price. */
  grosirPrice?: number;
  /** Required whenever openingQty > 0 — otherwise the opening stock would land at zero valuation (100% margin bug). Optional when registering a catalog-only entry with no stock yet. */
  costPrice?: number;
  /** Physical count on hand right now, if any. Omitted/0 means "register only, stock separately via Tambah Stok". */
  openingQty?: number;
  warehouse?: string;
  packageUoms?: PackageUom[];
}

/**
 * Edit from Daftar Produk — price-only (see apps/api's updateItemPrice doc
 * comment: ERPNext blocks direct UOM changes on any item with stock
 * history, so a UOM correction still needs the manual disable+recreate
 * flow, not a field on this form). At least one of
 * retailPrice/grosirPrice/costPrice is required — enforced in
 * build-price-action.ts.
 */
export interface UpdateItemPriceAction {
  type: 'update-item-price';
  itemCode: string;
  uom: string;
  retailPrice?: number;
  grosirPrice?: number;
  costPrice?: number;
  warehouse?: string;
}

export type ScanAction = AddStockAction | ReduceStockAction | TransferAction | CreateItemAction;
export type ScanActionType = ScanAction['type'];

export interface PosSaleLine {
  itemCode: string;
  qty: number;
  rate?: number;
}

/** One checkout, queued as a single offline action even though it's two ERPNext writes server-side (create invoice, then pay) — see apps/api's sync module for how that stays idempotent under retry. */
export interface PosSaleAction {
  type: 'pos-sale';
  lines: PosSaleLine[];
  customerId?: string;
  modeOfPayment: string;
  amount: number;
}

/**
 * Kasbon / credit sale (Group 3) — a distinct action from PosSaleAction,
 * not a variant of it: there's no modeOfPayment/amount at all (the
 * invoice is submitted with zero payment by design), and customerId is
 * required, not optional — Kasbon is meaningless for Walk-in Customer.
 */
export interface KasbonSaleAction {
  type: 'kasbon-sale';
  lines: PosSaleLine[];
  customerId: string;
}

export type OfflineAction = ScanAction | PosSaleAction | KasbonSaleAction | UpdateItemPriceAction;
export type OfflineActionType = OfflineAction['type'];
