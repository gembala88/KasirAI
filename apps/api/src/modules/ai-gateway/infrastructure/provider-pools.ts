/**
 * Builds the provider pools the gateway fails over across, from env config
 * (§3.1's confirmed AI_PROVIDER_PRIORITY + per-provider key arrays).
 * OpenAI and Claude have no factory yet — configuring keys for them is a
 * no-op with a warning, not an error, until they're implemented.
 */
import { env } from '../../../config/env.js';
import { logger } from '../../../shared/logger/index.js';
import {
  createGeminiProvider,
  createMimoProvider,
  createNvidiaNimProvider,
  type AIProvider,
} from '../providers/index.js';
import type { ProviderPool } from './gateway.js';

type ProviderFactory = (apiKey: string) => AIProvider;

const PROVIDER_FACTORIES: Record<string, ProviderFactory> = {
  mimo: (key) => createMimoProvider(key, env.MIMO_MODEL),
  gemini: (key) => createGeminiProvider(key, env.GEMINI_MODEL),
  nvidia: (key) => createNvidiaNimProvider(key, env.NVIDIA_NIM_MODEL),
};

function keysForProvider(name: string): string[] {
  switch (name) {
    case 'mimo':
      return env.MIMO_API_KEYS;
    case 'gemini':
      return env.GEMINI_API_KEYS;
    case 'nvidia':
      return env.NVIDIA_NIM_API_KEYS;
    case 'openai':
      return env.OPENAI_API_KEYS;
    case 'claude':
      return env.CLAUDE_API_KEYS;
    default:
      return [];
  }
}

export function buildProviderPools(): ProviderPool[] {
  const pools: ProviderPool[] = [];

  for (const name of env.AI_PROVIDER_PRIORITY) {
    const keys = keysForProvider(name);
    if (keys.length === 0) {
      continue;
    }

    const factory = PROVIDER_FACTORIES[name];
    if (!factory) {
      logger.warn({ provider: name }, 'ai_gateway.provider_not_implemented');
      continue;
    }

    pools.push({
      name,
      instances: keys.map((apiKey) => ({ apiKey, provider: factory(apiKey) })),
    });
  }

  return pools;
}
