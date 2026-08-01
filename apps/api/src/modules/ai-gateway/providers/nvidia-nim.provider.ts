import { createOpenAiCompatibleProvider } from './openai-compatible.js';
import type { AIProvider } from './types.js';

/** NVIDIA NIM (build.nvidia.com) — OpenAI-compatible, Bearer token auth. */
export function createNvidiaNimProvider(
  apiKey: string,
  model: string,
  fetchImpl?: typeof fetch,
): AIProvider {
  return createOpenAiCompatibleProvider({
    name: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model,
    apiKey,
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
