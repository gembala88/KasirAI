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

const { listWarehouses } = await import('../src/modules/inventory/application/stock.js');
const { scanTransfer } = await import('../src/modules/inventory/application/scan.js');

describe('listWarehouses — Gudang dropdown source (spec: fixes free-text Gudang field bug)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only requests leaf warehouses (is_group=0), never category/parent nodes', async () => {
    erpNextClientMock.list.mockResolvedValue([{ name: 'Gudang Utama - TH' }]);

    const result = await listWarehouses();

    expect(erpNextClientMock.list).toHaveBeenCalledWith(
      'Warehouse',
      expect.objectContaining({
        filters: [
          ['is_group', '=', 0],
          ['company', '=', 'Toko Hermes'],
        ],
      }),
    );
    expect(result.warehouses).toEqual([{ name: 'Gudang Utama - TH' }]);
  });

  it('filters out ERPNext auto-generated per-Company default warehouses, in either language', async () => {
    erpNextClientMock.list.mockResolvedValue([
      { name: 'Gudang Utama - TH' },
      { name: 'Stores - TH' },
      { name: 'Work In Progress - TH' },
      { name: 'Finished Goods - TH' },
      { name: 'Goods In Transit - TH' },
      { name: 'Toko - NPG' },
      { name: 'Pekerjaan dalam proses - NPG' },
      { name: 'Stok Barang Jadi - NPG' },
      { name: 'Barang dalam Transit - NPG' },
    ]);

    const result = await listWarehouses();

    expect(result.warehouses).toEqual([{ name: 'Gudang Utama - TH' }, { name: 'Toko - NPG' }]);
  });

  it("returns the configured store warehouse as 'default'", async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    const result = await listWarehouses();

    expect(result.default).toBe('Gudang Utama - TH');
  });
});

describe('scanTransfer — Gudang Transfer action (real ERPNext Stock Entry, Material Transfer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a transfer where source and destination are the same warehouse, without ever calling ERPNext', async () => {
    await expect(
      scanTransfer('ITEM-A', 'Gudang Utama - TH', 'Gudang Utama - TH', 5),
    ).rejects.toThrow('Gudang asal dan tujuan tidak boleh sama');
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('creates then submits a Material Transfer Stock Entry between two different warehouses', async () => {
    erpNextClientMock.create.mockResolvedValue({ name: 'STE-0001' });
    erpNextClientMock.update.mockResolvedValue({ name: 'STE-0001' });

    await scanTransfer('ITEM-A', 'Gudang Utama - TH', 'Stores - TH', 5);

    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Stock Entry',
      expect.objectContaining({
        stock_entry_type: 'Material Transfer',
        items: [
          {
            item_code: 'ITEM-A',
            qty: 5,
            s_warehouse: 'Gudang Utama - TH',
            t_warehouse: 'Stores - TH',
          },
        ],
      }),
    );
    expect(erpNextClientMock.update).toHaveBeenCalledWith('Stock Entry', 'STE-0001', {
      docstatus: 1,
    });
  });
});
