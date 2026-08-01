import { describe, expect, it, vi } from 'vitest';
import { createGeminiProvider } from '../src/modules/ai-gateway/providers/gemini.provider.js';
import { createMimoProvider } from '../src/modules/ai-gateway/providers/mimo.provider.js';
import { createNvidiaNimProvider } from '../src/modules/ai-gateway/providers/nvidia-nim.provider.js';
import {
  AIProviderError,
  AIProviderRateLimitError,
} from '../src/modules/ai-gateway/providers/errors.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createGeminiProvider', () => {
  it('sends the prompt in Gemini contents/parts shape and parses the response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'halo dari gemini' }] } }] }),
      );
    const provider = createGeminiProvider('test-key', 'gemini-1.5-flash', fetchImpl);

    const result = await provider.generateResponse({ prompt: 'Halo' });

    expect(result.text).toBe('halo dari gemini');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-1.5-flash:generateContent');
    expect(url).toContain('key=test-key');
    expect(JSON.parse(init.body as string)).toEqual({ contents: [{ parts: [{ text: 'Halo' }] }] });
  });

  it('throws AIProviderRateLimitError on 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    const provider = createGeminiProvider('test-key', 'gemini-1.5-flash', fetchImpl);

    await expect(provider.generateResponse({ prompt: 'Halo' })).rejects.toThrow(
      AIProviderRateLimitError,
    );
  });

  it('throws AIProviderError when the response has no candidate text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ candidates: [] }));
    const provider = createGeminiProvider('test-key', 'gemini-1.5-flash', fetchImpl);

    await expect(provider.generateResponse({ prompt: 'Halo' })).rejects.toThrow(AIProviderError);
  });
});

describe('createNvidiaNimProvider', () => {
  it('sends Bearer auth and OpenAI-compatible chat completions body', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'halo dari nvidia' } }] }));
    const provider = createNvidiaNimProvider('nim-key', 'meta/llama3-70b-instruct', fetchImpl);

    const result = await provider.generateResponse({ prompt: 'Halo' });

    expect(result.text).toBe('halo dari nvidia');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer nim-key');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'meta/llama3-70b-instruct',
      messages: [{ role: 'user', content: 'Halo' }],
    });
  });

  it('throws AIProviderRateLimitError on 429', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 429));
    const provider = createNvidiaNimProvider('nim-key', 'meta/llama3-70b-instruct', fetchImpl);

    await expect(provider.generateResponse({ prompt: 'Halo' })).rejects.toThrow(
      AIProviderRateLimitError,
    );
  });
});

describe('createMimoProvider', () => {
  it('sends the api-key header (not Bearer) per Xiaomi MiMo auth', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ choices: [{ message: { content: 'halo dari mimo' } }] }));
    const provider = createMimoProvider('mimo-key', 'mimo-v2.5-pro', fetchImpl);

    const result = await provider.generateResponse({ prompt: 'Halo' });

    expect(result.text).toBe('halo dari mimo');
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('mimo-key');
    expect(headers.Authorization).toBeUndefined();
  });

  it('throws AIProviderError (not rate-limit) on a non-429 failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request' }, 400));
    const provider = createMimoProvider('mimo-key', 'mimo-v2.5-pro', fetchImpl);

    const error = await provider.generateResponse({ prompt: 'Halo' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIProviderError);
    expect(error).not.toBeInstanceOf(AIProviderRateLimitError);
  });
});
