import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import closeWithGrace from 'close-with-grace';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { logger } from './shared/logger/index.js';
import { AppError } from './shared/errors/index.js';

import { registerAuthRoutes } from './modules/auth/interfaces/index.js';
import { registerSalesPosRoutes } from './modules/sales-pos/interfaces/index.js';
import { registerInventoryModuleRoutes } from './modules/inventory/interfaces/index.js';
import {
  registerCustomerMembershipRoutes,
  startCustomerMembershipBackgroundJobs,
  stopCustomerMembershipBackgroundJobs,
} from './modules/customer-membership/interfaces/index.js';
import { registerWhatsappRoutes } from './modules/whatsapp/interfaces/index.js';
import { registerAiGatewayRoutes } from './modules/ai-gateway/interfaces/index.js';
import { registerPaymentRoutes } from './modules/payment/interfaces/index.js';
import { registerNotificationRoutes } from './modules/notification/interfaces/index.js';
import { registerReportDashboardRoutes } from './modules/report-dashboard/interfaces/index.js';
import { registerMediaRoutes } from './modules/media/interfaces/index.js';

export function buildApp() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
        : {}),
    },
  });

  app.register(sensible);
  app.register(cors, { origin: env.CORS_ALLOWED_ORIGINS });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }
    logger.error({ err: error }, 'unhandled_error');
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'hermes-api', env: env.NODE_ENV }));

  // Each module owns its own routes — the app bootstrap only knows about
  // each module's `interfaces` boundary, never its internals (§2.1, §3.3).
  registerAuthRoutes(app);
  registerSalesPosRoutes(app);
  registerInventoryModuleRoutes(app);
  registerCustomerMembershipRoutes(app);
  registerWhatsappRoutes(app);
  registerAiGatewayRoutes(app);
  registerPaymentRoutes(app);
  registerNotificationRoutes(app);
  registerReportDashboardRoutes(app);
  registerMediaRoutes(app);

  return app;
}

async function main() {
  const app = buildApp();

  // Background job workers (BullMQ + Redis, §3.3) — only started when
  // actually running the server, never in buildApp(), so tests that just
  // need the HTTP surface don't require a live Redis.
  await startCustomerMembershipBackgroundJobs();

  closeWithGrace({ delay: 5000 }, async ({ err }) => {
    if (err) {
      logger.error({ err }, 'closing_app_due_to_error');
    }
    await stopCustomerMembershipBackgroundJobs();
    await app.close();
  });

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
  } catch (err) {
    logger.error({ err }, 'failed_to_start_server');
    process.exit(1);
  }
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  void main();
}
