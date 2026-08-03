import { useCallback, useEffect, useState } from 'react';
import { IconArrowLeft, IconBuildingBank, IconCash, IconQrcode } from '@tabler/icons-react';
import { openReceipt, searchProducts, type PosTransaction, type ProductSearchResult } from '../lib/api';
import { formatRupiah, statusBadge } from '../lib/format';
import { listQueuedActions, type QueuedAction } from '../lib/offline-queue';
import { submitOrQueue, syncPendingQueue } from '../lib/sync';
import type { PosSaleAction } from '../lib/types';

interface CartLine {
  itemCode: string;
  itemName: string;
  qty: number;
  rate: number;
}

const PAYMENT_METHODS = [
  { id: 'Cash', label: 'Tunai', icon: <IconCash size={24} /> },
  { id: 'QRIS', label: 'QRIS', icon: <IconQrcode size={24} /> },
  { id: 'Transfer', label: 'Transfer', icon: <IconBuildingBank size={24} /> },
] as const;
const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'] as const;

/**
 * Cashier checkout screen (spec §1.3 "POS screen (cashier): optimized for
 * speed — barcode scan auto-adds to cart, numeric keypad always visible,
 * big 'Bayar' button, customer tier shown clearly"). Cart merge happens
 * here too, not just server-side in createTransaction — so scanning the
 * same item twice visibly increments the existing row immediately rather
 * than waiting on a round trip to notice.
 */
export default function Kasir() {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pendingQty, setPendingQty] = useState('1');
  const [customerId, setCustomerId] = useState('');
  const [stage, setStage] = useState<'cart' | 'payment'>('cart');
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]['id']>('Cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [printReceipt, setPrintReceipt] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSales, setPendingSales] = useState<Array<QueuedAction & { action: PosSaleAction }>>(
    [],
  );
  const [syncingQueue, setSyncingQueue] = useState(false);

  const refreshPendingSales = useCallback(async () => {
    const all = await listQueuedActions();
    setPendingSales(
      all.filter((item): item is QueuedAction & { action: PosSaleAction } =>
        item.actionType === 'pos-sale',
      ),
    );
  }, []);

  useEffect(() => {
    void refreshPendingSales();
  }, [refreshPendingSales]);

  async function handleSyncPendingSales(): Promise<void> {
    setSyncingQueue(true);
    try {
      await syncPendingQueue();
    } finally {
      await refreshPendingSales();
      setSyncingQueue(false);
    }
  }

  const total = cart.reduce((sum, line) => sum + line.qty * line.rate, 0);
  const qtyToAdd = Math.max(1, Math.trunc(Number(pendingQty)) || 1);

  function addToCart(item: ProductSearchResult, qty: number): void {
    setCart((current) => {
      const existing = current.find((line) => line.itemCode === item.itemCode);
      if (existing) {
        return current.map((line) =>
          line.itemCode === item.itemCode ? { ...line, qty: line.qty + qty } : line,
        );
      }
      return [...current, { itemCode: item.itemCode, itemName: item.itemName, qty, rate: item.price ?? 0 }];
    });
  }

  function adjustQty(itemCode: string, delta: number): void {
    setCart((current) =>
      current
        .map((line) => (line.itemCode === itemCode ? { ...line, qty: line.qty + delta } : line))
        .filter((line) => line.qty > 0),
    );
  }

  function removeLine(itemCode: string): void {
    setCart((current) => current.filter((line) => line.itemCode !== itemCode));
  }

  async function handleSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setSearching(true);
    setError(null);
    try {
      const { results } = await searchProducts(trimmed);
      // A barcode scanner behaves like fast keyboard entry ending in
      // Enter — an exact single itemCode match means "scan", not "typed
      // a partial name to browse": add straight to cart, no picker.
      const exactMatch = results.find((r) => r.itemCode.toLowerCase() === trimmed.toLowerCase());
      if (results.length === 1 || exactMatch) {
        addToCart(exactMatch ?? results[0]!, qtyToAdd);
        setSearchResults([]);
        setQuery('');
        setPendingQty('1');
      } else {
        setSearchResults(results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  }

  function pressKey(key: string): void {
    if (key === 'C') {
      setPendingQty('1');
    } else if (key === '⌫') {
      setPendingQty((current) => (current.length > 1 ? current.slice(0, -1) : '1'));
    } else {
      setPendingQty((current) => (current === '1' ? key : current + key).replace(/^0+(?=\d)/, ''));
    }
  }

  async function handleConfirmPayment(): Promise<void> {
    setSubmitting(true);
    setError(null);
    try {
      const action: PosSaleAction = {
        type: 'pos-sale',
        lines: cart.map((line) => ({ itemCode: line.itemCode, qty: line.qty, rate: line.rate })),
        ...(customerId.trim() ? { customerId: customerId.trim() } : {}),
        modeOfPayment: paymentMethod,
        amount: Number(amountTendered) || total,
      };

      // Durable-write-then-sync (spec §15.2) — the sale is recorded
      // locally the instant "Konfirmasi Pembayaran" is pressed, before
      // the network is even touched. If the connection is down or drops
      // mid-request, the sale is queued, not lost, and this same call is
      // safe to retry later since the server dedupes by this action's
      // UUID.
      const result = await submitOrQueue('pos-sale', action);
      await refreshPendingSales();

      if (result.outcome === 'queued') {
        setMessage(
          'Transaksi disimpan secara lokal — internet terputus. Akan tersinkron otomatis saat online, tidak akan hilang atau terduplikasi.',
        );
        resetAfterSale();
        return;
      }

      if (result.outcome === 'conflict') {
        setMessage(
          `Transaksi ditandai konflik (${result.message ?? 'stok tidak konsisten'}) — perlu ditinjau di dashboard, tidak diterapkan otomatis.`,
        );
        resetAfterSale();
        return;
      }

      const transaction = result.result as PosTransaction;

      if (printReceipt) {
        try {
          await openReceipt(transaction.name);
        } catch (printErr) {
          // The sale is already recorded — a failed print shouldn't look
          // like a failed transaction. Say so, don't throw.
          setMessage(
            `Transaksi ${transaction.name} berhasil, tapi struk gagal dibuka: ${
              printErr instanceof Error ? printErr.message : String(printErr)
            }`,
          );
          resetAfterSale();
          return;
        }
      }

      setMessage(`Transaksi ${transaction.name} berhasil (${formatRupiah(transaction.grandTotal)}).`);
      resetAfterSale();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  function resetAfterSale(): void {
    setCart([]);
    setCustomerId('');
    setAmountTendered('');
    setPrintReceipt(true);
    setStage('cart');
  }

  if (stage === 'payment') {
    return (
      <div className="kasir">
        <button type="button" className="link-button home-back" onClick={() => setStage('cart')}>
          <IconArrowLeft size={18} /> Kembali ke keranjang
        </button>

        <div className="payment-summary card">
          <span className="card-label">Total Bayar</span>
          <span className="card-value">{formatRupiah(total)}</span>
        </div>

        <section className="cart card">
          <h2 className="section-label">Ringkasan Pesanan</h2>
          <ul>
            {cart.map((line) => (
              <li key={line.itemCode} className="cart-line cart-line--review">
                <span>
                  {line.itemName} <span className="hint">× {line.qty}</span>
                </span>
                <span>{formatRupiah(line.qty * line.rate)}</span>
              </li>
            ))}
          </ul>
        </section>

        <h2 className="section-label">Metode Pembayaran</h2>
        <div className="payment-method-list" role="radiogroup" aria-label="Metode Pembayaran">
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method.id}
              type="button"
              role="radio"
              aria-checked={paymentMethod === method.id}
              className={
                paymentMethod === method.id
                  ? 'card payment-method-option payment-method-option--selected'
                  : 'card payment-method-option'
              }
              onClick={() => setPaymentMethod(method.id)}
            >
              <span className="stat-card-icon">{method.icon}</span>
              {method.label}
            </button>
          ))}
        </div>

        <form className="scan-form payment-form" onSubmit={(e) => e.preventDefault()}>
          <label>
            Jumlah Diterima
            <input
              value={amountTendered}
              onChange={(e) => setAmountTendered(e.target.value)}
              inputMode="decimal"
              placeholder={String(total)}
            />
          </label>
        </form>

        <label className="print-toggle">
          <input
            type="checkbox"
            checked={printReceipt}
            onChange={(e) => setPrintReceipt(e.target.checked)}
          />
          Cetak struk
        </label>

        {error && <p className="error-box">{error}</p>}

        <button
          type="button"
          className="bayar-button"
          disabled={submitting}
          onClick={() => void handleConfirmPayment()}
        >
          {submitting ? 'Memproses…' : 'Konfirmasi Pembayaran'}
        </button>
      </div>
    );
  }

  return (
    <div className="kasir">
      <form onSubmit={(e) => void handleSearch(e)} className="scan-form">
        <label>
          Cari / Scan Barang
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kode barang atau nama"
            autoFocus
          />
        </label>
        <button type="submit" disabled={searching}>
          {searching ? 'Mencari…' : 'Tambah ke Keranjang'}
        </button>
      </form>

      {searchResults.length > 1 && (
        <ul className="search-results">
          {searchResults.map((item) => (
            <li key={item.itemCode}>
              <button
                type="button"
                onClick={() => {
                  addToCart(item, qtyToAdd);
                  setSearchResults([]);
                  setQuery('');
                  setPendingQty('1');
                }}
              >
                {item.itemName} — {item.price !== null ? formatRupiah(item.price) : 'Harga tidak tersedia'}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="keypad-section">
        <span className="hint">Jumlah scan berikutnya: {pendingQty}</span>
        <div className="keypad">
          {KEYPAD_KEYS.map((key) => (
            <button type="button" key={key} onClick={() => pressKey(key)}>
              {key}
            </button>
          ))}
        </div>
      </div>

      <label>
        ID Pelanggan (kosongkan untuk Walk-in / Retail)
        <input value={customerId} onChange={(e) => setCustomerId(e.target.value)} />
      </label>

      {error && <p className="error-box">{error}</p>}
      {message && <p className="message">{message}</p>}

      {pendingSales.length > 0 && (
        <section className="queue">
          <h2>
            Transaksi Menunggu Sinkron ({pendingSales.length})
            <button
              type="button"
              onClick={() => void handleSyncPendingSales()}
              disabled={syncingQueue}
            >
              {syncingQueue ? 'Menyinkron…' : 'Sinkron Sekarang'}
            </button>
          </h2>
          <ul>
            {pendingSales.map((item) => {
              const badge = statusBadge(item.status);
              return (
                <li key={item.uuid}>
                  {formatRupiah(item.action.amount)} ({item.action.lines.length} barang){' '}
                  <span className={badge.className}>{badge.label}</span>
                  {item.lastError && <div className="hint">{item.lastError}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="cart">
        <h2 className="section-label">Keranjang</h2>
        {cart.length === 0 ? (
          <p className="hint">Belum ada barang.</p>
        ) : (
          <ul>
            {cart.map((line) => (
              <li key={line.itemCode} className="cart-line">
                <div>
                  <strong>{line.itemName}</strong>
                  <div className="hint">
                    {line.qty} × {formatRupiah(line.rate)} = {formatRupiah(line.qty * line.rate)}
                  </div>
                </div>
                <div className="cart-line-actions">
                  <button type="button" onClick={() => adjustQty(line.itemCode, -1)}>
                    −
                  </button>
                  <button type="button" onClick={() => adjustQty(line.itemCode, 1)}>
                    +
                  </button>
                  <button type="button" onClick={() => removeLine(line.itemCode)}>
                    Hapus
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="cart-total card">
        <span className="card-label">Total</span>
        <span className="card-value">{formatRupiah(total)}</span>
      </div>

      <button
        type="button"
        className="bayar-button"
        disabled={cart.length === 0}
        onClick={() => setStage('payment')}
      >
        Bayar
      </button>
    </div>
  );
}
