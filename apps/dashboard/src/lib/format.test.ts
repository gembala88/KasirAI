import { describe, expect, it } from 'vitest';
import { formatRupiah } from './format';

describe('formatRupiah', () => {
  it('formats with Indonesian thousands separators', () => {
    expect(formatRupiah(600000)).toBe('Rp 600.000');
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatRupiah(1200000)).toBe('Rp 1.200.000');
  });
});
