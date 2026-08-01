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
