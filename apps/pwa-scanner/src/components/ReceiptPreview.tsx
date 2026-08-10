import { useEffect, useRef, useState } from 'react';
import { IconPrinter } from '@tabler/icons-react';
import { fetchReceiptHtml } from '../lib/api';

/**
 * Receipt iframe + explicit print button — shared by Kasir's post-sale
 * screen and Riwayat Transaksi's "Cetak Ulang", since both need the exact
 * same fetch-on-mount, `<iframe srcDoc>` + print()-on-a-real-tap pattern
 * (see api.ts's fetchReceiptHtml doc comment for why print() is never
 * auto-triggered: it used to open a browser-blocked popup half the time).
 * Fetches itself on mount rather than taking pre-fetched HTML as a prop,
 * so a caller only needs to decide *when* to render this, not manage
 * loading/error state for it.
 */
export default function ReceiptPreview({
  transactionName,
  itemCount,
}: {
  transactionName: string;
  /** Distinct line-item count, when the caller already has it in hand (Kasir's cart, Riwayat Transaksi's detail.items) — omitted rather than re-derived from the printed HTML, which is free-form ERPNext Print Format content, not structured data. */
  itemCount?: number;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Real UX gap found live: a fixed iframe height (320px) meant any
  // receipt longer than a couple of lines needed scrolling to read in
  // full — fixed by measuring the actual rendered content height once the
  // srcDoc has loaded and sizing the iframe to fit exactly, so any
  // template (Minimal/Standard/Detailed) and any item count both fit
  // without scrolling. Reset to null on every new transaction so the
  // previous receipt's height doesn't flash before the new one loads.
  const [frameHeight, setFrameHeight] = useState<number | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
    setFrameHeight(null);
    fetchReceiptHtml(transactionName)
      .then((value) => {
        if (!cancelled) setHtml(value);
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
  }, [transactionName]);

  function handleFrameLoad(): void {
    const doc = frameRef.current?.contentDocument;
    if (doc?.documentElement) {
      // A little breathing room so the last line isn't flush against the
      // iframe's own bottom edge.
      setFrameHeight(doc.documentElement.scrollHeight + 16);
    }
  }

  return (
    <section className="receipt-preview card">
      <h2 className="section-label">Struk</h2>
      {typeof itemCount === 'number' && <p className="hint">Total item: {itemCount}</p>}
      {loading && <p className="hint">Memuat struk…</p>}
      {error && <p className="error-box">Struk gagal dimuat: {error}</p>}
      {html && (
        <>
          <iframe
            ref={frameRef}
            srcDoc={html}
            className="receipt-frame"
            title="Struk"
            onLoad={handleFrameLoad}
            style={frameHeight ? { height: `${frameHeight}px` } : undefined}
          />
          <button type="button" onClick={() => frameRef.current?.contentWindow?.print()}>
            <IconPrinter size={18} /> Cetak Struk
          </button>
        </>
      )}
    </section>
  );
}
