/**
 * Payment-detail hardening (§10 Phase 6 follow-up).
 *
 * Live testing found the model can answer a payment request by calling
 * the *wrong* action (e.g. get_order_status) and then inventing account
 * details in its freeform reply anyway — a stronger failure mode than a
 * wrong price, since the cost of acting on it is a customer sending money
 * to a wrong/nonexistent account. A better prompt example reduces how
 * often this happens but doesn't structurally prevent it, so this is
 * enforced the same way price/stock correctness already is: outside the
 * model's control entirely.
 *
 * Two rules, both enforced in conversation.ts, not in the prompt:
 *   1. Whenever this turn's action really was a *successful*
 *      initiate_payment, the reply the customer receives is always
 *      assembled here from the real result — the model's own reply text
 *      for that turn is never used for the payment-detail message, even
 *      if it happens to be correct.
 *   2. Any other reply is scanned for payment-detail-shaped content
 *      (account numbers, "transfer ke", "scan QRIS", etc.). If matched,
 *      it's blocked outright and replaced with a safe fallback — better
 *      to under-answer than to risk relaying fabricated payment info.
 */
import { env } from '../../../config/env.js';
import type { PaymentMethod } from '../domain/index.js';

export interface SuccessfulPaymentResult {
  invoiceName: string;
  grandTotal: number;
  method: PaymentMethod;
}

const PAYMENT_METHODS = new Set<PaymentMethod>(['qris', 'transfer', 'cod']);

export function isSuccessfulPaymentResult(data: unknown): data is SuccessfulPaymentResult {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const value = data as Record<string, unknown>;
  return (
    typeof value.invoiceName === 'string' &&
    typeof value.grandTotal === 'number' &&
    typeof value.method === 'string' &&
    PAYMENT_METHODS.has(value.method as PaymentMethod)
  );
}

/**
 * The one and only place payment-instruction text is composed — every
 * field it uses comes from a real ERPNext write (invoiceName, grandTotal)
 * or real server config (env), never from model output.
 */
export function buildPaymentInstructionReply(result: SuccessfulPaymentResult): string {
  const total = `Rp ${result.grandTotal.toLocaleString('id-ID')}`;

  switch (result.method) {
    case 'qris':
      if (!env.QRIS_STATIC_IMAGE_URL) {
        return `Maaf kak, pembayaran QRIS belum tersedia saat ini untuk pesanan ${result.invoiceName}. Coba pilih transfer bank atau COD ya 🙏`;
      }
      return `Total: ${total} — scan QRIS ini untuk bayar pesanan ${result.invoiceName}`;

    case 'transfer':
      if (!env.BANK_TRANSFER_BANK_NAME || !env.BANK_TRANSFER_ACCOUNT_NUMBER) {
        return `Maaf kak, pembayaran transfer bank belum tersedia saat ini untuk pesanan ${result.invoiceName}. Coba pilih QRIS atau COD ya 🙏`;
      }
      return `Total tagihan pesanan ${result.invoiceName}: ${total}\nTransfer ke:\n${env.BANK_TRANSFER_BANK_NAME} ${env.BANK_TRANSFER_ACCOUNT_NUMBER} a/n ${env.BANK_TRANSFER_ACCOUNT_NAME}\nKirim bukti transfer ya kak setelah selesai 🙏`;

    case 'cod':
      return `Oke kak, pesanan ${result.invoiceName} dibayar COD (cash saat barang sampai) ya. Total yang perlu disiapkan: ${total}. Terima kasih! 🙏`;
  }
}

/** Whether a QRIS image should be sent alongside `buildPaymentInstructionReply`'s text. */
export function shouldSendQrisImage(result: SuccessfulPaymentResult): boolean {
  return result.method === 'qris' && Boolean(env.QRIS_STATIC_IMAGE_URL);
}

/**
 * Heuristic, deliberately erring toward false positives: it's far
 * cheaper to occasionally block a legitimate reply (customer just gets a
 * "let me check" and can ask again) than to occasionally leak a
 * fabricated account number. Matches on the Indonesian payment-detail
 * vocabulary the persona prompt itself uses, plus a bare 6+ digit run
 * (account/VA-number shaped) that wouldn't normally appear in a
 * check_stock/get_order_status-style reply.
 */
const PAYMENT_KEYWORD_PATTERN =
  /nomor rekening|no\.? rekening|rekening (kami|bank)|virtual account|\bva\b.{0,10}\d|scan qris|kode qris|transfer ke|a\/n\s/i;
const LONG_DIGIT_RUN_PATTERN = /\d{6,}/;

export function containsUnverifiedPaymentDetails(replyText: string): boolean {
  return PAYMENT_KEYWORD_PATTERN.test(replyText) || LONG_DIGIT_RUN_PATTERN.test(replyText);
}

export const SAFE_PAYMENT_FALLBACK_REPLY =
  'Sebentar ya kak, saya pastikan dulu info pembayarannya biar akurat 🙏';
