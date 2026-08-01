import { createHmac } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';
import { buildApp } from '../src/main.js';

const app = buildApp();
afterAll(async () => {
  await app.close();
});

const body = JSON.stringify({ doctype: 'Stock Entry', name: 'TEST-WEBHOOK-001', items: [] });

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

describe('POST /webhooks/erpnext', () => {
  it('parses the body even without an exact application/json content-type', async () => {
    // Regression test: Frappe's webhook sender was observed sending a
    // content-type Fastify's default JSON parser didn't match, which
    // caused a 415 before the route ever ran — this must always parse.
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/erpnext',
      headers: {
        'content-type': 'text/plain',
        ...(env.ERPNEXT_WEBHOOK_SECRET
          ? { 'x-frappe-webhook-signature': sign(body, env.ERPNEXT_WEBHOOK_SECRET) }
          : {}),
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
  });

  describe.runIf(Boolean(env.ERPNEXT_WEBHOOK_SECRET))('when a webhook secret is configured', () => {
    it('accepts a correctly signed request', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/erpnext',
        headers: {
          'content-type': 'application/json',
          'x-frappe-webhook-signature': sign(body, env.ERPNEXT_WEBHOOK_SECRET),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
    });

    it('rejects a missing signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/erpnext',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a forged signature', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/erpnext',
        headers: {
          'content-type': 'application/json',
          'x-frappe-webhook-signature': sign(body, 'wrong-secret'),
        },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe.runIf(!env.ERPNEXT_WEBHOOK_SECRET)('when no webhook secret is configured', () => {
    it('accepts requests without verifying (documented dev-only fallback)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/erpnext',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
    });
  });
});
