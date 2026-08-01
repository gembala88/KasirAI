/**
 * Inventory module — PWA scanner actions (spec §1.3 FR-7, §6).
 *
 * Each action creates and immediately submits an ERPNext Stock Entry —
 * these are real-time physical actions from a handheld scanner, not
 * drafts to review later.
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { stockCache, stockCacheKey } from '../infrastructure/stock-cache.js';

interface StockEntryResult {
  name: string;
}

function invalidate(itemCode: string, warehouses: string[]): void {
  for (const warehouse of warehouses) {
    stockCache.invalidate(stockCacheKey(itemCode, warehouse));
  }
  stockCache.invalidate(stockCacheKey(itemCode));
}

export async function scanAddStock(
  itemCode: string,
  warehouse: string,
  qty: number,
  rate: number,
): Promise<StockEntryResult> {
  const entry = await erpNextClient.create<StockEntryResult>('Stock Entry', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    stock_entry_type: 'Material Receipt',
    items: [{ item_code: itemCode, qty, t_warehouse: warehouse, basic_rate: rate }],
  });
  const submitted = await erpNextClient.update<StockEntryResult>('Stock Entry', entry.name, {
    docstatus: 1,
  });
  invalidate(itemCode, [warehouse]);
  return submitted;
}

export async function scanReduceStock(
  itemCode: string,
  warehouse: string,
  qty: number,
): Promise<StockEntryResult> {
  const entry = await erpNextClient.create<StockEntryResult>('Stock Entry', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    stock_entry_type: 'Material Issue',
    items: [{ item_code: itemCode, qty, s_warehouse: warehouse }],
  });
  const submitted = await erpNextClient.update<StockEntryResult>('Stock Entry', entry.name, {
    docstatus: 1,
  });
  invalidate(itemCode, [warehouse]);
  return submitted;
}

export async function scanTransfer(
  itemCode: string,
  fromWarehouse: string,
  toWarehouse: string,
  qty: number,
): Promise<StockEntryResult> {
  const entry = await erpNextClient.create<StockEntryResult>('Stock Entry', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    stock_entry_type: 'Material Transfer',
    items: [{ item_code: itemCode, qty, s_warehouse: fromWarehouse, t_warehouse: toWarehouse }],
  });
  const submitted = await erpNextClient.update<StockEntryResult>('Stock Entry', entry.name, {
    docstatus: 1,
  });
  invalidate(itemCode, [fromWarehouse, toWarehouse]);
  return submitted;
}
