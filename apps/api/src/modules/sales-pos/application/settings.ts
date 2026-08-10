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
