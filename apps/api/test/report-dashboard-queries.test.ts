import { describe, expect, it, vi } from 'vitest';

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

const listLowStockMock = vi.fn();
const listNearExpiryMock = vi.fn();
vi.mock('../src/modules/inventory/interfaces/index.js', () => ({
  listLowStock: listLowStockMock,
  listNearExpiry: listNearExpiryMock,
}));

const { getDashboardSummary, getSalesReport } =
  await import('../src/modules/report-dashboard/application/queries.js');

const TODAY = new Date().toISOString().slice(0, 10);
const TEN_DAYS_AGO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const INVOICES: Record<string, unknown> = {
  'INV-TODAY': {
    name: 'INV-TODAY',
    posting_date: TODAY,
    customer: 'CUST-A',
    customer_name: 'Toko A',
    grand_total: 20000,
    items: [{ item_code: 'ITEM-X', item_name: 'Barang X', qty: 2, amount: 20000 }],
  },
  'INV-OLD-A': {
    name: 'INV-OLD-A',
    posting_date: TEN_DAYS_AGO,
    customer: 'CUST-A',
    customer_name: 'Toko A',
    grand_total: 5000,
    items: [{ item_code: 'ITEM-Y', item_name: 'Barang Y', qty: 1, amount: 5000 }],
  },
  'INV-OLD-B': {
    name: 'INV-OLD-B',
    posting_date: TEN_DAYS_AGO,
    customer: 'CUST-B',
    customer_name: 'Toko B',
    grand_total: 10000,
    items: [{ item_code: 'ITEM-X', item_name: 'Barang X', qty: 1, amount: 10000 }],
  },
};

// Real COGS source (Stock Ledger Entry, since Sales Invoice Item's
// gross_profit field isn't reliably populated — see queries.ts).
// Revenue 20000/5000/10000 with cost 16000/4000/8000 → profit 4000/1000/2000.
const STOCK_VALUE_DIFFERENCE_BY_INVOICE: Record<string, number> = {
  'INV-TODAY': -16000,
  'INV-OLD-A': -4000,
  'INV-OLD-B': -8000,
};

function mockSalesInvoiceQueries(): void {
  erpNextClientMock.list.mockImplementation((doctype: string, params: { filters: unknown[][] }) => {
    if (doctype === 'Sales Invoice') {
      const fromDate = params.filters.find(
        (f) => f[0] === 'posting_date' && f[1] === '>=',
      )?.[2] as string;
      const toDate = params.filters.find(
        (f) => f[0] === 'posting_date' && f[1] === '<=',
      )?.[2] as string;
      // "today" call: from === to === today. "window" call: from is well before today.
      const names = fromDate === toDate ? ['INV-TODAY'] : ['INV-TODAY', 'INV-OLD-A', 'INV-OLD-B'];
      return Promise.resolve(names.map((name) => ({ name })));
    }
    if (doctype === 'Stock Ledger Entry') {
      const voucherNos = params.filters.find((f) => f[0] === 'voucher_no')?.[2] as string[];
      return Promise.resolve(
        voucherNos.map((voucher_no) => ({
          voucher_no,
          stock_value_difference: STOCK_VALUE_DIFFERENCE_BY_INVOICE[voucher_no] ?? 0,
        })),
      );
    }
    if (doctype === 'Purchase Invoice') {
      return Promise.resolve([
        { supplier: 'SUP-A', supplier_name: 'Pemasok A', grand_total: 50000 },
        { supplier: 'SUP-B', supplier_name: 'Pemasok B', grand_total: 30000 },
        { supplier: 'SUP-A', supplier_name: 'Pemasok A', grand_total: 10000 },
      ]);
    }
    return Promise.resolve([]);
  });
  erpNextClientMock.get.mockImplementation((doctype: string, name: string) => {
    if (doctype === 'Sales Invoice' && INVOICES[name]) {
      return Promise.resolve(INVOICES[name]);
    }
    return Promise.reject(new Error(`unexpected get ${doctype}/${name}`));
  });
}

describe('getDashboardSummary', () => {
  it('computes today vs 30-day-window figures separately from real invoice data, never fabricated', async () => {
    mockSalesInvoiceQueries();
    listLowStockMock.mockResolvedValue([
      { itemCode: 'ITEM-Z', itemName: 'Barang Z', warehouse: 'WH', actualQty: 2, threshold: 5 },
    ]);
    listNearExpiryMock.mockResolvedValue([
      {
        batchId: 'B1',
        itemCode: 'ITEM-Z',
        expiryDate: '2026-09-01',
        daysUntilExpiry: 10,
        batchQty: 3,
      },
    ]);

    const summary = await getDashboardSummary();

    // Today: only INV-TODAY (revenue 20000, profit 4000).
    expect(summary.today).toEqual({ revenue: 20000, profit: 4000, invoiceCount: 1 });

    // Window (30d): all 3 invoices. Best seller by revenue: ITEM-X (10000+20000=30000) over ITEM-Y (5000).
    expect(summary.bestSellers[0]).toMatchObject({
      itemCode: 'ITEM-X',
      qtySold: 3,
      revenue: 30000,
    });
    expect(summary.worstSellers[0]).toMatchObject({ itemCode: 'ITEM-Y', revenue: 5000 });

    // Most active customer: CUST-A has 2 invoices (today + old-a) vs CUST-B's 1.
    expect(summary.mostActiveCustomer).toMatchObject({
      customer: 'CUST-A',
      invoiceCount: 2,
      totalSpent: 25000,
    });

    // Best supplier: SUP-A total 60000 (50000+10000) beats SUP-B's 30000.
    expect(summary.bestSupplier).toEqual({
      supplier: 'SUP-A',
      supplierName: 'Pemasok A',
      totalPurchased: 60000,
    });

    // Real inventory-module data, passed through untouched.
    expect(summary.nearOutOfStock).toEqual([
      { itemCode: 'ITEM-Z', itemName: 'Barang Z', warehouse: 'WH', actualQty: 2, threshold: 5 },
    ]);
    expect(summary.expiringItems).toEqual([
      {
        batchId: 'B1',
        itemCode: 'ITEM-Z',
        expiryDate: '2026-09-01',
        daysUntilExpiry: 10,
        batchQty: 3,
      },
    ]);
  });

  it('reports best supplier as null rather than fabricating one when no purchase data exists', async () => {
    erpNextClientMock.list.mockImplementation((doctype: string) => {
      if (doctype === 'Sales Invoice') return Promise.resolve([]);
      if (doctype === 'Purchase Invoice') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    listLowStockMock.mockResolvedValue([]);
    listNearExpiryMock.mockResolvedValue([]);

    const summary = await getDashboardSummary();

    expect(summary.bestSupplier).toBeNull();
    expect(summary.mostActiveCustomer).toBeNull();
    expect(summary.today).toEqual({ revenue: 0, profit: 0, invoiceCount: 0 });
  });
});

describe('getSalesReport', () => {
  it('returns per-invoice rows sorted by date with real revenue/profit totals', async () => {
    mockSalesInvoiceQueries();
    listLowStockMock.mockResolvedValue([]);
    listNearExpiryMock.mockResolvedValue([]);

    const report = await getSalesReport(TEN_DAYS_AGO, TODAY);

    expect(report.rows.map((r) => r.invoice)).toEqual(['INV-OLD-A', 'INV-OLD-B', 'INV-TODAY']);
    expect(report.totalRevenue).toBe(35000);
    expect(report.totalProfit).toBe(7000);
  });
});
