import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { ValidationError } from '../../../shared/errors/index.js';
import {
  createCustomer,
  findDuePiutangReminders,
  getCustomerProfile,
  getPiutang,
  getPurchaseHistory,
  triggerReminderCheck,
} from '../application/index.js';

const createCustomerSchema = z.object({
  name: z.string().min(1),
  tier: z.enum(['Retail', 'Grosir', 'Member']),
  mobileNo: z.string().optional(),
  paymentTermDays: z.number().int().nonnegative().optional(),
  creditLimit: z.number().nonnegative().optional(),
});

/**
 * Customer/Membership module — public HTTP boundary (spec §1.3 FR-4, §6).
 */
export function registerCustomerMembershipRoutes(app: FastifyInstance): void {
  app.get('/api/v1/customers/_status', async () => ({
    module: 'customer-membership',
    status: 'scaffolded',
  }));

  // Static path registered before the /:id catch-all so it isn't shadowed.
  app.get<{ Querystring: { days?: string } }>(
    '/api/v1/customers/piutang/due-reminders',
    async (request) => {
      const days = request.query.days
        ? Number(request.query.days)
        : env.PIUTANG_REMINDER_DAYS_AHEAD;
      if (!Number.isFinite(days) || days < 0) {
        throw new ValidationError('days must be a non-negative number');
      }
      return { daysAhead: days, reminders: await findDuePiutangReminders(days) };
    },
  );

  app.post('/api/v1/customers/piutang/check-reminders', async () => triggerReminderCheck());

  app.post('/api/v1/customers', async (request) => {
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return createCustomer(parsed.data);
  });

  app.get<{ Params: { id: string } }>('/api/v1/customers/:id', async (request) =>
    getCustomerProfile(request.params.id),
  );

  app.get<{ Params: { id: string } }>('/api/v1/customers/:id/piutang', async (request) =>
    getPiutang(request.params.id),
  );

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/v1/customers/:id/purchase-history',
    async (request) => {
      const limit = request.query.limit ? Number(request.query.limit) : 20;
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new ValidationError('limit must be a positive number');
      }
      return {
        customer: request.params.id,
        history: await getPurchaseHistory(request.params.id, limit),
      };
    },
  );
}
