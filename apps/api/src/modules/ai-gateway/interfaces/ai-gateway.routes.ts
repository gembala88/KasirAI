import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ValidationError } from '../../../shared/errors/index.js';
import { confirmAction, proposeAction, runAiQuery } from '../application/index.js';

const proposeSchema = z.object({
  type: z.literal('propose_sales_order'),
  payload: z.object({
    customerId: z.string().min(1),
    items: z
      .array(
        z.object({
          itemCode: z.string().min(1),
          qty: z.number().positive(),
          rate: z.number().nonnegative().optional(),
        }),
      )
      .min(1),
  }),
});

const querySchema = z.object({ prompt: z.string().min(1) });

/**
 * AI Gateway module — public HTTP boundary (spec §1.3 FR-5, §6).
 */
export function registerAiGatewayRoutes(app: FastifyInstance): void {
  app.get('/api/v1/ai/_status', async () => ({
    module: 'ai-gateway',
    status: 'scaffolded',
  }));

  app.post('/api/v1/ai/query', async (request) => {
    const parsed = querySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return runAiQuery(parsed.data.prompt);
  });

  app.post('/api/v1/ai/action/propose', async (request) => {
    const parsed = proposeSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues.map((i) => i.message).join('; '));
    }
    return proposeAction(parsed.data.type, parsed.data.payload);
  });

  app.post<{ Params: { id: string } }>('/api/v1/ai/action/:id/confirm', async (request) =>
    confirmAction(request.params.id),
  );
}
