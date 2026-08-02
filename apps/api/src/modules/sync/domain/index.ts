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

export type OfflineAction = AddStockAction | ReduceStockAction | TransferAction | PosSaleAction;
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
