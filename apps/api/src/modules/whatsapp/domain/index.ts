/**
 * WhatsApp module — domain layer (spec §1.3 FR-5, §7, §8).
 */

export interface WhatsAppSession {
  phoneNumber: string;
  customerId: string | undefined;
  state: Record<string, unknown>;
}

export interface ConversationLogEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

/** The three payment methods §10 Phase 6 adds alongside QRIS — each maps 1:1 to a real ERPNext Mode of Payment ("QRIS", "Transfer", "Cash"). */
export type PaymentMethod = 'qris' | 'transfer' | 'cod';

/**
 * The structured actions a conversation turn can dispatch — this is the
 * "AI proposes the action as structured JSON" boundary from §1.3 FR-5,
 * implemented as a JSON response envelope the persona prompt asks the
 * model to always return (§8.2's function list, minus get_active_promotions
 * and propose_quotation — see README "Phase 5 scope" for why).
 */
export type ConversationAction =
  | { type: 'check_stock'; itemQuery: string }
  | { type: 'check_price'; itemQuery: string }
  | { type: 'propose_sales_order'; items: Array<{ itemCode: string; qty: number }> }
  | { type: 'get_order_status'; orderName: string }
  | { type: 'get_purchase_history' }
  | { type: 'cancel_order'; orderName: string }
  | { type: 'initiate_payment'; orderName: string; method: PaymentMethod };

export interface ConversationTurnResult {
  reply: string;
  action?: ConversationAction;
}
