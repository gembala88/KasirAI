/**
 * Distinguishes "this key is rate-limited/exhausted, rotate to the next
 * one" from every other provider failure — that distinction is what the
 * two-level failover in ../infrastructure/gateway.ts acts on (§3.1).
 */
export class AIProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'AIProviderError';
  }
}

export class AIProviderRateLimitError extends AIProviderError {
  constructor(provider: string) {
    super(provider, 'rate limit or quota exceeded');
    this.name = 'AIProviderRateLimitError';
  }
}
