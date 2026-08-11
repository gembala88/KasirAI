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
const {
  getReceiptTemplate,
  setReceiptTemplate,
  printFormatForTemplate,
  getPaymentInfo,
  getStoreProfile,
  updateStoreProfile,
  getReceiptCustomization,
  updateReceiptCustomization,
} = await import('../src/modules/sales-pos/application/settings.js');

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

describe('getStoreProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads company_name/phone_no/custom_store_address/company_logo from the Company doc', async () => {
    erpNextClientMock.get.mockResolvedValue({
      company_name: 'Toko New Pelangi Group',
      phone_no: '0812-3456-666',
      custom_store_address: 'Jl. Contoh No. 1',
      company_logo: '/files/logo.png',
    });

    const profile = await getStoreProfile();

    expect(profile).toEqual({
      companyName: 'Toko New Pelangi Group',
      phone: '0812-3456-666',
      address: 'Jl. Contoh No. 1',
      logoUrl: '/files/logo.png',
    });
  });

  it('falls back to empty string/null for fields never set, rather than undefined leaking into the response', async () => {
    erpNextClientMock.get.mockResolvedValue({ company_name: 'Toko New Pelangi Group' });

    const profile = await getStoreProfile();

    expect(profile).toEqual({
      companyName: 'Toko New Pelangi Group',
      phone: '',
      address: '',
      logoUrl: null,
    });
  });
});

describe('updateStoreProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes only phone_no and custom_store_address — never company_name, which would rename the ERPNext document', async () => {
    erpNextClientMock.get.mockResolvedValue({
      company_name: 'Toko New Pelangi Group',
      phone_no: '0812-0000-000',
      custom_store_address: 'Alamat baru',
    });

    await updateStoreProfile({ phone: '0812-0000-000', address: 'Alamat baru' });

    expect(erpNextClientMock.update).toHaveBeenCalledWith('Company', expect.any(String), {
      phone_no: '0812-0000-000',
      custom_store_address: 'Alamat baru',
    });
    const updateCall = erpNextClientMock.update.mock.calls[0];
    expect(updateCall?.[2]).not.toHaveProperty('company_name');
  });
});

describe('getReceiptCustomization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads custom_receipt_header/footer/logo_url/store_tagline from the Company doc', async () => {
    erpNextClientMock.get.mockResolvedValue({
      custom_receipt_header: 'Toko Sembako Terpercaya',
      custom_receipt_footer: 'Barang yang sudah dibeli tidak dapat dikembalikan.',
      custom_receipt_logo_url: 'https://example.com/logo.png',
      custom_store_tagline: 'Sembako & Kebutuhan Harian',
    });

    const result = await getReceiptCustomization();

    expect(result).toEqual({
      headerText: 'Toko Sembako Terpercaya',
      footerText: 'Barang yang sudah dibeli tidak dapat dikembalikan.',
      logoUrl: 'https://example.com/logo.png',
      tagline: 'Sembako & Kebutuhan Harian',
    });
  });

  it('falls back to empty strings for fields never set', async () => {
    erpNextClientMock.get.mockResolvedValue({});

    expect(await getReceiptCustomization()).toEqual({
      headerText: '',
      footerText: '',
      logoUrl: '',
      tagline: '',
    });
  });
});

describe('updateReceiptCustomization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes header/footer/logo_url/store_tagline to the Company doc', async () => {
    erpNextClientMock.get.mockResolvedValue({
      custom_receipt_header: 'Header baru',
      custom_receipt_footer: 'Footer baru',
      custom_receipt_logo_url: 'https://example.com/new-logo.png',
      custom_store_tagline: 'Tagline baru',
    });

    await updateReceiptCustomization({
      headerText: 'Header baru',
      footerText: 'Footer baru',
      logoUrl: 'https://example.com/new-logo.png',
      tagline: 'Tagline baru',
    });

    expect(erpNextClientMock.update).toHaveBeenCalledWith('Company', expect.any(String), {
      custom_receipt_header: 'Header baru',
      custom_receipt_footer: 'Footer baru',
      custom_receipt_logo_url: 'https://example.com/new-logo.png',
      custom_store_tagline: 'Tagline baru',
    });
  });

  it('accepts an empty logoUrl (clearing it) without requiring http(s)', async () => {
    erpNextClientMock.get.mockResolvedValue({});

    await expect(
      updateReceiptCustomization({ headerText: '', footerText: '', logoUrl: '', tagline: '' }),
    ).resolves.not.toThrow();
  });

  it("rejects a logoUrl that is not a full http(s) URL — real bug this guards against: a relative ERPNext file path (e.g. /files/logo.png) resolves against Hermes' own origin inside the receipt iframe, not ERPNext's, and silently 404s", async () => {
    await expect(
      updateReceiptCustomization({
        headerText: '',
        footerText: '',
        logoUrl: '/files/logo.png',
        tagline: '',
      }),
    ).rejects.toThrow();
    expect(erpNextClientMock.update).not.toHaveBeenCalled();
  });
});
