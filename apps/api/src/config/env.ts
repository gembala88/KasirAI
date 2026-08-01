import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Loads the nearest `.env`, walking up from cwd. There's a single
 * `.env.example` at the monorepo root (§4), but npm workspace scripts run
 * with cwd set to apps/api, and the production Docker image's WORKDIR is
 * the repo root — this works for both without hardcoding either shape.
 * A missing `.env` (e.g. production, where real env vars are injected
 * directly) is not an error; dotenv just has nothing to load.
 */
function loadNearestEnvFile(): void {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadNearestEnvFile();

/**
 * Comma-separated list of API keys -> non-empty string array.
 * Used for the AI Gateway's per-provider key pools (§3.1 of the spec).
 */
const csvKeys = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((key) => key.trim())
      .filter((key) => key.length > 0),
  );

const providerPriority = z
  .string()
  .default('mimo,gemini,nvidia,openai,claude')
  .transform((value) => value.split(',').map((p) => p.trim().toLowerCase()));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  // Comma-separated allowlist for browser clients (apps/pwa-scanner,
  // apps/dashboard) calling the API cross-origin. "*" (default) reflects
  // any origin — fine while those apps only run on developer machines;
  // replace with real production origins before deploying (§10 Phase 8).
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('*')
    .transform((value) => (value === '*' ? true : value.split(',').map((o) => o.trim()))),

  // --- Auth ---
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('CHANGE_ME_TO_A_RANDOM_32_CHAR_MINIMUM_SECRET'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  // --- ERPNext (source of truth) ---
  ERPNEXT_BASE_URL: z.string().url().default('http://localhost:8000'),
  ERPNEXT_API_KEY: z.string().default(''),
  ERPNEXT_API_SECRET: z.string().default(''),
  // Placeholder company name until the real business name is confirmed —
  // see README "Renaming the placeholder company". Renaming is a Company
  // doctype edit in ERPNext, not a code change, once these are updated.
  ERPNEXT_DEFAULT_COMPANY: z.string().default('Toko Hermes'),
  ERPNEXT_DEFAULT_WAREHOUSE: z.string().default('Gudang Utama - TH'),
  // HMAC secret Frappe signs webhook payloads with (Webhook.webhook_secret).
  // Empty means signature verification is skipped — fine for local dev,
  // must be set before exposing /webhooks/erpnext beyond localhost.
  ERPNEXT_WEBHOOK_SECRET: z.string().default(''),
  // Where ERPNext should POST webhook events — from inside the ERPNext
  // Docker network, the Node API running on the host is reached via
  // Docker Desktop's host.docker.internal, not localhost.
  ERPNEXT_WEBHOOK_CALLBACK_URL: z
    .string()
    .default('http://host.docker.internal:3000/webhooks/erpnext'),

  // --- Redis / BullMQ (async jobs, cache) ---
  // Points at the `hermes-redis` service in infra/docker/docker-compose.yml
  // (published on 6380, not the default 6379, to avoid colliding with any
  // other local Redis — that service is separate from ERPNext's internal
  // redis-cache/redis-queue, which aren't reachable from the host at all).
  REDIS_URL: z.string().default('redis://localhost:6380'),
  // Reminder window for piutang (accounts receivable) due-date checks,
  // spec §7 "Piutang reminder flow". A repeatable BullMQ job checks daily;
  // this controls how many days out counts as "coming due".
  PIUTANG_REMINDER_DAYS_AHEAD: z.coerce.number().int().positive().default(3),
  PIUTANG_REMINDER_CRON: z.string().default('0 8 * * *'),

  // --- AI Gateway: multi-provider, multi-key rotation (§3.1) ---
  AI_PROVIDER_PRIORITY: providerPriority,
  MIMO_API_KEYS: csvKeys,
  GEMINI_API_KEYS: csvKeys,
  NVIDIA_NIM_API_KEYS: csvKeys,
  OPENAI_API_KEYS: csvKeys,
  CLAUDE_API_KEYS: csvKeys,
  // Model names are env-configurable rather than hardcoded — free-tier
  // model availability shifts over time and per-account.
  MIMO_MODEL: z.string().default('mimo-v2.5-pro'),
  // gemini-1.5-flash 404s on current API keys (deprecated); confirmed
  // live 2026-08-02 that "gemini-flash-latest" works — Google's
  // "-latest" alias convention for whichever Flash model is currently
  // served, avoiding pinning to a dated snapshot that gets sunset again.
  GEMINI_MODEL: z.string().default('gemini-flash-latest'),
  NVIDIA_NIM_MODEL: z.string().default('meta/llama-3.1-8b-instruct'),
  // Consecutive-failure threshold before a key is put on cooldown, and how
  // long the cooldown lasts (§3.1: "tracks key health in Redis ... so a
  // rate-limited key isn't retried immediately").
  AI_KEY_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  // --- WhatsApp Business Cloud API ---
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default(''),
  // Meta signs inbound webhook payloads with this (X-Hub-Signature-256,
  // HMAC-SHA256 of the raw body) — the app's secret, not a separate token.
  WHATSAPP_APP_SECRET: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  // How many prior turns of ai_conversation_log to include as context
  // when building a reply (spec §5 "chat history for context/memory").
  WHATSAPP_CONVERSATION_HISTORY_TURNS: z.coerce.number().int().nonnegative().default(10),

  // --- Payment (§10 Phase 6: COD/Transfer, alongside Phase 5's static-image
  // QRIS — all three are manually confirmed by the owner/cashier for now;
  // real licensed-aggregator (Midtrans/Xendit) integration for automatic
  // QRIS confirmation is deferred until real sandbox credentials exist) ---
  QRIS_STATIC_IMAGE_URL: z.string().default(''),
  BANK_TRANSFER_BANK_NAME: z.string().default(''),
  BANK_TRANSFER_ACCOUNT_NUMBER: z.string().default(''),
  BANK_TRANSFER_ACCOUNT_NAME: z.string().default(''),

  // --- Observability ---
  SENTRY_DSN: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${formatted}`);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
