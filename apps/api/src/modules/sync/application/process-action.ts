/**
 * Dispatches a validated offline action to the same application-layer
 * functions the live/direct endpoints use — this module adds durability
 * and idempotency around them, it doesn't reimplement their business
 * logic (spec §15.2 sits on top of §1.3 FR-7 and §6, not instead of them).
 */
import { env } from '../../../config/env.js';
import { ErpNextApiError } from '../../../shared/erpnext-client/index.js';
import { scanAddStock, scanReduceStock, scanTransfer } from '../../inventory/application/index.js';
import { addPayment, createTransaction } from '../../sales-pos/application/index.js';
import type { OfflineAction } from '../domain/index.js';
import * as syncStore from '../infrastructure/sync-store.js';

export class ConflictError extends Error {}

/**
 * ERPNext's own negative-stock guard (confirmed live: submitting a Stock
 * Entry that would take a warehouse negative fails with
 * `exc_type: "NegativeStockError"`) is exactly the scenario spec §15.2
 * names as a Conflict — "stock went negative because two changes happened
 * in overlapping windows" — not a transient/retryable failure. Everything
 * else stays a plain Failed (network blips, validation errors, etc.),
 * eligible for the ordinary retry-on-next-sync path.
 */
function isNegativeStockConflict(error: unknown): boolean {
  if (!(error instanceof ErpNextApiError) || typeof error.responseBody !== 'string') {
    return false;
  }
  try {
    const parsed = JSON.parse(error.responseBody) as { exc_type?: string };
    return parsed.exc_type === 'NegativeStockError';
  } catch {
    return false;
  }
}

async function processPosSale(
  uuid: string,
  action: Extract<OfflineAction, { type: 'pos-sale' }>,
): Promise<unknown> {
  // Two ERPNext writes for one offline action (create invoice, then pay
  // it) — if a prior attempt already got past step 1, resume from the
  // existing invoice instead of creating a second one on retry.
  const existing = syncStore.findByUuid(uuid);
  let invoiceName = existing?.erpnextReference ?? null;

  if (!invoiceName) {
    const transaction = await createTransaction(action.customerId, action.lines);
    invoiceName = transaction.name;
    syncStore.savePartialReference(uuid, invoiceName);
  }

  return addPayment(invoiceName, [{ modeOfPayment: action.modeOfPayment, amount: action.amount }]);
}

export async function processAction(uuid: string, action: OfflineAction): Promise<unknown> {
  switch (action.type) {
    case 'add-stock':
      return scanAddStock(
        action.itemCode,
        action.warehouse ?? env.ERPNEXT_DEFAULT_WAREHOUSE,
        action.qty,
        action.rate,
      );
    case 'reduce-stock':
      return scanReduceStock(
        action.itemCode,
        action.warehouse ?? env.ERPNEXT_DEFAULT_WAREHOUSE,
        action.qty,
      );
    case 'transfer':
      return scanTransfer(
        action.itemCode,
        action.fromWarehouse ?? env.ERPNEXT_DEFAULT_WAREHOUSE,
        action.toWarehouse,
        action.qty,
      );
    case 'pos-sale':
      return processPosSale(uuid, action);
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported offline action type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export { isNegativeStockConflict };
