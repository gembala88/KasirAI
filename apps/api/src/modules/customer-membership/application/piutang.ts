/**
 * Customer/Membership module — piutang (accounts receivable) tracking
 * (spec §1.3 FR-4, §7 "Piutang reminder flow").
 *
 * Reads live from ERPNext's Sales Invoice ledger — outstanding_amount and
 * due_date are already computed and stored there; nothing is duplicated
 * or cached as a separate source of truth (§1.4 NFR "Data consistency").
 */
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import type {
  KasbonInvoice,
  PiutangLine,
  PiutangReminder,
  PiutangSummary,
} from '../domain/index.js';
import { triggerPiutangCheckNow } from '../infrastructure/index.js';

interface OutstandingInvoice {
  name: string;
  customer: string;
  posting_date: string;
  due_date: string;
  grand_total: number;
  outstanding_amount: number;
}

interface OutstandingInvoiceWithCustomerName extends OutstandingInvoice {
  customer_name: string;
}

function daysUntil(dueDate: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const due = new Date(dueDate);
  return Math.round((due.getTime() - today.getTime()) / msPerDay);
}

function toLine(invoice: OutstandingInvoice): PiutangLine {
  const daysUntilDue = daysUntil(invoice.due_date);
  return {
    invoice: invoice.name,
    postingDate: invoice.posting_date,
    dueDate: invoice.due_date,
    grandTotal: invoice.grand_total,
    outstandingAmount: invoice.outstanding_amount,
    daysUntilDue,
    overdue: daysUntilDue < 0,
  };
}

export async function getPiutang(customerId: string): Promise<PiutangSummary> {
  const invoices = await erpNextClient.list<OutstandingInvoice>('Sales Invoice', {
    filters: [
      ['customer', '=', customerId],
      ['docstatus', '=', 1],
      ['outstanding_amount', '>', 0],
    ],
    fields: ['name', 'customer', 'posting_date', 'due_date', 'grand_total', 'outstanding_amount'],
    order_by: 'due_date asc',
  });

  const lines = invoices.map(toLine);
  return {
    customer: customerId,
    totalOutstanding: lines.reduce((sum, line) => sum + line.outstandingAmount, 0),
    invoices: lines,
  };
}

/**
 * "Tagihan Kasbon" screen (spec Group 3) — every outstanding invoice
 * across every customer, regardless of due date (unlike
 * findDuePiutangReminders below, which only surfaces ones due soon for
 * the scheduled reminder job). Same live-ledger-read principle as
 * getPiutang: outstanding_amount/due_date come straight from ERPNext,
 * never cached separately.
 */
export async function listKasbonInvoices(): Promise<KasbonInvoice[]> {
  const invoices = await erpNextClient.list<OutstandingInvoiceWithCustomerName>('Sales Invoice', {
    filters: [
      ['docstatus', '=', 1],
      ['outstanding_amount', '>', 0],
    ],
    fields: [
      'name',
      'customer',
      'customer_name',
      'posting_date',
      'due_date',
      'grand_total',
      'outstanding_amount',
    ],
    order_by: 'due_date asc',
  });

  return invoices.map((invoice) => {
    const daysUntilDue = daysUntil(invoice.due_date);
    return {
      invoice: invoice.name,
      customer: invoice.customer,
      customerName: invoice.customer_name,
      grandTotal: invoice.grand_total,
      outstandingAmount: invoice.outstanding_amount,
      postingDate: invoice.posting_date,
      dueDate: invoice.due_date,
      daysUntilDue,
      overdue: daysUntilDue < 0,
    };
  });
}

/**
 * All outstanding invoices due within `daysAhead` (including already
 * overdue ones) across every customer — the query the piutang reminder
 * job runs on its schedule (spec §7). Exposed as a plain read here too so
 * it can be inspected without waiting for or triggering the job.
 */
export async function findDuePiutangReminders(daysAhead: number): Promise<PiutangReminder[]> {
  const cutoff = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const invoices = await erpNextClient.list<OutstandingInvoice>('Sales Invoice', {
    filters: [
      ['docstatus', '=', 1],
      ['outstanding_amount', '>', 0],
      ['due_date', '<=', cutoff],
    ],
    fields: ['name', 'customer', 'posting_date', 'due_date', 'grand_total', 'outstanding_amount'],
    order_by: 'due_date asc',
  });

  return invoices.map((invoice) => {
    const daysUntilDue = daysUntil(invoice.due_date);
    return {
      customer: invoice.customer,
      invoice: invoice.name,
      dueDate: invoice.due_date,
      outstandingAmount: invoice.outstanding_amount,
      daysUntilDue,
      overdue: daysUntilDue < 0,
    };
  });
}

/** Enqueues an immediate piutang-reminder check through the real BullMQ queue/worker. */
export async function triggerReminderCheck(): Promise<{ jobId: string }> {
  return triggerPiutangCheckNow();
}
