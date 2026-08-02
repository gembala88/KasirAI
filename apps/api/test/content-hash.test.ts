import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../src/shared/content-hash/index.js';

describe('computeContentHash', () => {
  it('produces a deterministic hash regardless of key insertion order', () => {
    const a = computeContentHash({ itemCode: 'X', qty: 2, warehouse: 'WH' });
    const b = computeContentHash({ warehouse: 'WH', itemCode: 'X', qty: 2 });
    expect(a).toBe(b);
  });

  it('produces a different hash when the payload actually differs', () => {
    const a = computeContentHash({ itemCode: 'X', qty: 2 });
    const b = computeContentHash({ itemCode: 'X', qty: 3 });
    expect(a).not.toBe(b);
  });

  it('matches the known output of the client-side implementation (apps/pwa-scanner/src/lib/hash.ts) for an identical payload — the two must never drift, or every real sync request gets rejected as "corrupted"', () => {
    const payload = {
      type: 'add-stock',
      itemCode: 'DEMO-BERAS-5KG',
      warehouse: 'Gudang Utama - TH',
      qty: 5,
      rate: 65000,
    };
    expect(computeContentHash(payload)).toBe(
      'be1a8f50bf9f4cb3d5f55717df74ba76f9d4ac8d9c36c6e2950cecb05906e155',
    );
  });
});
