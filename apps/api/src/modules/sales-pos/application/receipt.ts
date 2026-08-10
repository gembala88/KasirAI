/**
 * Receipt/invoice rendering (spec §14) — deliberately does not construct
 * any receipt markup itself. Every piece of content on a receipt (store
 * name/address, item lines, totals, footer text) must come from ERPNext's
 * own Print Format designer (Setup > Printing > Print Format) via its
 * `/printview` route, so the owner can redesign the receipt later without
 * a code change — see the user's explicit ask that nothing here be
 * hardcoded.
 *
 * Which of the 3 Print Formats prints is resolved per request from the
 * Company's own `custom_receipt_template` selection (settings.ts) — not a
 * fixed choice — so changing it from the Settings screen takes effect on
 * the very next print with no redeploy.
 *
 * Hand-rolled fetch, not the shared `erpNextClient` (which only talks to
 * the JSON `/api/resource` REST surface) — `/printview` is a Frappe
 * website route that returns rendered HTML, a different shape entirely.
 *
 * Originally tried `frappe.utils.print_format.download_pdf` (a real PDF),
 * but that call fails in this ERPNext Docker image — `wkhtmltopdf` itself
 * errors with a network-refused failure, a real environment gap found
 * live, not a guess. `/printview`'s HTML avoids that dependency entirely
 * and lets the browser's own print dialog (Ctrl+P → “Save as PDF” or a
 * real printer) do the PDF/print conversion instead — confirmed live
 * against a real invoice, containing the real Company name pulled from
 * ERPNext, not any string in this codebase.
 */
import { env } from '../../../config/env.js';
import { AppError } from '../../../shared/errors/index.js';
import { getReceiptTemplate, printFormatForTemplate } from './settings.js';

export class ReceiptRenderError extends AppError {
  constructor(message: string) {
    super(message, 502, 'RECEIPT_RENDER_ERROR');
  }
}

/** Falls back to the static env default if the Company lookup itself fails — a receipt should still print with whatever format ERPNext defaults to, not hard-fail over a second-order setting. */
async function resolvePrintFormat(): Promise<string | undefined> {
  try {
    return printFormatForTemplate(await getReceiptTemplate());
  } catch {
    return env.ERPNEXT_RECEIPT_PRINT_FORMAT || undefined;
  }
}

export async function getReceiptHtml(invoiceName: string): Promise<string> {
  const query = new URLSearchParams({
    doctype: 'Sales Invoice',
    name: invoiceName,
    no_letterhead: '0',
  });
  const format = await resolvePrintFormat();
  if (format) {
    query.set('format', format);
  }

  let response: Response;
  try {
    response = await fetch(`${env.ERPNEXT_BASE_URL}/printview?${query.toString()}`, {
      headers: {
        Authorization: `token ${env.ERPNEXT_API_KEY}:${env.ERPNEXT_API_SECRET}`,
      },
    });
  } catch (cause) {
    throw new ReceiptRenderError(
      `Failed to reach ERPNext for receipt rendering: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!response.ok) {
    throw new ReceiptRenderError(`ERPNext printview returned HTTP ${response.status}`);
  }

  return response.text();
}
