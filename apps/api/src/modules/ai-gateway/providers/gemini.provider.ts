import { AIProviderError, AIProviderRateLimitError } from './errors.js';
import type { AIProvider, AIRequest, AIResponse } from './types.js';

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

/**
 * Google Gemini (generativelanguage.googleapis.com) — a different request
 * shape from the OpenAI-compatible providers (contents/parts, not
 * messages), and the key goes in the query string, not a header. Never
 * log the built URL anywhere — it embeds the API key.
 */
export function createGeminiProvider(
  apiKey: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
): AIProvider {
  return {
    name: 'gemini',
    supportsFunctionCalling: true,
    async generateResponse(input: AIRequest): Promise<AIResponse> {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: input.prompt }] }] }),
        });
      } catch (cause) {
        throw new AIProviderError(
          'gemini',
          `network error: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (response.status === 429) {
        throw new AIProviderRateLimitError('gemini');
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AIProviderError('gemini', `HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const json = (await response.json()) as GenerateContentResponse;
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text === undefined) {
        throw new AIProviderError('gemini', 'response had no candidate text');
      }
      return { text, raw: json };
    },
  };
}
