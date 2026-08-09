import { describe, expect, it } from 'vitest';
import { formatQty } from './format';

describe('formatQty', () => {
  it('prints whole numbers plain, no decimal point', () => {
    expect(formatQty(1)).toBe('1');
    expect(formatQty(12)).toBe('12');
    expect(formatQty(0)).toBe('0');
  });

  it('prints decimal quantities with trailing zeros trimmed', () => {
    expect(formatQty(0.25)).toBe('0.25');
    expect(formatQty(0.5)).toBe('0.5');
    expect(formatQty(1.2)).toBe('1.2');
  });

  it('rounds to 2 decimal places, absorbing float-precision artifacts', () => {
    // A real artifact of merging cart lines: 0.1 + 0.2 !== 0.3 in JS.
    expect(formatQty(0.1 + 0.2)).toBe('0.3');
  });
});
