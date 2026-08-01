/**
 * Two-level failover (§3.1): rotate through a provider's key pool before
 * falling back to the next provider in priority order. Every failover is
 * logged to the audit trail so provider/key reliability is visible later.
 */
import { auditLogger } from '../../../shared/audit/index.js';
import { ServiceUnavailableError } from '../../../shared/errors/index.js';
import { logger } from '../../../shared/logger/index.js';
import {
  AIProviderRateLimitError,
  type AIProvider,
  type AIRequest,
  type AIResponse,
} from '../providers/index.js';
import { redisKeyHealthStore, type KeyHealthStore } from './key-rotation.js';

export interface ProviderPool {
  name: string;
  /** One provider instance per API key, each already bound to its own key. */
  instances: Array<{ apiKey: string; provider: AIProvider }>;
}

export class AllProvidersExhaustedError extends ServiceUnavailableError {
  constructor() {
    super('All configured AI providers/keys are exhausted or unavailable');
    this.name = 'AllProvidersExhaustedError';
  }
}

export async function generateWithFailover(
  pools: ProviderPool[],
  input: AIRequest,
  keyHealthStore: KeyHealthStore = redisKeyHealthStore,
): Promise<AIResponse> {
  for (const pool of pools) {
    for (const { apiKey, provider } of pool.instances) {
      if (await keyHealthStore.isOnCooldown(pool.name, apiKey)) {
        continue;
      }

      try {
        return await provider.generateResponse(input);
      } catch (error) {
        if (error instanceof AIProviderRateLimitError) {
          await keyHealthStore.markOnCooldown(pool.name, apiKey);
          logger.warn({ provider: pool.name }, 'ai_gateway.key_failover');
          await auditLogger.record({
            actor: 'ai-gateway',
            action: 'provider_key_failover',
            after: { provider: pool.name },
          });
          continue;
        }
        throw error;
      }
    }

    if (pool.instances.length > 0) {
      logger.warn({ provider: pool.name }, 'ai_gateway.provider_exhausted');
      await auditLogger.record({
        actor: 'ai-gateway',
        action: 'provider_exhausted',
        after: { provider: pool.name },
      });
    }
  }

  throw new AllProvidersExhaustedError();
}
