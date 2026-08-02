import type { FastifyInstance } from 'fastify';
import { registerInventoryRoutes } from './inventory.routes.js';
import { registerErpNextWebhookRoute } from './webhook.routes.js';

export function registerInventoryModuleRoutes(app: FastifyInstance): void {
  registerInventoryRoutes(app);
  registerErpNextWebhookRoute(app);
}

// Callable exports for other modules (report-dashboard's owner analytics, §6/§10 Phase 7).
export { listLowStock, listNearExpiry } from '../application/index.js';
