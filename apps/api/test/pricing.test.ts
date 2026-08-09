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

const { resolvePriceList, updateItemPrice } =
  await import('../src/modules/sales-pos/application/pricing.js');

describe('resolvePriceList', () => {
  it.each([
    ['Retail', 'Retail'],
    ['Grosir', 'Grosir'],
    ['Member', 'Member'],
  ])('maps tier %s to Price List %s', (tier, expected) => {
    expect(resolvePriceList(tier)).toBe(expected);
  });

  it('defaults to Retail for an unknown tier', () => {
    expect(resolvePriceList('NotARealTier')).toBe('Retail');
  });

  it('defaults to Retail when tier is undefined', () => {
    expect(resolvePriceList(undefined)).toBe('Retail');
  });
});

describe('updateItemPrice — Edit from Daftar Produk (price-only, see doc comment for why not UOM)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates an existing Retail row in place instead of creating a duplicate', async () => {
    erpNextClientMock.list.mockResolvedValueOnce([{ name: 'existing-retail-row' }]);

    await updateItemPrice('BAWANG-MERAH-KG', 'Kg', { retailPrice: 22000 });

    expect(erpNextClientMock.update).toHaveBeenCalledWith('Item Price', 'existing-retail-row', {
      price_list_rate: 22000,
    });
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('creates a new row when none exists yet for this item/price-list/uom', async () => {
    erpNextClientMock.list.mockResolvedValueOnce([]);

    await updateItemPrice('BAWANG-MERAH-KG', 'Kg', { retailPrice: 22000 });

    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: 'BAWANG-MERAH-KG',
      price_list: 'Retail',
      price_list_rate: 22000,
      uom: 'Kg',
    });
    expect(erpNextClientMock.update).not.toHaveBeenCalled();
  });

  it('writes only the field(s) provided — omitting grosirPrice never touches the Grosir row', async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    await updateItemPrice('BAWANG-MERAH-KG', 'Kg', { retailPrice: 22000 });

    const grosirWrites = [
      ...erpNextClientMock.create.mock.calls,
      ...erpNextClientMock.update.mock.calls,
    ].filter((call) => JSON.stringify(call).includes('Grosir'));
    expect(grosirWrites).toHaveLength(0);
  });

  it('updates both Retail and Grosir when both are provided', async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    await updateItemPrice('BAWANG-MERAH-KG', 'Kg', { retailPrice: 22000, grosirPrice: 21000 });

    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Item Price',
      expect.objectContaining({ price_list: 'Retail', price_list_rate: 22000 }),
    );
    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Item Price',
      expect.objectContaining({ price_list: 'Grosir', price_list_rate: 21000 }),
    );
  });
});
