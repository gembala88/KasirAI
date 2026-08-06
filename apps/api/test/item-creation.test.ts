import { beforeEach, describe, expect, it, vi } from 'vitest';

const erpNextClientMock = {
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

class FakeErpNextApiError extends Error {
  statusCode: number;
  constructor(statusCode: number, message = 'error') {
    super(message);
    this.statusCode = statusCode;
  }
}

vi.mock('../src/shared/erpnext-client/index.js', () => ({
  erpNextClient: erpNextClientMock,
  ErpNextApiError: FakeErpNextApiError,
}));

const { createItem, createItemPrices, listItemGroups, listUoms, DuplicateItemError } =
  await import('../src/modules/sales-pos/application/item-creation.js');

const NOT_FOUND = new FakeErpNextApiError(404);

const NEW_ITEM = {
  itemCode: '8997212800288',
  itemName: 'Teh Botol 350ml',
  itemGroup: 'Produk Umum',
  stockUom: 'Pcs',
};

describe('createItem — registers the Item document (spec: bulk product onboarding)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: everything referenced (item_code, UOMs) doesn't exist yet.
    erpNextClientMock.get.mockRejectedValue(NOT_FOUND);
  });

  it('throws DuplicateItemError and never writes anything when the item_code already exists', async () => {
    erpNextClientMock.get.mockResolvedValueOnce({ name: NEW_ITEM.itemCode });

    await expect(createItem(NEW_ITEM)).rejects.toBeInstanceOf(DuplicateItemError);
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('creates the Item with no uoms child table when there are no package UOMs', async () => {
    const result = await createItem(NEW_ITEM);

    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Item',
      expect.objectContaining({
        item_code: NEW_ITEM.itemCode,
        item_name: NEW_ITEM.itemName,
        item_group: NEW_ITEM.itemGroup,
        stock_uom: NEW_ITEM.stockUom,
        is_stock_item: 1,
        disabled: 0,
      }),
    );
    const itemCall = erpNextClientMock.create.mock.calls.find((c) => c[0] === 'Item');
    expect(itemCall?.[1]).not.toHaveProperty('uoms');
    expect(result).toEqual({ itemCode: NEW_ITEM.itemCode, itemName: NEW_ITEM.itemName });
  });

  it('ensures the base stockUom exists as a UOM master, creating it if missing', async () => {
    await createItem({ ...NEW_ITEM, stockUom: 'Renteng' });

    expect(erpNextClientMock.get).toHaveBeenCalledWith('UOM', 'Renteng');
    expect(erpNextClientMock.create).toHaveBeenCalledWith('UOM', { uom_name: 'Renteng' });
  });

  it('does not recreate a UOM master that already exists', async () => {
    erpNextClientMock.get.mockImplementation((doctype: string) => {
      if (doctype === 'Item') return Promise.reject(NOT_FOUND);
      if (doctype === 'UOM') return Promise.resolve({ name: 'Pcs' });
      throw new Error('unexpected doctype');
    });

    await createItem(NEW_ITEM);

    const uomCreateCalls = erpNextClientMock.create.mock.calls.filter((c) => c[0] === 'UOM');
    expect(uomCreateCalls).toHaveLength(0);
  });

  it('includes a uoms child-table row per package UOM, with its own conversion factor, and ensures each exists', async () => {
    await createItem({
      ...NEW_ITEM,
      stockUom: 'Renteng',
      packageUoms: [
        { uom: 'Dus', conversionQty: 8, retailPrice: 60000 },
        { uom: 'Lusin', conversionQty: 12, retailPrice: 55000 },
      ],
    });

    expect(erpNextClientMock.get).toHaveBeenCalledWith('UOM', 'Dus');
    expect(erpNextClientMock.get).toHaveBeenCalledWith('UOM', 'Lusin');
    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Item',
      expect.objectContaining({
        uoms: [
          { uom: 'Dus', conversion_factor: 8 },
          { uom: 'Lusin', conversion_factor: 12 },
        ],
      }),
    );
  });

  it('re-throws a non-404 error from the item existence check instead of treating it as "does not exist"', async () => {
    erpNextClientMock.get.mockRejectedValueOnce(new FakeErpNextApiError(500));

    await expect(createItem(NEW_ITEM)).rejects.toThrow();
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });
});

describe('createItemPrices — idempotent per-row (spec: safe to call again on retry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    erpNextClientMock.list.mockResolvedValue([]); // no existing rows by default
  });

  const PRICED_ITEM = { ...NEW_ITEM, retailPrice: 5000 };

  it('creates a Retail Item Price row for the base uom when none exists yet', async () => {
    const result = await createItemPrices(PRICED_ITEM);

    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: PRICED_ITEM.itemCode,
      price_list: 'Retail',
      price_list_rate: 5000,
      uom: PRICED_ITEM.stockUom,
    });
    expect(result).toEqual({
      itemCode: PRICED_ITEM.itemCode,
      itemName: PRICED_ITEM.itemName,
      retailPrice: 5000,
      grosirPrice: null,
      packageUoms: [],
    });
  });

  it('also creates a Grosir row when grosirPrice is given, never when omitted', async () => {
    await createItemPrices({ ...PRICED_ITEM, grosirPrice: 4000 });
    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: PRICED_ITEM.itemCode,
      price_list: 'Grosir',
      price_list_rate: 4000,
      uom: PRICED_ITEM.stockUom,
    });

    erpNextClientMock.create.mockClear();
    await createItemPrices(PRICED_ITEM);
    const grosirCalls = erpNextClientMock.create.mock.calls.filter(
      (c) => c[0] === 'Item Price' && c[1].price_list === 'Grosir',
    );
    expect(grosirCalls).toHaveLength(0);
  });

  it('skips creating a row that already exists — the actual retry-safety guarantee', async () => {
    erpNextClientMock.list.mockResolvedValueOnce([{ name: 'existing-retail-row' }]); // base Retail already there

    await createItemPrices(PRICED_ITEM);

    const retailCreateCalls = erpNextClientMock.create.mock.calls.filter(
      (c) =>
        c[0] === 'Item Price' && c[1].price_list === 'Retail' && c[1].uom === PRICED_ITEM.stockUom,
    );
    expect(retailCreateCalls).toHaveLength(0);
  });

  it('creates a Retail/Grosir pair per package UOM, distinct from the base uom rows', async () => {
    const result = await createItemPrices({
      ...PRICED_ITEM,
      packageUoms: [
        { uom: 'Dus', conversionQty: 8, retailPrice: 60000, grosirPrice: 56000 },
        { uom: 'Lusin', conversionQty: 12, retailPrice: 58000 },
      ],
    });

    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: PRICED_ITEM.itemCode,
      price_list: 'Retail',
      price_list_rate: 60000,
      uom: 'Dus',
    });
    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: PRICED_ITEM.itemCode,
      price_list: 'Grosir',
      price_list_rate: 56000,
      uom: 'Dus',
    });
    expect(erpNextClientMock.create).toHaveBeenCalledWith('Item Price', {
      item_code: PRICED_ITEM.itemCode,
      price_list: 'Retail',
      price_list_rate: 58000,
      uom: 'Lusin',
    });
    // Lusin has no grosirPrice — must not be invented as 0.
    const lusinGrosir = erpNextClientMock.create.mock.calls.filter(
      (c) => c[0] === 'Item Price' && c[1].uom === 'Lusin' && c[1].price_list === 'Grosir',
    );
    expect(lusinGrosir).toHaveLength(0);

    expect(result.packageUoms).toEqual([
      { uom: 'Dus', retailPrice: 60000, grosirPrice: 56000 },
      { uom: 'Lusin', retailPrice: 58000, grosirPrice: null },
    ]);
  });
});

describe('listItemGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('only requests leaf groups (is_group=0), never category/parent nodes', async () => {
    erpNextClientMock.list.mockResolvedValue([{ name: 'Produk Umum' }]);

    const groups = await listItemGroups();

    expect(erpNextClientMock.list).toHaveBeenCalledWith(
      'Item Group',
      expect.objectContaining({ filters: [['is_group', '=', 0]] }),
    );
    expect(groups).toEqual([{ name: 'Produk Umum' }]);
  });
});

describe('listUoms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns every UOM master record, unfiltered', async () => {
    erpNextClientMock.list.mockResolvedValue([{ name: 'Pcs' }, { name: 'Renteng' }]);

    const uoms = await listUoms();

    expect(erpNextClientMock.list).toHaveBeenCalledWith(
      'UOM',
      expect.objectContaining({ fields: ['name'] }),
    );
    expect(uoms).toEqual([{ name: 'Pcs' }, { name: 'Renteng' }]);
  });
});
