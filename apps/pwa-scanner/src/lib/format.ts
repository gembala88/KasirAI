export function formatRupiah(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Whole numbers print plain ("2"); weight-sold quantities keep up to 2 decimals, trailing zeros trimmed ("0.25", not "0.250" or "0.25000000000000004"). */
export function formatQty(qty: number): string {
  if (Number.isInteger(qty)) {
    return String(qty);
  }
  return qty.toFixed(2).replace(/\.?0+$/, '');
}

const STATUS_LABELS: Record<string, string> = {
  Pending: 'Menunggu',
  Processing: 'Memproses',
  Failed: 'Gagal',
  Retry: 'Mencoba Lagi',
  Conflict: 'Konflik',
  Synced: 'Tersinkron',
};

const STATUS_CLASS: Record<string, string> = {
  Pending: 'status-badge--pending',
  Processing: 'status-badge--processing',
  Failed: 'status-badge--failed',
  Retry: 'status-badge--pending',
  Conflict: 'status-badge--conflict',
  Synced: 'status-badge--synced',
};

/** One color per sync-status meaning, shared across every offline-queue list (design system, UI polish pass). */
export function statusBadge(status: string): { label: string; className: string } {
  return {
    label: STATUS_LABELS[status] ?? status,
    className: `status-badge ${STATUS_CLASS[status] ?? 'status-badge--pending'}`,
  };
}

/** Catalog-sync freshness indicator (spec §15.3) — "HH:mm" for today, "dd/MM HH:mm" otherwise, so a shift spanning midnight still reads unambiguously. */
export function formatSyncedAt(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  return date.toLocaleString('id-ID', {
    day: isToday ? undefined : '2-digit',
    month: isToday ? undefined : '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Riwayat Transaksi's date+time column — ERPNext's own "dd-MM-yyyy" receipt convention, plus HH:mm from postingTime (a "HH:MM:SS[.ffffff]" string). */
export function formatTransactionDateTime(postingDate: string, postingTime: string): string {
  const [datePart] = postingDate.split(' ');
  const [year, month, day] = (datePart ?? postingDate).split('-');
  const [hour, minute] = postingTime.split(':');
  return `${day}-${month}-${year} ${hour}:${minute}`;
}

/** Lunas/Belum Lunas badge — same color convention as statusBadge, but keyed off a plain boolean since payment status isn't one of the sync-queue's status strings. */
export function paymentStatusBadge(isPaid: boolean): { label: string; className: string } {
  return isPaid
    ? { label: 'Lunas', className: 'status-badge status-badge--synced' }
    : { label: 'Belum Lunas', className: 'status-badge status-badge--conflict' };
}
