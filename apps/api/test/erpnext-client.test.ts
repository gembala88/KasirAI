import { describe, expect, it, vi } from 'vitest';
import { createErpNextClient, ErpNextApiError } from '../src/shared/erpnext-client/index.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildClient(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createErpNextClient>[0]> = {},
) {
  return createErpNextClient({
    baseUrl: 'http://erpnext.test',
    apiKey: 'key',
    apiSecret: 'secret',
    fetchImpl,
    circuitBreakerResetMs: 50,
    ...overrides,
  });
}

describe('ErpNextClient', () => {
  it('sends token auth and maps GET to /api/resource/<doctype>/<name>', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { name: 'CUST-0001' } }));
    const client = buildClient(fetchImpl as unknown as typeof fetch);

    const result = await client.get<{ name: string }>('Customer', 'CUST-0001');

    expect(result).toEqual({ name: 'CUST-0001' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://erpnext.test/api/resource/Customer/CUST-0001');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('token key:secret');
  });

  it('maps create/update/delete to the right method and path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { name: 'CUST-0002' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { name: 'CUST-0002' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = buildClient(fetchImpl as unknown as typeof fetch);

    await client.create('Customer', { customer_name: 'Toko Jaya' });
    await client.update('Customer', 'CUST-0002', { customer_name: 'Toko Jaya Baru' });
    await client.delete('Customer', 'CUST-0002');

    expect(fetchImpl.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe('DELETE');
  });

  it('retries transient (5xx) failures and returns the eventual success', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ exc_type: 'boom' }, 502))
      .mockResolvedValueOnce(jsonResponse({ exc_type: 'boom' }, 502))
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: 'CUST-0001' }] }));
    const client = buildClient(fetchImpl as unknown as typeof fetch);

    const result = await client.list('Customer');

    expect(result).toEqual([{ name: 'CUST-0001' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-transient 4xx failure', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ exc_type: 'NotFound' }, 404));
    const client = buildClient(fetchImpl as unknown as typeof fetch);

    await expect(client.get('Customer', 'MISSING')).rejects.toThrow(ErpNextApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after consecutive transient failures and fails fast', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ exc_type: 'boom' }, 503));
    const client = buildClient(fetchImpl as unknown as typeof fetch, {
      circuitBreakerThreshold: 2,
      maxAttempts: 1,
    });

    await expect(client.get('Customer', 'A')).rejects.toThrow(ErpNextApiError);
    await expect(client.get('Customer', 'B')).rejects.toThrow(ErpNextApiError);
    const callsBeforeOpen = fetchImpl.mock.calls.length;

    // Circuit should now be open — this call must fail without hitting fetch again.
    await expect(client.get('Customer', 'C')).rejects.toThrow();
    expect(fetchImpl.mock.calls.length).toBe(callsBeforeOpen);
  });
});
