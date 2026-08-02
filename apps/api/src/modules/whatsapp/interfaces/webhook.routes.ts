import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/index.js';
import { handleInboundMessage } from '../application/index.js';

/**
 * Meta signs inbound webhook bodies with HMAC-SHA256 of the *raw* request
 * bytes using the app secret, sent as `X-Hub-Signature-256: sha256=<hex>`
 * — same shape of problem as the ERPNext webhook (needs the raw body, not
 * Fastify's parsed JSON), same fix (own content-type parser scoped to
 * this route only).
 */
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WHATSAPP_APP_SECRET) {
    logger.warn('webhook.whatsapp.signature_verification_skipped_no_secret_configured');
    return true;
  }
  if (!signatureHeader?.startsWith('sha256=')) {
    return false;
  }

  const expectedHex = createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  let received: Buffer;
  try {
    received = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

interface InboundMessage {
  from: string;
  type: string;
  text?: { body: string };
}

interface WebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: InboundMessage[];
      };
    }>;
  }>;
}

// §1.4 NFR "Security" names this endpoint specifically: "rate limiting on
// public WhatsApp webhook". Generous enough for real Meta traffic bursts,
// tight enough to blunt a flood/abuse attempt against an unauthenticated
// public endpoint.
const WEBHOOK_RATE_LIMIT = { max: 60, timeWindow: '1 minute' };

export function registerWhatsappWebhookRoute(app: FastifyInstance): void {
  // Verification handshake (Meta calls this once when you configure the
  // webhook URL in the Meta App dashboard).
  app.get<{ Querystring: Record<string, string> }>(
    '/whatsapp/webhook',
    { config: { rateLimit: WEBHOOK_RATE_LIMIT } },
    async (request, reply) => {
      const mode = request.query['hub.mode'];
      const token = request.query['hub.verify_token'];
      const challenge = request.query['hub.challenge'];

      if (mode === 'subscribe' && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        reply.status(200).type('text/plain').send(challenge ?? '');
        return;
      }
      throw new UnauthorizedError('Webhook verification failed');
    },
  );

  void app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      try {
        done(null, { raw: body as Buffer, json: JSON.parse((body as Buffer).toString('utf8')) });
      } catch (error) {
        done(error as Error, undefined);
      }
    });

    scope.post<{ Body: { raw: Buffer; json: WebhookPayload } }>(
      '/whatsapp/webhook',
      { config: { rateLimit: WEBHOOK_RATE_LIMIT } },
      async (request, reply) => {
        const signature = request.headers['x-hub-signature-256'];
        const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

        if (!verifySignature(request.body.raw, signatureHeader)) {
          throw new UnauthorizedError('Invalid webhook signature');
        }

        const messages =
          request.body.json.entry?.flatMap((entry) =>
            entry.changes?.flatMap((change) => change.value?.messages ?? []) ?? [],
          ) ?? [];

        for (const message of messages) {
          if (message.type === 'text' && message.text) {
            await handleInboundMessage(message.from, message.text.body);
          } else {
            logger.info({ from: message.from, type: message.type }, 'whatsapp.message_type_unhandled');
          }
        }

        reply.status(200);
        return { received: true };
      },
    );
  });
}
