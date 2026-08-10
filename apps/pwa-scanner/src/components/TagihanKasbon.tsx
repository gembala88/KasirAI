import { useCallback, useEffect, useState } from 'react';
import { confirmKasbonPaid, fetchKasbonInvoices, type KasbonInvoice } from '../lib/api';
import { formatDate, formatRupiah, overdueBadge } from '../lib/format';
import ReceiptPreview from './ReceiptPreview';

/**
 * "Tagihan Kasbon" (spec Group 3) — every outstanding invoice across
 * every customer, with a "Konfirmasi Lunas" per row. Always-online, like
 * Riwayat Transaksi/Daftar Produk — this is a live ERPNext ledger read,
 * not something the offline catalog cache could ever serve.
 */
export default function TagihanKasbon() {
  const [invoices, setInvoices] = useState<KasbonInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingInvoice, setConfirmingInvoice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Kept separate from `invoices` deliberately: once a payment is
  // confirmed, the just-paid invoice drops out of the (outstanding-only)
  // list on the next reload — but the receipt option should still be
  // shown right where the cashier is looking, not vanish the instant the
  // list refreshes out from under it.
  const [receiptFor, setReceiptFor] = useState<string | null>(null);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { invoices: fetched } = await fetchKasbonInvoices();
      setInvoices(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  async function handleConfirmPaid(invoiceName: string): Promise<void> {
    setConfirmingInvoice(invoiceName);
    setError(null);
    setMessage(null);
    try {
      await confirmKasbonPaid(invoiceName);
      setMessage(`${invoiceName} ditandai Lunas.`);
      setReceiptFor(invoiceName);
      await loadInvoices();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingInvoice(null);
    }
  }

  return (
    <>
      <h2 className="section-label">Tagihan Kasbon</h2>

      {loading && <p className="hint">Memuat…</p>}
      {error && <p className="error-box">{error}</p>}
      {message && <p className="message">{message}</p>}

      {receiptFor && (
        <div className="card kasbon-receipt">
          <span className="card-label">Struk {receiptFor}</span>
          <ReceiptPreview transactionName={receiptFor} />
          <button type="button" className="link-button" onClick={() => setReceiptFor(null)}>
            Tutup Struk
          </button>
        </div>
      )}

      {!loading && invoices.length === 0 ? (
        <p className="hint">Tidak ada tagihan Kasbon yang belum lunas.</p>
      ) : (
        <ul className="product-list">
          {invoices.map((invoice) => {
            const badge = overdueBadge(invoice.overdue);
            return (
              <li key={invoice.invoice} className="product-list-row kasbon-row">
                <div className="kasbon-row-summary">
                  <div className="product-list-main">
                    <span className="product-list-name">{invoice.customerName}</span>
                    <span className="hint">
                      {invoice.invoice} · Jatuh tempo {formatDate(invoice.dueDate)}
                    </span>
                  </div>
                  <div className="product-list-figures">
                    <span>{formatRupiah(invoice.outstandingAmount)}</span>
                    <span className={badge.className}>{badge.label}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="kasbon-confirm-button"
                  disabled={confirmingInvoice === invoice.invoice}
                  onClick={() => void handleConfirmPaid(invoice.invoice)}
                >
                  {confirmingInvoice === invoice.invoice ? 'Memproses…' : 'Konfirmasi Lunas'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
