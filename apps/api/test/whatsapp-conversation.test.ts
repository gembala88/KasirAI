import { beforeEach, describe, expect, it, vi } from 'vitest';

const runAiQueryMock = vi.fn();
vi.mock('../src/modules/ai-gateway/interfaces/index.js', () => ({
  runAiQuery: runAiQueryMock,
}));

const executeConversationActionMock = vi.fn();
vi.mock('../src/modules/whatsapp/application/actions.js', () => ({
  executeConversationAction: executeConversationActionMock,
}));

const sendTextMessageMock = vi.fn().mockResolvedValue(undefined);
const sendImageMessageMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../src/modules/whatsapp/infrastructure/whatsapp-client.js', () => ({
  sendTextMessage: sendTextMessageMock,
  sendImageMessage: sendImageMessageMock,
}));

const { handleInboundMessage } = await import('../src/modules/whatsapp/application/conversation.js');
const { env } = await import('../src/config/env.js');

const PHONE_BASE = `62899${Date.now()}`;

function aiTextResponse(payload: unknown) {
  return { text: JSON.stringify(payload) };
}

beforeEach(() => {
  // mockReset (not just clearAllMocks) — clearAllMocks only wipes call
  // history, not queued mockResolvedValueOnce responses, so a test that
  // queues more "once" responses than the code path under test actually
  // consumes leaks them into the next test. Every test below sets its
  // own resolved values fresh, so a full reset is safe here.
  runAiQueryMock.mockReset();
  executeConversationActionMock.mockReset();
  sendTextMessageMock.mockReset().mockResolvedValue(undefined);
  sendImageMessageMock.mockReset().mockResolvedValue(undefined);
});

describe('handleInboundMessage — payment-detail hardening', () => {
  it('reproduces and blocks the live Phase 6 failure: model picks the wrong action, then fabricates payment details in its own reply', async () => {
    // Turn A: the model picks get_order_status instead of initiate_payment
    // for a payment request — exactly what happened live.
    runAiQueryMock
      .mockResolvedValueOnce(
        aiTextResponse({
          reply: 'sebentar ya kak, saya cek dulu 🙏',
          action: { type: 'get_order_status', orderName: 'SAL-ORD-X' },
        }),
      )
      // Turn B: system_data is a plain order-status object with no
      // payment info at all — but the model invents an account number
      // anyway.
      .mockResolvedValueOnce(
        aiTextResponse({
          reply: 'Nomor rekening kami untuk transfer adalah 9999888877, silakan transfer ke situ ya kak',
          action: null,
        }),
      );
    executeConversationActionMock.mockResolvedValue({
      name: 'SAL-ORD-X',
      customer: 'CUST-1',
      status: 'To Deliver and Bill',
      grandTotal: 60000,
      deliveryDate: '2026-08-10',
    });

    const phone = `${PHONE_BASE}-blocked`;
    await handleInboundMessage(phone, 'pesanan SAL-ORD-X aku mau transfer dong');

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    expect(sendImageMessageMock).not.toHaveBeenCalled();
    const [, sentText] = sendTextMessageMock.mock.calls[0] as [string, string];
    expect(sentText).not.toContain('9999888877');
    expect(sentText).not.toMatch(/rekening/i);
  });

  it('never sends fabricated payment content as the very first turn either (action: null case)', async () => {
    runAiQueryMock.mockResolvedValueOnce(
      aiTextResponse({
        reply: 'Nomor rekening kami adalah 5551112223 kak, transfer ke situ ya',
        action: null,
      }),
    );

    const phone = `${PHONE_BASE}-blocked-turn-a`;
    await handleInboundMessage(phone, 'halo, ada rekening buat transfer ga?');

    expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
    const [, sentText] = sendTextMessageMock.mock.calls[0] as [string, string];
    expect(sentText).not.toContain('5551112223');
    expect(executeConversationActionMock).not.toHaveBeenCalled();
  });

  it('sends the deterministic template — not the model\'s freeform text — when initiate_payment really succeeds', async () => {
    const originalBankName = env.BANK_TRANSFER_BANK_NAME;
    const originalBankAccount = env.BANK_TRANSFER_ACCOUNT_NUMBER;
    env.BANK_TRANSFER_BANK_NAME = 'BCA';
    env.BANK_TRANSFER_ACCOUNT_NUMBER = '1112223334';

    try {
      // A successful initiate_payment never runs a second AI turn at all
      // (conversation.ts short-circuits straight to the template) — so
      // there is no "turn B text" to fabricate here in the first place;
      // this is exactly the structural guarantee being tested. Turn A's
      // own "sebentar ya" placeholder reply must also never be what gets
      // sent — only the template.
      runAiQueryMock.mockResolvedValueOnce(
        aiTextResponse({
          reply: 'sebentar ya kak 🙏',
          action: { type: 'initiate_payment', orderName: 'SAL-ORD-Y', method: 'transfer' },
        }),
      );
      executeConversationActionMock.mockResolvedValue({
        invoiceName: 'SINV-REAL-1',
        grandTotal: 60000,
        method: 'transfer',
      });

      const phone = `${PHONE_BASE}-real`;
      await handleInboundMessage(phone, 'pesanan SAL-ORD-Y transfer dong');

      expect(runAiQueryMock).toHaveBeenCalledTimes(1);
      expect(sendTextMessageMock).toHaveBeenCalledTimes(1);
      const [, sentText] = sendTextMessageMock.mock.calls[0] as [string, string];
      expect(sentText).not.toBe('sebentar ya kak 🙏');
      expect(sentText).toContain('SINV-REAL-1');
      expect(sentText).toContain('1112223334');
      expect(sentText).toContain('BCA');
    } finally {
      env.BANK_TRANSFER_BANK_NAME = originalBankName;
      env.BANK_TRANSFER_ACCOUNT_NUMBER = originalBankAccount;
    }
  });

  it('sends the QRIS image (not text) when a successful qris initiate_payment has an image URL configured', async () => {
    const originalQrisUrl = env.QRIS_STATIC_IMAGE_URL;
    env.QRIS_STATIC_IMAGE_URL = 'https://example.test/qris.png';

    try {
      runAiQueryMock.mockResolvedValueOnce(
        aiTextResponse({
          reply: 'sebentar ya 🙏',
          action: { type: 'initiate_payment', orderName: 'SAL-ORD-Z', method: 'qris' },
        }),
      );
      executeConversationActionMock.mockResolvedValue({
        invoiceName: 'SINV-REAL-2',
        grandTotal: 45000,
        method: 'qris',
      });

      const phone = `${PHONE_BASE}-qris`;
      await handleInboundMessage(phone, 'pesanan SAL-ORD-Z bayar QRIS');

      expect(sendImageMessageMock).toHaveBeenCalledTimes(1);
      expect(sendTextMessageMock).not.toHaveBeenCalled();
      const [, imageUrl, caption] = sendImageMessageMock.mock.calls[0] as [string, string, string];
      expect(imageUrl).toBe('https://example.test/qris.png');
      expect(caption).toContain('SINV-REAL-2');
    } finally {
      env.QRIS_STATIC_IMAGE_URL = originalQrisUrl;
    }
  });

  it('does not block an ordinary reply that happens to mention a short number', async () => {
    runAiQueryMock.mockResolvedValueOnce(
      aiTextResponse({
        reply: 'Stoknya masih ada 12 kak, mau berapa?',
        action: null,
      }),
    );

    const phone = `${PHONE_BASE}-ordinary`;
    await handleInboundMessage(phone, 'ada minyak goreng ga?');

    expect(sendTextMessageMock).toHaveBeenCalledWith(phone, 'Stoknya masih ada 12 kak, mau berapa?');
  });
});
