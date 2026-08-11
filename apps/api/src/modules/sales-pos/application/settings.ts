/**
 * Receipt template selection (spec: 3 layout options selectable from a
 * Settings screen). Company's own `custom_receipt_template` custom field
 * (see scripts/seed-erpnext.ts) is the single source of truth — the same
 * value is visible/editable either from ERPNext directly or from Hermes'
 * own Settings screen, never two places that could drift out of sync.
 */
import { env } from '../../../config/env.js';
import { erpNextClient } from '../../../shared/erpnext-client/index.js';
import { AppError, ValidationError } from '../../../shared/errors/index.js';

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

export class LogoUploadError extends AppError {
  constructor(message: string) {
    super(message, 502, 'LOGO_UPLOAD_ERROR');
  }
}

/**
 * Store profile — the receipt-header fields (spec: owner should be able to
 * edit these from within the app, not just ERPNext directly). Deliberately
 * excludes `company_name`: it's both the Company's display name *and* its
 * ERPNext document ID, and `env.ERPNEXT_DEFAULT_COMPANY` is a hardcoded
 * reference to that ID — editing company_name would very likely trigger an
 * ERPNext document rename and silently break that reference everywhere in
 * Hermes. Renaming a Company is an ERPNext-side action on purpose.
 */
export interface StoreProfile {
  companyName: string;
  phone: string;
  address: string;
  logoUrl: string | null;
}

interface CompanyProfileDoc {
  company_name: string;
  phone_no?: string;
  custom_store_address?: string;
  company_logo?: string;
}

export async function getStoreProfile(): Promise<StoreProfile> {
  const company = await erpNextClient.get<CompanyProfileDoc>(
    'Company',
    env.ERPNEXT_DEFAULT_COMPANY,
  );
  return {
    companyName: company.company_name,
    phone: company.phone_no ?? '',
    address: company.custom_store_address ?? '',
    logoUrl: company.company_logo ?? null,
  };
}

export async function updateStoreProfile(input: {
  phone: string;
  address: string;
}): Promise<StoreProfile> {
  await erpNextClient.update('Company', env.ERPNEXT_DEFAULT_COMPANY, {
    phone_no: input.phone,
    custom_store_address: input.address,
  });
  return getStoreProfile();
}

interface FrappeUploadResponse {
  message?: { file_url?: string };
}

/**
 * Real file upload (not a pasted URL) — Frappe's own upload endpoint,
 * attached directly to the Company doc's `company_logo` field. Hand-rolled
 * fetch, same reasoning as receipt.ts: this is multipart/form-data against
 * a Frappe method route, a different shape than the shared erpNextClient's
 * JSON `/api/resource` surface.
 */
export async function uploadCompanyLogo(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<StoreProfile> {
  const form = new FormData();
  form.append('is_private', '0');
  form.append('doctype', 'Company');
  form.append('docname', env.ERPNEXT_DEFAULT_COMPANY);
  form.append('fieldname', 'company_logo');
  form.append('file', new Blob([fileBuffer], { type: mimeType }), filename);

  let response: Response;
  try {
    response = await fetch(`${env.ERPNEXT_BASE_URL}/api/method/upload_file`, {
      method: 'POST',
      headers: { Authorization: `token ${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}` },
      body: form,
    });
  } catch (cause) {
    throw new LogoUploadError(
      `Failed to reach ERPNext for logo upload: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!response.ok) {
    throw new LogoUploadError(`ERPNext upload_file returned HTTP ${response.status}`);
  }

  const json = (await response.json()) as FrappeUploadResponse;
  const fileUrl = json.message?.file_url;
  if (!fileUrl) {
    throw new LogoUploadError('ERPNext upload_file response had no file_url');
  }

  // upload_file with doctype/docname/fieldname already attaches the file to
  // that field server-side — this update is a deliberate belt-and-suspenders
  // confirmation, not a workaround for a known gap, so a future ERPNext
  // version change there can't silently leave company_logo unset.
  await erpNextClient.update('Company', env.ERPNEXT_DEFAULT_COMPANY, {
    company_logo: fileUrl,
  });
  return getStoreProfile();
}

/**
 * Receipt customization (header/footer text, logo) — separate from
 * StoreProfile above: these three are receipt-content fields, not general
 * store info, and `custom_receipt_logo_url` is deliberately NOT the same as
 * StoreProfile's `logoUrl` (Company's native `company_logo` attach field).
 * Real bug found live: `company_logo` stores a path relative to ERPNext
 * (`/files/...` or `/private/files/...`), but the printed receipt HTML is
 * rendered into an iframe on Hermes' own origin — a relative path there
 * resolves against the wrong origin and 404s, and a private file needs an
 * ERPNext session the iframe never has either way. custom_receipt_logo_url
 * requires a real absolute URL instead, so it always resolves correctly
 * regardless of where the receipt is displayed or printed from.
 */
export interface ReceiptCustomization {
  headerText: string;
  footerText: string;
  logoUrl: string;
}

interface CompanyReceiptCustomizationDoc {
  custom_receipt_header?: string;
  custom_receipt_footer?: string;
  custom_receipt_logo_url?: string;
}

export async function getReceiptCustomization(): Promise<ReceiptCustomization> {
  const company = await erpNextClient.get<CompanyReceiptCustomizationDoc>(
    'Company',
    env.ERPNEXT_DEFAULT_COMPANY,
  );
  return {
    headerText: company.custom_receipt_header ?? '',
    footerText: company.custom_receipt_footer ?? '',
    logoUrl: company.custom_receipt_logo_url ?? '',
  };
}

export async function updateReceiptCustomization(input: {
  headerText: string;
  footerText: string;
  logoUrl: string;
}): Promise<ReceiptCustomization> {
  if (input.logoUrl && !/^https?:\/\//i.test(input.logoUrl)) {
    throw new ValidationError(
      'Logo URL harus berupa alamat lengkap (dimulai dengan http:// atau https://)',
    );
  }
  await erpNextClient.update('Company', env.ERPNEXT_DEFAULT_COMPANY, {
    custom_receipt_header: input.headerText,
    custom_receipt_footer: input.footerText,
    custom_receipt_logo_url: input.logoUrl,
  });
  return getReceiptCustomization();
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
