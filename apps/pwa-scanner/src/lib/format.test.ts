import { describe, expect, it } from 'vitest';
import { formatQty, formatTransactionDateTime, paymentStatusBadge, statusBadge } from './format';

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

describe('formatTransactionDateTime', () => {
  it("reformats ERPNext's posting_date/posting_time into dd-MM-yyyy HH:mm", () => {
    expect(formatTransactionDateTime('2026-08-10', '14:05:47.304975')).toBe('10-08-2026 14:05');
  });

  it('handles a posting_date that includes a time component too', () => {
    expect(formatTransactionDateTime('2026-08-10 00:00:00', '09:03:00')).toBe('10-08-2026 09:03');
  });
});

describe('statusBadge', () => {
  it('labels a not-yet-attempted queued sale "Menunggu Sinkron", not an alarming "Gagal"', () => {
    expect(statusBadge('Pending').label).toBe('Menunggu Sinkron');
  });

  it('labels a real, server-attempted rejection "Gagal"', () => {
    expect(statusBadge('Failed').label).toBe('Gagal');
  });
});

describe('paymentStatusBadge', () => {
  it('labels a paid transaction "Lunas" with the synced (green) style', () => {
    expect(paymentStatusBadge(true)).toEqual({
      label: 'Lunas',
      className: 'status-badge status-badge--synced',
    });
  });

  it('labels an unpaid transaction "Belum Lunas" with the conflict (red) style', () => {
    expect(paymentStatusBadge(false)).toEqual({
      label: 'Belum Lunas',
      className: 'status-badge status-badge--conflict',
    });
  });
});
