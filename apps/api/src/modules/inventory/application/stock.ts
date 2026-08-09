/**
 * Inventory module — stock reads and alerts (spec §1.3 FR-2).
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import type { LowStockAlert, NearExpiryAlert, StockLevel, WarehouseList } from '../domain/index.js';
import { stockCache, stockCacheKey } from '../infrastructure/stock-cache.js';

interface BinRecord {
  item_code: string;
  warehouse: string;
  actual_qty: number;
}

interface WarehouseRecord {
  name: string;
}

/**
 * ERPNext auto-creates this fixed set of warehouses for every Company
 * ("Stores", "Work In Progress", "Finished Goods", "Goods In Transit" —
 * see erpnext/setup/setup_wizard/operations/company_setup.py), translated
 * per the company's language. Real UX gap found live: with two Companies
 * seeded (TH, NPG) that's 8 auto-generated warehouses cluttering every
 * Gudang picker alongside the 2 actual store warehouses — a cashier or
 * warehouse worker has no way to tell "Finished Goods - TH" apart from
 * the one they should actually pick. ERPNext has no field marking these
 * as system-generated (warehouse_type is null on most of them), so this
 * is a name-based match against the known default set, both languages
 * observed in this deployment.
 */
const SYSTEM_DEFAULT_WAREHOUSE_BASE_NAMES = new Set([
  'stores',
  'work in progress',
  'finished goods',
  'goods in transit',
  'pekerjaan dalam proses',
  'stok barang jadi',
  'barang dalam transit',
]);

/** Strips ERPNext's " - {company abbr}" suffix, e.g. "Stores - TH" -> "stores". */
function warehouseBaseName(name: string): string {
  return name
    .replace(/\s*-\s*[^-]+$/, '')
    .trim()
    .toLowerCase();
}

function isSystemDefaultWarehouse(name: string): boolean {
  return SYSTEM_DEFAULT_WAREHOUSE_BASE_NAMES.has(warehouseBaseName(name));
}

/**
 * Leaf warehouses only (is_group=0) — same "exclude category/parent tree
 * nodes" rule as Item Group — with ERPNext's auto-generated per-Company
 * defaults filtered out (see isSystemDefaultWarehouse). Real bug this
 * closes: every Gudang field in the app (Input Stok, Transfer, and
 * "Tambah Produk Baru"'s Stok Awal) was plain free text with nothing to
 * validate against, so a warehouse worker typing a plausible-looking but
 * wrong value (confirmed live: "4", "60") only found out at ERPNext's own
 * raw, untranslated error — after the item and its prices had already
 * been created, with just the opening stock left dangling as a Failed
 * sync row.
 */
export async function listWarehouses(): Promise<WarehouseList> {
  const warehouses = await erpNextClient.list<WarehouseRecord>('Warehouse', {
    filters: [['is_group', '=', 0]],
    fields: ['name'],
    order_by: 'name asc',
    limit_page_length: '200',
  });
  return {
    warehouses: warehouses
      .filter((w) => !isSystemDefaultWarehouse(w.name))
      .map((w) => ({ name: w.name })),
    default: env.ERPNEXT_DEFAULT_WAREHOUSE,
  };
}

/**
 * Real-time stock read from ERPNext's Bin doctype — cached for read-speed
 * only (TTL 30s), never treated as the source of truth. Invalidated early
 * by the /webhooks/erpnext receiver on Stock Entry / Stock Reconciliation
 * submission.
 */
export async function getStock(itemCode: string, warehouse?: string): Promise<StockLevel[]> {
  const cacheKey = stockCacheKey(itemCode, warehouse);
  const cached = stockCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const filters: unknown[][] = [['item_code', '=', itemCode]];
  if (warehouse) {
    filters.push(['warehouse', '=', warehouse]);
  }

  const bins = await erpNextClient.list<BinRecord>('Bin', {
    filters,
    fields: ['item_code', 'warehouse', 'actual_qty'],
  });

  const levels: StockLevel[] = bins.map((bin) => ({
    itemCode: bin.item_code,
    warehouse: bin.warehouse,
    actualQty: bin.actual_qty,
  }));

  stockCache.set(cacheKey, levels);
  return levels;
}

/**
 * Threshold-based low-stock check against the default warehouse. Not
 * ERPNext's per-item reorder-level feature (that needs a reorder rule
 * configured per item) — a simple, always-available floor check that
 * works for every item without extra per-item setup.
 */
export async function listLowStock(threshold: number): Promise<LowStockAlert[]> {
  const bins = await erpNextClient.list<BinRecord>('Bin', {
    filters: [
      ['warehouse', '=', env.ERPNEXT_DEFAULT_WAREHOUSE],
      ['actual_qty', '<=', threshold],
    ],
    fields: ['item_code', 'warehouse', 'actual_qty'],
  });

  if (bins.length === 0) {
    return [];
  }

  const items = await erpNextClient.list<{ item_code: string; item_name: string }>('Item', {
    filters: [['item_code', 'in', bins.map((bin) => bin.item_code)]],
    fields: ['item_code', 'item_name'],
  });
  const itemNameByCode = new Map(items.map((item) => [item.item_code, item.item_name]));

  return bins.map((bin) => ({
    itemCode: bin.item_code,
    itemName: itemNameByCode.get(bin.item_code) ?? bin.item_code,
    warehouse: bin.warehouse,
    actualQty: bin.actual_qty,
    threshold,
  }));
}

/**
 * Batches (ERPNext's expiry-tracking doctype, spec §1.3 FR-2) expiring
 * within `daysAhead`, with remaining quantity still in stock.
 */
export async function listNearExpiry(daysAhead: number): Promise<NearExpiryAlert[]> {
  const today = new Date();
  const cutoff = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const isoToday = today.toISOString().slice(0, 10);
  const isoCutoff = cutoff.toISOString().slice(0, 10);

  const batches = await erpNextClient.list<{
    name: string;
    item: string;
    expiry_date: string;
    batch_qty: number;
  }>('Batch', {
    filters: [
      ['expiry_date', '>=', isoToday],
      ['expiry_date', '<=', isoCutoff],
      ['batch_qty', '>', 0],
    ],
    fields: ['name', 'item', 'expiry_date', 'batch_qty'],
  });

  return batches.map((batch) => ({
    batchId: batch.name,
    itemCode: batch.item,
    expiryDate: batch.expiry_date,
    daysUntilExpiry: Math.ceil(
      (new Date(batch.expiry_date).getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
    ),
    batchQty: batch.batch_qty,
  }));
}
