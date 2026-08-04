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

const { listCatalogPage } = await import('../src/modules/sales-pos/application/pricing.js');

describe('listCatalogPage — bulk offline-catalog pull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins Item and Item Price (Retail only) by item_code in a single pass', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string, params: Record<string, unknown>) => {
      if (doctype === 'Item') {
        return Promise.resolve([
          { item_code: 'A', item_name: 'Item A', stock_uom: 'Pcs' },
          { item_code: 'B', item_name: 'Item B', stock_uom: 'Pcs' },
        ]);
      }
      if (doctype === 'Item Price') {
        // Only Retail-list rows should ever be requested — assert the
        // filter the code sent, not just what we choose to return.
        expect(params.filters).toContainEqual(['price_list', '=', 'Retail']);
        return Promise.resolve([{ item_code: 'A', price_list_rate: 15000 }]);
      }
      return Promise.resolve([]);
    });

    const page = await listCatalogPage(0, 200);

    expect(page.items).toEqual([
      { itemCode: 'A', itemName: 'Item A', stockUom: 'Pcs', retailPrice: 15000 },
      { itemCode: 'B', itemName: 'Item B', stockUom: 'Pcs', retailPrice: null },
    ]);
  });

  it('only queries disabled=0 items, never a disabled Item', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string, params: Record<string, unknown>) => {
      if (doctype === 'Item') {
        expect(params.filters).toContainEqual(['disabled', '=', 0]);
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    await listCatalogPage(0, 200);
    expect(erpNextClientMock.list).toHaveBeenCalledWith('Item', expect.anything());
  });

  it('sets hasMore=true when a full page comes back, false on a short page', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Item') {
        return Promise.resolve(
          Array.from({ length: 3 }, (_, i) => ({
            item_code: `ITEM-${i}`,
            item_name: `Item ${i}`,
            stock_uom: 'Pcs',
          })),
        );
      }
      return Promise.resolve([]);
    });

    const fullPage = await listCatalogPage(0, 3);
    expect(fullPage.hasMore).toBe(true);

    const shortPage = await listCatalogPage(0, 10);
    expect(shortPage.hasMore).toBe(false);
  });

  it('returns an empty, non-more page without calling Item Price at all when Item comes back empty', async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    const page = await listCatalogPage(0, 200);

    expect(page).toEqual({ items: [], hasMore: false });
    expect(erpNextClientMock.list).toHaveBeenCalledTimes(1);
    expect(erpNextClientMock.list).toHaveBeenCalledWith('Item', expect.anything());
  });

  it('respects offset/limit by passing them through as limit_start/limit_page_length', async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    await listCatalogPage(400, 200);

    expect(erpNextClientMock.list).toHaveBeenCalledWith(
      'Item',
      expect.objectContaining({ limit_start: '400', limit_page_length: '200' }),
    );
  });
});
