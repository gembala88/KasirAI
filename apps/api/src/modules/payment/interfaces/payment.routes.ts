import type { FastifyInstance } from 'fastify';

/**
 * Payment module — public HTTP boundary.
 *
 * This is the only entry point other modules or the app bootstrap should
 * use to reach the Payment module. Business routes are added here as
 * the module is implemented per the roadmap (§10); for now this only
 * proves the module is wired into the app.
 */
export function registerPaymentRoutes(app: FastifyInstance): void {
  app.get('/api/v1/payment/_status', async () => ({
    module: 'payment',
    status: 'scaffolded',
  }));
}
