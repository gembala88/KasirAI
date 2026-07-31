import type { FastifyInstance } from 'fastify';

/**
 * WhatsApp module — public HTTP boundary.
 *
 * This is the only entry point other modules or the app bootstrap should
 * use to reach the WhatsApp module. Business routes are added here as
 * the module is implemented per the roadmap (§10); for now this only
 * proves the module is wired into the app.
 */
export function registerWhatsappRoutes(app: FastifyInstance): void {
  app.get('/api/v1/whatsapp/_status', async () => ({
    module: 'whatsapp',
    status: 'scaffolded',
  }));
}
