import { useEffect, useMemo, useState } from 'react';
import { IconCloudCheck } from '@tabler/icons-react';
import { getStoredAuth } from '../lib/auth';
import { buildUpdatePriceAction, type EditPriceFormFields } from '../lib/build-price-action';
import { fetchItemUomPrices, triggerCatalogSync } from '../lib/api';
import {
  getLastSyncedAt,
  listAllCatalogItems,
  matchCatalog,
  type CatalogItem,
} from '../lib/catalog-cache';
import { formatRupiah, formatSyncedAt } from '../lib/format';
import { submitOrQueue } from '../lib/sync';

/** Owner/Manager only — mirrors the backend's ALLOWED_ROLES_BY_ACTION for 'update-item-price' (price-setting is a business decision, not every staff role's call). */
const EDIT_PRICE_ROLES = new Set(['Owner', 'Manager']);

/**
 * Read-only product browser (UX gap found live: the only way to see every
 * registered item was ERPNext's own /erp/ Item list). Reads the same
 * offline catalog cache Kasir search already syncs — no new network calls,
 * works offline, and never gets out of sync with what the cashier sees.
 *
 * Edit (Retail/Grosir price only — see build-price-action.ts's doc comment
 * for why a UOM correction isn't offered here): opens a small always-online
 * form, prefilled from a live per-UOM price lookup since the offline cache
 * only ever has Retail.
 */
export default function DaftarProduk() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CatalogItem | null>(null);
  const lastSyncedAt = getLastSyncedAt();
  const canEditPrice = EDIT_PRICE_ROLES.has(getStoredAuth()?.user.role ?? '');

  function reload(): void {
    void listAllCatalogItems().then((all) =>
      setItems([...all].sort((a, b) => a.itemName.localeCompare(b.itemName))),
    );
  }

  useEffect(() => {
    // Read whatever's cached immediately (works offline, shows something
    // right away), then refresh from the server in the background. Real
    // bug found live: a disabled item (old "bawang merah", Pcs) kept
    // showing here long after being disabled — the cache only refreshes on
    // login or an actual offline→online transition, neither of which
    // happens just from opening this screen while already online.
    reload();
    void triggerCatalogSync().then(reload);
  }, []);

  const visible = useMemo(() => {
    const trimmed = query.trim();
    return trimmed ? matchCatalog(items, trimmed) : items;
  }, [items, query]);

  return (
    <>
      <h2 className="section-label">Daftar Produk</h2>

      {lastSyncedAt && (
        <p className="hint">
          <IconCloudCheck size={14} /> Data tersinkron: {formatSyncedAt(lastSyncedAt)}
        </p>
      )}

      <label>
        Cari Produk
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nama atau kode barang"
          inputMode="search"
        />
      </label>

      {items.length === 0 ? (
        <p className="hint">Belum ada data produk tersimpan — sinkron ulang saat online.</p>
      ) : visible.length === 0 ? (
        <p className="hint">Tidak ada barang yang cocok dengan &quot;{query.trim()}&quot;.</p>
      ) : (
        <>
          <p className="hint">
            {visible.length} dari {items.length} produk
          </p>
          <ul className="product-list">
            {visible.map((item) => (
              <li key={item.itemCode} className="product-list-row">
                <div className="product-list-main">
                  <span className="product-list-name">{item.itemName}</span>
                  <span className="hint">
                    {item.itemCode} · {item.stockUom}
                  </span>
                </div>
                <div className="product-list-figures">
                  <span style={item.stockQty > 0 ? undefined : { color: 'var(--color-warning)' }}>
                    {item.stockQty} {item.stockUom}
                  </span>
                  <span>{item.retailPrice != null ? formatRupiah(item.retailPrice) : '—'}</span>
                  {canEditPrice && (
                    <button type="button" className="link-button" onClick={() => setEditing(item)}>
                      Edit
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && (
        <EditPriceDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void triggerCatalogSync().then(reload);
          }}
        />
      )}
    </>
  );
}

function EditPriceDialog({
  item,
  onClose,
  onSaved,
}: {
  item: CatalogItem;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [retailPrice, setRetailPrice] = useState('');
  const [grosirPrice, setGrosirPrice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchItemUomPrices(item.itemCode)
      .then(({ item: priced }) => {
        if (cancelled) return;
        const match = priced?.uoms.find((u) => u.uom === item.stockUom) ?? priced?.uoms[0];
        setRetailPrice(match?.retailPrice != null ? String(match.retailPrice) : '');
        setGrosirPrice(match?.grosirPrice != null ? String(match.grosirPrice) : '');
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item.itemCode, item.stockUom]);

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const fields: EditPriceFormFields = {
      itemCode: item.itemCode,
      uom: item.stockUom,
      retailPrice,
      grosirPrice,
    };
    const built = buildUpdatePriceAction(fields);
    if (typeof built === 'string') {
      setError(built);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOrQueue('update-item-price', built);
      if (result.outcome === 'synced') {
        onSaved();
      } else if (result.outcome === 'conflict') {
        setMessage(`Ditandai konflik (${result.message ?? 'gagal menyimpan'}) — perlu ditinjau.`);
      } else {
        setMessage('Disimpan secara lokal — akan sinkron otomatis saat online.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="edit-price-overlay" role="dialog" aria-label={`Edit harga ${item.itemName}`}>
      <div className="edit-price-card">
        <h3>{item.itemName}</h3>
        <p className="hint">
          {item.itemCode} · {item.stockUom}
        </p>

        {loading ? (
          <p className="hint">Memuat harga saat ini…</p>
        ) : (
          <form onSubmit={handleSubmit} className="scan-form">
            <label>
              Harga Retail
              <input
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>
            <label>
              Harga Grosir
              <input
                value={grosirPrice}
                onChange={(e) => setGrosirPrice(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>

            {error && <p className="error-box">{error}</p>}
            {message && <p className="hint">{message}</p>}

            <div className="edit-price-actions">
              <button type="submit" disabled={submitting}>
                {submitting ? 'Menyimpan…' : 'Simpan'}
              </button>
              <button type="button" className="link-button" onClick={onClose}>
                Batal
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
