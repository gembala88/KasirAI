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
import type { CartLineInput, PaymentInput, PosTransaction } from '../domain/index.js';
import { getProductPrice, resolvePriceList } from './pricing.js';

interface SalesInvoiceDoc {
  name: string;
  status: string;
  customer: string;
  grand_total: number;
  paid_amount: number;
  outstanding_amount: number;
}

function toPosTransaction(doc: SalesInvoiceDoc): PosTransaction {
  return {
    name: doc.name,
    status: doc.status,
    customer: doc.customer,
    grandTotal: doc.grand_total,
    paidAmount: doc.paid_amount,
    outstandingAmount: doc.outstanding_amount,
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

export async function createTransaction(
  customerId: string | undefined,
  lines: CartLineInput[],
): Promise<PosTransaction> {
  if (lines.length === 0) {
    throw new ValidationError('A POS transaction needs at least one line');
  }

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
