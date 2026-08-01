import type { FastifyInstance } from 'fastify';
import { ValidationError } from '../../../shared/errors/index.js';
import { confirmPayment } from '../application/index.js';
import type { PaymentMethod } from '../domain/index.js';
import { sendTextMessage } from '../infrastructure/whatsapp-client.js';

const PAYMENT_METHODS: readonly PaymentMethod[] = ['qris', 'transfer', 'cod'];

/**
 * WhatsApp module — public HTTP boundary (spec §6, §7).
 *
 * This is the only entry point other modules or the app bootstrap should
 * use to reach the WhatsApp module (the webhook receiver is registered
 * separately by webhook.routes.ts, kept apart because it needs its own
 * raw-body content-type parser scope).
 */
export function registerWhatsappRoutes(app: FastifyInstance): void {
  app.get('/api/v1/whatsapp/_status', async () => ({
    module: 'whatsapp',
    status: 'scaffolded',
  }));

  // Manual/outbound send — mainly useful for ops (piutang reminders,
  // spec §7, already call sendTextMessage directly; this exposes the same
  // capability over HTTP for anything outside the Node process later).
  app.post<{ Body: { to?: string; message?: string } }>(
    '/api/v1/whatsapp/send-message',
    async (request, reply) => {
      const { to, message } = request.body ?? {};
      if (!to || !message) {
        throw new ValidationError('"to" and "message" are required');
      }
      await sendTextMessage(to, message);
      reply.status(202);
      return { sent: true };
    },
  );

  // Owner/cashier confirms a payment was received — QRIS, bank transfer,
  // or COD (§7/§10 Phase 6 payment flow). Deliberately API-only, no UI,
  // per project decision.
  app.post<{
    Params: { invoiceName: string };
    Body: { phoneNumber?: string; method?: string };
  }>('/api/v1/whatsapp/orders/:invoiceName/confirm-payment', async (request, reply) => {
    const { phoneNumber, method } = request.body ?? {};
    if (!phoneNumber) {
      throw new ValidationError('"phoneNumber" is required (who to notify)');
    }
    if (!method || !PAYMENT_METHODS.includes(method as PaymentMethod)) {
      throw new ValidationError(`"method" must be one of: ${PAYMENT_METHODS.join(', ')}`);
    }
    const result = await confirmPayment(request.params.invoiceName, phoneNumber, method as PaymentMethod);
    reply.status(200);
    return { confirmed: true, ...result };
  });
}
