import { useCallback, useEffect, useState } from 'react';
import { IconCamera, IconX } from '@tabler/icons-react';
import CameraScanner from './CameraScanner';
import DaftarProduk from './DaftarProduk';
import TambahProdukBaru from './TambahProdukBaru';
import { fetchWarehouses, type WarehouseOption } from '../lib/api';
import { buildAction, type StockActionType } from '../lib/build-action';
import { loadWithCacheFallback } from '../lib/cached-lookup';
import { statusBadge, stripHtmlTags } from '../lib/format';
import {
  listQueuedActions,
  removeQueuedAction,
  QUEUE_CHANGED_EVENT,
  type QueuedAction,
} from '../lib/offline-queue';
import { submitOrQueue, syncPendingQueue } from '../lib/sync';
import type { ScanAction, ScanActionType } from '../lib/types';
import { useProductSearch } from '../lib/use-product-search';

const WAREHOUSES_CACHE_KEY = 'hermes-pwa-scanner-warehouses';

const ACTION_LABELS: Record<ScanActionType, string> = {
  'add-stock': 'Tambah Stok',
  'reduce-stock': 'Kurangi Stok',
  transfer: 'Transfer',
  'create-item': 'Produk Baru',
};

interface ScanQueuedAction extends QueuedAction {
  actionType: ScanActionType;
  action: ScanAction;
}

/** The offline queue is shared with the Kasir screen (one IndexedDB store) — only show this screen's own action types here. */
function isScanAction(item: QueuedAction): item is ScanQueuedAction {
  return item.actionType !== 'pos-sale';
}

/** create-item has no qty/rate — everything else on this screen does. */
function queueLineDescription(item: ScanQueuedAction): string {
  if (item.action.type === 'create-item') {
    return item.action.itemName;
  }
  return `${item.action.itemCode} (${item.action.qty})`;
}

export default function WarehouseScan({
  initialMode,
  lowStockItemCodes,
}: {
  /** Opens straight into Daftar Produk instead of the usual Input Stok default — set by App.tsx only when arriving here from Beranda's low-stock stat card. */
  initialMode?: 'daftar-produk';
  lowStockItemCodes?: string[];
} = {}) {
  const [mode, setMode] = useState<'input-stok' | 'tambah-produk' | 'daftar-produk'>(
    initialMode ?? 'input-stok',
  );
  const [queue, setQueue] = useState<ScanQueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [actionType, setActionType] = useState<StockActionType>('add-stock');
  const [itemCode, setItemCode] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [toWarehouse, setToWarehouse] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  // Not a sales screen, so no customer/tier to worry about — always false.
  const {
    results: itemSearchResults,
    searching: itemSearching,
    clearResults: clearItemSearch,
  } = useProductSearch(itemCode, false);

  const refreshQueue = useCallback(async () => {
    setQueue((await listQueuedActions()).filter(isScanAction));
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  // Real bug found live: a sync sweep can now run from App.tsx's
  // online-reconnect/login handler while this screen is or isn't mounted —
  // this keeps the displayed list current either way, instead of only
  // updating after this screen's own submit/manual-sync calls.
  useEffect(() => {
    const handler = () => void refreshQueue();
    window.addEventListener(QUEUE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(QUEUE_CHANGED_EVENT, handler);
  }, [refreshQueue]);

  useEffect(() => {
    void loadWithCacheFallback(WAREHOUSES_CACHE_KEY, fetchWarehouses, {
      warehouses: [],
      default: '',
    }).then(({ warehouses: list, default: def }) => {
      setWarehouses(list);
      setWarehouse((current) => current || def);
    });
  }, []);

  const syncQueue = useCallback(async () => {
    setSyncing(true);
    try {
      await syncPendingQueue();
    } finally {
      await refreshQueue();
      setSyncing(false);
    }
  }, [refreshQueue]);

  // Local-only — never touches ERPNext or the server-side sync checkpoint.
  async function handleDismissQueueItem(uuid: string): Promise<void> {
    await removeQueuedAction(uuid);
    await refreshQueue();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    const built = buildAction(actionType, { itemCode, qty, rate, warehouse, toWarehouse });
    if (typeof built === 'string') {
      setMessage(built);
      return;
    }

    const label = ACTION_LABELS[actionType];
    const result = await submitOrQueue(built.type, built);
    if (result.outcome === 'synced') {
      setMessage(`${label} berhasil dikirim.`);
    } else if (result.outcome === 'conflict') {
      setMessage(
        `${label} ditandai konflik (${result.message ?? 'stok tidak konsisten'}) — perlu ditinjau di dashboard.`,
      );
    } else {
      setMessage(`${label} disimpan secara lokal — akan sinkron otomatis saat online.`);
    }
    await refreshQueue();

    setItemCode('');
    setQty('');
    setRate('');
    setToWarehouse('');
  }

  return (
    <>
      <nav className="tabs">
        <button
          type="button"
          className={mode === 'input-stok' ? 'tab tab--active' : 'tab'}
          onClick={() => setMode('input-stok')}
        >
          Input Stok
        </button>
        <button
          type="button"
          className={mode === 'tambah-produk' ? 'tab tab--active' : 'tab'}
          onClick={() => setMode('tambah-produk')}
        >
          Tambah Produk Baru
        </button>
        <button
          type="button"
          className={mode === 'daftar-produk' ? 'tab tab--active' : 'tab'}
          onClick={() => setMode('daftar-produk')}
        >
          Daftar Produk
        </button>
      </nav>

      {mode === 'input-stok' && (
        <>
          <h2 className="section-label">Input Stok</h2>
          <form onSubmit={(e) => void handleSubmit(e)} className="scan-form">
            <label>
              Aksi
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as StockActionType)}
              >
                <option value="add-stock">Tambah Stok</option>
                <option value="reduce-stock">Kurangi Stok</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>

            <label>
              Kode Barang
              <div className="scan-input-row">
                <input
                  value={itemCode}
                  onChange={(e) => setItemCode(e.target.value)}
                  // Real bug found live: Enter here submitted the whole
                  // Input Stok transaction with whatever raw/partial text
                  // was typed, bypassing the dropdown below entirely. Now
                  // Enter only confirms an unambiguous single match (same
                  // as tapping it) — with 0 or several candidates, it does
                  // nothing rather than guess.
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (itemSearchResults.length === 1 && itemSearchResults[0]) {
                      setItemCode(itemSearchResults[0].itemCode);
                      clearItemSearch();
                    }
                  }}
                  placeholder="mis. BRG-001, atau ketik nama produk"
                  inputMode="text"
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

            {/* Suppresses itself once itemCode already holds the exact
                code of the single match — otherwise reappears right after
                a tap/scan, since itemCode is both the search query and
                the field's real value (unlike Kasir, which clears its
                separate query field on selection). */}
            {itemSearchResults.length > 0 &&
              !(
                itemSearchResults.length === 1 &&
                itemSearchResults[0]?.itemCode.toLowerCase() === itemCode.trim().toLowerCase()
              ) && (
                <ul className="search-results">
                  {itemSearchResults.map((item) => (
                    <li key={item.itemCode}>
                      <button
                        type="button"
                        onClick={() => {
                          setItemCode(item.itemCode);
                          clearItemSearch();
                        }}
                      >
                        <span className="search-result-name">{item.itemName}</span>
                        <span className="hint">
                          {item.itemCode} · {item.stockUom}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

            {itemCode.trim().length >= 2 && itemSearchResults.length === 0 && !itemSearching && (
              <p className="hint">
                Tidak ada barang yang cocok dengan &quot;{itemCode.trim()}&quot;.
              </p>
            )}

            <label>
              Jumlah
              <input
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>

            {actionType === 'add-stock' && (
              <label>
                Harga Satuan
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                />
              </label>
            )}

            <label>
              Gudang {actionType === 'transfer' ? '(Asal)' : ''}
              <select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                {warehouses.length === 0 && <option value="">Tidak ada data (cek koneksi)</option>}
                {warehouses.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>

            {actionType === 'transfer' && (
              <label>
                Gudang Tujuan
                <select value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)}>
                  <option value="">Pilih gudang tujuan</option>
                  {warehouses.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button type="submit">Kirim</button>
          </form>

          {message && <p className="message">{message}</p>}

          {cameraOpen && (
            <CameraScanner
              onDetect={(value) => {
                setItemCode(value);
                setCameraOpen(false);
              }}
              onClose={() => setCameraOpen(false)}
            />
          )}
        </>
      )}

      {mode === 'tambah-produk' && <TambahProdukBaru onSubmitted={() => void refreshQueue()} />}

      {mode === 'daftar-produk' && <DaftarProduk initialItemCodeFilter={lowStockItemCodes} />}

      {mode !== 'daftar-produk' && (
        <section className="queue">
          <h2>
            Menunggu Disimpan ({queue.length})
            <button
              type="button"
              className="queue-sync-button"
              onClick={() => void syncQueue()}
              disabled={syncing || queue.length === 0}
            >
              {syncing ? 'Menyimpan ke server…' : 'Simpan ke Server Sekarang'}
            </button>
          </h2>
          <ul>
            {queue.map((item) => {
              const badge = statusBadge(item.status);
              return (
                <li key={item.uuid}>
                  <div className="queue-item-body">
                    {ACTION_LABELS[item.actionType]} — {queueLineDescription(item)}{' '}
                    <span className={badge.className}>{badge.label}</span>
                    {item.lastError && <div className="hint">{stripHtmlTags(item.lastError)}</div>}
                  </div>
                  <button
                    type="button"
                    className="queue-dismiss-button"
                    onClick={() => void handleDismissQueueItem(item.uuid)}
                    aria-label="Hapus dari antrian (tidak memengaruhi data di server)"
                    title="Hapus dari antrian — hanya di perangkat ini, tidak memengaruhi ERPNext"
                  >
                    <IconX size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
