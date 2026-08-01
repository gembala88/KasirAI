/**
 * Customer/Membership module — profile and purchase history (spec §1.3 FR-4).
 */
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { NotFoundError, ValidationError } from '../../../shared/errors/index.js';
import {
  CUSTOMER_TIERS,
  type CustomerProfile,
  type PurchaseHistoryEntry,
} from '../domain/index.js';

interface CustomerDoc {
  name: string;
  customer_name: string;
  customer_tier?: string;
  credit_limit?: number;
  payment_term_days?: number;
  mobile_no?: string;
}

function toProfile(doc: CustomerDoc): CustomerProfile {
  return {
    id: doc.name,
    name: doc.customer_name,
    tier: doc.customer_tier ?? 'Retail',
    creditLimit: doc.credit_limit ?? 0,
    paymentTermDays: doc.payment_term_days ?? 0,
    mobileNo: doc.mobile_no ?? '',
  };
}

export async function getCustomerProfile(customerId: string): Promise<CustomerProfile> {
  try {
    const doc = await erpNextClient.get<CustomerDoc>('Customer', customerId);
    return toProfile(doc);
  } catch (error) {
    if (error instanceof Error && 'statusCode' in error && error.statusCode === 404) {
      throw new NotFoundError(`Customer ${customerId} not found`);
    }
    throw error;
  }
}

/**
 * Looks up a Customer by phone number (spec §7: the WhatsApp webhook only
 * ever gives us a phone number, never an ERPNext Customer ID). Returns
 * `null` rather than throwing when nobody matches — an unrecognised
 * number chatting in is an expected case (not-yet-registered customer),
 * not an error.
 */
export async function findCustomerByMobile(mobileNo: string): Promise<CustomerProfile | null> {
  const [doc] = await erpNextClient.list<CustomerDoc>('Customer', {
    filters: [['mobile_no', '=', mobileNo]],
    fields: ['name', 'customer_name', 'customer_tier', 'credit_limit', 'payment_term_days', 'mobile_no'],
    limit_page_length: '1',
  });
  return doc ? toProfile(doc) : null;
}

export interface CreateCustomerInput {
  name: string;
  tier: string;
  mobileNo?: string | undefined;
  paymentTermDays?: number | undefined;
  creditLimit?: number | undefined;
}

export async function createCustomer(input: CreateCustomerInput): Promise<CustomerProfile> {
  if (!CUSTOMER_TIERS.includes(input.tier as (typeof CUSTOMER_TIERS)[number])) {
    throw new ValidationError(`tier must be one of ${CUSTOMER_TIERS.join(', ')}`);
  }

  const doc = await erpNextClient.create<CustomerDoc>('Customer', {
    customer_name: input.name,
    customer_type: 'Individual',
    customer_tier: input.tier,
    ...(input.mobileNo ? { mobile_no: input.mobileNo } : {}),
    ...(input.paymentTermDays !== undefined ? { payment_term_days: input.paymentTermDays } : {}),
    ...(input.creditLimit !== undefined ? { credit_limit: input.creditLimit } : {}),
  });

  return toProfile(doc);
}

interface SalesInvoiceListItem {
  name: string;
  posting_date: string;
  grand_total: number;
  status: string;
}

export async function getPurchaseHistory(
  customerId: string,
  limit: number,
): Promise<PurchaseHistoryEntry[]> {
  const invoices = await erpNextClient.list<SalesInvoiceListItem>('Sales Invoice', {
    filters: [
      ['customer', '=', customerId],
      ['docstatus', '=', 1],
    ],
    fields: ['name', 'posting_date', 'grand_total', 'status'],
    order_by: 'posting_date desc',
    limit_page_length: String(limit),
  });

  return invoices.map((invoice) => ({
    invoice: invoice.name,
    postingDate: invoice.posting_date,
    grandTotal: invoice.grand_total,
    status: invoice.status,
  }));
}
