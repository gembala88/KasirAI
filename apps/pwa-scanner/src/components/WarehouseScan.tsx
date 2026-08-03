import { useCallback, useEffect, useState } from 'react';
import CameraScanner from './CameraScanner';
import { buildAction } from '../lib/build-action';
import { listQueuedActions, type QueuedAction } from '../lib/offline-queue';
import { submitOrQueue, syncPendingQueue } from '../lib/sync';
import type { ScanAction, ScanActionType } from '../lib/types';

const ACTION_LABELS: Record<ScanActionType, string> = {
  'add-stock': 'Tambah Stok',
  'reduce-stock': 'Kurangi Stok',
  transfer: 'Transfer',
};

interface ScanQueuedAction extends QueuedAction {
  actionType: ScanActionType;
  action: ScanAction;
}

/** The offline queue is shared with the Kasir screen (one IndexedDB store) — only show this screen's own action types here. */
function isScanAction(item: QueuedAction): item is ScanQueuedAction {
  return item.actionType !== 'pos-sale';
}

export default function WarehouseScan({ isOnline }: { isOnline: boolean }) {
  const [queue, setQueue] = useState<ScanQueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [actionType, setActionType] = useState<ScanActionType>('add-stock');
  const [itemCode, setItemCode] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [toWarehouse, setToWarehouse] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  const refreshQueue = useCallback(async () => {
    setQueue((await listQueuedActions()).filter(isScanAction));
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

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
      <form onSubmit={(e) => void handleSubmit(e)} className="scan-form">
        <label>
          Aksi
          <select
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ScanActionType)}
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
            <button type="button" className="camera-scan-button" onClick={() => setCameraOpen(true)}>
              📷 Scan
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
          <input
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
            placeholder="Kosongkan untuk gudang default"
          />
        </label>

        {actionType === 'transfer' && (
          <label>
            Gudang Tujuan
            <input value={toWarehouse} onChange={(e) => setToWarehouse(e.target.value)} />
          </label>
        )}

        <button type="submit">Kirim</button>
      </form>

      {message && <p className="message">{message}</p>}

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
          {queue.map((item) => (
            <li key={item.uuid}>
              {ACTION_LABELS[item.actionType]} — {item.action.itemCode} ({item.action.qty}) —{' '}
              {item.status}
              {item.lastError && <div className="hint">{item.lastError}</div>}
            </li>
          ))}
        </ul>
      </section>

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
  );
}
