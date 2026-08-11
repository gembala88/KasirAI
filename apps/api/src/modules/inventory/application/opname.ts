/**
 * Inventory module — stock opname / physical count (spec §1.3 FR-2).
 *
 * Creates and submits an ERPNext Stock Reconciliation — the native
 * doctype for physical-count adjustments (§5: don't duplicate ERPNext's
 * schema, use what it already has). Submitting it is what actually moves
 * the Bin quantities to match the count.
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import type {
  StockOpnameLine,
  StockOpnameResult,
  StockOpnameVarianceLine,
} from '../domain/index.js';
import { stockCache, stockCacheKey } from '../infrastructure/stock-cache.js';

interface BinRecord {
  item_code: string;
  actual_qty: number;
}

async function getSystemQty(itemCode: string, warehouse: string): Promise<number> {
  const bins = await erpNextClient.list<BinRecord>('Bin', {
    filters: [
      ['item_code', '=', itemCode],
      ['warehouse', '=', warehouse],
    ],
    fields: ['item_code', 'actual_qty'],
  });
  return bins[0]?.actual_qty ?? 0;
}

export async function submitStockOpname(
  warehouse: string,
  lines: StockOpnameLine[],
): Promise<StockOpnameResult> {
  const variances: StockOpnameVarianceLine[] = await Promise.all(
    lines.map(async (line) => {
      const systemQty = await getSystemQty(line.itemCode, warehouse);
      return {
        itemCode: line.itemCode,
        systemQty,
        countedQty: line.countedQty,
        variance: line.countedQty - systemQty,
      };
    }),
  );

  const reconciliation = await erpNextClient.create<{ name: string }>('Stock Reconciliation', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    purpose: 'Stock Reconciliation',
    items: lines.map((line) => ({
      item_code: line.itemCode,
      warehouse,
      qty: line.countedQty,
    })),
  });

  await erpNextClient.update('Stock Reconciliation', reconciliation.name, { docstatus: 1 });

  for (const line of lines) {
    stockCache.invalidate(stockCacheKey(line.itemCode, warehouse));
    stockCache.invalidate(stockCacheKey(line.itemCode));
  }

  return { reconciliationName: reconciliation.name, warehouse, variances };
}

/**
 * "Edit Harga Modal" (Daftar Produk) — adjusts an item's cost/valuation
 * without moving any stock. There is no direct `Item.valuation_rate` field
 * to write in ERPNext (it's a read-only rollup of the Stock Ledger); the
 * native mechanism for a no-quantity-change valuation correction is the
 * same Stock Reconciliation submitStockOpname uses above, with `qty` set
 * to the *current* on-hand quantity (unchanged) and a `valuation_rate` on
 * the row instead. Real caveat worth knowing: if the item currently has
 * zero stock in this warehouse, this has no lasting effect — the next
 * Material Receipt sets the moving-average valuation from its own
 * basic_rate, not from this reconciliation, since 0 qty carries no prior
 * value forward.
 */
export async function updateItemCostPrice(
  itemCode: string,
  warehouse: string,
  costPrice: number,
): Promise<{ reconciliationName: string; itemCode: string; warehouse: string; qty: number }> {
  const qty = await getSystemQty(itemCode, warehouse);

  const reconciliation = await erpNextClient.create<{ name: string }>('Stock Reconciliation', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    purpose: 'Stock Reconciliation',
    items: [{ item_code: itemCode, warehouse, qty, valuation_rate: costPrice }],
  });

  await erpNextClient.update('Stock Reconciliation', reconciliation.name, { docstatus: 1 });

  stockCache.invalidate(stockCacheKey(itemCode, warehouse));
  stockCache.invalidate(stockCacheKey(itemCode));

  return { reconciliationName: reconciliation.name, itemCode, warehouse, qty };
}
