import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBuildingBank,
  IconCamera,
  IconCash,
  IconCloudCheck,
  IconPrinter,
  IconQrcode,
} from '@tabler/icons-react';
import {
  fetchReceiptHtml,
  searchProducts,
  type PosTransaction,
  type ProductSearchResult,
} from '../lib/api';
import CameraScanner from './CameraScanner';
import { getLastSyncedAt } from '../lib/catalog-cache';
import { formatQty, formatRupiah, formatSyncedAt, statusBadge } from '../lib/format';
import { listQueuedActions, type QueuedAction } from '../lib/offline-queue';
import { submitOrQueue, syncPendingQueue } from '../lib/sync';
import type { PosSaleAction } from '../lib/types';
import { useProductSearch } from '../lib/use-product-search';

interface CartLine {
  itemCode: string;
  itemName: string;
  stockUom: string;
  qty: number;
  rate: number;
  /** Carried from ProductSearchResult.stale — the price may not reflect this customer's real (Grosir/Member) tier. See searchProducts's doc comment. */
  stale?: boolean;
}

/** Amber "needs a live check" warning — same convention as dashboard's SyncConflicts badge. */
function StalePriceWarning() {
  return (
    <span className="status-badge status-badge--conflict">
      <IconAlertTriangle size={12} /> Harga mungkin belum terbaru
    </span>
  );
}

const PAYMENT_METHODS = [
  { id: 'Cash', label: 'Tunai', icon: <IconCash size={24} /> },
  { id: 'QRIS', label: 'QRIS', icon: <IconQrcode size={24} /> },
  { id: 'Transfer', label: 'Transfer', icon: <IconBuildingBank size={24} /> },
] as const;
// 'C' (clear) lives next to the "Jumlah scan berikutnya" label instead of
// in the grid — keeps this a clean 4-row-of-3 layout once '.' joined the
// digits for weight-sold items (Bawang Merah, Gula, Beras — Kg qty like
// 0.25 needs a decimal point, not just whole scans).
const KEYPAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

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
  const [submitSearching, setSubmitSearching] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pendingQty, setPendingQty] = useState('1');
  // Distinguishes "still showing the untouched default" from "user typed the digit 1" —
  // without it, typing 1 then . then 5 misfired as 0.5 (see pressKey).
  const [qtyTouched, setQtyTouched] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [stage, setStage] = useState<'cart' | 'payment'>('cart');
  const [paymentMethod, setPaymentMethod] =
    useState<(typeof PAYMENT_METHODS)[number]['id']>('Cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [printReceipt, setPrintReceipt] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingSales, setPendingSales] = useState<Array<QueuedAction & { action: PosSaleAction }>>(
    [],
  );
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Set once a sale is confirmed and synced — while non-null, the payment
  // panel shows Kembalian + (optional) receipt instead of the payment
  // form, until the cashier taps "Transaksi Baru".
  const [saleResult, setSaleResult] = useState<{
    transaction: PosTransaction;
    changeDue: number;
  } | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const receiptFrameRef = useRef<HTMLIFrameElement>(null);
  const lastSyncedAt = getLastSyncedAt();

  const {
    results: searchResults,
    searching: debouncedSearching,
    error: searchError,
    setResults: setSearchResults,
    clearResults,
  } = useProductSearch(query, !!customerId.trim());
  const searching = submitSearching || debouncedSearching;

  const refreshPendingSales = useCallback(async () => {
    const all = await listQueuedActions();
    setPendingSales(
      all.filter(
        (item): item is QueuedAction & { action: PosSaleAction } => item.actionType === 'pos-sale',
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
  // Weight-sold items (Bawang Merah, Gula, Beras...) need decimal qty —
  // parseInt-style truncation used to silently round 0.25 down to 0, then
  // Math.max(1, ...) would round it back UP to a full unit. Any positive
  // number is valid now; only a genuinely empty/non-numeric pad falls
  // back to 1.
  const parsedPendingQty = Number(pendingQty);
  const qtyToAdd = Number.isFinite(parsedPendingQty) && parsedPendingQty > 0 ? parsedPendingQty : 1;

  function addToCart(item: ProductSearchResult, qty: number): void {
    setCart((current) => {
      const existing = current.find((line) => line.itemCode === item.itemCode);
      if (existing) {
        return current.map((line) =>
          line.itemCode === item.itemCode
            ? { ...line, qty: line.qty + qty, stale: line.stale || item.stale }
            : line,
        );
      }
      return [
        ...current,
        {
          itemCode: item.itemCode,
          itemName: item.itemName,
          stockUom: item.stockUom,
          qty,
          rate: item.price ?? 0,
          stale: item.stale,
        },
      ];
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

  // Live dropdown as the cashier types (debounced, see useProductSearch)
  // — never adds anything to the cart by itself, purely populates the
  // picker below. Real bug found live: with growing near-duplicate
  // products (same item in multiple sizes/flavors/UOMs — several Cimory
  // variants, Rinso in more than one size), a partial name that happened
  // to match only one product today was silently added straight to the
  // cart with no picker and no chance to double-check what was about to
  // be sold. Only an exact item_code match (handleSearch below, on
  // Enter/submit — what a barcode scanner's keystrokes-then-Enter
  // behaves like) is allowed to add directly; every name-based match,
  // however few, requires an explicit tap.

  /**
   * Shared by the search form's submit (Enter, or a real barcode
   * scanner's keystrokes-then-Enter) and the camera scanner's onDetect —
   * both are "a code arrived", just from different input hardware, so
   * both get the exact same exact-match-only-auto-add safety rule.
   */
  async function submitSearchQuery(rawQuery: string): Promise<void> {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;

    setSubmitSearching(true);
    setError(null);
    try {
      const { results } = await searchProducts(trimmed, !!customerId.trim());
      // A barcode scanner (hardware or camera) behaves like fast keyboard
      // entry ending in Enter — only an *exact* itemCode match means
      // "scan", not "typed a partial name to browse": that's the one case
      // allowed to add straight to cart with no picker. Anything else —
      // including a name search that happens to match exactly one
      // product — always shows the picker below for an explicit tap,
      // never auto-adds.
      const exactMatch = results.find((r) => r.itemCode.toLowerCase() === trimmed.toLowerCase());
      if (exactMatch) {
        addToCart(exactMatch, qtyToAdd);
        clearResults();
        setQuery('');
        setPendingQty('1');
      } else {
        setSearchResults(results);
        setQuery(trimmed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitSearching(false);
    }
  }

  async function handleSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await submitSearchQuery(query);
  }

  function pressKey(key: string): void {
    if (key === 'C') {
      setPendingQty('1');
      setQtyTouched(false);
    } else if (key === '⌫') {
      if (!qtyTouched || pendingQty.length <= 1) {
        setPendingQty('1');
        setQtyTouched(false);
      } else {
        const next = pendingQty.slice(0, -1);
        setPendingQty(next);
        setQtyTouched(next.length > 0);
      }
    } else if (key === '.') {
      if (!qtyTouched) {
        setPendingQty('0.');
      } else if (!pendingQty.includes('.')) {
        setPendingQty(pendingQty + '.');
      }
      setQtyTouched(true);
    } else {
      const base = qtyTouched ? pendingQty : '';
      setPendingQty((base + key).replace(/^0+(?=\d)/, '') || '1');
      setQtyTouched(true);
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
      // Real UX gap found live: resetting straight back to an empty cart
      // left the cashier to calculate change by hand, and receipt
      // printing auto-opened a popup (browser-blocked half the time) with
      // no user gesture backing the print() call. Now: show Kembalian
      // immediately, and if the cashier wanted a receipt, fetch it for
      // inline preview — printing itself only happens on an explicit tap
      // of "Cetak Struk" below, which is neither a popup nor an
      // auto-triggered print.
      setSaleResult({
        transaction,
        changeDue: Math.max(0, (Number(amountTendered) || total) - total),
      });
      setCart([]);
      setCustomerId('');
      setAmountTendered('');
      if (printReceipt) {
        setReceiptLoading(true);
        setReceiptError(null);
        fetchReceiptHtml(transaction.name)
          .then(setReceiptHtml)
          .catch((err: unknown) => {
            setReceiptError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => setReceiptLoading(false));
      }
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
    setSaleResult(null);
    setReceiptHtml(null);
    setReceiptError(null);
  }

  return (
    <div className="kasir" data-stage={stage}>
      <div className="kasir-cart-panel">
        <form onSubmit={(e) => void handleSearch(e)} className="scan-form">
          <label>
            Cari / Scan Barang
            <div className="scan-input-row">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Kode barang atau nama"
                autoFocus
              />
              <button
                type="button"
                className="camera-scan-button"
                onClick={() => setCameraOpen(true)}
              >
                <IconCamera size={20} /> Scan
              </button>
            </div>
          </label>
          <button type="submit" disabled={searching}>
            {searching ? 'Mencari…' : 'Tambah ke Keranjang'}
          </button>
        </form>

        {cameraOpen && (
          <CameraScanner
            onDetect={(value) => {
              setCameraOpen(false);
              void submitSearchQuery(value);
            }}
            onClose={() => setCameraOpen(false)}
          />
        )}

        <p className="hint sync-indicator">
          {lastSyncedAt ? (
            <>
              <IconCloudCheck size={14} /> Data tersinkron: {formatSyncedAt(lastSyncedAt)}
            </>
          ) : (
            <>
              <IconAlertTriangle size={14} style={{ color: 'var(--color-warning)' }} /> Katalog
              belum tersinkron — pencarian offline belum tersedia
            </>
          )}
        </p>

        {query.trim().length >= 2 && searchResults.length === 0 && !searching && (
          <p className="hint">Tidak ada barang yang cocok dengan "{query.trim()}".</p>
        )}

        {searchResults.length > 0 && (
          <ul className="search-results">
            {searchResults.map((item) => (
              <li key={item.itemCode}>
                <button
                  type="button"
                  onClick={() => {
                    addToCart(item, qtyToAdd);
                    clearResults();
                    setQuery('');
                    setPendingQty('1');
                    setQtyTouched(false);
                  }}
                >
                  <span className="search-result-name">{item.itemName}</span>
                  <span className="hint">
                    {item.itemCode} · {item.stockUom} ·{' '}
                    {item.price !== null ? formatRupiah(item.price) : 'Harga tidak tersedia'}
                  </span>
                  {item.stale && <StalePriceWarning />}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="keypad-section">
          <span className="hint keypad-label">
            Jumlah scan berikutnya: {pendingQty}
            <button type="button" className="link-button" onClick={() => pressKey('C')}>
              Hapus
            </button>
          </span>
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

        {(error ?? searchError) && <p className="error-box">{error ?? searchError}</p>}
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
                      {formatQty(line.qty)} {line.stockUom} × {formatRupiah(line.rate)} ={' '}
                      {formatRupiah(line.qty * line.rate)}
                    </div>
                    {line.stale && <StalePriceWarning />}
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

        {/* Mobile only — desktop shows the payment panel alongside the cart at all times, so this full-screen swap has nothing to do there. */}
        <button
          type="button"
          className="bayar-button kasir-mobile-only"
          disabled={cart.length === 0}
          onClick={() => setStage('payment')}
        >
          Bayar
        </button>
      </div>

      <div className="kasir-payment-panel">
        {/* Mobile only — see kasir-mobile-only above; desktop has no "back", both panels are just always visible. Hidden once a sale is done — there's nothing to "reconsider" post-payment, only "Transaksi Baru" makes sense. */}
        {!saleResult && (
          <button
            type="button"
            className="link-button home-back kasir-mobile-only"
            onClick={() => setStage('cart')}
          >
            <IconArrowLeft size={18} /> Kembali ke keranjang
          </button>
        )}

        {saleResult ? (
          <>
            <div className="payment-summary card">
              <span className="card-label">Kembalian</span>
              <span className="card-value">{formatRupiah(saleResult.changeDue)}</span>
            </div>
            <p className="hint">
              Transaksi {saleResult.transaction.name} berhasil (
              {formatRupiah(saleResult.transaction.grandTotal)}).
            </p>

            {printReceipt && (
              <section className="receipt-preview card">
                <h2 className="section-label">Struk</h2>
                {receiptLoading && <p className="hint">Memuat struk…</p>}
                {receiptError && <p className="error-box">Struk gagal dimuat: {receiptError}</p>}
                {receiptHtml && (
                  <>
                    <iframe
                      ref={receiptFrameRef}
                      srcDoc={receiptHtml}
                      className="receipt-frame"
                      title="Struk"
                    />
                    <button
                      type="button"
                      onClick={() => receiptFrameRef.current?.contentWindow?.print()}
                    >
                      <IconPrinter size={18} /> Cetak Struk
                    </button>
                  </>
                )}
              </section>
            )}

            {error && <p className="error-box">{error}</p>}
            {message && <p className="message">{message}</p>}

            <button type="button" className="bayar-button" onClick={resetAfterSale}>
              Transaksi Baru
            </button>
          </>
        ) : (
          <>
            <div className="payment-summary card">
              <span className="card-label">Total Bayar</span>
              <span className="card-value">{formatRupiah(total)}</span>
            </div>

            <section className="cart card">
              <h2 className="section-label">Ringkasan Pesanan</h2>
              {cart.length === 0 ? (
                <p className="hint">Belum ada barang.</p>
              ) : (
                <ul>
                  {cart.map((line) => (
                    <li key={line.itemCode} className="cart-line cart-line--review">
                      <span>
                        {line.itemName}{' '}
                        <span className="hint">
                          × {formatQty(line.qty)} {line.stockUom}
                        </span>
                        {line.stale && <StalePriceWarning />}
                      </span>
                      <span>{formatRupiah(line.qty * line.rate)}</span>
                    </li>
                  ))}
                </ul>
              )}
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
            {message && <p className="message">{message}</p>}

            <button
              type="button"
              className="bayar-button"
              disabled={submitting || cart.length === 0}
              onClick={() => void handleConfirmPayment()}
            >
              {submitting ? 'Memproses…' : 'Konfirmasi Pembayaran'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
