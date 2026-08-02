import type { FastifyInstance } from 'fastify';
import { ValidationError } from '../../../shared/errors/index.js';
import { login, refreshAccessToken } from '../application/index.js';

/**
 * Auth module — public HTTP boundary (spec §1.4, §6 "POST /auth/login",
 * "POST /auth/refresh"). `/login` and `/refresh` are the only two routes
 * in this module (and in the whole app, alongside health/webhooks) that
 * bypass the global auth preHandler — see `auth-plugin.ts`.
 */
export function registerAuthRoutes(app: FastifyInstance): void {
  app.get('/api/v1/auth/_status', async () => ({
    module: 'auth',
    status: 'scaffolded',
  }));

  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/v1/auth/login',
    // Stricter than the global default — no JWT exists yet to rely on,
    // and this is the one endpoint a credential-stuffing/brute-force
    // attempt would actually hit.
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request) => {
      const { email, password } = request.body ?? {};
      if (!email || !password) {
        throw new ValidationError('"email" and "password" are required');
      }
      return login(email, password);
    },
  );

  app.post<{ Body: { refreshToken?: string } }>('/api/v1/auth/refresh', async (request) => {
    const { refreshToken } = request.body ?? {};
    if (!refreshToken) {
      throw new ValidationError('"refreshToken" is required');
    }
    return refreshAccessToken(refreshToken);
  });

  // Self-info for the currently authenticated caller — lets the
  // dashboard confirm its stored token is still valid and know which
  // role's UI to render, without needing a separate "whoami" convention.
  app.get('/api/v1/auth/me', async (request) => ({ user: request.user }));
}
