import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { buildApp } = await import('../src/main.js');
const { issueTokenPair } = await import('../src/modules/auth/infrastructure/jwt.js');

const app = await buildApp();
const { accessToken } = issueTokenPair({
  email: 'owner@hermes.local',
  fullName: 'Owner',
  role: 'Owner',
});

describe('POST /api/v1/sync/actions — add-stock rate validation (the real write boundary, not just the PWA form)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects rate: 0 before it ever reaches ERPNext — real bug: this used to pass and fail later with a raw 417 valuation error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/actions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        uuid: '55555555-5555-5555-5555-555555555555',
        contentHash: 'irrelevant-fails-before-hash-check',
        clientTimestamp: '2026-08-10T10:00:00.000Z',
        action: {
          type: 'add-stock',
          itemCode: 'Bawang putih',
          warehouse: 'Gudang Utama - TH',
          qty: 40,
          rate: 0,
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(erpNextClientMock.create).not.toHaveBeenCalled();
  });

  it('rejects a negative rate the same way', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/actions',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        uuid: '66666666-6666-6666-6666-666666666666',
        contentHash: 'irrelevant-fails-before-hash-check',
        clientTimestamp: '2026-08-10T10:00:00.000Z',
        action: { type: 'add-stock', itemCode: 'X', qty: 1, rate: -5 },
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
