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

const { createTransaction } = await import('../src/modules/sales-pos/application/transactions.js');

const PRICE_LIST = {
  price_list_rate: 5000,
};

function mockPriceLookup(): void {
  erpNextClientMock.list.mockImplementation((doctype: string) => {
    if (doctype === 'Item Price') return Promise.resolve([PRICE_LIST]);
    return Promise.resolve([]);
  });
  erpNextClientMock.create.mockImplementation((_doctype: string, payload: Record<string, unknown>) =>
    Promise.resolve({
      name: 'ACC-SINV-TEST',
      status: 'Draft',
      customer: payload.customer,
      grand_total: 0,
      paid_amount: 0,
      outstanding_amount: 0,
      items: payload.items,
    }),
  );
}

describe('createTransaction — duplicate barcode scan merging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges two lines for the same item + warehouse into one summed-quantity line', async () => {
    mockPriceLookup();

    await createTransaction(undefined, [
      { itemCode: 'DEMO-BERAS-5KG', qty: 1 },
      { itemCode: 'DEMO-BERAS-5KG', qty: 1 },
      { itemCode: 'DEMO-BERAS-5KG', qty: 2 },
    ]);

    const createCall = erpNextClientMock.create.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    const items = createCall?.[1].items as Array<{ item_code: string; qty: number }>;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ item_code: 'DEMO-BERAS-5KG', qty: 4 });
  });

  it('keeps different items as separate lines', async () => {
    mockPriceLookup();

    await createTransaction(undefined, [
      { itemCode: 'ITEM-A', qty: 1 },
      { itemCode: 'ITEM-B', qty: 1 },
    ]);

    const createCall = erpNextClientMock.create.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    const items = createCall?.[1].items as Array<{ item_code: string }>;

    expect(items.map((i) => i.item_code).sort()).toEqual(['ITEM-A', 'ITEM-B']);
  });

  it('keeps the same item in different warehouses as separate lines', async () => {
    mockPriceLookup();

    await createTransaction(undefined, [
      { itemCode: 'ITEM-A', qty: 1, warehouse: 'WH-1' },
      { itemCode: 'ITEM-A', qty: 1, warehouse: 'WH-2' },
    ]);

    const createCall = erpNextClientMock.create.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    const items = createCall?.[1].items as Array<{ item_code: string; warehouse: string; qty: number }>;

    expect(items).toHaveLength(2);
    expect(items.every((i) => i.qty === 1)).toBe(true);
  });

  it('carries an explicit rate override from either duplicate line into the merged line', async () => {
    mockPriceLookup();

    await createTransaction(undefined, [
      { itemCode: 'ITEM-A', qty: 1 },
      { itemCode: 'ITEM-A', qty: 1, rate: 9999 },
    ]);

    const createCall = erpNextClientMock.create.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    const items = createCall?.[1].items as Array<{ rate: number; qty: number }>;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ qty: 2, rate: 9999 });
  });
});
