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
export default function ReceiptPreview({ transactionName }: { transactionName: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml(null);
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

  return (
    <section className="receipt-preview card">
      <h2 className="section-label">Struk</h2>
      {loading && <p className="hint">Memuat struk…</p>}
      {error && <p className="error-box">Struk gagal dimuat: {error}</p>}
      {html && (
        <>
          <iframe ref={frameRef} srcDoc={html} className="receipt-frame" title="Struk" />
          <button type="button" onClick={() => frameRef.current?.contentWindow?.print()}>
            <IconPrinter size={18} /> Cetak Struk
          </button>
        </>
      )}
    </section>
  );
}
