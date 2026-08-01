import type { FastifyInstance } from 'fastify';
import { registerInventoryRoutes } from './inventory.routes.js';
import { registerErpNextWebhookRoute } from './webhook.routes.js';

export function registerInventoryModuleRoutes(app: FastifyInstance): void {
  registerInventoryRoutes(app);
  registerErpNextWebhookRoute(app);
}
