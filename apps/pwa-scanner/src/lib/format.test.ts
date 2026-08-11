import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatQty,
  formatTransactionDateTime,
  overdueBadge,
  paymentStatusBadge,
  statusBadge,
  stripHtmlTags,
} from './format';

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
  it('labels a not-yet-attempted queued sale "Menunggu Disimpan", not an alarming "Gagal"', () => {
    expect(statusBadge('Pending').label).toBe('Menunggu Disimpan');
  });

  it('labels a real, server-attempted rejection "Gagal"', () => {
    expect(statusBadge('Failed').label).toBe('Gagal');
  });
});

describe('formatDate', () => {
  it('reformats a plain ERPNext date ("YYYY-MM-DD") into "dd-MM-yyyy"', () => {
    expect(formatDate('2026-08-10')).toBe('10-08-2026');
  });
});

describe('overdueBadge', () => {
  it('labels an overdue Kasbon invoice "Jatuh Tempo" with the failed (red) style', () => {
    expect(overdueBadge(true)).toEqual({
      label: 'Jatuh Tempo',
      className: 'status-badge status-badge--failed',
    });
  });

  it('labels a not-yet-due Kasbon invoice "Belum Jatuh Tempo" with the pending (neutral) style', () => {
    expect(overdueBadge(false)).toEqual({
      label: 'Belum Jatuh Tempo',
      className: 'status-badge status-badge--pending',
    });
  });
});

describe('stripHtmlTags', () => {
  it('removes HTML tags ERPNext embeds in its own validation messages', () => {
    expect(
      stripHtmlTags(
        "ERPNext request failed: Baris 1: Kuantitas (2.75) tidak boleh pecahan. Untuk mengizinkan ini, nonaktifkan '<strong>Harus Nomor Utuh</strong>' di UOM <strong>Pcs</strong>.",
      ),
    ).toBe(
      "ERPNext request failed: Baris 1: Kuantitas (2.75) tidak boleh pecahan. Untuk mengizinkan ini, nonaktifkan 'Harus Nomor Utuh' di UOM Pcs.",
    );
  });

  it('leaves plain text with no markup unchanged', () => {
    expect(stripHtmlTags('Koneksi terputus, coba lagi.')).toBe('Koneksi terputus, coba lagi.');
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
