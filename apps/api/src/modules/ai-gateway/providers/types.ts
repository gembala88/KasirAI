/**
 * AI Gateway — provider contract (§3.1). Every provider (Mimo, Gemini,
 * NVIDIA NIM, and later OpenAI/Claude) implements this the same way; the
 * gateway never needs to know which one it's talking to.
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
