import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ErpNextClientModule from '../src/shared/erpnext-client/index.js';

const erpNextClientMock = {
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../src/shared/erpnext-client/index.js', async () => {
  const actual = await vi.importActual<typeof ErpNextClientModule>(
    '../src/shared/erpnext-client/index.js',
  );
  return { ...actual, erpNextClient: erpNextClientMock };
});

const { computeContentHash } = await import('../src/shared/content-hash/index.js');
const { syncAction } = await import('../src/modules/sync/application/index.js');

const ADD_STOCK_ACTION = {
  type: 'add-stock' as const,
  itemCode: 'DEMO-BERAS-5KG',
  warehouse: 'Gudang Utama - TH',
  qty: 5,
  rate: 65000,
};

function buildRequest(uuid: string, action: typeof ADD_STOCK_ACTION) {
  return {
    uuid,
    contentHash: computeContentHash(action),
    clientTimestamp: '2026-08-03T10:00:00.000Z',
    action,
  };
}

describe('syncAction — §15.2 duplicate prevention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    erpNextClientMock.create.mockResolvedValue({ name: 'MAT-STE-TEST-001' });
    erpNextClientMock.update.mockResolvedValue({ name: 'MAT-STE-TEST-001' });
  });

  it('retrying the identical UUID after a successful sync does not re-apply the write', async () => {
    const request = buildRequest('11111111-1111-1111-1111-111111111111', ADD_STOCK_ACTION);

    const first = await syncAction(request);
    expect(first.status).toBe('Synced');
    expect(first.skipped).toBe(false);
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(1);

    const second = await syncAction(request);
    expect(second.status).toBe('Synced');
    expect(second.skipped).toBe(true);
    expect(second.result).toEqual(first.result);

    // The real assertion: no second Stock Entry was ever created.
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(1);
  });

  it('retrying after a genuinely different UUID (a real second scan) does create a second write', async () => {
    const first = buildRequest('22222222-2222-2222-2222-222222222222', ADD_STOCK_ACTION);
    const second = buildRequest('33333333-3333-3333-3333-333333333333', ADD_STOCK_ACTION);

    await syncAction(first);
    await syncAction(second);

    expect(erpNextClientMock.create).toHaveBeenCalledTimes(2);
  });

  it('rejects a request whose contentHash does not match its payload, without writing anything', async () => {
    const request = {
      uuid: '44444444-4444-4444-4444-444444444444',
      contentHash: 'not-the-real-hash',
      clientTimestamp: '2026-08-03T10:00:00.000Z',
      action: ADD_STOCK_ACTION,
    };

    await expect(syncAction(request)).rejects.toThrow(/hash/i);
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('retrying a Failed sync (a real prior network error) does attempt the write again', async () => {
    const request = buildRequest('55555555-5555-5555-5555-555555555555', ADD_STOCK_ACTION);

    erpNextClientMock.create.mockRejectedValueOnce(new Error('network blip'));
    await expect(syncAction(request)).rejects.toThrow('network blip');
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(1);

    erpNextClientMock.create.mockResolvedValueOnce({ name: 'MAT-STE-TEST-002' });
    const retried = await syncAction(request);
    expect(retried.status).toBe('Synced');
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(2);
  });

  it('classifies a real NegativeStockError as Conflict, not a generic retryable Failed', async () => {
    const { ErpNextApiError } = await import('../src/shared/erpnext-client/index.js');
    const reduceStockAction = {
      type: 'reduce-stock' as const,
      itemCode: 'DEMO-BERAS-5KG',
      warehouse: 'Gudang Utama - TH',
      qty: 999999,
    };
    const request = {
      uuid: '66666666-6666-6666-6666-666666666666',
      contentHash: computeContentHash(reduceStockAction),
      clientTimestamp: '2026-08-03T10:00:00.000Z',
      action: reduceStockAction,
    };

    // Matches the real live-confirmed sequence (curl against a real
    // ERPNext instance): the draft Stock Entry creates fine; the
    // NegativeStockError only surfaces on submit (docstatus -> 1, i.e.
    // the client's `update` call), with `exc_type: "NegativeStockError"`
    // in the response body.
    erpNextClientMock.create.mockResolvedValueOnce({ name: 'MAT-STE-TEST-003' });
    erpNextClientMock.update.mockRejectedValueOnce(
      new ErpNextApiError(
        'ERPNext request failed with status 417',
        417,
        JSON.stringify({ exc_type: 'NegativeStockError' }),
      ),
    );

    const result = await syncAction(request);
    expect(result.status).toBe('Conflict');

    // A Conflict must not be silently retried/re-applied on the next sync attempt.
    erpNextClientMock.create.mockClear();
    erpNextClientMock.update.mockClear();
    const replay = await syncAction(request);
    expect(replay.status).toBe('Conflict');
    expect(replay.skipped).toBe(true);
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
    expect(erpNextClientMock.update).not.toHaveBeenCalled();
  });
});
