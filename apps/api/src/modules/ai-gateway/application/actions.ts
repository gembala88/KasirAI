/**
 * AI Gateway — propose/confirm action lifecycle (spec §1.3 FR-5, §6).
 *
 * propose: validates and persists to ai_action_audit, never touches
 * ERPNext. confirm: re-validates (stock/price may have moved since the
 * proposal) and only then executes the ERPNext write — the "validated
 * action layer" the spec requires between any AI output and a database
 * change.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../../../config/env.js';
import { getDb } from '../../../shared/database/index.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { NotFoundError, ValidationError } from '../../../shared/errors/index.js';
import type {
  ActionPayload,
  ActionStatus,
  ProposedAction,
  ProposedActionType,
  SalesOrderActionPayload,
} from '../domain/index.js';
import { validateSalesOrderAction } from '../validation/index.js';

interface AuditRow {
  id: string;
  type: string;
  payload: string;
  status: string;
  validation: string;
  erpnext_reference: string | null;
  created_at: string;
  confirmed_at: string | null;
}

function rowToAction(row: AuditRow): ProposedAction {
  return {
    id: row.id,
    type: row.type as ProposedActionType,
    payload: JSON.parse(row.payload) as ActionPayload,
    status: row.status as ActionStatus,
    validation: JSON.parse(row.validation) as ProposedAction['validation'],
    ...(row.erpnext_reference ? { erpnextReference: row.erpnext_reference } : {}),
    createdAt: row.created_at,
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}),
  };
}

async function runValidation(type: ProposedActionType, payload: ActionPayload) {
  switch (type) {
    case 'propose_sales_order':
      return validateSalesOrderAction(payload);
    default: {
      const exhaustive: never = type;
      throw new ValidationError(`Unsupported action type "${String(exhaustive)}"`);
    }
  }
}

export async function proposeAction(
  type: ProposedActionType,
  payload: ActionPayload,
): Promise<ProposedAction> {
  const validation = await runValidation(type, payload);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const status: ActionStatus = validation.valid ? 'proposed' : 'validation_failed';

  getDb()
    .prepare(
      'INSERT INTO ai_action_audit (id, type, payload, status, validation, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, type, JSON.stringify(payload), status, JSON.stringify(validation), createdAt);

  return { id, type, payload, status, validation, createdAt };
}

function loadAction(id: string): ProposedAction {
  const row = getDb().prepare('SELECT * FROM ai_action_audit WHERE id = ?').get(id) as
    AuditRow | undefined;
  if (!row) {
    throw new NotFoundError(`Proposed action "${id}" not found`);
  }
  return rowToAction(row);
}

export function getAction(id: string): ProposedAction {
  return loadAction(id);
}

interface SalesOrderResult {
  name: string;
}

async function executeSalesOrder(payload: SalesOrderActionPayload): Promise<SalesOrderResult> {
  const customer = await erpNextClient.get<{ customer_tier?: string }>(
    'Customer',
    payload.customerId,
  );
  const priceList =
    customer.customer_tier === 'Grosir' || customer.customer_tier === 'Member'
      ? customer.customer_tier
      : 'Retail';

  const items = await Promise.all(
    payload.items.map(async (line) => {
      const [priceRecord] = await erpNextClient.list<{ price_list_rate: number }>('Item Price', {
        filters: [
          ['item_code', '=', line.itemCode],
          ['price_list', '=', priceList],
        ],
        fields: ['price_list_rate'],
      });
      return {
        item_code: line.itemCode,
        qty: line.qty,
        rate: priceRecord?.price_list_rate ?? line.rate,
        warehouse: env.ERPNEXT_DEFAULT_WAREHOUSE,
      };
    }),
  );

  const deliveryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const doc = await erpNextClient.create<SalesOrderResult>('Sales Order', {
    company: env.ERPNEXT_DEFAULT_COMPANY,
    customer: payload.customerId,
    order_type: 'Sales',
    currency: 'IDR',
    conversion_rate: 1,
    selling_price_list: priceList,
    price_list_currency: 'IDR',
    plc_conversion_rate: 1,
    delivery_date: deliveryDate,
    items: items.map((item) => ({ ...item, delivery_date: deliveryDate })),
  });

  return erpNextClient.update<SalesOrderResult>('Sales Order', doc.name, { docstatus: 1 });
}

export async function confirmAction(id: string): Promise<ProposedAction> {
  const action = loadAction(id);

  if (action.status !== 'proposed') {
    throw new ValidationError(`Action "${id}" is not confirmable (status: ${action.status})`);
  }

  // Re-validate — stock/price may have changed since the action was proposed.
  const revalidation = await runValidation(action.type, action.payload);
  if (!revalidation.valid) {
    getDb()
      .prepare('UPDATE ai_action_audit SET status = ?, validation = ? WHERE id = ?')
      .run('validation_failed', JSON.stringify(revalidation), id);
    return { ...action, status: 'validation_failed', validation: revalidation };
  }

  const confirmedAt = new Date().toISOString();

  try {
    const salesOrder = await executeSalesOrder(action.payload);
    getDb()
      .prepare(
        'UPDATE ai_action_audit SET status = ?, erpnext_reference = ?, confirmed_at = ? WHERE id = ?',
      )
      .run('executed', salesOrder.name, confirmedAt, id);
    return {
      ...action,
      status: 'executed',
      erpnextReference: salesOrder.name,
      confirmedAt,
    };
  } catch (error) {
    getDb()
      .prepare('UPDATE ai_action_audit SET status = ?, confirmed_at = ? WHERE id = ?')
      .run('execution_failed', confirmedAt, id);
    throw error;
  }
}
