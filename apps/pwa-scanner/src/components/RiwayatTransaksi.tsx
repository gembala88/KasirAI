import { useCallback, useEffect, useState } from 'react';
import { IconArrowLeft, IconPrinter } from '@tabler/icons-react';
import {
  fetchTransactionDetail,
  fetchTransactions,
  type TransactionDetail,
  type TransactionSummary,
} from '../lib/api';
import {
  formatQty,
  formatRupiah,
  formatTransactionDateTime,
  paymentStatusBadge,
} from '../lib/format';
import ReceiptPreview from './ReceiptPreview';

const PAGE_SIZE = 20;

/**
 * Riwayat Transaksi — every submitted sale, newest first (spec: date,
 * customer, total, payment method, status; tap for full detail +
 * reprint). Always-online, like Daftar Produk/Edit Price — this is a
 * server lookup of historical ERPNext data, not something the offline
 * catalog cache could ever serve.
 */
export default function RiwayatTransaksi() {
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  const loadPage = useCallback(async (nextOffset: number, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchTransactions(nextOffset, PAGE_SIZE);
      setTransactions((current) =>
        replace ? page.transactions : [...current, ...page.transactions],
      );
      setHasMore(page.hasMore);
      setOffset(nextOffset + page.transactions.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(0, true);
  }, [loadPage]);

  if (selected) {
    return <TransactionDetailView name={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <>
      <h2 className="section-label">Riwayat Transaksi</h2>

      {error && <p className="error-box">{error}</p>}

      {transactions.length === 0 && !loading ? (
        <p className="hint">Belum ada transaksi.</p>
      ) : (
        <ul className="product-list">
          {transactions.map((t) => {
            const badge = paymentStatusBadge(t.isPaid);
            return (
              <li key={t.name} className="product-list-row">
                <button
                  type="button"
                  className="transaction-row-button"
                  onClick={() => setSelected(t.name)}
                >
                  <div className="product-list-main">
                    <span className="product-list-name">{t.customerName}</span>
                    <span className="hint">
                      {t.name} · {formatTransactionDateTime(t.postingDate, t.postingTime)}
                    </span>
                    <span className="hint">
                      {t.payments.map((p) => p.modeOfPayment).join(', ') || '—'}
                    </span>
                  </div>
                  <div className="product-list-figures">
                    <span>{formatRupiah(t.grandTotal)}</span>
                    <span className={badge.className}>{badge.label}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <button type="button" onClick={() => void loadPage(offset, false)} disabled={loading}>
          {loading ? 'Memuat…' : 'Muat Lebih Banyak'}
        </button>
      )}
    </>
  );
}

function TransactionDetailView({ name, onBack }: { name: string; onBack: () => void }) {
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTransactionDetail(name)
      .then((value) => {
        if (!cancelled) setDetail(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <>
      <button type="button" className="link-button home-back" onClick={onBack}>
        <IconArrowLeft size={18} /> Kembali
      </button>
      <h2 className="section-label">Detail Transaksi</h2>

      {loading && <p className="hint">Memuat…</p>}
      {error && <p className="error-box">{error}</p>}

      {detail && (
        <>
          <div className="card">
            <span className="card-label">{detail.name}</span>
            <span className="hint">
              {formatTransactionDateTime(detail.postingDate, detail.postingTime)}
            </span>
            <span className="hint">Pelanggan: {detail.customerName}</span>
            <span className={paymentStatusBadge(detail.isPaid).className}>
              {paymentStatusBadge(detail.isPaid).label}
            </span>
          </div>

          <h3 className="section-label">Barang</h3>
          <ul>
            {detail.items.map((item) => (
              <li key={item.itemCode} className="cart-line cart-line--review">
                <span>
                  {item.itemName}{' '}
                  <span className="hint">
                    × {formatQty(item.qty)} {item.uom}
                  </span>
                </span>
                <span>{formatRupiah(item.amount)}</span>
              </li>
            ))}
          </ul>

          <div className="cart-total card">
            <span className="card-label">Total</span>
            <span className="card-value">{formatRupiah(detail.grandTotal)}</span>
          </div>

          {detail.payments.map((p, i) => (
            <div key={`${p.modeOfPayment}-${i}`} className="cart-line cart-line--review">
              <span>{p.modeOfPayment}</span>
              <span>{formatRupiah(p.amount)}</span>
            </div>
          ))}

          {showReceipt ? (
            <ReceiptPreview transactionName={detail.name} itemCount={detail.items.length} />
          ) : (
            <button type="button" onClick={() => setShowReceipt(true)}>
              <IconPrinter size={18} /> Cetak Ulang
            </button>
          )}
        </>
      )}
    </>
  );
}
