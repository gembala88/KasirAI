/**
 * Report/Dashboard module — domain layer (spec §1.3 FR-6, FR-8, §6, §10 Phase 7).
 *
 * LowStockAlertSummary/ExpiringItemSummary intentionally duplicate
 * inventory's LowStockAlert/NearExpiryAlert shape rather than importing
 * it — each module's domain layer describes its own view of the world,
 * even where structurally identical to another module's, to keep domain
 * layers independent of each other (only application/interfaces layers
 * reach across modules, per §2.1/§3.3).
 */

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

export interface LowStockAlertSummary {
  itemCode: string;
  itemName: string;
  warehouse: string;
  actualQty: number;
  threshold: number;
}

export interface ExpiringItemSummary {
  batchId: string;
  itemCode: string;
  expiryDate: string;
  daysUntilExpiry: number;
  batchQty: number;
}

/**
 * Everything the dashboard home page and the owner-chat's
 * get_dashboard_summary action both need — one comprehensive, real query
 * bundle rather than one endpoint per KPI, since the dashboard renders
 * all of them together anyway (§9: "card-based summary ... at top").
 */
export interface DashboardSummary {
  today: RevenueProfitSummary;
  /** Rolling window used for the ranking metrics below — a single day is too thin a sample for a small store. */
  rankingWindowDays: number;
  bestSellers: ItemPerformance[];
  worstSellers: ItemPerformance[];
  bestSupplier: SupplierPerformance | null;
  mostActiveCustomer: CustomerActivity | null;
  nearOutOfStock: LowStockAlertSummary[];
  expiringItems: ExpiringItemSummary[];
}

export interface SalesReportRow {
  invoice: string;
  postingDate: string;
  customer: string;
  grandTotal: number;
  profit: number;
}

export interface SalesReport {
  from: string;
  to: string;
  rows: SalesReportRow[];
  totalRevenue: number;
  totalProfit: number;
}
