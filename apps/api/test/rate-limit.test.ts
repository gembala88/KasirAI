import { afterAll, describe, expect, it, vi } from 'vitest';

// Login always fails fast (wrong credentials) — the point of this test is
// the rate limiter tripping before the 11th attempt, not login logic
// itself (already covered in auth.test.ts).
vi.stubGlobal(
  'fetch',
  vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ message: 'Invalid login credentials' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

const { buildApp } = await import('../src/main.js');
const app = await buildApp();

describe('POST /api/v1/auth/login rate limiting', () => {
  afterAll(async () => {
    await app.close();
  });

  it('blocks the 11th login attempt within the window (max: 10) — spec §1.4 brute-force protection', async () => {
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'attacker@hermes.local', password: 'guess' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      // Sequential on purpose — rate limiting is about request order, not concurrency.
      statuses.push((await attempt()).statusCode);
    }

    expect(statuses.slice(0, 10).every((code) => code === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
