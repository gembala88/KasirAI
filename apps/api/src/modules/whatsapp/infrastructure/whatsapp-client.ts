/**
 * WhatsApp Business Cloud API client (spec §6 "POST /whatsapp/send-message").
 * Plain fetch, no retry/circuit-breaker — a much smaller, less critical
 * surface than ERPNext (a failed send just means the reply doesn't go
 * out; there's no partial-write risk to guard against), so the added
 * complexity isn't warranted the way it was for shared/erpnext-client.
 */
import { env } from '../../../config/env.js';
import { AppError } from '../../../shared/errors/index.js';

export class WhatsAppApiError extends AppError {
  constructor(message: string) {
    super(message, 502, 'WHATSAPP_API_ERROR');
  }
}

function graphApiUrl(): string {
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

async function postToGraphApi(body: Record<string, unknown>): Promise<void> {
  let response: Response;
  try {
    response = await fetch(graphApiUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
  } catch (cause) {
    throw new WhatsAppApiError(
      `WhatsApp send failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new WhatsAppApiError(`WhatsApp API HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
}

export async function sendTextMessage(to: string, body: string): Promise<void> {
  await postToGraphApi({ to, type: 'text', text: { body } });
}

export async function sendImageMessage(
  to: string,
  imageUrl: string,
  caption?: string,
): Promise<void> {
  await postToGraphApi({
    to,
    type: 'image',
    image: { link: imageUrl, ...(caption ? { caption } : {}) },
  });
}
