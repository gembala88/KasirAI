// Mirrors apps/api's report-dashboard/domain and sales-pos/domain response
// shapes (§1.3 FR-6, FR-8) — this app never invents its own shape for
// data the backend already defines.

export interface RevenueProfitSummary {
  revenue: number;
  profit: number;
  invoiceCount: number;
}

export interface ItemPerformance {
  itemCode: string;
  itemName: string;
  qtySold: number;
  revenue: number;
}

export interface SupplierPerformance {
  supplier: string;
  supplierName: string;
  totalPurchased: number;
}

export interface CustomerActivity {
  customer: string;
  customerName: string;
  invoiceCount: number;
  totalSpent: number;
}

export interface LowStockAlert {
  itemCode: string;
  itemName: string;
  warehouse: string;
  actualQty: number;
  threshold: number;
}

export interface ExpiringItem {
  batchId: string;
  itemCode: string;
  expiryDate: string;
  daysUntilExpiry: number;
  batchQty: number;
}

export interface DashboardSummary {
  today: RevenueProfitSummary;
  rankingWindowDays: number;
  bestSellers: ItemPerformance[];
  worstSellers: ItemPerformance[];
  bestSupplier: SupplierPerformance | null;
  mostActiveCustomer: CustomerActivity | null;
  nearOutOfStock: LowStockAlert[];
  expiringItems: ExpiringItem[];
}

export interface PendingPaymentOrder {
  name: string;
  status: string;
  customer: string;
  grandTotal: number;
  paidAmount: number;
  outstandingAmount: number;
  poNo?: string;
  contactMobile?: string;
}

export type PaymentMethod = 'qris' | 'transfer' | 'cod';

// Mirrors apps/api's sync/domain (§15.2) — a Conflict is never
// auto-resolved (e.g. two overlapping stock changes going negative), so
// it needs a human glance here rather than being silently retried.
export interface SyncConflict {
  uuid: string;
  actionType: string;
  clientTimestamp: string;
  createdAt: string;
  errorMessage: string | null;
  payload: unknown;
}
