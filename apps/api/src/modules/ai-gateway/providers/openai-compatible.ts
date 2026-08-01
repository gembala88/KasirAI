/**
 * Shared client for providers exposing an OpenAI-compatible chat
 * completions endpoint (NVIDIA NIM, Mimo) — same request/response shape,
 * different base URL / auth header / model. Hand-rolled with fetch rather
 * than pulling in an SDK, consistent with the rest of the codebase (e.g.
 * shared/erpnext-client).
 */
import { AIProviderError, AIProviderRateLimitError } from './errors.js';
import type { AIProvider, AIRequest, AIResponse } from './types.js';

export interface OpenAiCompatibleConfig {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** Different providers put the key in different headers (Bearer vs. a custom header name). */
  authHeader: (apiKey: string) => Record<string, string>;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export function createOpenAiCompatibleProvider(config: OpenAiCompatibleConfig): AIProvider {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    name: config.name,
    supportsFunctionCalling: true,
    async generateResponse(input: AIRequest): Promise<AIResponse> {
      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...config.authHeader(config.apiKey),
          },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'user', content: input.prompt }],
          }),
        });
      } catch (cause) {
        throw new AIProviderError(
          config.name,
          `network error: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }

      if (response.status === 429) {
        throw new AIProviderRateLimitError(config.name);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new AIProviderError(config.name, `HTTP ${response.status}: ${body.slice(0, 300)}`);
      }

      const json = (await response.json()) as ChatCompletionResponse;
      const text = json.choices?.[0]?.message?.content;
      if (text === undefined) {
        throw new AIProviderError(config.name, 'response had no message content');
      }
      return { text, raw: json };
    },
  };
}
