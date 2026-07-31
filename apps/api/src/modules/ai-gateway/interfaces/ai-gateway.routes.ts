import type { FastifyInstance } from 'fastify';

/**
 * AI Gateway module — public HTTP boundary.
 *
 * This is the only entry point other modules or the app bootstrap should
 * use to reach the AI Gateway module. Business routes are added here as
 * the module is implemented per the roadmap (§10); for now this only
 * proves the module is wired into the app.
 */
export function registerAiGatewayRoutes(app: FastifyInstance): void {
  app.get('/api/v1/ai/_status', async () => ({
    module: 'ai-gateway',
    status: 'scaffolded',
  }));
}
