/**
 * Dispatches a validated offline action to the same application-layer
 * functions the live/direct endpoints use — this module adds durability
 * and idempotency around them, it doesn't reimplement their business
 * logic (spec §15.2 sits on top of §1.3 FR-7 and §6, not instead of them).
 */
import { env } from '../../../config/env.js';
import { ErpNextApiError } from '../../../shared/erpnext-client/index.js';
import { scanAddStock, scanReduceStock, scanTransfer } from '../../inventory/application/index.js';
import {
  addPayment,
  assertRealCustomer,
  createItem,
  createItemPrices,
  createTransaction,
  DuplicateItemError,
  submitKasbonInvoice,
  updateItemPrice,
} from '../../sales-pos/application/index.js';
import type { OfflineAction } from '../domain/index.js';
import * as syncStore from '../infrastructure/sync-store.js';

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

/**
 * Every "two people didn't know about each other's offline work" clash
 * this codebase currently knows how to detect — deliberately a single
 * predicate (not one call site checking N separate ones) so a third
 * conflict type is one more `||` here, not a change at every call site.
 */
function isConflict(error: unknown): boolean {
  return isNegativeStockConflict(error) || error instanceof DuplicateItemError;
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

/**
 * Kasbon / credit sale — same checkpointing shape as processPosSale
 * above (two ERPNext writes, resume from the existing invoice on retry
 * rather than creating a second one), but the second write is
 * submitKasbonInvoice (due date + submit, no payment) instead of
 * addPayment.
 */
async function processKasbonSale(
  uuid: string,
  action: Extract<OfflineAction, { type: 'kasbon-sale' }>,
): Promise<unknown> {
  assertRealCustomer(action.customerId);

  const existing = syncStore.findByUuid(uuid);
  let invoiceName = existing?.erpnextReference ?? null;

  if (!invoiceName) {
    const draft = await createTransaction(action.customerId, action.lines);
    invoiceName = draft.name;
    syncStore.savePartialReference(uuid, invoiceName);
  }

  return submitKasbonInvoice(invoiceName, action.customerId);
}

/**
 * Three write stages for one offline action: register the Item (incl. its
 * base + package UOM conversions), write every Retail/Grosir price row
 * (base unit plus one pair per package UOM), then an optional
 * opening-stock Material Receipt (valued at costPrice, so COGS is correct
 * from the very first sale rather than defaulting to zero).
 *
 * Registration is checkpointed the same way processPosSale checkpoints
 * its invoice: if a prior attempt already created the Item, this UUID's
 * erpnextReference is set, and a retry skips straight past it instead of
 * calling createItem() again (which would now see the Item as a genuine
 * duplicate and misreport this retry as a Conflict). The price-row step
 * needs no such checkpoint — createItemPrices is check-before-create per
 * row, so calling it again on retry (whether zero, some, or all of its
 * rows already exist) is always a safe, cheap no-op-or-fill-in-the-rest.
 */
async function processCreateItem(
  uuid: string,
  action: Extract<OfflineAction, { type: 'create-item' }>,
): Promise<unknown> {
  const existing = syncStore.findByUuid(uuid);

  if (!existing?.erpnextReference) {
    await createItem({
      itemCode: action.itemCode,
      itemName: action.itemName,
      itemGroup: action.itemGroup,
      stockUom: action.stockUom,
      packageUoms: action.packageUoms,
    });
    syncStore.savePartialReference(uuid, action.itemCode);
  }

  const priced = await createItemPrices({
    itemCode: action.itemCode,
    itemName: action.itemName,
    stockUom: action.stockUom,
    retailPrice: action.retailPrice,
    grosirPrice: action.grosirPrice,
    packageUoms: action.packageUoms,
  });

  let stockEntry: { name: string } | null = null;
  if (action.openingQty !== undefined && action.openingQty > 0) {
    stockEntry = await scanAddStock(
      action.itemCode,
      action.warehouse ?? env.ERPNEXT_DEFAULT_WAREHOUSE,
      action.openingQty,
      // Zod's schema guarantees costPrice is present whenever openingQty > 0.
      action.costPrice as number,
    );
  }

  return {
    ...priced,
    openingQty: action.openingQty ?? null,
    costPrice: action.costPrice ?? null,
    stockEntry: stockEntry?.name ?? null,
  };
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
    case 'kasbon-sale':
      return processKasbonSale(uuid, action);
    case 'create-item':
      return processCreateItem(uuid, action);
    case 'update-item-price':
      await updateItemPrice(action.itemCode, action.uom, {
        ...(action.retailPrice !== undefined ? { retailPrice: action.retailPrice } : {}),
        ...(action.grosirPrice !== undefined ? { grosirPrice: action.grosirPrice } : {}),
      });
      return { itemCode: action.itemCode, uom: action.uom };
    default: {
      const exhaustive: never = action;
      throw new Error(`Unsupported offline action type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export { isConflict };
