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
  | { type: 'initiate_qris_payment'; orderName: string };

export interface ConversationTurnResult {
  reply: string;
  action?: ConversationAction;
}
