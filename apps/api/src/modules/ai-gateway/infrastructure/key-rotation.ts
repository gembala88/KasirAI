/**
 * Key health tracking in Redis (§3.1: "The AI Gateway module tracks key
 * health in Redis (key → last-failure-timestamp/cooldown) so a
 * rate-limited key isn't retried immediately").
 *
 * Behind a `KeyHealthStore` interface so the gateway's failover logic is
 * testable with an in-memory fake (see test/ai-gateway.test.ts) — the same
 * injectable-dependency pattern as ErpNextClient's `fetchImpl`. CI runs
 * without a live Redis; production uses `redisKeyHealthStore` by default.
 */
import { createHash } from 'node:crypto';
import { env } from '../../../config/env.js';
import { getRedisConnection } from '../../../shared/queue/index.js';

export interface KeyHealthStore {
  isOnCooldown(provider: string, apiKey: string): Promise<boolean>;
  markOnCooldown(provider: string, apiKey: string): Promise<void>;
}

// Never store the raw API key in the Redis keyspace (visible via KEYS/logs).
function keyHash(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
}

function cooldownRedisKey(provider: string, apiKey: string): string {
  return `ai-key-cooldown:${provider}:${keyHash(apiKey)}`;
}

export const redisKeyHealthStore: KeyHealthStore = {
  async isOnCooldown(provider, apiKey) {
    const value = await getRedisConnection().get(cooldownRedisKey(provider, apiKey));
    return value !== null;
  },
  async markOnCooldown(provider, apiKey) {
    await getRedisConnection().set(
      cooldownRedisKey(provider, apiKey),
      '1',
      'EX',
      env.AI_KEY_COOLDOWN_SECONDS,
    );
  },
};
