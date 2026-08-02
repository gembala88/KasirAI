/**
 * Distinguishes "this key is rate-limited/exhausted, rotate to the next
 * one" from every other provider failure — that distinction is what the
 * two-level failover in ../infrastructure/gateway.ts acts on (§3.1).
 */
export class AIProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    /**
     * Transient failures (network errors, 5xx) mean this provider/key is
     * temporarily unavailable, not that the request itself was bad — worth
     * failing over to the next key/provider, same distinction
     * shared/erpnext-client's `isRetryable` makes for HTTP status codes.
     * Non-retryable (the default): a genuine 4xx or a malformed response
     * body, which another key of the same provider won't fix.
     */
    public readonly retryable: boolean = false,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'AIProviderError';
  }
}

export class AIProviderRateLimitError extends AIProviderError {
  constructor(provider: string) {
    super(provider, 'rate limit or quota exceeded', true);
    this.name = 'AIProviderRateLimitError';
  }
}
