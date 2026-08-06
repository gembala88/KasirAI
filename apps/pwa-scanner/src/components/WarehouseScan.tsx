import { useCallback, useEffect, useState } from 'react';
import { IconCamera } from '@tabler/icons-react';
import CameraScanner from './CameraScanner';
import DaftarProduk from './DaftarProduk';
import TambahProdukBaru from './TambahProdukBaru';
import { fetchWarehouses, type WarehouseOption } from '../lib/api';
import { buildAction, type StockActionType } from '../lib/build-action';
import { loadWithCacheFallback } from '../lib/cached-lookup';
import { statusBadge } from '../lib/format';
import { listQueuedActions, type QueuedAction } from '../lib/offline-queue';
import { submitOrQueue, syncPendingQueue } from '../lib/sync';
import type { ScanAction, ScanActionType } from '../lib/types';

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

export default function WarehouseScan({ isOnline }: { isOnline: boolean }) {
  const [mode, setMode] = useState<'input-stok' | 'tambah-produk' | 'daftar-produk'>('input-stok');
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

  const refreshQueue = useCallback(async () => {
    setQueue((await listQueuedActions()).filter(isScanAction));
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  useEffect(() => {
    void loadWithCacheFallback(
      WAREHOUSES_CACHE_KEY,
      async () => (await fetchWarehouses()).warehouses,
    ).then(setWarehouses);
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

  useEffect(() => {
    if (isOnline) {
      void syncQueue();
    }
  }, [isOnline, syncQueue]);

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
                  placeholder="mis. BRG-001 (scan atau ketik manual)"
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
                <option value="">Gudang default</option>
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

      {mode === 'daftar-produk' && <DaftarProduk />}

      {mode !== 'daftar-produk' && (
        <section className="queue">
          <h2>
            Menunggu Sinkron ({queue.length})
            <button
              type="button"
              onClick={() => void syncQueue()}
              disabled={syncing || queue.length === 0}
            >
              {syncing ? 'Menyinkron…' : 'Sinkron Sekarang'}
            </button>
          </h2>
          <ul>
            {queue.map((item) => {
              const badge = statusBadge(item.status);
              return (
                <li key={item.uuid}>
                  {ACTION_LABELS[item.actionType]} — {queueLineDescription(item)}{' '}
                  <span className={badge.className}>{badge.label}</span>
                  {item.lastError && <div className="hint">{item.lastError}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
