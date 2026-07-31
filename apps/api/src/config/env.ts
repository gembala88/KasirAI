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

  // --- Redis / BullMQ (async jobs, cache) ---
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // --- AI Gateway: multi-provider, multi-key rotation (§3.1) ---
  AI_PROVIDER_PRIORITY: providerPriority,
  MIMO_API_KEYS: csvKeys,
  GEMINI_API_KEYS: csvKeys,
  NVIDIA_NIM_API_KEYS: csvKeys,
  OPENAI_API_KEYS: csvKeys,
  CLAUDE_API_KEYS: csvKeys,

  // --- WhatsApp Business Cloud API ---
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),

  // --- Payment (QRIS static image, manual confirmation for MVP — §7) ---
  QRIS_STATIC_IMAGE_URL: z.string().default(''),

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
