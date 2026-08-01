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
