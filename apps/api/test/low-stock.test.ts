import { beforeEach, describe, expect, it, vi } from 'vitest';

const erpNextClientMock = {
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../src/shared/erpnext-client/index.js', () => ({
  erpNextClient: erpNextClientMock,
}));

const { listLowStock, DEFAULT_LOW_STOCK_THRESHOLD } =
  await import('../src/modules/inventory/application/stock.js');

describe('listLowStock — Beranda low-stock alert (real ERPNext Bin data, per-item threshold override)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags an item at or below the store-wide default (10) when it has no threshold override', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Bin') {
        return Promise.resolve([
          { item_code: 'BERAS', warehouse: 'Gudang Utama - TH', actual_qty: 8 },
          { item_code: 'KOPI', warehouse: 'Gudang Utama - TH', actual_qty: 50 },
        ]);
      }
      if (doctype === 'Item') {
        return Promise.resolve([
          { item_code: 'BERAS', item_name: 'Beras', custom_low_stock_threshold: 0 },
          { item_code: 'KOPI', item_name: 'Kopi Kapal Api', custom_low_stock_threshold: 0 },
        ]);
      }
      throw new Error(`unexpected doctype ${doctype}`);
    });

    const result = await listLowStock();

    expect(result).toEqual([
      {
        itemCode: 'BERAS',
        itemName: 'Beras',
        warehouse: 'Gudang Utama - TH',
        actualQty: 8,
        threshold: 10,
      },
    ]);
  });

  it("honors an item's own custom_low_stock_threshold instead of the store-wide default", async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Bin') {
        return Promise.resolve([
          // 15 units would NOT be low against the default (10), but this
          // item's own threshold is 20 — a fast-moving staple the owner
          // wants flagged sooner.
          { item_code: 'MINYAK', warehouse: 'Gudang Utama - TH', actual_qty: 15 },
        ]);
      }
      if (doctype === 'Item') {
        return Promise.resolve([
          { item_code: 'MINYAK', item_name: 'Minyak Goreng', custom_low_stock_threshold: 20 },
        ]);
      }
      throw new Error(`unexpected doctype ${doctype}`);
    });

    const result = await listLowStock();

    expect(result).toEqual([
      {
        itemCode: 'MINYAK',
        itemName: 'Minyak Goreng',
        warehouse: 'Gudang Utama - TH',
        actualQty: 15,
        threshold: 20,
      },
    ]);
  });

  it('treats a zero or negative per-item threshold as "unset" and falls back to the default', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Bin') {
        return Promise.resolve([
          { item_code: 'GULA', warehouse: 'Gudang Utama - TH', actual_qty: 9 },
        ]);
      }
      if (doctype === 'Item') {
        return Promise.resolve([
          { item_code: 'GULA', item_name: 'Gula Pasir', custom_low_stock_threshold: -1 },
        ]);
      }
      throw new Error(`unexpected doctype ${doctype}`);
    });

    const result = await listLowStock();

    expect(result[0]?.threshold).toBe(DEFAULT_LOW_STOCK_THRESHOLD);
  });

  it('returns items sorted by ascending stock, most urgent first', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Bin') {
        return Promise.resolve([
          { item_code: 'A', warehouse: 'Gudang Utama - TH', actual_qty: 7 },
          { item_code: 'B', warehouse: 'Gudang Utama - TH', actual_qty: 1 },
          { item_code: 'C', warehouse: 'Gudang Utama - TH', actual_qty: 4 },
        ]);
      }
      if (doctype === 'Item') {
        return Promise.resolve([
          { item_code: 'A', item_name: 'A' },
          { item_code: 'B', item_name: 'B' },
          { item_code: 'C', item_name: 'C' },
        ]);
      }
      throw new Error(`unexpected doctype ${doctype}`);
    });

    const result = await listLowStock();

    expect(result.map((r) => r.itemCode)).toEqual(['B', 'C', 'A']);
  });

  it('returns an empty array without querying Item when nothing is stocked in the default warehouse', async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    const result = await listLowStock();

    expect(result).toEqual([]);
    expect(erpNextClientMock.list).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicit default threshold override, still overridable per item', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Bin') {
        return Promise.resolve([
          { item_code: 'TISU', warehouse: 'Gudang Utama - TH', actual_qty: 3 },
        ]);
      }
      if (doctype === 'Item') {
        return Promise.resolve([{ item_code: 'TISU', item_name: 'Tisu' }]);
      }
      throw new Error(`unexpected doctype ${doctype}`);
    });

    const result = await listLowStock(2);

    // actual_qty (3) > explicit default threshold (2) and no per-item
    // override — not flagged.
    expect(result).toEqual([]);
  });
});
