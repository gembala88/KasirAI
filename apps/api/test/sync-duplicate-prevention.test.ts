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

  it('classifies "create-item" finding an already-registered item_code as Conflict, same as a stock clash', async () => {
    // A warehouse worker's device queued this offline; by the time it
    // synced, someone else (another device, or this same one earlier)
    // had already registered this exact barcode — the spec's explicit
    // "confirm item_code doesn't already exist... to avoid duplicates".
    const createItemAction = {
      type: 'create-item' as const,
      itemCode: '8997212800288',
      itemName: 'Teh Botol 350ml',
      itemGroup: 'Produk Umum',
      stockUom: 'Pcs',
      retailPrice: 5000,
    };
    const request = {
      uuid: '77777777-7777-7777-7777-777777777777',
      contentHash: computeContentHash(createItemAction),
      clientTimestamp: '2026-08-03T10:00:00.000Z',
      action: createItemAction,
    };

    erpNextClientMock.get.mockResolvedValueOnce({ name: createItemAction.itemCode });

    const result = await syncAction(request);
    expect(result.status).toBe('Conflict');
    expect(erpNextClientMock.create).not.toHaveBeenCalled();

    // Same not-re-applied guarantee as every other Conflict.
    erpNextClientMock.get.mockClear();
    const replay = await syncAction(request);
    expect(replay.status).toBe('Conflict');
    expect(replay.skipped).toBe(true);
    expect(erpNextClientMock.get).not.toHaveBeenCalled();
  });

  it('"create-item" with opening stock resumes from the stock entry on retry, without re-registering the Item', async () => {
    // Registering the item (step 1) succeeds, but the opening-stock
    // Material Receipt (step 2) hits a network blip — the same
    // partial-failure shape processPosSale already handles for
    // invoice-then-payment. A naive retry would call createItem() again,
    // see the Item now exists, and wrongly report this as a Conflict
    // instead of finishing step 2.
    const createItemAction = {
      type: 'create-item' as const,
      itemCode: 'DEMO-KOPI-SACHET',
      itemName: 'Kopi Sachet',
      itemGroup: 'Produk Umum',
      stockUom: 'Pcs',
      retailPrice: 2000,
      costPrice: 1200,
      openingQty: 50,
      warehouse: 'Gudang Utama - TH',
    };
    const request = {
      uuid: '88888888-8888-8888-8888-888888888888',
      contentHash: computeContentHash(createItemAction),
      clientTimestamp: '2026-08-03T10:00:00.000Z',
      action: createItemAction,
    };

    const { ErpNextApiError } = await import('../src/shared/erpnext-client/index.js');
    // itemExists -> not found; ensureUom(stockUom) -> already exists (no UOM create needed).
    erpNextClientMock.get.mockImplementation((doctype: string) => {
      if (doctype === 'Item') return Promise.reject(new ErpNextApiError('not found', 404));
      if (doctype === 'UOM') return Promise.resolve({ name: 'Pcs' });
      return Promise.reject(new Error(`unexpected get(${doctype})`));
    });
    erpNextClientMock.list.mockResolvedValue([]); // no existing Item Price rows yet
    erpNextClientMock.create
      .mockResolvedValueOnce({ name: createItemAction.itemCode }) // Item
      .mockResolvedValueOnce({ name: 'item-price-retail' }) // Item Price (Retail)
      .mockRejectedValueOnce(new Error('network blip creating stock entry')); // Stock Entry

    await expect(syncAction(request)).rejects.toThrow('network blip');
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(3);

    erpNextClientMock.get.mockClear();
    erpNextClientMock.create.mockClear();
    // The base Retail row now exists (created in the failed attempt) —
    // createItemPrices must find it and skip, not recreate it.
    erpNextClientMock.list.mockResolvedValueOnce([{ name: 'item-price-retail' }]);
    erpNextClientMock.create.mockResolvedValueOnce({ name: 'MAT-STE-RETRY-001' }); // Stock Entry, retried
    erpNextClientMock.update.mockResolvedValueOnce({ name: 'MAT-STE-RETRY-001' }); // submit

    const retried = await syncAction(request);
    expect(retried.status).toBe('Synced');
    // The real assertion: no re-check of item existence/UOMs, no second Item or Item Price write.
    expect(erpNextClientMock.get).not.toHaveBeenCalled();
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(1);
    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Stock Entry',
      expect.objectContaining({ stock_entry_type: 'Material Receipt' }),
    );
  });

  it('"create-item" with package UOMs resumes price-row creation on retry without duplicating rows already written', async () => {
    // A partial failure this time lands *inside* the multi-row price step
    // itself (base Retail written, Dus Retail fails) — createItemPrices
    // must be safe to call again and only fill in what's missing.
    const createItemAction = {
      type: 'create-item' as const,
      itemCode: 'DEMO-RINSO-CAIR',
      itemName: 'Rinso Cair',
      itemGroup: 'Produk Umum',
      stockUom: 'Renteng',
      retailPrice: 2000,
      packageUoms: [{ uom: 'Dus', conversionQty: 8, retailPrice: 15000 }],
    };
    const request = {
      uuid: '99999999-9999-9999-9999-999999999999',
      contentHash: computeContentHash(createItemAction),
      clientTimestamp: '2026-08-03T10:00:00.000Z',
      action: createItemAction,
    };

    const { ErpNextApiError } = await import('../src/shared/erpnext-client/index.js');
    erpNextClientMock.get.mockImplementation((doctype: string) => {
      if (doctype === 'Item') return Promise.reject(new ErpNextApiError('not found', 404));
      if (doctype === 'UOM') return Promise.reject(new ErpNextApiError('not found', 404)); // Renteng + Dus both new
      return Promise.reject(new Error(`unexpected get(${doctype})`));
    });
    erpNextClientMock.list.mockResolvedValue([]); // no Item Price rows exist yet
    erpNextClientMock.create
      .mockResolvedValueOnce({ name: 'Renteng' }) // ensureUom(stockUom)
      .mockResolvedValueOnce({ name: 'Dus' }) // ensureUom(package uom)
      .mockResolvedValueOnce({ name: createItemAction.itemCode }) // Item
      .mockResolvedValueOnce({ name: 'item-price-retail-renteng' }) // base Retail
      .mockRejectedValueOnce(new Error('network blip creating Dus price')); // Dus Retail fails

    await expect(syncAction(request)).rejects.toThrow('network blip');

    erpNextClientMock.get.mockClear();
    erpNextClientMock.create.mockClear();
    // Base Retail row already exists; Dus Retail row still doesn't.
    erpNextClientMock.list.mockImplementation(
      (_doctype: string, opts: { filters: [string, string, unknown][] }) => {
        const uomFilter = opts.filters.find((f) => f[0] === 'uom');
        if (uomFilter?.[2] === 'Renteng') return Promise.resolve([{ name: 'item-price-retail-renteng' }]);
        return Promise.resolve([]);
      },
    );
    erpNextClientMock.create.mockResolvedValueOnce({ name: 'item-price-retail-dus' });

    const retried = await syncAction(request);
    expect(retried.status).toBe('Synced');
    // No re-registration of the Item or its UOMs, no duplicate base-Retail row.
    expect(erpNextClientMock.get).not.toHaveBeenCalled();
    expect(erpNextClientMock.create).toHaveBeenCalledTimes(1);
    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: createItemAction.itemCode,
      price_list: 'Retail',
      price_list_rate: 15000,
      uom: 'Dus',
    });
  });
});
