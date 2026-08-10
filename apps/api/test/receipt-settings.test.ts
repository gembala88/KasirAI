import { beforeEach, describe, expect, it, vi } from 'vitest';

const erpNextClientMock = {
  get: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../src/shared/erpnext-client/index.js', () => ({
  erpNextClient: erpNextClientMock,
}));

const { env } = await import('../src/config/env.js');
const { getReceiptTemplate, setReceiptTemplate, printFormatForTemplate, getPaymentInfo } =
  await import('../src/modules/sales-pos/application/settings.js');

describe('getReceiptTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the Company doc’s current selection', async () => {
    erpNextClientMock.get.mockResolvedValue({ custom_receipt_template: 'Minimal' });
    expect(await getReceiptTemplate()).toBe('Minimal');
  });

  it('defaults to Standard when the field is blank (never saved since the custom field was added)', async () => {
    erpNextClientMock.get.mockResolvedValue({ custom_receipt_template: '' });
    expect(await getReceiptTemplate()).toBe('Standard');
  });

  it('defaults to Standard on an unrecognized value rather than trusting unvalidated ERPNext data', async () => {
    erpNextClientMock.get.mockResolvedValue({ custom_receipt_template: 'Garbage' });
    expect(await getReceiptTemplate()).toBe('Standard');
  });
});

describe('setReceiptTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes a valid template to the Company doc', async () => {
    await setReceiptTemplate('Detailed');
    expect(erpNextClientMock.update).toHaveBeenCalledWith('Company', expect.any(String), {
      custom_receipt_template: 'Detailed',
    });
  });

  it('rejects an invalid template before writing anything', async () => {
    await expect(setReceiptTemplate('Fancy')).rejects.toThrow();
    expect(erpNextClientMock.update).not.toHaveBeenCalled();
  });
});

describe('printFormatForTemplate', () => {
  it('maps each template to the exact Print Format name scripts/seed-erpnext.ts creates', () => {
    expect(printFormatForTemplate('Minimal')).toBe('Hermes Struk Kasir - Minimal');
    expect(printFormatForTemplate('Standard')).toBe('Hermes Struk Kasir');
    expect(printFormatForTemplate('Detailed')).toBe('Hermes Struk Kasir - Detail');
  });
});

describe('getPaymentInfo', () => {
  it('maps each field from its own distinct env var, never mixing QRIS and transfer config', () => {
    const info = getPaymentInfo();
    expect(info.qris.imageUrl).toBe(env.QRIS_STATIC_IMAGE_URL || null);
    expect(info.transfer.bankName).toBe(env.BANK_TRANSFER_BANK_NAME || null);
    expect(info.transfer.accountNumber).toBe(env.BANK_TRANSFER_ACCOUNT_NUMBER || null);
    expect(info.transfer.accountName).toBe(env.BANK_TRANSFER_ACCOUNT_NAME || null);
  });

  it('reports an unset (empty-string) field as null, not an empty string', () => {
    // Real config on this project's own VPS today: QRIS_STATIC_IMAGE_URL is
    // unset — the cashier UI must be able to tell "not configured" apart
    // from "configured to an empty string" (which zod's .default('') can't
    // distinguish on its own).
    if (env.QRIS_STATIC_IMAGE_URL === '') {
      expect(getPaymentInfo().qris.imageUrl).toBeNull();
    }
  });
});
