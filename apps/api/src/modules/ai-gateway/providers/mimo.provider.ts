import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import type { AIProvider } from './types.js';

/** Xiaomi MiMo (api.xiaomimimo.com) — OpenAI-compatible, `api-key` header auth. */
export function createMimoProvider(
  apiKey: string,
  model: string,
  fetchImpl?: typeof fetch,
): AIProvider {
  return createOpenAiCompatibleProvider({
    name: 'mimo',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model,
    apiKey,
    authHeader: (key) => ({ 'api-key': key }),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
