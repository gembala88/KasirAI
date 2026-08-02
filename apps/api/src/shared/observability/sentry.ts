/**
 * Optional Sentry error tracking (§1.4 NFR "Monitoring"). Disabled by
 * default — `SENTRY_DSN` is empty until a real Sentry project exists, and
 * every deploy target (bare dev machine, CI, a VPS with no Sentry account
 * yet) must still boot and run cleanly without one. `createSentryReporter`
 * is the injectable factory (same pattern as `createErpNextClient`) so
 * tests can supply a fake Sentry client instead of hitting the real SDK;
 * `sentry` is the ready-to-use singleton the rest of the app imports.
 */
import * as Sentry from '@sentry/node';
import { env } from '../../config/env.js';

export interface SentryClient {
  init(options: { dsn: string; environment: string; tracesSampleRate: number }): unknown;
  captureException(error: unknown, hint?: { extra?: Record<string, unknown> }): unknown;
  captureMessage(message: string, hint?: { extra?: Record<string, unknown> }): unknown;
}

export interface SentryReporter {
  readonly enabled: boolean;
  captureException(error: unknown, extra?: Record<string, unknown>): void;
  captureMessage(message: string, extra?: Record<string, unknown>): void;
}

export function createSentryReporter(
  dsn: string,
  environment: string,
  client: SentryClient = Sentry,
): SentryReporter {
  const enabled = dsn.length > 0;

  if (enabled) {
    // Error tracking only — no performance tracing needed for this app's scale.
    client.init({ dsn, environment, tracesSampleRate: 0 });
  }

  return {
    enabled,
    captureException(error, extra) {
      if (!enabled) return;
      client.captureException(error, extra ? { extra } : undefined);
    },
    captureMessage(message, extra) {
      if (!enabled) return;
      client.captureMessage(message, extra ? { extra } : undefined);
    },
  };
}

export const sentry: SentryReporter = createSentryReporter(env.SENTRY_DSN, env.NODE_ENV);
