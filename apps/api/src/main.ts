import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import closeWithGrace from 'close-with-grace';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { logger } from './shared/logger/index.js';
import { AppError } from './shared/errors/index.js';
import { sentry } from './shared/observability/sentry.js';

import { attachAuthentication, registerAuthRoutes } from './modules/auth/interfaces/index.js';
import { registerSalesPosRoutes } from './modules/sales-pos/interfaces/index.js';
import { registerInventoryModuleRoutes } from './modules/inventory/interfaces/index.js';
import {
  registerCustomerMembershipRoutes,
  startCustomerMembershipBackgroundJobs,
  stopCustomerMembershipBackgroundJobs,
} from './modules/customer-membership/interfaces/index.js';
import { registerWhatsappModuleRoutes } from './modules/whatsapp/interfaces/index.js';
import { registerAiGatewayRoutes } from './modules/ai-gateway/interfaces/index.js';
import { registerPaymentRoutes } from './modules/payment/interfaces/index.js';
import { registerNotificationRoutes } from './modules/notification/interfaces/index.js';
import { registerReportDashboardRoutes } from './modules/report-dashboard/interfaces/index.js';
import { registerMediaRoutes } from './modules/media/interfaces/index.js';
import {
  registerSyncRoutes,
  startSyncBackgroundJobs,
  stopSyncBackgroundJobs,
} from './modules/sync/interfaces/index.js';

export async function buildApp() {
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
  // §1.4 NFR "Security": "rate limiting on public WhatsApp webhook".
  // `global: false` — every other route already requires a valid JWT
  // (see attachAuthentication below), so rate limiting is applied only
  // where it's actually load-bearing: the handful of routes that have no
  // JWT to rely on for abuse control (webhooks, login), each via its own
  // `config: { rateLimit: {...} }`. Awaited (unlike sensible/cors above)
  // because its per-route override relies on an `onRoute` hook that must
  // be attached *before* those routes are added — found live that
  // registering it without awaiting let routes get added first and
  // silently skip rate limiting entirely, since Fastify plugins resolve
  // asynchronously but plain route registration (`app.post(...)`) is
  // synchronous.
  await app.register(rateLimit, { global: false });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({ error: error.code, message: error.message });
      return;
    }

    // A framework/plugin-level client error not modeled as our own
    // AppError — @fastify/rate-limit's 429, Fastify's own 404s and body
    // parse errors, @fastify/sensible's httpErrors, etc. Found live
    // (Phase 8, adding rate limiting) that this branch was previously
    // missing entirely: every one of these was silently flattened to a
    // generic 500, masking the real, more specific status code the
    // framework had already decided on.
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      logger.warn({ err: error }, 'client_error');
      reply
        .status(error.statusCode)
        .send({ error: error.code ?? 'CLIENT_ERROR', message: error.message });
      return;
    }

    logger.error({ err: error }, 'unhandled_error');
    sentry.captureException(error, { url: request.url, method: request.method });
    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'hermes-api', env: env.NODE_ENV }));

  // Global JWT auth (§1.4 NFR "Security") — applies to every route
  // registered below except the public allowlist in auth-plugin.ts
  // (health, webhooks, login/refresh). Must be attached before any
  // route needs `request.user`, but Fastify hooks on the root instance
  // apply regardless of registration order relative to routes.
  attachAuthentication(app);

  // Each module owns its own routes — the app bootstrap only knows about
  // each module's `interfaces` boundary, never its internals (§2.1, §3.3).
  registerAuthRoutes(app);
  registerSalesPosRoutes(app);
  registerInventoryModuleRoutes(app);
  registerCustomerMembershipRoutes(app);
  registerWhatsappModuleRoutes(app);
  registerAiGatewayRoutes(app);
  registerPaymentRoutes(app);
  registerNotificationRoutes(app);
  registerReportDashboardRoutes(app);
  registerMediaRoutes(app);
  registerSyncRoutes(app);

  return app;
}

async function main() {
  const app = await buildApp();

  // Background job workers (BullMQ + Redis, §3.3) — only started when
  // actually running the server, never in buildApp(), so tests that just
  // need the HTTP surface don't require a live Redis.
  await startCustomerMembershipBackgroundJobs();
  await startSyncBackgroundJobs();

  closeWithGrace({ delay: 5000 }, async ({ err }) => {
    if (err) {
      logger.error({ err }, 'closing_app_due_to_error');
      // The only place an uncaughtException/unhandledRejection surfaces —
      // without this, a process-crashing bug would be invisible to Sentry
      // even though it's the single worst kind of failure to miss.
      sentry.captureException(err);
    }
    await stopCustomerMembershipBackgroundJobs();
    await stopSyncBackgroundJobs();
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
