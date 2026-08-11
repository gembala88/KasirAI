/**
 * Offline sync module — domain layer (spec §15.2 "Strengthened Offline
 * Sync Queue"). Right-sized for the confirmed single-cashier-device setup
 * (§15) — one staging table and one idempotent endpoint, not a
 * distributed multi-node conflict-resolution engine.
 */

export type SyncStatus = 'Pending' | 'Processing' | 'Synced' | 'Failed' | 'Retry' | 'Conflict';

export interface AddStockAction {
  type: 'add-stock';
  itemCode: string;
  warehouse?: string | undefined;
  qty: number;
  rate: number;
}

export interface ReduceStockAction {
  type: 'reduce-stock';
  itemCode: string;
  warehouse?: string | undefined;
  qty: number;
}

export interface TransferAction {
  type: 'transfer';
  itemCode: string;
  fromWarehouse?: string | undefined;
  toWarehouse: string;
  qty: number;
}

/**
 * Bulk product onboarding from the Gudang scan screen — see sales-pos/domain's NewItemInput, which this mirrors exactly (same shape, different module boundary: sync only knows the wire format, sales-pos owns the business meaning).
 *
 * openingQty/costPrice/warehouse are optional: registering a catalog
 * entry with zero stock (to be stocked later via a separate add-stock
 * action) is still supported. But when openingQty > 0, costPrice is
 * required — without it the opening stock would land in ERPNext with a
 * zero valuation rate, showing 100% margin on every unit sold until a
 * later restock happens to supply a real cost.
 */
/** A package/selling UOM above the item's base unit — see sales-pos/domain's PackageUomInput, which this mirrors exactly. */
export interface PackageUomAction {
  uom: string;
  conversionQty: number;
  retailPrice: number;
  grosirPrice?: number | undefined;
}

export interface CreateItemAction {
  type: 'create-item';
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  retailPrice: number;
  grosirPrice?: number | undefined;
  costPrice?: number | undefined;
  openingQty?: number | undefined;
  warehouse?: string | undefined;
  packageUoms?: PackageUomAction[] | undefined;
}

export interface PosSaleLine {
  itemCode: string;
  qty: number;
  rate?: number | undefined;
}

/**
 * A checkout is one logical offline action even though it's two ERPNext
 * writes under the hood (create invoice, then record payment) — see
 * application/process-action.ts for how the two-step case stays
 * idempotent under retry.
 */
export interface PosSaleAction {
  type: 'pos-sale';
  lines: PosSaleLine[];
  customerId?: string | undefined;
  modeOfPayment: string;
  amount: number;
}

/**
 * Kasbon / credit sale (spec Group 3) — a distinct action type from
 * PosSaleAction, not a variant of it: there's no modeOfPayment/amount at
 * all (createKasbonTransaction submits the invoice with zero payment by
 * design), and customerId is required, not optional — Kasbon is
 * meaningless for Walk-in Customer.
 */
export interface KasbonSaleAction {
  type: 'kasbon-sale';
  lines: PosSaleLine[];
  customerId: string;
}

/**
 * "Edit from Daftar Produk" (price-only — see sales-pos/application's
 * updateItemPrice doc comment for why a UOM change isn't offered here).
 * At least one of retailPrice/grosirPrice/costPrice is required — enforced
 * in sync.routes.ts, since a request with none would be a no-op write.
 * costPrice is a genuinely different write underneath (a Stock
 * Reconciliation's valuation_rate, not an Item Price row — see
 * inventory/application/opname.ts's updateItemCostPrice) but stays one
 * offline-queue action so an owner's single "Simpan" edit can't half-apply
 * if the connection drops between two separate submits.
 */
export interface UpdateItemPriceAction {
  type: 'update-item-price';
  itemCode: string;
  uom: string;
  retailPrice?: number | undefined;
  grosirPrice?: number | undefined;
  costPrice?: number | undefined;
  warehouse?: string | undefined;
}

export type OfflineAction =
  | AddStockAction
  | ReduceStockAction
  | TransferAction
  | PosSaleAction
  | KasbonSaleAction
  | CreateItemAction
  | UpdateItemPriceAction;
export type OfflineActionType = OfflineAction['type'];

export interface SyncRequest {
  uuid: string;
  contentHash: string;
  clientTimestamp: string;
  action: OfflineAction;
}

export interface SyncResponse {
  status: SyncStatus;
  /** The ERPNext write's own result — shape depends on action type (StockEntryResult | PosTransaction). Present only when status is Synced. */
  result?: unknown;
  message?: string | undefined;
  /** True when this call didn't do any work — the UUID was already Synced or Conflict from a prior call, per §15.2's "skipped, not re-applied". */
  skipped: boolean;
}

export interface SyncQueueRow {
  uuid: string;
  actionType: OfflineActionType;
  contentHash: string;
  clientTimestamp: string;
  status: SyncStatus;
  payload: OfflineAction;
  erpnextReference: string | null;
  result: unknown | null;
  errorMessage: string | null;
  createdAt: string;
  syncedAt: string | null;
}
