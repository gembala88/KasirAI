/**
 * Inventory module — reaction to incoming ERPNext webhooks (spec §3.2).
 *
 * HTTP-level concerns (signature verification, raw body) live in
 * interfaces/webhook.routes.ts; this is just "what happens once we trust
 * the payload."
 */
import { eventBus } from '../../../shared/event-bus/index.js';
import { logger } from '../../../shared/logger/index.js';
import { stockCache, stockCacheKey } from '../infrastructure/stock-cache.js';

interface StockEntryItemPayload {
  item_code: string;
  s_warehouse?: string;
  t_warehouse?: string;
}

interface StockReconciliationItemPayload {
  item_code: string;
  warehouse: string;
}

export interface ErpNextWebhookPayload {
  doctype: string;
  name: string;
  items?: Array<StockEntryItemPayload | StockReconciliationItemPayload>;
  item_code?: string;
  [key: string]: unknown;
}

function invalidateFromItems(
  items: Array<StockEntryItemPayload | StockReconciliationItemPayload> | undefined,
): void {
  if (!items) {
    return;
  }
  for (const item of items) {
    const warehouses = [
      'warehouse' in item ? item.warehouse : undefined,
      's_warehouse' in item ? item.s_warehouse : undefined,
      't_warehouse' in item ? item.t_warehouse : undefined,
    ].filter((w): w is string => Boolean(w));

    for (const warehouse of warehouses) {
      stockCache.invalidate(stockCacheKey(item.item_code, warehouse));
    }
    stockCache.invalidate(stockCacheKey(item.item_code));
  }
}

/**
 * Handles Stock Entry / Stock Reconciliation / Item webhook events by
 * invalidating the affected stock cache entries, and republishes every
 * event on the shared event bus so other modules (sales-pos, future
 * customer-membership) can react without inventory needing to know about
 * them (§2.1, §3.3: modules communicate only through defined interfaces).
 */
export function handleErpNextWebhook(payload: ErpNextWebhookPayload): void {
  logger.info({ doctype: payload.doctype, name: payload.name }, 'webhook.erpnext.received');

  switch (payload.doctype) {
    // Sales Invoice with update_stock=1 (how sales-pos completes a POS
    // sale, §5) reduces stock on submit same as a Stock Entry does — needs
    // the same cache invalidation, even though it's not one of the
    // doctypes §3.2 lists (that list predates the Sales Invoice-based POS
    // design decision documented in sales-pos/application/transactions.ts).
    case 'Stock Entry':
    case 'Stock Reconciliation':
    case 'Sales Invoice':
      invalidateFromItems(payload.items);
      break;
    case 'Item':
      if (payload.item_code) {
        stockCache.invalidate(stockCacheKey(payload.item_code));
      }
      break;
    default:
      // Sales Order / Purchase Order etc. — no inventory cache action yet,
      // but still worth publishing for other modules to pick up later.
      break;
  }

  eventBus.publish('erpnext.webhook', payload);
}
