import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../auth/interfaces/index.js';
import { env } from '../../../config/env.js';
import { ValidationError } from '../../../shared/errors/index.js';
import {
  getStock,
  listLowStock,
  listNearExpiry,
  listWarehouses,
  scanAddStock,
  scanReduceStock,
  scanTransfer,
  submitStockOpname,
} from '../application/index.js';

const stockOpnameSchema = z.object({
  warehouse: z.string().default(env.ERPNEXT_DEFAULT_WAREHOUSE),
  lines: z
    .array(z.object({ itemCode: z.string().min(1), countedQty: z.number().nonnegative() }))
    .min(1),
});

const addStockSchema = z.object({
  itemCode: z.string().min(1),
  warehouse: z.string().default(env.ERPNEXT_DEFAULT_WAREHOUSE),
  qty: z.number().positive(),
  rate: z.number().nonnegative(),
});

const reduceStockSchema = z.object({
  itemCode: z.string().min(1),
  warehouse: z.string().default(env.ERPNEXT_DEFAULT_WAREHOUSE),
  qty: z.number().positive(),
});

const transferSchema = z.object({
  itemCode: z.string().min(1),
  fromWarehouse: z.string().default(env.ERPNEXT_DEFAULT_WAREHOUSE),
  toWarehouse: z.string().min(1),
  qty: z.number().positive(),
});

const STOCK_READ_ROLES = ['Owner', 'Manager', 'Cashier', 'Warehouse Staff'] as const;
const INVENTORY_MANAGE_ROLES = ['Owner', 'Manager', 'Warehouse Staff'] as const;

/**
 * Inventory module — public HTTP boundary (spec §1.3 FR-2, FR-7, §6).
 * Stock reads are broadly available (Cashier needs it mid-sale); alerts
 * and every write action are Owner/Manager/Warehouse Staff only, per
 * §1.3 FR-8 ("Warehouse staff (inventory-focused)").
 */
export function registerInventoryRoutes(app: FastifyInstance): void {
  app.get('/api/v1/inventory/_status', async () => ({
    module: 'inventory',
    status: 'scaffolded',
  }));

  app.get<{ Params: { id: string }; Querystring: { warehouse?: string } }>(
    '/api/v1/products/:id/stock',
    { preHandler: requireRole(...STOCK_READ_ROLES) },
    async (request) => {
      const levels = await getStock(request.params.id, request.query.warehouse);
      return { itemCode: request.params.id, levels };
    },
  );

  // Every warehouse worth writing stock into (leaf nodes only, system
  // defaults excluded) — the autocomplete source for every Gudang field:
  // Input Stok, Transfer, and "Tambah Produk Baru"'s Stok Awal. Also
  // returns the store's actual default so those fields can pre-select it.
  app.get(
    '/api/v1/inventory/warehouses',
    { preHandler: requireRole(...STOCK_READ_ROLES) },
    async () => listWarehouses(),
  );

  app.get<{ Querystring: { threshold?: string } }>(
    '/api/v1/inventory/alerts/low-stock',
    { preHandler: requireRole(...INVENTORY_MANAGE_ROLES) },
    async (request) => {
      const threshold = request.query.threshold ? Number(request.query.threshold) : 5;
      if (!Number.isFinite(threshold) || threshold < 0) {
        throw new ValidationError('threshold must be a non-negative number');
      }
      return { threshold, alerts: await listLowStock(threshold) };
    },
  );

  app.get<{ Querystring: { days?: string } }>(
    '/api/v1/inventory/alerts/near-expiry',
    { preHandler: requireRole(...INVENTORY_MANAGE_ROLES) },
    async (request) => {
      const days = request.query.days ? Number(request.query.days) : 30;
      if (!Number.isFinite(days) || days < 0) {
        throw new ValidationError('days must be a non-negative number');
      }
      return { daysAhead: days, alerts: await listNearExpiry(days) };
    },
  );

  app.post(
    '/api/v1/inventory/stock-opname',
    { preHandler: requireRole(...INVENTORY_MANAGE_ROLES) },
    async (request) => {
      const parsed = stockOpnameSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return submitStockOpname(parsed.data.warehouse, parsed.data.lines);
    },
  );

  app.post(
    '/api/v1/inventory/scan/add-stock',
    { preHandler: requireRole(...INVENTORY_MANAGE_ROLES) },
    async (request) => {
      const parsed = addStockSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      const { itemCode, warehouse, qty, rate } = parsed.data;
      return scanAddStock(itemCode, warehouse, qty, rate);
    },
  );

  app.post(
    '/api/v1/inventory/scan/reduce-stock',
    { preHandler: requireRole(...INVENTORY_MANAGE_ROLES) },
    async (request) => {
      const parsed = reduceStockSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      const { itemCode, warehouse, qty } = parsed.data;
      return scanReduceStock(itemCode, warehouse, qty);
    },
  );

  app.post(
    '/api/v1/inventory/scan/transfer',
    { preHandler: requireRole(...INVENTORY_MANAGE_ROLES) },
    async (request) => {
      const parsed = transferSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      const { itemCode, fromWarehouse, toWarehouse, qty } = parsed.data;
      return scanTransfer(itemCode, fromWarehouse, toWarehouse, qty);
    },
  );
}
