/**
 * Inventory module — domain layer (spec §1.3 FR-2).
 */

export interface StockLevel {
  itemCode: string;
  warehouse: string;
  actualQty: number;
}

export interface StockOpnameLine {
  itemCode: string;
  countedQty: number;
}

export interface StockOpnameVarianceLine {
  itemCode: string;
  systemQty: number;
  countedQty: number;
  variance: number;
}

export interface StockOpnameResult {
  reconciliationName: string;
  warehouse: string;
  variances: StockOpnameVarianceLine[];
}

export interface LowStockAlert {
  itemCode: string;
  itemName: string;
  warehouse: string;
  actualQty: number;
  threshold: number;
}

export interface NearExpiryAlert {
  batchId: string;
  itemCode: string;
  expiryDate: string;
  daysUntilExpiry: number;
  batchQty: number;
}
