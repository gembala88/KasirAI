import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env.js';

describe('env config', () => {
  it('parses AI provider key pools into arrays', () => {
    expect(Array.isArray(env.GEMINI_API_KEYS)).toBe(true);
    expect(Array.isArray(env.AI_PROVIDER_PRIORITY)).toBe(true);
    expect(env.AI_PROVIDER_PRIORITY).toContain('gemini');
  });

  it('has sane defaults for local development', () => {
    expect(env.PORT).toBeGreaterThan(0);
    expect(env.ERPNEXT_BASE_URL).toMatch(/^https?:\/\//);
  });
});
