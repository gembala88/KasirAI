import { describe, expect, it, afterAll } from 'vitest';
import { buildApp } from '../src/main.js';
import { issueTokenPair } from '../src/modules/auth/interfaces/index.js';

const app = await buildApp();
// Every /_status endpoint is behind the global auth preHandler as of
// Phase 8 (§1.4 "JWT-based auth on every endpoint") — any authenticated
// role is enough here, this test isn't about RBAC granularity (see
// test/auth.test.ts for that).
const { accessToken } = issueTokenPair({ email: 'test@hermes.local', fullName: 'Test', role: 'Owner' });
const authHeaders = { authorization: `Bearer ${accessToken}` };

describe('app bootstrap', () => {
  afterAll(async () => {
    await app.close();
  });

  it('responds on /health without auth (public)', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'hermes-api' });
  });

  it('rejects unauthenticated access to a status endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/_status' });
    expect(response.statusCode).toBe(401);
  });

  it('exposes a status endpoint for every registered module', async () => {
    const modules = [
      'auth',
      'pos',
      'inventory',
      'customers',
      'whatsapp',
      'ai',
      'payment',
      'notifications',
      'reports',
      'media',
      'sync',
    ];

    for (const module of modules) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/${module}/_status`,
        headers: authHeaders,
      });
      expect(response.statusCode, `module ${module} should respond`).toBe(200);
      expect(response.json().status).toBe('scaffolded');
    }
  });
});
