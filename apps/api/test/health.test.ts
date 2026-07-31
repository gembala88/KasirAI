import { describe, expect, it, afterAll } from 'vitest';
import { buildApp } from '../src/main.js';

describe('app bootstrap', () => {
  const app = buildApp();

  afterAll(async () => {
    await app.close();
  });

  it('responds on /health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'hermes-api' });
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
    ];

    for (const module of modules) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/${module}/_status` });
      expect(response.statusCode, `module ${module} should respond`).toBe(200);
      expect(response.json().status).toBe('scaffolded');
    }
  });
});
