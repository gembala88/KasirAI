import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../auth/interfaces/index.js';
import type { Role } from '../../auth/interfaces/index.js';
import { ForbiddenError, ValidationError } from '../../../shared/errors/index.js';
import { listConflicts, syncAction } from '../application/index.js';
import type { OfflineActionType } from '../domain/index.js';

const posSaleLineSchema = z.object({
  itemCode: z.string().min(1),
  qty: z.number().positive(),
  rate: z.number().nonnegative().optional(),
});

const packageUomSchema = z.object({
  uom: z.string().min(1),
  conversionQty: z.number().positive(),
  retailPrice: z.number().nonnegative(),
  grosirPrice: z.number().nonnegative().optional(),
});

const offlineActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add-stock'),
    itemCode: z.string().min(1),
    warehouse: z.string().optional(),
    qty: z.number().positive(),
    // Zero silently passed ERPNext's Stock Entry submission with no
    // accounting effect until the item had zero valuation history left to
    // fall back on, then failed with a raw, untranslated 417 — confirmed
    // live (3 real submissions, rate 0, all rejected). The PWA form already
    // requires a positive rate (build-action.ts); this is the actual write
    // boundary, so it must reject it too, not just the form.
    rate: z.number().positive(),
  }),
  z.object({
    type: z.literal('reduce-stock'),
    itemCode: z.string().min(1),
    warehouse: z.string().optional(),
    qty: z.number().positive(),
  }),
  z.object({
    type: z.literal('transfer'),
    itemCode: z.string().min(1),
    fromWarehouse: z.string().optional(),
    toWarehouse: z.string().min(1),
    qty: z.number().positive(),
  }),
  z.object({
    type: z.literal('pos-sale'),
    lines: z.array(posSaleLineSchema).min(1),
    customerId: z.string().optional(),
    modeOfPayment: z.string().min(1),
    amount: z.number().positive(),
  }),
  z.object({
    type: z.literal('create-item'),
    itemCode: z.string().min(1),
    itemName: z.string().min(1),
    itemGroup: z.string().min(1),
    stockUom: z.string().min(1),
    retailPrice: z.number().nonnegative(),
    grosirPrice: z.number().nonnegative().optional(),
    costPrice: z.number().nonnegative().optional(),
    openingQty: z.number().nonnegative().optional(),
    warehouse: z.string().optional(),
    packageUoms: z.array(packageUomSchema).optional(),
  }),
  z.object({
    type: z.literal('update-item-price'),
    itemCode: z.string().min(1),
    uom: z.string().min(1),
    retailPrice: z.number().nonnegative().optional(),
    grosirPrice: z.number().nonnegative().optional(),
  }),
]);

const syncRequestSchema = z.object({
  uuid: z.string().min(1),
  contentHash: z.string().min(1),
  clientTimestamp: z.string().min(1),
  action: offlineActionSchema,
});

// Any authenticated staff role can reach this route (it's one shared
// endpoint for every offline action type) — the per-action-type check
// below then mirrors the same restriction the equivalent direct/live
// endpoint already enforces (inventory.routes.ts's
// INVENTORY_MANAGE_ROLES, sales-pos.routes.ts's POS_ROLES), so this
// endpoint can't be used as a role-check bypass for either.
const SYNC_ROLES = ['Owner', 'Manager', 'Cashier', 'Warehouse Staff'] as const;
const ALLOWED_ROLES_BY_ACTION: Record<OfflineActionType, Role[]> = {
  'add-stock': ['Owner', 'Manager', 'Warehouse Staff'],
  'reduce-stock': ['Owner', 'Manager', 'Warehouse Staff'],
  transfer: ['Owner', 'Manager', 'Warehouse Staff'],
  'pos-sale': ['Owner', 'Manager', 'Cashier'],
  'create-item': ['Owner', 'Manager', 'Warehouse Staff'],
  // Price-setting is an Owner/Manager decision, not a Cashier/Warehouse
  // Staff one — narrower than create-item on purpose.
  'update-item-price': ['Owner', 'Manager'],
};

export function registerSyncRoutes(app: FastifyInstance): void {
  app.get('/api/v1/sync/_status', async () => ({ module: 'sync', status: 'scaffolded' }));

  app.post('/api/v1/sync/actions', { preHandler: requireRole(...SYNC_ROLES) }, async (request) => {
    const parsed = syncRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }

    const allowedRoles = ALLOWED_ROLES_BY_ACTION[parsed.data.action.type];
    if (!request.user || !allowedRoles.includes(request.user.role)) {
      throw new ForbiddenError(`Requires one of: ${allowedRoles.join(', ')}`);
    }

    // Opening stock with no cost price would land in ERPNext at a zero
    // valuation rate — every unit sold before a later restock would show
    // 100% margin. Enforced here (not just in the PWA form) since this is
    // the actual write boundary.
    const { action } = parsed.data;
    if (
      action.type === 'create-item' &&
      action.openingQty !== undefined &&
      action.openingQty > 0 &&
      action.costPrice === undefined
    ) {
      throw new ValidationError('Harga Modal/Beli wajib diisi saat Stok Awal lebih dari 0');
    }

    // A package UOM can't collide with the base unit or with another
    // package row — each needs its own distinct conversion factor and
    // price, so a duplicate name is always a mistake, not a valid state.
    if (action.type === 'create-item' && action.packageUoms && action.packageUoms.length > 0) {
      const names = [action.stockUom, ...action.packageUoms.map((p) => p.uom)].map((n) =>
        n.toLowerCase(),
      );
      if (new Set(names).size !== names.length) {
        throw new ValidationError(
          'Setiap Satuan Kemasan harus berbeda dari Satuan Dasar dan dari satuan kemasan lainnya',
        );
      }
    }

    // A price edit that touches neither field is a no-op, not a valid request.
    if (
      action.type === 'update-item-price' &&
      action.retailPrice === undefined &&
      action.grosirPrice === undefined
    ) {
      throw new ValidationError('Harga Retail atau Harga Grosir wajib diisi salah satu');
    }

    return syncAction(parsed.data);
  });

  app.get('/api/v1/sync/conflicts', { preHandler: requireRole('Owner', 'Manager') }, async () => ({
    conflicts: listConflicts(),
  }));
}
