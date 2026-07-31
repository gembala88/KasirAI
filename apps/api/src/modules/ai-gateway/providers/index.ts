/**
 * AI Gateway — provider adapters (§3.1).
 *
 * Each provider (Mimo, Gemini, NVIDIA NIM, OpenAI, Claude) implements the
 * shared `AIProvider` interface independently, e.g. `mimo.provider.ts`,
 * `gemini.provider.ts`. The gateway rotates across each provider's key pool
 * before falling back to the next provider in `AI_PROVIDER_PRIORITY`.
 *
 * This is a Phase 4 deliverable (§10) — implemented once the validation
 * layer it depends on is in place.
 */
export interface AIRequest {
  prompt: string;
  context?: Record<string, unknown>;
}

export interface AIResponse {
  text: string;
  raw?: unknown;
}

export interface AIProvider {
  name: string;
  supportsFunctionCalling: boolean;
  generateResponse(input: AIRequest): Promise<AIResponse>;
}
