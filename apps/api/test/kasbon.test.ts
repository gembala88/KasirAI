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

const { env } = await import('../src/config/env.js');
const { createKasbonTransaction, submitKasbonInvoice, confirmKasbonPaid, assertRealCustomer } =
  await import('../src/modules/sales-pos/application/transactions.js');
const { searchCustomers } =
  await import('../src/modules/customer-membership/application/customers.js');
const { listKasbonInvoices } =
  await import('../src/modules/customer-membership/application/piutang.js');

const PRICE_LIST = { price_list_rate: 5000 };

function mockCreateTransactionDependencies(): void {
  erpNextClientMock.get.mockImplementation((doctype: string, name: string) => {
    if (doctype === 'Customer') {
      return Promise.resolve({ name, customer_tier: 'Retail' });
    }
    return Promise.resolve({});
  });
  erpNextClientMock.list.mockImplementation((doctype: string) => {
    if (doctype === 'Item Price') return Promise.resolve([PRICE_LIST]);
    return Promise.resolve([]);
  });
  erpNextClientMock.create.mockImplementation(
    (_doctype: string, payload: Record<string, unknown>) =>
      Promise.resolve({
        name: 'ACC-SINV-KASBON',
        status: 'Draft',
        customer: payload.customer,
        grand_total: 0,
        paid_amount: 0,
        outstanding_amount: 0,
        items: payload.items,
      }),
  );
  erpNextClientMock.update.mockImplementation(
    (_doctype: string, name: string, payload: Record<string, unknown>) =>
      Promise.resolve({
        name,
        status: payload.docstatus === 1 ? 'Overdue' : 'Draft',
        customer: 'CUST-001',
        grand_total: 5000,
        paid_amount: 0,
        outstanding_amount: 5000,
        due_date: payload.due_date,
      }),
  );
}

describe('assertRealCustomer', () => {
  it('rejects an empty customer id', () => {
    expect(() => assertRealCustomer('')).toThrow();
    expect(() => assertRealCustomer('   ')).toThrow();
  });

  it('rejects Walk-in Customer — Kasbon is meaningless without a real credit relationship', () => {
    expect(() => assertRealCustomer('Walk-in Customer')).toThrow();
  });

  it('accepts a real customer id', () => {
    expect(() => assertRealCustomer('CUST-001')).not.toThrow();
  });
});

describe('createKasbonTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects Walk-in Customer before ever writing a draft invoice', async () => {
    await expect(
      createKasbonTransaction('Walk-in Customer', [{ itemCode: 'ITEM-A', qty: 1 }]),
    ).rejects.toThrow();
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('creates a draft then submits it with a due date computed from the customer’s payment_term_days', async () => {
    mockCreateTransactionDependencies();
    erpNextClientMock.get.mockImplementation((doctype: string, name: string) => {
      if (doctype === 'Customer') {
        return Promise.resolve({ name, customer_tier: 'Retail', payment_term_days: 14 });
      }
      return Promise.resolve({});
    });

    await createKasbonTransaction('CUST-001', [{ itemCode: 'ITEM-A', qty: 1 }]);

    const updateCall = erpNextClientMock.update.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    expect(updateCall?.[2]).toMatchObject({ docstatus: 1 });
    const dueDate = new Date(updateCall?.[2].due_date as string);
    const expected = new Date();
    expected.setDate(expected.getDate() + 14);
    expect(dueDate.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });

  it('defaults to a 30-day term when payment_term_days is 0/unset, rather than "due today"', async () => {
    mockCreateTransactionDependencies();
    // mockCreateTransactionDependencies already returns no payment_term_days (undefined).

    await createKasbonTransaction('CUST-001', [{ itemCode: 'ITEM-A', qty: 1 }]);

    const updateCall = erpNextClientMock.update.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    const dueDate = new Date(updateCall?.[2].due_date as string);
    const expected = new Date();
    expected.setDate(expected.getDate() + 30);
    expect(dueDate.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });

  it('never sends a payment on creation — the invoice is submitted Unpaid', async () => {
    mockCreateTransactionDependencies();

    await createKasbonTransaction('CUST-001', [{ itemCode: 'ITEM-A', qty: 1 }]);

    const createCall = erpNextClientMock.create.mock.calls.find(
      (call) => call[0] === 'Sales Invoice',
    );
    expect(createCall?.[1]).not.toHaveProperty('payments');
  });
});

describe('submitKasbonInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits an already-created draft by name, without creating a new invoice', async () => {
    erpNextClientMock.get.mockResolvedValue({ payment_term_days: 0 });
    erpNextClientMock.update.mockResolvedValue({
      name: 'ACC-SINV-EXISTING',
      status: 'Overdue',
      customer: 'CUST-001',
      grand_total: 5000,
      paid_amount: 0,
      outstanding_amount: 5000,
    });

    await submitKasbonInvoice('ACC-SINV-EXISTING', 'CUST-001');

    expect(erpNextClientMock.create).not.toHaveBeenCalled();
    expect(erpNextClientMock.update).toHaveBeenCalledWith(
      'Sales Invoice',
      'ACC-SINV-EXISTING',
      expect.objectContaining({ docstatus: 1 }),
    );
  });

  it('flips is_pos back to 0 — real bug found live: ERPNext refuses to submit an is_pos=1 invoice with zero payments, and Kasbon submits with none by design', async () => {
    erpNextClientMock.get.mockResolvedValue({ payment_term_days: 0 });
    erpNextClientMock.update.mockResolvedValue({
      name: 'ACC-SINV-EXISTING',
      status: 'Overdue',
      customer: 'CUST-001',
      grand_total: 5000,
      paid_amount: 0,
      outstanding_amount: 5000,
    });

    await submitKasbonInvoice('ACC-SINV-EXISTING', 'CUST-001');

    expect(erpNextClientMock.update).toHaveBeenCalledWith(
      'Sales Invoice',
      'ACC-SINV-EXISTING',
      expect.objectContaining({ is_pos: 0 }),
    );
  });
});

describe('confirmKasbonPaid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses to pay an invoice that is already fully paid, without creating a Payment Entry', async () => {
    erpNextClientMock.get.mockResolvedValue({
      name: 'ACC-SINV-PAID',
      customer: 'CUST-001',
      outstanding_amount: 0,
    });

    await expect(confirmKasbonPaid('ACC-SINV-PAID')).rejects.toThrow();
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('creates a Payment Entry against the Customer’s receivable account, then submits it — real ERPNext confirmed live that Sales Invoice.payments is not allow_on_submit, so this is the only way to settle an already-submitted invoice', async () => {
    erpNextClientMock.get.mockImplementation((doctype: string, name: string) => {
      if (doctype === 'Sales Invoice') {
        return Promise.resolve({
          name,
          customer: 'CUST-001',
          outstanding_amount: 5000,
          grand_total: 5000,
          paid_amount: 0,
          status: 'Overdue',
        });
      }
      if (doctype === 'Company') {
        return Promise.resolve({ default_receivable_account: 'Debtors - TH' });
      }
      if (doctype === 'Mode of Payment') {
        return Promise.resolve({
          name: 'Cash',
          accounts: [{ company: env.ERPNEXT_DEFAULT_COMPANY, default_account: 'Cash - TH' }],
        });
      }
      return Promise.resolve({});
    });
    erpNextClientMock.create.mockResolvedValue({ name: 'PE-0001' });

    await confirmKasbonPaid('ACC-SINV-KASBON');

    const createCall = erpNextClientMock.create.mock.calls.find(
      (call) => call[0] === 'Payment Entry',
    );
    expect(createCall?.[1]).toMatchObject({
      payment_type: 'Receive',
      party_type: 'Customer',
      party: 'CUST-001',
      paid_from: 'Debtors - TH',
      paid_to: 'Cash - TH',
      paid_amount: 5000,
      received_amount: 5000,
      references: [
        {
          reference_doctype: 'Sales Invoice',
          reference_name: 'ACC-SINV-KASBON',
          allocated_amount: 5000,
        },
      ],
    });
    // Same create-draft-then-submit pattern as every other write in this
    // module — Frappe's insert() never honours docstatus at create time.
    expect(erpNextClientMock.update).toHaveBeenCalledWith('Payment Entry', 'PE-0001', {
      docstatus: 1,
    });
  });
});

describe('searchCustomers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns nothing for a blank query without ever calling ERPNext', async () => {
    const results = await searchCustomers('   ');
    expect(results).toEqual([]);
    expect(erpNextClientMock.list).not.toHaveBeenCalled();
  });

  it('excludes Walk-in Customer from the search filters — it can never be a valid Kasbon result', async () => {
    erpNextClientMock.list.mockResolvedValue([
      {
        name: 'CUST-001',
        customer_name: 'Budi Santoso',
        customer_tier: 'Retail',
        mobile_no: '0812',
      },
    ]);

    const results = await searchCustomers('Budi');

    expect(erpNextClientMock.list).toHaveBeenCalledWith(
      'Customer',
      expect.objectContaining({ filters: [['name', '!=', 'Walk-in Customer']] }),
    );
    expect(results).toEqual([
      { id: 'CUST-001', name: 'Budi Santoso', mobileNo: '0812', tier: 'Retail' },
    ]);
  });
});

describe('listKasbonInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('flags a past-due invoice as overdue and a future-due one as not', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    erpNextClientMock.list.mockResolvedValue([
      {
        name: 'ACC-SINV-OVERDUE',
        customer: 'CUST-001',
        customer_name: 'Budi Santoso',
        posting_date: '2026-07-01',
        due_date: yesterday.toISOString().slice(0, 10),
        grand_total: 20000,
        outstanding_amount: 20000,
      },
      {
        name: 'ACC-SINV-CURRENT',
        customer: 'CUST-002',
        customer_name: 'Siti Aminah',
        posting_date: '2026-08-01',
        due_date: nextWeek.toISOString().slice(0, 10),
        grand_total: 10000,
        outstanding_amount: 10000,
      },
    ]);

    const invoices = await listKasbonInvoices();

    expect(invoices[0]).toMatchObject({ invoice: 'ACC-SINV-OVERDUE', overdue: true });
    expect(invoices[1]).toMatchObject({ invoice: 'ACC-SINV-CURRENT', overdue: false });
  });
});
