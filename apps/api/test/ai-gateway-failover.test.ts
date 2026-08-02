import { describe, expect, it } from 'vitest';
import {
  AllProvidersExhaustedError,
  generateWithFailover,
  type ProviderPool,
} from '../src/modules/ai-gateway/infrastructure/gateway.js';
import type { KeyHealthStore } from '../src/modules/ai-gateway/infrastructure/key-rotation.js';
import { AIProviderError, AIProviderRateLimitError } from '../src/modules/ai-gateway/providers/errors.js';
import type { AIProvider, AIResponse } from '../src/modules/ai-gateway/providers/types.js';

/** In-memory KeyHealthStore fake — no Redis needed for these tests (CI has none). */
function createInMemoryKeyHealthStore(): KeyHealthStore {
  const cooldowns = new Set<string>();
  return {
    isOnCooldown: (provider, apiKey) => Promise.resolve(cooldowns.has(`${provider}:${apiKey}`)),
    markOnCooldown: (provider, apiKey) => {
      cooldowns.add(`${provider}:${apiKey}`);
      return Promise.resolve();
    },
  };
}

function fakeProvider(
  name: string,
  behavior: (() => Promise<AIResponse>) | (() => never),
): AIProvider {
  return {
    name,
    supportsFunctionCalling: false,
    generateResponse: async () => behavior(),
  };
}

describe('generateWithFailover', () => {
  it('returns the first successful response with no failover needed', async () => {
    const pools: ProviderPool[] = [
      {
        name: 'gemini',
        instances: [
          { apiKey: 'key-1', provider: fakeProvider('gemini', async () => ({ text: 'ok' })) },
        ],
      },
    ];

    const result = await generateWithFailover(
      pools,
      { prompt: 'hi' },
      createInMemoryKeyHealthStore(),
    );
    expect(result.text).toBe('ok');
  });

  it('rotates to the next key in the same provider on a rate-limit error', async () => {
    const calls: string[] = [];
    const pools: ProviderPool[] = [
      {
        name: 'gemini',
        instances: [
          {
            apiKey: 'key-1',
            provider: fakeProvider('gemini', () => {
              calls.push('key-1');
              throw new AIProviderRateLimitError('gemini');
            }),
          },
          {
            apiKey: 'key-2',
            provider: fakeProvider('gemini', async () => {
              calls.push('key-2');
              return { text: 'from key 2' };
            }),
          },
        ],
      },
    ];

    const result = await generateWithFailover(
      pools,
      { prompt: 'hi' },
      createInMemoryKeyHealthStore(),
    );

    expect(result.text).toBe('from key 2');
    expect(calls).toEqual(['key-1', 'key-2']);
  });

  it('skips a key already on cooldown without calling it again', async () => {
    const store = createInMemoryKeyHealthStore();
    await store.markOnCooldown('gemini', 'key-1');

    const calls: string[] = [];
    const pools: ProviderPool[] = [
      {
        name: 'gemini',
        instances: [
          {
            apiKey: 'key-1',
            provider: fakeProvider('gemini', async () => {
              calls.push('key-1');
              return { text: 'should not happen' };
            }),
          },
          {
            apiKey: 'key-2',
            provider: fakeProvider('gemini', async () => {
              calls.push('key-2');
              return { text: 'from key 2' };
            }),
          },
        ],
      },
    ];

    const result = await generateWithFailover(pools, { prompt: 'hi' }, store);

    expect(result.text).toBe('from key 2');
    expect(calls).toEqual(['key-2']);
  });

  it('falls back to the next provider once every key in the first is exhausted', async () => {
    const calls: string[] = [];
    const pools: ProviderPool[] = [
      {
        name: 'mimo',
        instances: [
          {
            apiKey: 'mimo-key-1',
            provider: fakeProvider('mimo', () => {
              calls.push('mimo-1');
              throw new AIProviderRateLimitError('mimo');
            }),
          },
        ],
      },
      {
        name: 'gemini',
        instances: [
          {
            apiKey: 'gemini-key-1',
            provider: fakeProvider('gemini', async () => {
              calls.push('gemini-1');
              return { text: 'from gemini' };
            }),
          },
        ],
      },
    ];

    const result = await generateWithFailover(
      pools,
      { prompt: 'hi' },
      createInMemoryKeyHealthStore(),
    );

    expect(result.text).toBe('from gemini');
    expect(calls).toEqual(['mimo-1', 'gemini-1']);
  });

  it('throws AllProvidersExhaustedError when every key in every provider is rate-limited', async () => {
    const pools: ProviderPool[] = [
      {
        name: 'mimo',
        instances: [
          {
            apiKey: 'k1',
            provider: fakeProvider('mimo', () => {
              throw new AIProviderRateLimitError('mimo');
            }),
          },
        ],
      },
      {
        name: 'gemini',
        instances: [
          {
            apiKey: 'k2',
            provider: fakeProvider('gemini', () => {
              throw new AIProviderRateLimitError('gemini');
            }),
          },
        ],
      },
    ];

    await expect(
      generateWithFailover(pools, { prompt: 'hi' }, createInMemoryKeyHealthStore()),
    ).rejects.toThrow(AllProvidersExhaustedError);
  });

  it('propagates a non-rate-limit, non-provider error immediately without rotating', async () => {
    const calls: string[] = [];
    const pools: ProviderPool[] = [
      {
        name: 'gemini',
        instances: [
          {
            apiKey: 'k1',
            provider: fakeProvider('gemini', () => {
              calls.push('k1');
              throw new Error('boom');
            }),
          },
          {
            apiKey: 'k2',
            provider: fakeProvider('gemini', async () => {
              calls.push('k2');
              return { text: 'unreachable' };
            }),
          },
        ],
      },
    ];

    await expect(
      generateWithFailover(pools, { prompt: 'hi' }, createInMemoryKeyHealthStore()),
    ).rejects.toThrow('boom');
    expect(calls).toEqual(['k1']);
  });

  it('rotates to the next key on a retryable provider error (network error / 5xx), not just rate limits', async () => {
    const calls: string[] = [];
    const store = createInMemoryKeyHealthStore();
    const pools: ProviderPool[] = [
      {
        name: 'nvidia',
        instances: [
          {
            apiKey: 'key-1',
            provider: fakeProvider('nvidia', () => {
              calls.push('key-1');
              throw new AIProviderError('nvidia', 'network error: ECONNRESET', true);
            }),
          },
          {
            apiKey: 'key-2',
            provider: fakeProvider('nvidia', async () => {
              calls.push('key-2');
              return { text: 'from key 2' };
            }),
          },
        ],
      },
    ];

    const result = await generateWithFailover(pools, { prompt: 'hi' }, store);

    expect(result.text).toBe('from key 2');
    expect(calls).toEqual(['key-1', 'key-2']);
    // A transient failure isn't a rate limit — the key itself may still be
    // healthy, so it must not be put on cooldown.
    expect(await store.isOnCooldown('nvidia', 'key-1')).toBe(false);
  });

  it('propagates a non-retryable provider error (e.g. a real 4xx) immediately without rotating', async () => {
    const calls: string[] = [];
    const pools: ProviderPool[] = [
      {
        name: 'gemini',
        instances: [
          {
            apiKey: 'k1',
            provider: fakeProvider('gemini', () => {
              calls.push('k1');
              throw new AIProviderError('gemini', 'HTTP 400: bad request', false);
            }),
          },
          {
            apiKey: 'k2',
            provider: fakeProvider('gemini', async () => {
              calls.push('k2');
              return { text: 'unreachable' };
            }),
          },
        ],
      },
    ];

    await expect(
      generateWithFailover(pools, { prompt: 'hi' }, createInMemoryKeyHealthStore()),
    ).rejects.toThrow('HTTP 400');
    expect(calls).toEqual(['k1']);
  });
});
