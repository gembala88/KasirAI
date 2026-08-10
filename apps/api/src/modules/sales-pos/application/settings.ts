/**
 * Receipt template selection (spec: 3 layout options selectable from a
 * Settings screen). Company's own `custom_receipt_template` custom field
 * (see scripts/seed-erpnext.ts) is the single source of truth — the same
 * value is visible/editable either from ERPNext directly or from Hermes'
 * own Settings screen, never two places that could drift out of sync.
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { ValidationError } from '../../../shared/errors/index.js';

export const RECEIPT_TEMPLATES = ['Minimal', 'Standard', 'Detailed'] as const;
export type ReceiptTemplate = (typeof RECEIPT_TEMPLATES)[number];

/** Print Format names, kept in lockstep with what scripts/seed-erpnext.ts actually creates. */
const TEMPLATE_PRINT_FORMAT: Record<ReceiptTemplate, string> = {
  Minimal: 'Hermes Struk Kasir - Minimal',
  Standard: 'Hermes Struk Kasir',
  Detailed: 'Hermes Struk Kasir - Detail',
};

interface CompanyTemplateDoc {
  custom_receipt_template?: string;
}

function isReceiptTemplate(value: string | undefined): value is ReceiptTemplate {
  return !!value && (RECEIPT_TEMPLATES as readonly string[]).includes(value);
}

/** Defaults to 'Standard' for a Company that's never had this field set (a fresh custom field starts blank, not at its declared default, until the doc is next saved). */
export async function getReceiptTemplate(): Promise<ReceiptTemplate> {
  const company = await erpNextClient.get<CompanyTemplateDoc>(
    'Company',
    env.ERPNEXT_DEFAULT_COMPANY,
  );
  return isReceiptTemplate(company.custom_receipt_template)
    ? company.custom_receipt_template
    : 'Standard';
}

export async function setReceiptTemplate(template: string): Promise<ReceiptTemplate> {
  if (!isReceiptTemplate(template)) {
    throw new ValidationError(`Template harus salah satu dari: ${RECEIPT_TEMPLATES.join(', ')}`);
  }
  await erpNextClient.update('Company', env.ERPNEXT_DEFAULT_COMPANY, {
    custom_receipt_template: template,
  });
  return template;
}

export function printFormatForTemplate(template: ReceiptTemplate): string {
  return TEMPLATE_PRINT_FORMAT[template];
}

/**
 * QRIS/Transfer confirmation screen (spec Group 2): the same static
 * payment config already used to build the WhatsApp channel's payment
 * instructions (see whatsapp/application/payment-reply.ts) — one store
 * QRIS code and one bank account, never two different ones depending on
 * which channel a sale came through. `null` (not an empty string) means
 * "not configured", so the cashier UI can show a clear fallback instead of
 * a broken image or blank bank details.
 */
export interface PaymentInfo {
  qris: { imageUrl: string | null };
  transfer: { bankName: string | null; accountNumber: string | null; accountName: string | null };
}

export function getPaymentInfo(): PaymentInfo {
  return {
    qris: { imageUrl: env.QRIS_STATIC_IMAGE_URL || null },
    transfer: {
      bankName: env.BANK_TRANSFER_BANK_NAME || null,
      accountNumber: env.BANK_TRANSFER_ACCOUNT_NUMBER || null,
      accountName: env.BANK_TRANSFER_ACCOUNT_NAME || null,
    },
  };
}
