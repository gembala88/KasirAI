import { describe, expect, it } from 'vitest';
import { matchCatalog, type CatalogItem } from './catalog-cache';

// IndexedDB-backed functions (searchLocalCatalog, syncCatalog) aren't unit
// tested here, matching offline-queue.ts's existing convention — jsdom
// isn't configured for this project, so IndexedDB-dependent code is
// covered by live verification instead. matchCatalog is the pure part.

const CATALOG: CatalogItem[] = [
  { itemCode: 'BRG-001', itemName: 'Beras 5kg', stockUom: 'Pcs', retailPrice: 65000 },
  { itemCode: 'BRG-002', itemName: 'Minyak Goreng 1L', stockUom: 'Pcs', retailPrice: 18000 },
  { itemCode: 'GULA-KG', itemName: 'Gula Pasir', stockUom: 'Kg', retailPrice: 15000 },
];

describe('matchCatalog', () => {
  it('matches by item code, case-insensitively', () => {
    expect(matchCatalog(CATALOG, 'brg-001')).toEqual([CATALOG[0]]);
  });

  it('matches by item name substring, case-insensitively', () => {
    expect(matchCatalog(CATALOG, 'goreng')).toEqual([CATALOG[1]]);
  });

  it('matches multiple items sharing a substring', () => {
    expect(matchCatalog(CATALOG, 'BRG')).toEqual([CATALOG[0], CATALOG[1]]);
  });

  it('returns an empty array for an empty or whitespace-only query', () => {
    expect(matchCatalog(CATALOG, '')).toEqual([]);
    expect(matchCatalog(CATALOG, '   ')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(matchCatalog(CATALOG, 'nonexistent-item-xyz')).toEqual([]);
  });
});
