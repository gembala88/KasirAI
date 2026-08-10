/**
 * Customer/Membership module — domain layer (spec §1.3 FR-4).
 */

// Duplicated from sales-pos/domain's CUSTOMER_TIERS rather than imported —
// modules only talk to each other through `interfaces`, never each
// other's domain layer directly (§2.1, §3.3). Three values, unlikely to
// drift; not worth a shared-kernel abstraction for.
export const CUSTOMER_TIERS = ['Retail', 'Grosir', 'Member'] as const;

export interface CustomerProfile {
  id: string;
  name: string;
  tier: string;
  creditLimit: number;
  paymentTermDays: number;
  mobileNo: string;
}

export interface PiutangLine {
  invoice: string;
  postingDate: string;
  dueDate: string;
  grandTotal: number;
  outstandingAmount: number;
  daysUntilDue: number;
  overdue: boolean;
}

export interface PiutangSummary {
  customer: string;
  totalOutstanding: number;
  invoices: PiutangLine[];
}

export interface PurchaseHistoryEntry {
  invoice: string;
  postingDate: string;
  grandTotal: number;
  status: string;
}

export interface PiutangReminder {
  customer: string;
  invoice: string;
  dueDate: string;
  outstandingAmount: number;
  daysUntilDue: number;
  overdue: boolean;
}

/** A search-result row for picking a real registered Customer (spec Group 3: Kasbon requires one, never Walk-in) — deliberately thinner than CustomerProfile, matching ProductSearchResult's role as a picker-list shape, not a full profile. */
export interface CustomerSearchResult {
  id: string;
  name: string;
  mobileNo: string;
  tier: string;
}

/** "Tagihan Kasbon" screen's list row (spec Group 3) — every outstanding invoice across every customer, not just those due soon like PiutangReminder (that one backs the scheduled reminder job; this one is a full ledger view). */
export interface KasbonInvoice {
  invoice: string;
  customer: string;
  customerName: string;
  grandTotal: number;
  outstandingAmount: number;
  postingDate: string;
  dueDate: string;
  daysUntilDue: number;
  overdue: boolean;
}
