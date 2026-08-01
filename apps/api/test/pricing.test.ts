import { describe, expect, it } from 'vitest';
import { resolvePriceList } from '../src/modules/sales-pos/application/pricing.js';

describe('resolvePriceList', () => {
  it.each([
    ['Retail', 'Retail'],
    ['Grosir', 'Grosir'],
    ['Member', 'Member'],
  ])('maps tier %s to Price List %s', (tier, expected) => {
    expect(resolvePriceList(tier)).toBe(expected);
  });

  it('defaults to Retail for an unknown tier', () => {
    expect(resolvePriceList('NotARealTier')).toBe('Retail');
  });

  it('defaults to Retail when tier is undefined', () => {
    expect(resolvePriceList(undefined)).toBe('Retail');
  });
});
