/**
 * AI Gateway — provider adapters (§3.1).
 *
 * Each provider implements the shared `AIProvider` contract independently.
 * The gateway (../infrastructure/gateway.ts) rotates across each
 * provider's key pool before falling back to the next provider in
 * `AI_PROVIDER_PRIORITY`.
 *
 * OpenAI and Claude are not implemented yet (§3.1 confirms all 5 are
 * eventually active; this phase starts with the free-tier providers —
 * Mimo, Gemini, NVIDIA NIM — per "gratis dulu").
 */
export type { AIRequest, AIResponse, AIProvider } from './types.js';
export { AIProviderError, AIProviderRateLimitError } from './errors.js';
export { createGeminiProvider } from './gemini.provider.js';
export { createNvidiaNimProvider } from './nvidia-nim.provider.js';
export { createMimoProvider } from './mimo.provider.js';
