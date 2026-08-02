import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../../config/env.js';
import { UnauthorizedError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/index.js';
import { handleErpNextWebhook, type ErpNextWebhookPayload } from '../application/index.js';

/**
 * Frappe signs webhook bodies with HMAC-SHA256 of the *raw* request bytes,
 * base64-encoded, in the `X-Frappe-Webhook-Signature` header — so this
 * route needs the raw body, not Fastify's already-parsed JSON. Scoped to
 * this route only (via its own plugin context) so the rest of the app
 * keeps the default JSON parser untouched.
 */
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.ERPNEXT_WEBHOOK_SECRET) {
    logger.warn('webhook.erpnext.signature_verification_skipped_no_secret_configured');
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  const expected = createHmac('sha256', env.ERPNEXT_WEBHOOK_SECRET).update(rawBody).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signatureHeader, 'base64');
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function registerErpNextWebhookRoute(app: FastifyInstance): void {
  void app.register(async (scope) => {
    // Frappe's webhook sender doesn't reliably send `Content-Type:
    // application/json` (observed sending a type Fastify's default parsers
    // don't match, causing a 415 before this route ever ran). A `*`
    // fallback parser alone isn't enough either: Fastify only consults `*`
    // when NO more-specific parser exists anywhere up the encapsulation
    // chain, and the parent app already has built-in default parsers for
    // both `application/json` and `text/plain` — so either would still
    // shadow a same-scope `*`. Clearing every inherited parser in this
    // scope first means `*` is the only candidate, regardless of what
    // content-type the client actually sends — scoped to this route only,
    // so the rest of the app keeps Fastify's normal JSON parsing.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
      try {
        done(null, { raw: body as Buffer, json: JSON.parse((body as Buffer).toString('utf8')) });
      } catch (error) {
        done(error as Error, undefined);
      }
    });

    scope.post<{ Body: { raw: Buffer; json: ErpNextWebhookPayload } }>(
      '/webhooks/erpnext',
      // Defense in depth alongside signature verification — this route
      // is unauthenticated (no JWT) like the WhatsApp webhook, even
      // though it's meant to only be reachable from ERPNext itself.
      { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
      async (request, reply) => {
        const signature = request.headers['x-frappe-webhook-signature'];
        const signatureHeader = Array.isArray(signature) ? signature[0] : signature;

        if (!verifySignature(request.body.raw, signatureHeader)) {
          throw new UnauthorizedError('Invalid webhook signature');
        }

        handleErpNextWebhook(request.body.json);
        reply.status(200);
        return { received: true };
      },
    );
  });
}
