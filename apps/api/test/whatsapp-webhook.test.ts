import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const handleInboundMessageMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/modules/whatsapp/application/index.js', () => ({
  handleInboundMessage: handleInboundMessageMock,
}));

const { env } = await import('../src/config/env.js');
const { buildApp } = await import('../src/main.js');

const originalSecret = env.WHATSAPP_APP_SECRET;
const originalVerifyToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

const TEST_SECRET = 'test-whatsapp-app-secret';
const TEST_VERIFY_TOKEN = 'test-verify-token';

function sign(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function inboundPayload(from: string, text: string) {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ from, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  });
}

describe('WhatsApp webhook', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    env.WHATSAPP_APP_SECRET = TEST_SECRET;
    env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
    app = await buildApp();
  });

  afterAll(async () => {
    env.WHATSAPP_APP_SECRET = originalSecret;
    env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = originalVerifyToken;
    await app.close();
  });

  describe('GET /whatsapp/webhook (verification handshake)', () => {
    it('echoes the challenge when mode and token match', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/whatsapp/webhook',
        query: {
          'hub.mode': 'subscribe',
          'hub.verify_token': TEST_VERIFY_TOKEN,
          'hub.challenge': 'abc123',
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('abc123');
    });

    it('rejects a wrong verify token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/whatsapp/webhook',
        query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' },
      });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /whatsapp/webhook (inbound messages)', () => {
    beforeAll(() => {
      handleInboundMessageMock.mockClear();
    });

    it('accepts a correctly signed request and dispatches the message', async () => {
      const body = inboundPayload('6281234567890', 'ada minyak goreng?');
      const response = await app.inject({
        method: 'POST',
        url: '/whatsapp/webhook',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, TEST_SECRET) },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(handleInboundMessageMock).toHaveBeenCalledWith('6281234567890', 'ada minyak goreng?');
    });

    it('rejects a missing signature', async () => {
      handleInboundMessageMock.mockClear();
      const body = inboundPayload('6281234567890', 'test');
      const response = await app.inject({
        method: 'POST',
        url: '/whatsapp/webhook',
        headers: { 'content-type': 'application/json' },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
      expect(handleInboundMessageMock).not.toHaveBeenCalled();
    });

    it('rejects a forged signature', async () => {
      handleInboundMessageMock.mockClear();
      const body = inboundPayload('6281234567890', 'test');
      const response = await app.inject({
        method: 'POST',
        url: '/whatsapp/webhook',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, 'wrong-secret') },
        payload: body,
      });
      expect(response.statusCode).toBe(401);
      expect(handleInboundMessageMock).not.toHaveBeenCalled();
    });

    it('ignores non-text message types without erroring', async () => {
      handleInboundMessageMock.mockClear();
      const body = JSON.stringify({
        entry: [{ changes: [{ value: { messages: [{ from: '628', type: 'image' }] } }] }],
      });
      const response = await app.inject({
        method: 'POST',
        url: '/whatsapp/webhook',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, TEST_SECRET) },
        payload: body,
      });
      expect(response.statusCode).toBe(200);
      expect(handleInboundMessageMock).not.toHaveBeenCalled();
    });
  });
});
