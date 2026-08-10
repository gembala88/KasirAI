import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../../auth/interfaces/index.js';
import { ValidationError } from '../../../shared/errors/index.js';
import {
  addPayment,
  createTransaction,
  getItemUomPrices,
  getPaymentInfo,
  getProductPrice,
  getReceiptHtml,
  getReceiptTemplate,
  getTransactionDetail,
  listCatalogPage,
  listCompletedTransactions,
  listItemGroups,
  listParkedTransactions,
  listUoms,
  parkTransaction,
  RECEIPT_TEMPLATES,
  searchProducts,
  setReceiptTemplate,
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

const transactionListQuerySchema = z.object({
  offset: z.coerce.number().int().nonnegative().optional().default(0),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

const receiptTemplateSchema = z.object({
  template: z.enum(RECEIPT_TEMPLATES),
});

const POS_ROLES = ['Owner', 'Manager', 'Cashier'] as const;
// Read-only product/catalog endpoints also need to be reachable from the
// Gudang scan screen (Warehouse Staff) — "Tambah Produk Baru" checks
// whether a scanned barcode matches an existing Item via the same
// search/catalog endpoints Kasir uses, and the catalog-cache background
// sync (api.ts's triggerCatalogSync, fired on every login) runs
// unconditionally regardless of role. Found live: Warehouse Staff was
// never in POS_ROLES, so a warehouse-only account's catalog sync has been
// silently 403ing in the background since that feature shipped — no
// visible symptom because triggerCatalogSync swallows its own errors by
// design, but it meant Warehouse Staff never actually got an offline
// catalog cached. Deliberately a separate, wider list rather than adding
// Warehouse Staff to POS_ROLES itself — the actual POS transaction routes
// (pos/transactions, park, payment, receipt) below still correctly stay
// Owner/Manager/Cashier only.
const PRODUCT_READ_ROLES = ['Owner', 'Manager', 'Cashier', 'Warehouse Staff'] as const;
// Receipt template is a business decision, not every staff role's call —
// same narrower gate as update-item-price.
const SETTINGS_ROLES = ['Owner', 'Manager'] as const;

/**
 * Sales/POS module — public HTTP boundary (spec §1.3 FR-1, §6).
 * Owner/Manager/Cashier per §1.3 FR-8 ("Cashier (POS-focused)") for
 * transaction routes; product/catalog reads also open to Warehouse Staff
 * (see PRODUCT_READ_ROLES above).
 */
export function registerSalesPosRoutes(app: FastifyInstance): void {
  app.get('/api/v1/pos/_status', async () => ({
    module: 'sales-pos',
    status: 'scaffolded',
  }));

  app.get<{ Querystring: { q?: string; customer_tier?: string } }>(
    '/api/v1/products/search',
    { preHandler: requireRole(...PRODUCT_READ_ROLES) },
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
    { preHandler: requireRole(...PRODUCT_READ_ROLES) },
    async (request) => getProductPrice(request.params.id, request.query.tier),
  );

  // Full per-UOM price breakdown for "Tambah Produk Baru"'s existing-item
  // card — distinct from the single tier-resolved price above.
  app.get<{ Params: { id: string } }>(
    '/api/v1/products/:id/uom-prices',
    { preHandler: requireRole(...PRODUCT_READ_ROLES) },
    async (request) => ({ item: await getItemUomPrices(request.params.id) }),
  );

  // Bulk catalog pull for pwa-scanner's offline product cache (spec §15.3
  // "kasir tetap bisa jualan walau internet mati") — paged, not the
  // single-shot /products/search. See listCatalogPage's doc comment for
  // why it's a separate code path.
  app.get<{ Querystring: { offset?: string; limit?: string } }>(
    '/api/v1/products/catalog',
    { preHandler: requireRole(...PRODUCT_READ_ROLES) },
    async (request) => {
      const parsed = catalogQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return listCatalogPage(parsed.data.offset, parsed.data.limit);
    },
  );

  // Leaf Item Groups for "Tambah Produk Baru" (Gudang scan screen, spec:
  // bulk product onboarding) — the dropdown a warehouse worker picks a
  // category from when a scanned barcode doesn't match any existing Item.
  app.get(
    '/api/v1/products/item-groups',
    { preHandler: requireRole(...PRODUCT_READ_ROLES) },
    async () => ({ itemGroups: await listItemGroups() }),
  );

  // Every UOM master ERPNext knows about — the autocomplete source for
  // "Tambah Produk Baru"'s Satuan Dasar / Satuan Kemasan fields. A typed
  // name not in this list still works (item-creation.ts auto-creates it).
  app.get(
    '/api/v1/products/uoms',
    { preHandler: requireRole(...PRODUCT_READ_ROLES) },
    async () => ({
      uoms: await listUoms(),
    }),
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

  // QRIS image / bank transfer details for the "Menunggu Konfirmasi
  // Pembayaran" screen (spec Group 2) — POS_ROLES, not SETTINGS_ROLES,
  // since a Cashier needs this at checkout time, not just Owner/Manager.
  app.get('/api/v1/pos/payment-info', { preHandler: requireRole(...POS_ROLES) }, async () =>
    getPaymentInfo(),
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

  // Riwayat Transaksi (spec: transaction history) — every submitted sale,
  // paginated, newest first. Registered after the more specific
  // /parked and /:id/... routes above only for readability; Fastify's
  // router matches by path specificity, not registration order, so a
  // plain GET here can never be shadowed by them.
  app.get<{ Querystring: { offset?: string; limit?: string } }>(
    '/api/v1/pos/transactions',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => {
      const parsed = transactionListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return listCompletedTransactions(parsed.data.offset, parsed.data.limit);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/pos/transactions/:id/detail',
    { preHandler: requireRole(...POS_ROLES) },
    async (request) => getTransactionDetail(request.params.id),
  );

  app.get(
    '/api/v1/settings/receipt-template',
    { preHandler: requireRole(...SETTINGS_ROLES) },
    async () => ({ template: await getReceiptTemplate() }),
  );

  app.put(
    '/api/v1/settings/receipt-template',
    { preHandler: requireRole(...SETTINGS_ROLES) },
    async (request) => {
      const parsed = receiptTemplateSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
      }
      return { template: await setReceiptTemplate(parsed.data.template) };
    },
  );
}
