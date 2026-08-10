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

const { createTransaction, listCompletedTransactions, getTransactionDetail } =
  await import('../src/modules/sales-pos/application/transactions.js');

const PRICE_LIST = {
  price_list_rate: 5000,
};

function mockPriceLookup(): void {
  erpNextClientMock.list.mockImplementation((doctype: string) => {
    if (doctype === 'Item Price') return Promise.resolve([PRICE_LIST]);
    return Promise.resolve([]);
  });
  erpNextClientMock.create.mockImplementation(
    (_doctype: string, payload: Record<string, unknown>) =>
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
    const items = createCall?.[1].items as Array<{
      item_code: string;
      warehouse: string;
      qty: number;
    }>;

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

describe('listCompletedTransactions — Riwayat Transaksi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches each invoice individually for payment rows, keyed correctly per invoice', async () => {
    // Real ERPNext behavior this guards against: the generic list endpoint
    // for a child-table doctype (`Sales Invoice Payment`) silently drops
    // every requested field except `name`, filter or no filter — so
    // payment method can only be read via each invoice's own GET, same as
    // getTransactionDetail already does.
    erpNextClientMock.list.mockResolvedValue([
      { name: 'ACC-SINV-0001' },
      { name: 'ACC-SINV-0002' },
    ]);
    erpNextClientMock.get.mockImplementation((doctype: string, name: string) => {
      if (name === 'ACC-SINV-0001') {
        return Promise.resolve({
          name: 'ACC-SINV-0001',
          customer_name: 'Walk-in Customer',
          posting_date: '2026-08-10',
          posting_time: '10:00:00',
          grand_total: 5000,
          outstanding_amount: 0,
          payments: [{ mode_of_payment: 'Cash', amount: 5000 }],
          items: [],
        });
      }
      return Promise.resolve({
        name: 'ACC-SINV-0002',
        customer_name: 'Budi',
        posting_date: '2026-08-10',
        posting_time: '09:00:00',
        grand_total: 20000,
        outstanding_amount: 20000,
        payments: [],
        items: [],
      });
    });

    const page = await listCompletedTransactions(0, 20);

    expect(page.transactions).toHaveLength(2);
    expect(page.transactions[0]).toMatchObject({
      name: 'ACC-SINV-0001',
      isPaid: true,
      payments: [{ modeOfPayment: 'Cash', amount: 5000 }],
    });
    // Real bug this guards against: an Unpaid/Kasbon-style invoice (no
    // payment rows yet, positive outstanding balance) must still show up
    // correctly — isPaid false, an empty payments array, not thrown away
    // or crashed on.
    expect(page.transactions[1]).toMatchObject({
      name: 'ACC-SINV-0002',
      isPaid: false,
      payments: [],
    });

    expect(erpNextClientMock.get).toHaveBeenCalledWith('Sales Invoice', 'ACC-SINV-0001');
    expect(erpNextClientMock.get).toHaveBeenCalledWith('Sales Invoice', 'ACC-SINV-0002');
  });

  it('only queries submitted invoices, never drafts — but does not filter on is_pos, real bug found live: Kasbon invoices are deliberately is_pos=0 (ERPNext refuses to submit an is_pos=1 invoice with zero payments), so an is_pos filter here would silently drop every Kasbon sale', async () => {
    erpNextClientMock.list.mockResolvedValue([]);

    await listCompletedTransactions(0, 20);

    const invoiceListCall = erpNextClientMock.list.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    expect(invoiceListCall?.[1]).toMatchObject({
      filters: [['docstatus', '=', 1]],
    });
  });

  it('sets hasMore only when a full page came back', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Sales Invoice') {
        return Promise.resolve(Array.from({ length: 2 }, (_, i) => ({ name: `ACC-SINV-000${i}` })));
      }
      return Promise.resolve([]);
    });
    erpNextClientMock.get.mockImplementation((_doctype: string, name: string) =>
      Promise.resolve({
        name,
        customer_name: 'Walk-in Customer',
        posting_date: '2026-08-10',
        posting_time: '10:00:00',
        grand_total: 1000,
        outstanding_amount: 0,
        payments: [],
        items: [],
      }),
    );

    expect((await listCompletedTransactions(0, 2)).hasMore).toBe(true);
    expect((await listCompletedTransactions(0, 5)).hasMore).toBe(false);
  });
});

describe('getTransactionDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes full line items alongside the same summary fields the list uses', async () => {
    erpNextClientMock.get.mockResolvedValue({
      name: 'ACC-SINV-0001',
      customer_name: 'Walk-in Customer',
      posting_date: '2026-08-10',
      posting_time: '10:00:00',
      grand_total: 5500,
      outstanding_amount: 0,
      payments: [{ mode_of_payment: 'Cash', amount: 5500 }],
      items: [
        {
          item_code: 'KOPI-1',
          item_name: 'Kopi Kapal Api',
          qty: 1,
          uom: 'Pcs',
          rate: 5500,
          amount: 5500,
        },
      ],
    });

    const detail = await getTransactionDetail('ACC-SINV-0001');

    expect(detail.isPaid).toBe(true);
    expect(detail.payments).toEqual([{ modeOfPayment: 'Cash', amount: 5500 }]);
    expect(detail.items).toEqual([
      {
        itemCode: 'KOPI-1',
        itemName: 'Kopi Kapal Api',
        qty: 1,
        uom: 'Pcs',
        rate: 5500,
        amount: 5500,
      },
    ]);
  });
});
