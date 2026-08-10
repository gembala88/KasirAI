/**
 * Sales/POS module — POS transaction lifecycle (spec §1.3 FR-1, §6).
 *
 * Backed by ERPNext's Sales Invoice doctype with `is_pos=1` rather than
 * the dedicated "POS Invoice" doctype — POS Invoice mandates a POS
 * Profile (payment-method-to-account wiring, default warehouse, etc.)
 * that adds real setup cost for no MVP benefit; Sales Invoice supports
 * the same split-payment (`payments` child table) and draft/submit
 * (park/complete) lifecycle we need with just a Company + Warehouse +
 * Mode of Payment already in place (§5: use what ERPNext already has).
 *
 * "Park" is not a distinct status: an un-submitted Sales Invoice
 * (docstatus=0) already *is* parked — creating a transaction leaves it
 * there until payment completes it. `parkTransaction` mainly exists so
 * the POS/PWA UI has an explicit action and confirmation to call.
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { ValidationError } from '../../../shared/errors/index.js';
import type {
  CartLineInput,
  PaymentInput,
  PosTransaction,
  TransactionDetail,
  TransactionListPage,
  TransactionPayment,
  TransactionSummary,
} from '../domain/index.js';
import { getProductPrice, resolvePriceList } from './pricing.js';

interface SalesInvoiceDoc {
  name: string;
  status: string;
  customer: string;
  grand_total: number;
  paid_amount: number;
  outstanding_amount: number;
  po_no?: string;
  contact_mobile?: string;
}

function toPosTransaction(doc: SalesInvoiceDoc): PosTransaction {
  return {
    name: doc.name,
    status: doc.status,
    customer: doc.customer,
    grandTotal: doc.grand_total,
    paidAmount: doc.paid_amount,
    outstandingAmount: doc.outstanding_amount,
    ...(doc.po_no ? { poNo: doc.po_no } : {}),
    ...(doc.contact_mobile ? { contactMobile: doc.contact_mobile } : {}),
  };
}

async function resolveCustomerTier(customerId: string | undefined): Promise<{
  customer: string;
  tier: string | undefined;
}> {
  if (!customerId) {
    return { customer: 'Walk-in Customer', tier: 'Retail' };
  }
  const customer = await erpNextClient.get<{ name: string; customer_tier?: string }>(
    'Customer',
    customerId,
  );
  return { customer: customer.name, tier: customer.customer_tier };
}

/**
 * Scanning the same item's barcode twice in one checkout (spec §1.3's
 * "barcode scan auto-adds to cart") must increment that line's qty, not
 * create a second invoice line for the same item — merged here rather
 * than relying on the cashier UI to dedupe client-side, so the guarantee
 * holds for any caller of this endpoint, not just the one built-in POS
 * screen. Grouped by item + resolved warehouse (a genuinely different
 * warehouse is a different stock movement, not a duplicate scan); an
 * explicit `rate` override from any line in the group wins over the
 * price-list lookup the rest of the merged line would otherwise get.
 */
function mergeDuplicateLines(lines: CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, CartLineInput>();
  for (const line of lines) {
    const warehouse = line.warehouse ?? env.ERPNEXT_DEFAULT_WAREHOUSE;
    const key = `${line.itemCode}::${warehouse}`;
    const existing = merged.get(key);
    if (existing) {
      existing.qty += line.qty;
      existing.rate ??= line.rate;
    } else {
      merged.set(key, { ...line, warehouse });
    }
  }
  return [...merged.values()];
}

export async function createTransaction(
  customerId: string | undefined,
  rawLines: CartLineInput[],
): Promise<PosTransaction> {
  if (rawLines.length === 0) {
    throw new ValidationError('A POS transaction needs at least one line');
  }
  const lines = mergeDuplicateLines(rawLines);

  const { customer, tier } = await resolveCustomerTier(customerId);
  const priceList = resolvePriceList(tier);

  const items = await Promise.all(
    lines.map(async (line) => {
      const rate = line.rate ?? (await getProductPrice(line.itemCode, tier)).price;
      if (rate === null) {
        throw new ValidationError(`No price found for ${line.itemCode} in ${priceList}`);
      }
      return {
        item_code: line.itemCode,
        qty: line.qty,
        rate,
        warehouse: line.warehouse ?? env.ERPNEXT_DEFAULT_WAREHOUSE,
      };
    }),
  );

  const doc = await erpNextClient.create<SalesInvoiceDoc>('Sales Invoice', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    customer,
    currency: 'IDR',
    conversion_rate: 1,
    is_pos: 1,
    update_stock: 1,
    selling_price_list: priceList,
    price_list_currency: 'IDR',
    plc_conversion_rate: 1,
    items,
  });

  return toPosTransaction(doc);
}

export async function getTransaction(name: string): Promise<PosTransaction> {
  const doc = await erpNextClient.get<SalesInvoiceDoc>('Sales Invoice', name);
  return toPosTransaction(doc);
}

interface SalesOrderDoc {
  name: string;
  customer: string;
  selling_price_list: string;
  items: Array<{ item_code: string; qty: number; rate: number; warehouse: string }>;
}

/**
 * QRIS payment flow (§7): converts an already-confirmed Sales Order into
 * a *draft* Sales Invoice (docstatus=0 — stock is not reduced by a draft)
 * so the customer can be sent the static QRIS image to pay against.
 * Reuses `po_no` (Frappe's standard "Customer's PO No." field) to trace
 * the invoice back to its source order rather than adding a custom field.
 *
 * `is_pos: 1` even though this is a WhatsApp-channel sale, not a till
 * sale — found live (Phase 5 verification) that Frappe's `payments`
 * child table on Sales Invoice, which `addPayment` below writes to and
 * relies on to actually register `paid_amount`, is only honoured when
 * `is_pos = 1`; a plain (non-POS) Sales Invoice submits fine with
 * `payments` set but silently ignores it, leaving the invoice "Unpaid".
 * `is_pos` here means "paid via the payments child table on submit", not
 * "sold at a physical till".
 */
export async function createInvoiceFromSalesOrder(orderName: string): Promise<PosTransaction> {
  const order = await erpNextClient.get<SalesOrderDoc>('Sales Order', orderName);

  const doc = await erpNextClient.create<SalesInvoiceDoc>('Sales Invoice', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    customer: order.customer,
    currency: 'IDR',
    conversion_rate: 1,
    is_pos: 1,
    update_stock: 1,
    selling_price_list: order.selling_price_list,
    price_list_currency: 'IDR',
    plc_conversion_rate: 1,
    po_no: order.name,
    items: order.items.map((item) => ({
      item_code: item.item_code,
      qty: item.qty,
      rate: item.rate,
      warehouse: item.warehouse,
    })),
  });

  return toPosTransaction(doc);
}

export async function listParkedTransactions(): Promise<PosTransaction[]> {
  const docs = await erpNextClient.list<SalesInvoiceDoc>('Sales Invoice', {
    filters: [
      ['is_pos', '=', 1],
      ['docstatus', '=', 0],
    ],
    fields: ['name', 'status', 'customer', 'grand_total', 'paid_amount', 'outstanding_amount'],
  });
  return docs.map(toPosTransaction);
}

/**
 * WhatsApp orders awaiting the owner/cashier's manual payment
 * confirmation (§7, §10 Phase 6/7) — same underlying shape as a
 * cashier-parked POS sale (`is_pos=1`, `docstatus=0`), distinguished by
 * `po_no` being set (only `createInvoiceFromSalesOrder` sets it).
 */
export async function listPendingPaymentConfirmations(): Promise<PosTransaction[]> {
  const docs = await erpNextClient.list<SalesInvoiceDoc>('Sales Invoice', {
    filters: [
      ['is_pos', '=', 1],
      ['docstatus', '=', 0],
      ['po_no', '!=', ''],
    ],
    fields: [
      'name',
      'status',
      'customer',
      'grand_total',
      'paid_amount',
      'outstanding_amount',
      'po_no',
      'contact_mobile',
    ],
  });
  return docs.map(toPosTransaction);
}

export async function parkTransaction(name: string): Promise<PosTransaction> {
  const doc = await erpNextClient.get<SalesInvoiceDoc>('Sales Invoice', name);
  if (doc.status !== 'Draft') {
    throw new ValidationError(`Transaction ${name} is not a draft (status: ${doc.status})`);
  }
  return toPosTransaction(doc);
}

interface ModeOfPaymentDoc {
  name: string;
  accounts: Array<{ company: string; default_account: string }>;
}

/**
 * Each Mode of Payment posts to its own account (Cash / QRIS clearing /
 * Bank Transfer) — required for real reconciliation: knowing what's
 * physically in the till versus what's actually settled to the bank.
 * Configured per-company on the Mode of Payment doctype (see
 * apps/api/scripts/seed-erpnext.ts); resolved here rather than cached,
 * since this only runs once per payment submission.
 */
async function getAccountForModeOfPayment(modeOfPayment: string): Promise<string> {
  const mode = await erpNextClient.get<ModeOfPaymentDoc>('Mode of Payment', modeOfPayment);
  const match = mode.accounts.find((a) => a.company === env.ERPNEXT_DEFAULT_COMPANY);
  if (!match) {
    throw new ValidationError(
      `Mode of Payment "${modeOfPayment}" has no account configured for ${env.ERPNEXT_DEFAULT_COMPANY}`,
    );
  }
  return match.default_account;
}

/**
 * Applies the full set of payments for a transaction in one call (not an
 * incremental append — the POS UI collects every payment method the
 * cashier is using, then submits them together). Auto-submits (completing
 * the sale and reducing stock) once the total covers the grand total.
 */
export async function addPayment(name: string, payments: PaymentInput[]): Promise<PosTransaction> {
  if (payments.length === 0) {
    throw new ValidationError('At least one payment is required');
  }

  const current = await erpNextClient.get<SalesInvoiceDoc>('Sales Invoice', name);
  const totalPaid = payments.reduce((sum, payment) => sum + payment.amount, 0);

  const paymentRows = await Promise.all(
    payments.map(async (payment) => ({
      mode_of_payment: payment.modeOfPayment,
      amount: payment.amount,
      account: await getAccountForModeOfPayment(payment.modeOfPayment),
    })),
  );

  const updated = await erpNextClient.update<SalesInvoiceDoc>('Sales Invoice', name, {
    payments: paymentRows,
    ...(totalPaid >= current.grand_total ? { docstatus: 1 } : {}),
  });

  return toPosTransaction(updated);
}

// --- Kasbon / credit sale (spec Group 3) ---

/** Used whenever a customer's own `payment_term_days` is 0/unset — keeps Kasbon usable for a newly-picked credit customer immediately, rather than blocking the sale until the owner configures a real term in ERPNext. The owner's own term always wins once set. */
const DEFAULT_KASBON_TERM_DAYS = 30;

interface CustomerTermDoc {
  payment_term_days?: number;
}

async function computeKasbonDueDate(customerId: string): Promise<string> {
  const customer = await erpNextClient.get<CustomerTermDoc>('Customer', customerId);
  const days =
    customer.payment_term_days && customer.payment_term_days > 0
      ? customer.payment_term_days
      : DEFAULT_KASBON_TERM_DAYS;
  const due = new Date();
  due.setDate(due.getDate() + days);
  return due.toISOString().slice(0, 10);
}

/** Exported so the offline-sync path (processKasbonSale) can enforce this before ever writing a draft invoice, not just createKasbonTransaction's own single-call convenience path. */
export function assertRealCustomer(customerId: string): void {
  if (!customerId.trim() || customerId === 'Walk-in Customer') {
    throw new ValidationError('Kasbon memerlukan pelanggan terdaftar, tidak bisa Walk-in Customer');
  }
}

/**
 * Second half of a Kasbon sale: submits an already-created draft invoice
 * (from createTransaction) with no payment at all — the invoice stays
 * Unpaid (outstanding_amount = grand_total) until confirmKasbonPaid
 * settles it later. Split out from createKasbonTransaction below as its
 * own exported step so the offline-sync path (processKasbonSale) can
 * checkpoint between "draft created" and "submitted", the same two-step
 * pattern processPosSale already uses for createTransaction+addPayment —
 * without it, retrying a sync that succeeded at step 1 but failed at
 * step 2 would create a second, duplicate invoice.
 */
export async function submitKasbonInvoice(
  invoiceName: string,
  customerId: string,
): Promise<PosTransaction> {
  const dueDate = await computeKasbonDueDate(customerId);
  const updated = await erpNextClient.update<SalesInvoiceDoc>('Sales Invoice', invoiceName, {
    due_date: dueDate,
    docstatus: 1,
  });
  return toPosTransaction(updated);
}

/**
 * Kasbon / credit sale, single-call convenience for direct (non-offline-
 * queue) callers: same item/price resolution as a normal checkout
 * (createTransaction reused as-is, including its real per-customer tier
 * pricing) followed immediately by submitKasbonInvoice above. Stock still
 * reduces immediately (update_stock=1, same as every other Kasir sale)
 * since the goods physically leave the store at sale time even though
 * payment is deferred.
 *
 * Requires a real registered Customer — never Walk-in Customer, which
 * has no meaningful payment_term_days/credit relationship. Enforced
 * here, not just in the Kasir UI, since this is the actual write
 * boundary.
 */
export async function createKasbonTransaction(
  customerId: string,
  rawLines: CartLineInput[],
): Promise<PosTransaction> {
  assertRealCustomer(customerId);
  const draft = await createTransaction(customerId, rawLines);
  return submitKasbonInvoice(draft.name, customerId);
}

interface CompanyReceivableDoc {
  default_receivable_account?: string;
}

async function getReceivableAccount(): Promise<string> {
  const company = await erpNextClient.get<CompanyReceivableDoc>(
    'Company',
    env.ERPNEXT_DEFAULT_COMPANY,
  );
  if (!company.default_receivable_account) {
    throw new ValidationError(
      `Company ${env.ERPNEXT_DEFAULT_COMPANY} has no default receivable account configured`,
    );
  }
  return company.default_receivable_account;
}

/**
 * "Konfirmasi Lunas" — settles an existing Kasbon debt. Confirmed live
 * against this project's own ERPNext that Sales Invoice's `payments`
 * child table has `allow_on_submit: 0`, so a plain update (the approach
 * addPayment uses for a still-draft invoice) cannot touch it once the
 * invoice is already submitted — a real ERPNext Payment Entry, linked via
 * its `references` child table, is the standard way to record a payment
 * against an already-submitted invoice; ERPNext updates the invoice's
 * own outstanding_amount/status automatically as a side effect of
 * submitting it. Cash only for now (spec: a single confirm button, no
 * method picker) — reuses the same Mode of Payment → account resolution
 * addPayment already relies on.
 */
export async function confirmKasbonPaid(invoiceName: string): Promise<PosTransaction> {
  const invoice = await erpNextClient.get<SalesInvoiceDoc>('Sales Invoice', invoiceName);
  if (invoice.outstanding_amount <= 0) {
    throw new ValidationError(`Invoice ${invoiceName} sudah lunas`);
  }

  const [receivableAccount, cashAccount] = await Promise.all([
    getReceivableAccount(),
    getAccountForModeOfPayment('Cash'),
  ]);

  const paymentEntry = await erpNextClient.create<{ name: string }>('Payment Entry', {
    payment_type: 'Receive',
    company: env.ERPNEXT_DEFAULT_COMPANY,
    party_type: 'Customer',
    party: invoice.customer,
    mode_of_payment: 'Cash',
    paid_from: receivableAccount,
    paid_to: cashAccount,
    paid_amount: invoice.outstanding_amount,
    received_amount: invoice.outstanding_amount,
    references: [
      {
        reference_doctype: 'Sales Invoice',
        reference_name: invoiceName,
        allocated_amount: invoice.outstanding_amount,
      },
    ],
  });
  // Same create-draft-then-submit two-step every other write in this
  // module uses — Frappe's insert() never honours a docstatus passed at
  // create time, submitted or not.
  await erpNextClient.update('Payment Entry', paymentEntry.name, { docstatus: 1 });

  const updated = await erpNextClient.get<SalesInvoiceDoc>('Sales Invoice', invoiceName);
  return toPosTransaction(updated);
}

interface SalesInvoiceListRow {
  name: string;
  customer_name: string;
  posting_date: string;
  posting_time: string;
  grand_total: number;
  outstanding_amount: number;
}

interface SalesInvoicePaymentRow {
  parent: string;
  mode_of_payment: string;
  amount: number;
}

function toTransactionPayment(row: SalesInvoicePaymentRow): TransactionPayment {
  return { modeOfPayment: row.mode_of_payment, amount: row.amount };
}

function toTransactionSummary(
  doc: SalesInvoiceListRow,
  payments: TransactionPayment[],
): TransactionSummary {
  return {
    name: doc.name,
    customerName: doc.customer_name,
    postingDate: doc.posting_date,
    postingTime: doc.posting_time,
    grandTotal: doc.grand_total,
    outstandingAmount: doc.outstanding_amount,
    // Derived from the real outstanding balance, not ERPNext's own status
    // string — correct for both a Paid POS sale today and a genuinely
    // Unpaid Kasbon invoice once Group 3 starts creating those, no change
    // needed here when that lands.
    isPaid: doc.outstanding_amount <= 0,
    payments,
  };
}

/**
 * Riwayat Transaksi (spec: transaction history) — every submitted sale,
 * Paid or not (Kasbon/credit sales aren't reachable yet, but this list is
 * deliberately built to already handle both).
 *
 * Payment method is fetched per-invoice via a full `Sales Invoice` GET,
 * NOT a bulk list of the `Sales Invoice Payment` child-table doctype —
 * confirmed against real ERPNext that its generic `/api/resource/{doctype}`
 * list endpoint silently drops every requested field except `name` for
 * child-table (istable=1) doctypes, filter or no filter. A parent
 * document's own GET correctly returns its full child array, which is
 * what getTransactionDetail already relied on — so this reuses the same
 * approach. Bounded by the page size (default 20, max 100), so the N+1
 * fetch is an acceptable, deliberate cost for correctness.
 */
export async function listCompletedTransactions(
  offset: number,
  limit: number,
): Promise<TransactionListPage> {
  const names = await erpNextClient.list<{ name: string }>('Sales Invoice', {
    filters: [
      ['docstatus', '=', 1],
      ['is_pos', '=', 1],
    ],
    fields: ['name'],
    order_by: 'posting_date desc, posting_time desc',
    limit_start: String(offset),
    limit_page_length: String(limit),
  });

  if (names.length === 0) {
    return { transactions: [], hasMore: false };
  }

  const docs = await Promise.all(
    names.map((n) => erpNextClient.get<SalesInvoiceDetailDoc>('Sales Invoice', n.name)),
  );

  return {
    transactions: docs.map((doc) =>
      toTransactionSummary(doc, doc.payments.map(toTransactionPayment)),
    ),
    hasMore: names.length === limit,
  };
}

interface SalesInvoiceDetailDoc extends SalesInvoiceListRow {
  items: Array<{
    item_code: string;
    item_name: string;
    qty: number;
    uom: string;
    rate: number;
    amount: number;
  }>;
  payments: SalesInvoicePaymentRow[];
}

export async function getTransactionDetail(name: string): Promise<TransactionDetail> {
  const doc = await erpNextClient.get<SalesInvoiceDetailDoc>('Sales Invoice', name);
  return {
    ...toTransactionSummary(doc, doc.payments.map(toTransactionPayment)),
    items: doc.items.map((item) => ({
      itemCode: item.item_code,
      itemName: item.item_name,
      qty: item.qty,
      uom: item.uom,
      rate: item.rate,
      amount: item.amount,
    })),
  };
}
