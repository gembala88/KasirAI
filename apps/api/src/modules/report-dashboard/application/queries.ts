/**
 * Report/Dashboard module — real ERPNext analytics queries (spec §1.3
 * FR-6, FR-8, §6). Every number here comes from a live ERPNext query,
 * never a cache or an estimate — matches the "never fabricate" principle
 * applied everywhere else in this system (§8.1), just for the owner
 * instead of the customer.
 */
import { listLowStock, listNearExpiry } from '../../inventory/interfaces/index.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import type {
  CustomerActivity,
  DashboardSummary,
  ItemPerformance,
  RevenueProfitSummary,
  SalesReport,
  SupplierPerformance,
} from '../domain/index.js';

const LOW_STOCK_THRESHOLD = 10;
const NEAR_EXPIRY_DAYS = 30;
const RANKING_WINDOW_DAYS = 30;
const TOP_N = 5;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number): string {
  return toDateOnly(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000));
}

interface SalesInvoiceItemDoc {
  item_code: string;
  item_name: string;
  qty: number;
  amount: number;
}

interface SalesInvoiceFullDoc {
  name: string;
  posting_date: string;
  customer: string;
  customer_name?: string;
  grand_total: number;
  items: SalesInvoiceItemDoc[];
}

interface StockLedgerEntryDoc {
  voucher_no: string;
  stock_value_difference: number;
}

/**
 * Real COGS per invoice, for real profit — found live that Sales
 * Invoice Item's `gross_profit`/`valuation_rate` fields are *not*
 * reliably populated on a plain document fetch (only ever seen these
 * live-populated on a Sales *Order* item, which shows a current-moment
 * projection, not the actual posted cost). `Stock Ledger Entry` is the
 * authoritative source: each stock-reducing entry from a sale carries a
 * real, confirmed `stock_value_difference` (negative — outgoing stock),
 * whose magnitude is that line's actual cost of goods sold.
 */
async function fetchCogsByInvoice(invoiceNames: string[]): Promise<Map<string, number>> {
  const cogsByInvoice = new Map<string, number>();
  if (invoiceNames.length === 0) {
    return cogsByInvoice;
  }
  const entries = await erpNextClient.list<StockLedgerEntryDoc>('Stock Ledger Entry', {
    filters: [
      ['voucher_type', '=', 'Sales Invoice'],
      ['voucher_no', 'in', invoiceNames],
    ],
    fields: ['voucher_no', 'stock_value_difference'],
    limit_page_length: '0',
  });
  for (const entry of entries) {
    const current = cogsByInvoice.get(entry.voucher_no) ?? 0;
    cogsByInvoice.set(entry.voucher_no, current - entry.stock_value_difference);
  }
  return cogsByInvoice;
}

interface InvoicesWithCogs {
  invoices: SalesInvoiceFullDoc[];
  cogsByInvoice: Map<string, number>;
}

/**
 * Frappe's list endpoint can't aggregate or return child-table rows, so
 * getting real revenue/item/customer breakdowns means fetching each
 * matching invoice's full document (items included) individually. Fine
 * at this store's real transaction volume; would need a proper report
 * query (or a materialized view) at much higher volume.
 */
async function fetchSubmittedInvoicesInRange(
  fromDate: string,
  toDate: string,
): Promise<InvoicesWithCogs> {
  const names = await erpNextClient.list<{ name: string }>('Sales Invoice', {
    filters: [
      ['docstatus', '=', 1],
      ['posting_date', '>=', fromDate],
      ['posting_date', '<=', toDate],
    ],
    fields: ['name'],
    limit_page_length: '0',
  });
  const invoices = await Promise.all(
    names.map((n) => erpNextClient.get<SalesInvoiceFullDoc>('Sales Invoice', n.name)),
  );
  const cogsByInvoice = await fetchCogsByInvoice(invoices.map((inv) => inv.name));
  return { invoices, cogsByInvoice };
}

function summarizeRevenueProfit({
  invoices,
  cogsByInvoice,
}: InvoicesWithCogs): RevenueProfitSummary {
  const revenue = invoices.reduce((sum, inv) => sum + inv.grand_total, 0);
  const cogs = invoices.reduce((sum, inv) => sum + (cogsByInvoice.get(inv.name) ?? 0), 0);
  return { revenue, profit: revenue - cogs, invoiceCount: invoices.length };
}

function rankItemPerformance(invoices: SalesInvoiceFullDoc[]): {
  bestSellers: ItemPerformance[];
  worstSellers: ItemPerformance[];
} {
  const byItem = new Map<string, ItemPerformance>();
  for (const invoice of invoices) {
    for (const line of invoice.items) {
      const current = byItem.get(line.item_code) ?? {
        itemCode: line.item_code,
        itemName: line.item_name,
        qtySold: 0,
        revenue: 0,
      };
      current.qtySold += line.qty;
      current.revenue += line.amount;
      byItem.set(line.item_code, current);
    }
  }
  const ranked = [...byItem.values()].sort((a, b) => b.revenue - a.revenue);
  return {
    bestSellers: ranked.slice(0, TOP_N),
    worstSellers: ranked.slice(-TOP_N).reverse(),
  };
}

function rankMostActiveCustomer(invoices: SalesInvoiceFullDoc[]): CustomerActivity | null {
  const byCustomer = new Map<string, CustomerActivity>();
  for (const invoice of invoices) {
    const current = byCustomer.get(invoice.customer) ?? {
      customer: invoice.customer,
      customerName: invoice.customer_name ?? invoice.customer,
      invoiceCount: 0,
      totalSpent: 0,
    };
    current.invoiceCount += 1;
    current.totalSpent += invoice.grand_total;
    byCustomer.set(invoice.customer, current);
  }
  let best: CustomerActivity | null = null;
  for (const activity of byCustomer.values()) {
    if (!best || activity.invoiceCount > best.invoiceCount) {
      best = activity;
    }
  }
  return best;
}

interface PurchaseInvoiceDoc {
  supplier: string;
  supplier_name?: string;
  grand_total: number;
}

async function getBestSupplier(days: number): Promise<SupplierPerformance | null> {
  const invoices = await erpNextClient.list<PurchaseInvoiceDoc>('Purchase Invoice', {
    filters: [
      ['docstatus', '=', 1],
      ['posting_date', '>=', daysAgo(days)],
      ['posting_date', '<=', toDateOnly(new Date())],
    ],
    fields: ['supplier', 'supplier_name', 'grand_total'],
    limit_page_length: '0',
  });

  const bySupplier = new Map<string, SupplierPerformance>();
  for (const invoice of invoices) {
    const current = bySupplier.get(invoice.supplier) ?? {
      supplier: invoice.supplier,
      supplierName: invoice.supplier_name ?? invoice.supplier,
      totalPurchased: 0,
    };
    current.totalPurchased += invoice.grand_total;
    bySupplier.set(invoice.supplier, current);
  }

  let best: SupplierPerformance | null = null;
  for (const performance of bySupplier.values()) {
    if (!best || performance.totalPurchased > best.totalPurchased) {
      best = performance;
    }
  }
  return best;
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const today = toDateOnly(new Date());
  const windowStart = daysAgo(RANKING_WINDOW_DAYS);

  const [todaysInvoices, windowInvoices, nearOutOfStock, expiringItems, bestSupplier] =
    await Promise.all([
      fetchSubmittedInvoicesInRange(today, today),
      fetchSubmittedInvoicesInRange(windowStart, today),
      listLowStock(LOW_STOCK_THRESHOLD),
      listNearExpiry(NEAR_EXPIRY_DAYS),
      getBestSupplier(RANKING_WINDOW_DAYS),
    ]);

  const { bestSellers, worstSellers } = rankItemPerformance(windowInvoices.invoices);

  return {
    today: summarizeRevenueProfit(todaysInvoices),
    rankingWindowDays: RANKING_WINDOW_DAYS,
    bestSellers,
    worstSellers,
    bestSupplier,
    mostActiveCustomer: rankMostActiveCustomer(windowInvoices.invoices),
    nearOutOfStock,
    expiringItems,
  };
}

export async function getSalesReport(from: string, to: string): Promise<SalesReport> {
  const { invoices, cogsByInvoice } = await fetchSubmittedInvoicesInRange(from, to);
  const rows = invoices
    .map((invoice) => ({
      invoice: invoice.name,
      postingDate: invoice.posting_date,
      customer: invoice.customer_name ?? invoice.customer,
      grandTotal: invoice.grand_total,
      profit: invoice.grand_total - (cogsByInvoice.get(invoice.name) ?? 0),
    }))
    .sort((a, b) => a.postingDate.localeCompare(b.postingDate));

  return {
    from,
    to,
    rows,
    totalRevenue: rows.reduce((sum, row) => sum + row.grandTotal, 0),
    totalProfit: rows.reduce((sum, row) => sum + row.profit, 0),
  };
}
