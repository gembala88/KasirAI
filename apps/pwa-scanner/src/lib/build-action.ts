import type { AddStockAction, ReduceStockAction, TransferAction } from './types';

/** This form's own 3 actions — "Tambah Produk Baru" (create-item) has its own dedicated form/builder in build-item-action.ts, since its fields don't overlap with these at all. */
export type StockActionType = 'add-stock' | 'reduce-stock' | 'transfer';
type StockAction = AddStockAction | ReduceStockAction | TransferAction;

export interface ScanFormFields {
  itemCode: string;
  qty: string;
  rate: string;
  warehouse: string;
  toWarehouse: string;
}

/** Validates and converts raw form input into a ScanAction, or returns a Bahasa Indonesia error message. */
export function buildAction(type: StockActionType, fields: ScanFormFields): StockAction | string {
  const itemCode = fields.itemCode.trim();
  const qty = Number(fields.qty);

  if (!itemCode) {
    return 'Kode barang wajib diisi';
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return 'Jumlah harus lebih dari 0';
  }

  if (type === 'add-stock') {
    const rate = Number(fields.rate);
    if (!Number.isFinite(rate) || rate < 0) {
      return 'Harga satuan tidak valid';
    }
    return {
      type,
      itemCode,
      qty,
      rate,
      ...(fields.warehouse.trim() ? { warehouse: fields.warehouse.trim() } : {}),
    };
  }

  if (type === 'reduce-stock') {
    return {
      type,
      itemCode,
      qty,
      ...(fields.warehouse.trim() ? { warehouse: fields.warehouse.trim() } : {}),
    };
  }

  const toWarehouse = fields.toWarehouse.trim();
  if (!toWarehouse) {
    return 'Gudang tujuan wajib diisi';
  }
  return {
    type,
    itemCode,
    qty,
    toWarehouse,
    ...(fields.warehouse.trim() ? { fromWarehouse: fields.warehouse.trim() } : {}),
  };
}
