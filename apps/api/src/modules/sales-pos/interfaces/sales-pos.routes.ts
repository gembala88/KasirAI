import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../auth/interfaces/index.js';
import { ValidationError } from '../../../shared/errors/index.js';
import {
  addPayment,
  createTransaction,
  getProductPrice,
  getReceiptHtml,
  listCatalogPage,
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

const catalogQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  // Capped well above any realistic page size a client would request —
  // this is a server-side abuse guard, not a tuning knob; pwa-scanner's
  // catalog-cache always asks for 200.
  limit: z.coerce.number().int().positive().max(500).optional().default(200),
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

  // Bulk catalog pull for pwa-scanner's offline product cache (spec §15.3
  // "kasir tetap bisa jualan walau internet mati") — paged, not the
  // single-shot /products/search. See listCatalogPage's doc comment for
  // why it's a separate code path.
  app.get<{ Querystring: { offset?: string; limit?: string } }>(
    '/api/v1/products/catalog',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => {
      const parsed = catalogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return listCatalogPage(parsed.data.offset, parsed.data.limit);
    },
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

  app.get<{ Params: { id: string } }>(
    '/api/v1/pos/transactions/:id/receipt',
    { preHandler: requireRole(...POS_ROLES) },
    async (request, reply) => {
      const html = await getReceiptHtml(request.params.id);
      reply.type('text/html');
      return html;
    },
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
