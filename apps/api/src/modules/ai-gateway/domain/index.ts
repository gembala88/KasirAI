/**
 * AI Gateway module — domain layer (spec §3.1, §5, §6).
 *
 * "AI proposes the action as structured JSON, a business-rule validator
 * checks stock/price/MOQ, only then does it execute against ERPNext API.
 * AI never writes directly to the database." (§1.3 FR-5)
 */

export type ProposedActionType = 'propose_sales_order';

export interface SalesOrderActionLine {
  itemCode: string;
  qty: number;
  /** AI-supplied price, if any — validated against ERPNext's own price, never trusted outright. */
  rate?: number | undefined;
}

export interface SalesOrderActionPayload {
  customerId: string;
  items: SalesOrderActionLine[];
}

export type ActionPayload = SalesOrderActionPayload;

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export type ActionStatus = 'proposed' | 'validation_failed' | 'executed' | 'execution_failed';

export interface ProposedAction {
  id: string;
  type: ProposedActionType;
  payload: ActionPayload;
  status: ActionStatus;
  validation: ValidationResult;
  erpnextReference?: string;
  createdAt: string;
  confirmedAt?: string;
}
