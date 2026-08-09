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

  it("scopes the query to Hermes' own company, so a second ERPNext company's warehouses (e.g. 'Toko - NPG') are never offered — real bug: they passed the is_group/system-default checks and were only rejected later by ERPNext at submit time ('Gudang X bukan milik perusahaan Toko Hermes')", async () => {
    erpNextClientMock.list.mockResolvedValue([{ name: 'Gudang Utama - TH' }]);

    await listWarehouses();

    const [, options] = erpNextClientMock.list.mock.calls[0];
    expect(options.filters).toContainEqual(['company', '=', 'Toko Hermes']);
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
