/**
 * Dispatches a ConversationAction (spec §7/§8) to the module that owns
 * that data/write, and returns a plain JSON-serialisable result that
 * becomes the next turn's "system_data" (persona.ts) — the model never
 * touches ERPNext directly, only ever sees facts this layer fetched.
 *
 * propose_sales_order is routed through ai-gateway's proposeAction +
 * confirmAction (the same validated-action layer Phase 4 built) rather
 * than writing to ERPNext directly — but unlike the AI Gateway's
 * owner-facing HTTP endpoints (propose, then a separate confirm call),
 * chat orders are proposed *and* confirmed in the same turn once the
 * model decides the request is unambiguous. There's no second
 * "ya, jadi proses" round-trip in this phase — a deliberate scope
 * simplification, documented here rather than added silently.
 */
import { env } from '../../../config/env.js';
import { getStockQty } from '../../../shared/erpnext-queries/index.js';
import { logger } from '../../../shared/logger/index.js';
import { cancelOrder, confirmAction, getOrderStatus, proposeAction } from '../../ai-gateway/interfaces/index.js';
import { findCustomerByMobile, getPurchaseHistory } from '../../customer-membership/interfaces/index.js';
import {
  addPayment,
  createInvoiceFromSalesOrder,
  getTransaction,
  searchProducts,
} from '../../sales-pos/interfaces/index.js';
import type { ConversationAction, PaymentMethod, WhatsAppSession } from '../domain/index.js';
import { sendTextMessage } from '../infrastructure/whatsapp-client.js';
import { updateSession } from '../infrastructure/sessions.js';

/**
 * Each payment method maps 1:1 to a real ERPNext Mode of Payment (created
 * in the Phase 2 seed script, each posting to its own account for
 * reconciliation) — "cod" reuses "Cash" since it *is* cash, just collected
 * by the courier at delivery instead of at a till.
 */
export const MODE_OF_PAYMENT_BY_METHOD: Record<PaymentMethod, string> = {
  qris: 'QRIS',
  transfer: 'Transfer',
  cod: 'Cash',
};

async function resolveCustomerId(phoneNumber: string, session: WhatsAppSession): Promise<string | null> {
  if (session.customerId) {
    return session.customerId;
  }
  const customer = await findCustomerByMobile(phoneNumber);
  if (!customer) {
    return null;
  }
  updateSession(phoneNumber, { customerId: customer.id });
  return customer.id;
}

export async function executeConversationAction(
  phoneNumber: string,
  session: WhatsAppSession,
  action: ConversationAction,
): Promise<unknown> {
  switch (action.type) {
    case 'check_stock': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      const results = await searchProducts(action.itemQuery, customerId ? undefined : 'Retail');
      if (results.length === 0) {
        // Distinct from "found, qty 0" — the persona prompt must not be
        // left to infer this from an empty array, since a small model
        // reading raw JSON can (and did, in live Phase 5 testing) collapse
        // "no such product" into "out of stock" and say so to a customer.
        return { found: false, itemQuery: action.itemQuery };
      }
      const matches = await Promise.all(
        results.slice(0, 5).map(async (item) => ({
          itemCode: item.itemCode,
          itemName: item.itemName,
          stockQty: await getStockQty(item.itemCode, env.ERPNEXT_DEFAULT_WAREHOUSE),
        })),
      );
      return { found: true, matches };
    }

    case 'check_price': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      const tier = customerId ? undefined : 'Retail';
      const results = await searchProducts(action.itemQuery, tier);
      return {
        matches: results
          .slice(0, 5)
          .map((item) => ({ itemCode: item.itemCode, itemName: item.itemName, price: item.price, priceList: item.priceList })),
      };
    }

    case 'propose_sales_order': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      if (!customerId) {
        return { error: 'customer_not_registered', message: 'No ERPNext Customer found for this phone number' };
      }
      const proposed = await proposeAction('propose_sales_order', {
        customerId,
        items: action.items,
      });
      if (proposed.status !== 'proposed') {
        return { error: 'validation_failed', issues: proposed.validation.issues };
      }
      const confirmed = await confirmAction(proposed.id);
      if (confirmed.status !== 'executed') {
        return { error: 'execution_failed', issues: confirmed.validation.issues };
      }
      return { orderName: confirmed.erpnextReference, status: confirmed.status };
    }

    case 'get_order_status': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      if (!customerId) {
        return { error: 'customer_not_registered' };
      }
      try {
        return await getOrderStatus(action.orderName, customerId);
      } catch {
        return { error: 'not_found', orderName: action.orderName };
      }
    }

    case 'get_purchase_history': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      if (!customerId) {
        return { error: 'customer_not_registered' };
      }
      return { history: await getPurchaseHistory(customerId, 10) };
    }

    case 'cancel_order': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      if (!customerId) {
        return { error: 'customer_not_registered' };
      }
      try {
        return await cancelOrder(action.orderName, customerId);
      } catch (error) {
        return { error: 'cancel_failed', message: error instanceof Error ? error.message : String(error) };
      }
    }

    case 'initiate_payment': {
      const customerId = await resolveCustomerId(phoneNumber, session);
      if (!customerId) {
        return { error: 'customer_not_registered' };
      }
      if (!(action.method in MODE_OF_PAYMENT_BY_METHOD)) {
        // parseModelJson only checks the action's "type", not nested
        // fields — a model could emit a method it invented (e.g. "cash"
        // instead of "cod"), so this is checked for real here.
        return { error: 'unsupported_method', method: action.method };
      }
      // No message is sent from here — composing and sending the
      // payment-instruction reply is conversation.ts's job exclusively
      // (payment-reply.ts's buildPaymentInstructionReply), so there is
      // exactly one place in the codebase that turns a successful
      // initiate_payment into customer-facing text. This action only
      // ever returns real facts about the ERPNext write.
      try {
        const invoice = await createInvoiceFromSalesOrder(action.orderName);
        return { invoiceName: invoice.name, grandTotal: invoice.grandTotal, method: action.method };
      } catch (error) {
        return { error: 'invoice_failed', message: error instanceof Error ? error.message : String(error) };
      }
    }

    default: {
      const exhaustive: never = action;
      return { error: 'unsupported_action', type: String((exhaustive as ConversationAction).type) };
    }
  }
}

export interface PaymentConfirmResult {
  invoiceName: string;
  grandTotal: number;
  /** False if the ERPNext write succeeded but the WhatsApp notification failed — never claims a send that didn't happen. */
  customerNotified: boolean;
}

/**
 * Owner/cashier confirms a payment was received — QRIS, bank transfer, or
 * COD cash-on-delivery (§7/§10 Phase 6, "API endpoint only, no UI" per
 * project decision) — reuses the same addPayment the POS module uses to
 * submit the invoice (docstatus=1) and reduce stock, then sends the
 * customer a real WhatsApp confirmation.
 *
 * The ERPNext write and the WhatsApp notification are treated as
 * separate outcomes: a notification failure (e.g. WhatsApp credentials
 * not configured yet) must never look like the payment itself failed to
 * the owner/cashier calling this — the money was already registered.
 */
export async function confirmPayment(
  invoiceName: string,
  phoneNumber: string,
  method: PaymentMethod,
): Promise<PaymentConfirmResult> {
  const current = await getTransaction(invoiceName);
  const updated = await addPayment(invoiceName, [
    { modeOfPayment: MODE_OF_PAYMENT_BY_METHOD[method], amount: current.grandTotal },
  ]);

  let customerNotified = false;
  try {
    await sendTextMessage(
      phoneNumber,
      `Pembayaran untuk pesanan ${updated.name} sebesar Rp ${updated.grandTotal.toLocaleString('id-ID')} sudah kami terima ya kak, terima kasih! Pesanan segera kami proses 🙏`,
    );
    customerNotified = true;
  } catch (error) {
    logger.error({ invoiceName, phoneNumber, error }, 'whatsapp.payment_confirmation_notify_failed');
  }

  return { invoiceName: updated.name, grandTotal: updated.grandTotal, customerNotified };
}
