export type ScanActionType = 'add-stock' | 'reduce-stock' | 'transfer';

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

export type ScanAction = AddStockAction | ReduceStockAction | TransferAction;

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

export type OfflineAction = ScanAction | PosSaleAction;
export type OfflineActionType = OfflineAction['type'];
