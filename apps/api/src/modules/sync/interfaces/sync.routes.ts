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

const offlineActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add-stock'),
    itemCode: z.string().min(1),
    warehouse: z.string().optional(),
    qty: z.number().positive(),
    rate: z.number().nonnegative(),
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
};

export function registerSyncRoutes(app: FastifyInstance): void {
  app.get('/api/v1/sync/_status', async () => ({ module: 'sync', status: 'scaffolded' }));

  app.post(
    '/api/v1/sync/actions',
    { preHandler: requireRole(...SYNC_ROLES) },
    async (request) => {
      const parsed = syncRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }

      const allowedRoles = ALLOWED_ROLES_BY_ACTION[parsed.data.action.type];
      if (!request.user || !allowedRoles.includes(request.user.role)) {
        throw new ForbiddenError(`Requires one of: ${allowedRoles.join(', ')}`);
      }

      return syncAction(parsed.data);
    },
  );

  app.get(
    '/api/v1/sync/conflicts',
    { preHandler: requireRole('Owner', 'Manager') },
    async () => ({ conflicts: listConflicts() }),
  );
}
