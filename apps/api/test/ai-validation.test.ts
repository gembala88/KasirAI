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

const { validateSalesOrderAction } = await import('../src/modules/ai-gateway/validation/index.js');

function mockGet(byDoctype: Record<string, unknown>): void {
  erpNextClientMock.get.mockImplementation((doctype: string) => {
    const value = byDoctype[doctype];
    if (value === undefined) {
      return Promise.reject(new Error(`not found: ${doctype}`));
    }
    return Promise.resolve(value);
  });
}

function mockList(byDoctype: Record<string, unknown[]>): void {
  erpNextClientMock.list.mockImplementation((doctype: string) =>
    Promise.resolve(byDoctype[doctype] ?? []),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateSalesOrderAction', () => {
  it('is valid when customer exists, price matches, and stock covers qty', async () => {
    mockGet({
      Customer: { customer_tier: 'Retail' },
      Item: { min_order_qty: 0 },
    });
    mockList({
      'Item Price': [{ price_list_rate: 10000 }],
      Bin: [{ actual_qty: 50 }],
    });

    const result = await validateSalesOrderAction({
      customerId: 'CUST-1',
      items: [{ itemCode: 'ITEM-1', qty: 5, rate: 10000 }],
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('rejects an AI-proposed price that does not match ERPNext', async () => {
    mockGet({ Customer: { customer_tier: 'Retail' }, Item: { min_order_qty: 0 } });
    mockList({ 'Item Price': [{ price_list_rate: 10000 }], Bin: [{ actual_qty: 50 }] });

    const result = await validateSalesOrderAction({
      customerId: 'CUST-1',
      items: [{ itemCode: 'ITEM-1', qty: 5, rate: 9000 }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/does not match ERPNext price/);
  });

  it('rejects insufficient stock', async () => {
    mockGet({ Customer: { customer_tier: 'Retail' }, Item: { min_order_qty: 0 } });
    mockList({ 'Item Price': [{ price_list_rate: 10000 }], Bin: [{ actual_qty: 2 }] });

    const result = await validateSalesOrderAction({
      customerId: 'CUST-1',
      items: [{ itemCode: 'ITEM-1', qty: 5 }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/Insufficient stock/);
  });

  it('enforces MOQ for Grosir tier using Item.min_order_qty', async () => {
    mockGet({ Customer: { customer_tier: 'Grosir' }, Item: { min_order_qty: 10 } });
    mockList({ 'Item Price': [{ price_list_rate: 8000 }], Bin: [{ actual_qty: 100 }] });

    const result = await validateSalesOrderAction({
      customerId: 'CUST-1',
      items: [{ itemCode: 'ITEM-1', qty: 5 }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/Below MOQ for Grosir/);
  });

  it('does not enforce MOQ for Retail tier', async () => {
    mockGet({ Customer: { customer_tier: 'Retail' }, Item: { min_order_qty: 10 } });
    mockList({ 'Item Price': [{ price_list_rate: 8000 }], Bin: [{ actual_qty: 100 }] });

    const result = await validateSalesOrderAction({
      customerId: 'CUST-1',
      items: [{ itemCode: 'ITEM-1', qty: 5 }],
    });

    expect(result.valid).toBe(true);
  });

  it('rejects an unknown customer', async () => {
    mockGet({ Item: { min_order_qty: 0 } });
    mockList({ 'Item Price': [{ price_list_rate: 10000 }], Bin: [{ actual_qty: 50 }] });

    const result = await validateSalesOrderAction({
      customerId: 'MISSING',
      items: [{ itemCode: 'ITEM-1', qty: 1, rate: 10000 }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('not found'))).toBe(true);
  });

  it('rejects an unknown item without fabricating a price', async () => {
    mockGet({ Customer: { customer_tier: 'Retail' } });
    mockList({ 'Item Price': [], Bin: [] });

    const result = await validateSalesOrderAction({
      customerId: 'CUST-1',
      items: [{ itemCode: 'GHOST-ITEM', qty: 1 }],
    });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/not found/);
  });

  it('rejects an empty item list', async () => {
    mockGet({ Customer: { customer_tier: 'Retail' } });
    mockList({});

    const result = await validateSalesOrderAction({ customerId: 'CUST-1', items: [] });

    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toMatch(/at least one line item/i);
  });
});
