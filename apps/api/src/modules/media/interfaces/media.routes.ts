import type { FastifyInstance } from 'fastify';

/**
 * Media module — public HTTP boundary.
 *
 * This is the only entry point other modules or the app bootstrap should
 * use to reach the Media module. Business routes are added here as
 * the module is implemented per the roadmap (§10); for now this only
 * proves the module is wired into the app.
 */
export function registerMediaRoutes(app: FastifyInstance): void {
  app.get('/api/v1/media/_status', async () => ({
    module: 'media',
    status: 'scaffolded',
  }));
}
