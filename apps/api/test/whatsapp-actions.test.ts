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

const sendImageMessageMock = vi.fn().mockResolvedValue(undefined);
const sendTextMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/modules/whatsapp/infrastructure/whatsapp-client.js', () => ({
  sendImageMessage: sendImageMessageMock,
  sendTextMessage: sendTextMessageMock,
}));

const { executeConversationAction } = await import('../src/modules/whatsapp/application/actions.js');
const { getOrCreateSession } = await import('../src/modules/whatsapp/infrastructure/sessions.js');

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

const PHONE = `62800${Date.now()}`; // unique per run — whatsapp_sessions is a real (test) sqlite file

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeConversationAction', () => {
  it('check_stock returns matching items with real stock quantities, never fabricated', async () => {
    mockList({
      Item: [{ item_code: 'ITEM-OIL', item_name: 'Minyak Goreng 1L', stock_uom: 'Pcs' }],
      'Item Price': [{ price_list_rate: 18000 }],
      Bin: [{ actual_qty: 42 }],
      Customer: [],
    });

    const session = getOrCreateSession(PHONE);
    const result = (await executeConversationAction(PHONE, session, {
      type: 'check_stock',
      itemQuery: 'minyak',
    })) as { found: boolean; matches: Array<{ itemCode: string; stockQty: number }> };

    expect(result.found).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({ itemCode: 'ITEM-OIL', stockQty: 42 });
  });

  it('check_stock distinguishes "not found in catalog" from "found, zero stock" so the persona never conflates them', async () => {
    mockList({ Item: [], Customer: [] });

    const session = getOrCreateSession(`${PHONE}-notfound`);
    const notFound = (await executeConversationAction(`${PHONE}-notfound`, session, {
      type: 'check_stock',
      itemQuery: 'barang gaib',
    })) as { found: boolean; itemQuery?: string; matches?: unknown };

    expect(notFound).toEqual({ found: false, itemQuery: 'barang gaib' });
    expect(notFound.matches).toBeUndefined();

    mockList({
      Item: [{ item_code: 'ITEM-EMPTY', item_name: 'Barang Kosong', stock_uom: 'Pcs' }],
      'Item Price': [{ price_list_rate: 5000 }],
      Bin: [],
      Customer: [],
    });
    const zeroStock = (await executeConversationAction(`${PHONE}-notfound`, session, {
      type: 'check_stock',
      itemQuery: 'barang kosong',
    })) as { found: boolean; matches: Array<{ itemCode: string; stockQty: number }> };

    expect(zeroStock.found).toBe(true);
    expect(zeroStock.matches[0]).toMatchObject({ itemCode: 'ITEM-EMPTY', stockQty: 0 });
  });

  it('propose_sales_order reports customer_not_registered instead of fabricating an order', async () => {
    mockList({ Customer: [] });

    const session = getOrCreateSession(`${PHONE}-unregistered`);
    const result = await executeConversationAction(`${PHONE}-unregistered`, session, {
      type: 'propose_sales_order',
      items: [{ itemCode: 'ITEM-OIL', qty: 2 }],
    });

    expect(result).toEqual({
      error: 'customer_not_registered',
      message: 'No ERPNext Customer found for this phone number',
    });
  });

  it('propose_sales_order proposes then confirms through the validated action layer when the customer resolves', async () => {
    mockGet({
      Customer: { name: 'CUST-1', customer_tier: 'Retail' },
      Item: { min_order_qty: 0 },
    });
    mockList({
      Customer: [{ name: 'CUST-1', customer_name: 'Budi', mobile_no: PHONE }],
      'Item Price': [{ price_list_rate: 18000 }],
      Bin: [{ actual_qty: 42 }],
    });
    erpNextClientMock.create.mockResolvedValue({ name: 'SO-0001' });
    erpNextClientMock.update.mockResolvedValue({ name: 'SO-0001' });

    const phone = `${PHONE}-order`;
    const session = getOrCreateSession(phone);
    const result = await executeConversationAction(phone, session, {
      type: 'propose_sales_order',
      items: [{ itemCode: 'ITEM-OIL', qty: 2 }],
    });

    expect(result).toEqual({ orderName: 'SO-0001', status: 'executed' });
    expect(erpNextClientMock.create).toHaveBeenCalledWith(
      'Sales Order',
      expect.objectContaining({ customer: 'CUST-1' }),
    );
  });

  describe('initiate_payment', () => {
    // As of the Phase 6 payment-detail hardening, this action only ever
    // creates the draft invoice and returns real facts — it never sends
    // a WhatsApp message itself. Composing/sending the payment
    // instruction is conversation.ts's job exclusively (payment-reply.ts),
    // covered by test/whatsapp-conversation.test.ts.
    function mockOrderAndInvoice(orderName: string, invoiceName: string): void {
      mockGet({ Customer: { name: 'CUST-1', customer_tier: 'Retail' } });
      erpNextClientMock.get.mockImplementation((doctype: string) => {
        if (doctype === 'Sales Order') {
          return Promise.resolve({
            name: orderName,
            customer: 'CUST-1',
            selling_price_list: 'Retail',
            items: [{ item_code: 'ITEM-OIL', qty: 2, rate: 18000, warehouse: 'Gudang Utama - TH' }],
          });
        }
        if (doctype === 'Customer') {
          return Promise.resolve({ name: 'CUST-1', customer_tier: 'Retail' });
        }
        return Promise.reject(new Error(`unexpected doctype ${doctype}`));
      });
      erpNextClientMock.create.mockResolvedValue({
        name: invoiceName,
        status: 'Draft',
        customer: 'CUST-1',
        grand_total: 36000,
        paid_amount: 0,
        outstanding_amount: 36000,
      });
    }

    it.each(['qris', 'transfer', 'cod'] as const)(
      'method=%s: creates the draft invoice and returns real facts, never sends a message itself',
      async (method) => {
        mockList({ Customer: [{ name: 'CUST-1', customer_name: 'Budi', mobile_no: `${PHONE}-${method}` }] });
        mockOrderAndInvoice(`SO-${method}`, `SINV-${method}`);

        const phone = `${PHONE}-${method}`;
        const session = getOrCreateSession(phone);
        const result = await executeConversationAction(phone, session, {
          type: 'initiate_payment',
          orderName: `SO-${method}`,
          method,
        });

        expect(result).toEqual({ invoiceName: `SINV-${method}`, grandTotal: 36000, method });
        expect(sendTextMessageMock).not.toHaveBeenCalled();
        expect(sendImageMessageMock).not.toHaveBeenCalled();
      },
    );

    it('reports invoice_failed without masking when the ERPNext write itself fails', async () => {
      mockList({ Customer: [{ name: 'CUST-1', customer_name: 'Budi', mobile_no: `${PHONE}-writefail` }] });
      mockGet({ Customer: { name: 'CUST-1', customer_tier: 'Retail' } });
      erpNextClientMock.get.mockImplementation((doctype: string) =>
        doctype === 'Sales Order'
          ? Promise.reject(new Error('ERPNext request failed with status 404'))
          : Promise.resolve({ name: 'CUST-1', customer_tier: 'Retail' }),
      );

      const phone = `${PHONE}-writefail`;
      const session = getOrCreateSession(phone);
      const result = await executeConversationAction(phone, session, {
        type: 'initiate_payment',
        orderName: 'SO-MISSING',
        method: 'cod',
      });

      expect(result).toMatchObject({ error: 'invoice_failed' });
    });

    it('rejects a method the model invented that is not one of qris/transfer/cod', async () => {
      mockList({ Customer: [{ name: 'CUST-1', customer_name: 'Budi', mobile_no: `${PHONE}-badmethod` }] });
      mockOrderAndInvoice('SO-0005', 'SINV-0004');

      const phone = `${PHONE}-badmethod`;
      const session = getOrCreateSession(phone);
      const result = await executeConversationAction(phone, session, {
        type: 'initiate_payment',
        orderName: 'SO-0005',
        // @ts-expect-error deliberately invalid at the boundary this guards
        method: 'cash',
      });

      expect(result).toEqual({ error: 'unsupported_method', method: 'cash' });
      expect(erpNextClientMock.create).not.toHaveBeenCalled();
    });
  });
});
