import type { FastifyInstance } from 'fastify';
import { registerWhatsappRoutes } from './whatsapp.routes.js';
import { registerWhatsappWebhookRoute } from './webhook.routes.js';

export function registerWhatsappModuleRoutes(app: FastifyInstance): void {
  registerWhatsappRoutes(app);
  registerWhatsappWebhookRoute(app);
}
