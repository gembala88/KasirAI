import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../auth/interfaces/index.js';
import { ValidationError } from '../../../shared/errors/index.js';
import {
  addPayment,
  createTransaction,
  getProductPrice,
  listParkedTransactions,
  parkTransaction,
  searchProducts,
} from '../application/index.js';

const createTransactionSchema = z.object({
  customerId: z.string().optional(),
  lines: z
    .array(
      z.object({
        itemCode: z.string().min(1),
        qty: z.number().positive(),
        rate: z.number().nonnegative().optional(),
        warehouse: z.string().optional(),
      }),
    )
    .min(1),
});

const paymentSchema = z.object({
  payments: z
    .array(z.object({ modeOfPayment: z.string().min(1), amount: z.number().positive() }))
    .min(1),
});

const productSearchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  customer_tier: z.string().max(50).optional(),
});

const POS_ROLES = ['Owner', 'Manager', 'Cashier'] as const;

/**
 * Sales/POS module — public HTTP boundary (spec §1.3 FR-1, §6).
 * Owner/Manager/Cashier per §1.3 FR-8 ("Cashier (POS-focused)").
 */
export function registerSalesPosRoutes(app: FastifyInstance): void {
  app.get('/api/v1/pos/_status', async () => ({
    module: 'sales-pos',
    status: 'scaffolded',
  }));

  app.get<{ Querystring: { q?: string; customer_tier?: string } }>(
    '/api/v1/products/search',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => {
      const parsed = productSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return { results: await searchProducts(parsed.data.q ?? '', parsed.data.customer_tier) };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { tier?: string } }>(
    '/api/v1/products/:id/price',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => getProductPrice(request.params.id, request.query.tier),
  );

  app.get(
    '/api/v1/pos/transactions/parked',
    { preHandler: requireRole(...POS_ROLES) },
    async () => ({ transactions: await listParkedTransactions() }),
  );

  app.post(
    '/api/v1/pos/transactions',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => {
      const parsed = createTransactionSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return createTransaction(parsed.data.customerId, parsed.data.lines);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/pos/transactions/:id/park',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => parkTransaction(request.params.id),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/pos/transactions/:id/payment',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => {
      const parsed = paymentSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return addPayment(request.params.id, parsed.data.payments);
    },
  );
}
