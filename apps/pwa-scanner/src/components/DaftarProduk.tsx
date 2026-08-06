import { useEffect, useMemo, useState } from 'react';
import { IconCloudCheck } from '@tabler/icons-react';
import {
  getLastSyncedAt,
  listAllCatalogItems,
  matchCatalog,
  type CatalogItem,
} from '../lib/catalog-cache';
import { formatRupiah, formatSyncedAt } from '../lib/format';

/**
 * Read-only product browser (UX gap found live: the only way to see every
 * registered item was ERPNext's own /erp/ Item list). Reads the same
 * offline catalog cache Kasir search already syncs — no new network calls,
 * works offline, and never gets out of sync with what the cashier sees.
 */
export default function DaftarProduk() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState('');
  const lastSyncedAt = getLastSyncedAt();

  useEffect(() => {
    void listAllCatalogItems().then((all) =>
      setItems([...all].sort((a, b) => a.itemName.localeCompare(b.itemName))),
    );
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
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
