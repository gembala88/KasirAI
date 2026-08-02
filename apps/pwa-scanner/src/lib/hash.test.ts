import { describe, expect, it } from 'vitest';
import { computeContentHash } from './hash';

describe('computeContentHash', () => {
  it('produces a deterministic hash regardless of key insertion order', async () => {
    const a = await computeContentHash({ itemCode: 'X', qty: 2, warehouse: 'WH' });
    const b = await computeContentHash({ warehouse: 'WH', itemCode: 'X', qty: 2 });
    expect(a).toBe(b);
  });

  it('produces a different hash when the payload actually differs', async () => {
    const a = await computeContentHash({ itemCode: 'X', qty: 2 });
    const b = await computeContentHash({ itemCode: 'X', qty: 3 });
    expect(a).not.toBe(b);
  });

  it('matches the known output of the server-side implementation (shared/content-hash) for an identical payload', async () => {
    // Cross-checked live against apps/api/src/shared/content-hash/index.ts
    // for this exact payload — see the Phase-9-prep offline-resilience
    // verification. If this ever fails, the two implementations have
    // drifted and every sync request will be rejected as "corrupted".
    const payload = {
      type: 'add-stock',
      itemCode: 'DEMO-BERAS-5KG',
      warehouse: 'Gudang Utama - TH',
      qty: 5,
      rate: 65000,
    };
    const hash = await computeContentHash(payload);
    expect(hash).toBe('be1a8f50bf9f4cb3d5f55717df74ba76f9d4ac8d9c36c6e2950cecb05906e155');
  });
});
