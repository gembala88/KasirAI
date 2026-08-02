/**
 * Global authentication + per-route RBAC (spec §1.4 NFR "Security":
 * "JWT-based auth on every endpoint, role-based access control (RBAC)
 * with at least 4 roles").
 *
 * `attachAuthentication` registers one global preHandler on the app
 * instance in main.ts, applying to every route in the whole app
 * (Fastify hooks added on the root instance apply regardless of
 * registration order relative to routes) — secure-by-default, with an
 * explicit allowlist for the handful of routes that must stay public
 * (health check, ERPNext/WhatsApp webhooks — both HMAC-signature
 * verified internally, not JWT — and login/refresh themselves).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors/index.js';
import type { Role } from '../domain/index.js';
import { verifyAccessToken } from '../infrastructure/jwt.js';

const PUBLIC_PATHS = [
  '/health',
  '/webhooks/erpnext',
  '/whatsapp/webhook',
  '/api/v1/auth/login',
  '/api/v1/auth/refresh',
];

function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return PUBLIC_PATHS.includes(path);
}

export function attachAuthentication(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: FastifyRequest, _reply: FastifyReply) => {
    if (isPublicPath(request.url)) {
      return;
    }

    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing bearer token');
    }

    request.user = verifyAccessToken(header.slice('Bearer '.length));
  });
}

/** Per-route preHandler restricting access to specific roles — apply after `attachAuthentication` has already set `request.user`. */
export function requireRole(...allowed: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!request.user || !allowed.includes(request.user.role)) {
      throw new ForbiddenError(`Requires one of: ${allowed.join(', ')}`);
    }
  };
}
