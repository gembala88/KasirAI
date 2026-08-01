/**
 * AI Gateway — action validation layer (FR-5, §3.1, §8.2).
 *
 * Every write-type action the AI proposes (Sales Order, Quotation, stock
 * change) is structured JSON that must pass through here — checking stock
 * availability, price correctness, and MOQ — before it is ever sent to
 * ERPNext. The AI never writes directly to the database; this is the
 * enforcement point for that rule, independent of which provider produced
 * the proposal.
 *
 * Queries ERPNext directly (via the shared erpnext-client/erpnext-queries)
 * rather than calling into sales-pos/inventory's application layer —
 * modules only talk to each other through `interfaces` (§2.1, §3.3).
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { getStockQty, lookupItemPrice, resolvePriceListForTier } from '../../../shared/erpnext-queries/index.js';
import type { SalesOrderActionPayload, ValidationIssue, ValidationResult } from '../domain/index.js';

interface ItemRecord {
  min_order_qty: number;
}

interface CustomerRecord {
  customer_tier?: string;
}

export async function validateSalesOrderAction(
  payload: SalesOrderActionPayload,
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = [];

  let tier: string | undefined;
  try {
    const customer = await erpNextClient.get<CustomerRecord>('Customer', payload.customerId);
    tier = customer.customer_tier;
  } catch {
    issues.push({ field: 'customerId', message: `Customer "${payload.customerId}" not found` });
  }

  if (payload.items.length === 0) {
    issues.push({ field: 'items', message: 'At least one line item is required' });
  }

  const priceList = resolvePriceListForTier(tier);

  for (const [index, line] of payload.items.entries()) {
    if (line.qty <= 0) {
      issues.push({ field: `items[${index}].qty`, message: 'qty must be positive' });
      continue;
    }

    const item = await erpNextClient.get<ItemRecord>('Item', line.itemCode).catch(() => null);
    if (!item) {
      issues.push({
        field: `items[${index}].itemCode`,
        message: `Item "${line.itemCode}" not found`,
      });
      continue;
    }

    const [correctPrice, stockQty] = await Promise.all([
      lookupItemPrice(line.itemCode, priceList),
      getStockQty(line.itemCode, env.ERPNEXT_DEFAULT_WAREHOUSE),
    ]);

    if (correctPrice === null) {
      issues.push({
        field: `items[${index}].itemCode`,
        message: `No price found for "${line.itemCode}" in ${priceList}`,
      });
    } else if (line.rate !== undefined && line.rate !== correctPrice) {
      // Never trust an AI-supplied price — this is the concrete
      // enforcement of spec §3.1/§8.1's "never fabricate price" rule.
      issues.push({
        field: `items[${index}].rate`,
        message: `Proposed rate ${line.rate} does not match ERPNext price ${correctPrice} for "${line.itemCode}" in ${priceList}`,
      });
    }

    if (stockQty < line.qty) {
      issues.push({
        field: `items[${index}].qty`,
        message: `Insufficient stock for "${line.itemCode}": have ${stockQty}, need ${line.qty}`,
      });
    }

    if (tier === 'Grosir' && item.min_order_qty > 0 && line.qty < item.min_order_qty) {
      issues.push({
        field: `items[${index}].qty`,
        message: `Below MOQ for Grosir: "${line.itemCode}" requires at least ${item.min_order_qty}`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}
