/**
 * AI Gateway — Sales Order status/cancel (spec §7 WhatsApp conversation
 * flows "cek status pesanan" / "batalkan pesanan"). Kept alongside
 * propose/confirm in actions.ts since this module already owns the Sales
 * Order lifecycle created by confirmAction — reading/cancelling an
 * *existing*, already-validated order is a smaller-risk write than
 * creating one, so unlike propose_sales_order it isn't routed through the
 * two-step propose/confirm audit trail (documented scope simplification).
 */
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { NotFoundError, ValidationError } from '../../../shared/errors/index.js';

export interface SalesOrderSummary {
  name: string;
  customer: string;
  status: string;
  grandTotal: number;
  deliveryDate: string;
}

interface SalesOrderDoc {
  name: string;
  customer: string;
  status: string;
  grand_total: number;
  delivery_date: string;
}

function toSummary(doc: SalesOrderDoc): SalesOrderSummary {
  return {
    name: doc.name,
    customer: doc.customer,
    status: doc.status,
    grandTotal: doc.grand_total,
    deliveryDate: doc.delivery_date,
  };
}

export async function getOrderStatus(
  orderName: string,
  customerId: string,
): Promise<SalesOrderSummary> {
  let doc: SalesOrderDoc;
  try {
    doc = await erpNextClient.get<SalesOrderDoc>('Sales Order', orderName);
  } catch {
    throw new NotFoundError(`Order "${orderName}" not found`);
  }
  if (doc.customer !== customerId) {
    throw new NotFoundError(`Order "${orderName}" not found`);
  }
  return toSummary(doc);
}

const CANCELLABLE_STATUSES = new Set([
  'Draft',
  'On Hold',
  'To Deliver and Bill',
  'To Bill',
  'To Deliver',
]);

export async function cancelOrder(
  orderName: string,
  customerId: string,
): Promise<SalesOrderSummary> {
  const order = await getOrderStatus(orderName, customerId);
  if (!CANCELLABLE_STATUSES.has(order.status)) {
    throw new ValidationError(
      `Order "${orderName}" can no longer be cancelled (status: ${order.status})`,
    );
  }
  const updated = await erpNextClient.update<SalesOrderDoc>('Sales Order', orderName, {
    docstatus: 2,
  });
  return toSummary(updated);
}
