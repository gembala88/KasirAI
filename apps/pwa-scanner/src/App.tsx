import { useCallback, useEffect, useState } from 'react';
import { submitScanAction } from './lib/api';
import { buildAction } from './lib/build-action';
import {
  enqueueAction,
  listQueuedActions,
  removeQueuedAction,
  type QueuedAction,
} from './lib/offline-queue';
import type { ScanActionType } from './lib/types';

const ACTION_LABELS: Record<ScanActionType, string> = {
  'add-stock': 'Tambah Stok',
  'reduce-stock': 'Kurangi Stok',
  transfer: 'Transfer',
};

export default function App() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState<QueuedAction[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [actionType, setActionType] = useState<ScanActionType>('add-stock');
  const [itemCode, setItemCode] = useState('');
  const [qty, setQty] = useState('');
  const [rate, setRate] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [toWarehouse, setToWarehouse] = useState('');

  const refreshQueue = useCallback(async () => {
    setQueue(await listQueuedActions());
  }, []);

  useEffect(() => {
    void refreshQueue();
  }, [refreshQueue]);

  const syncQueue = useCallback(async () => {
    setSyncing(true);
    try {
      const pending = await listQueuedActions();
      for (const item of pending) {
        try {
          await submitScanAction(item.action);
          await removeQueuedAction(item.id);
        } catch {
          // Still offline (or the API is down) — stop and retry next time.
          break;
        }
      }
    } finally {
      await refreshQueue();
      setSyncing(false);
    }
  }, [refreshQueue]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void syncQueue();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncQueue]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);

    const built = buildAction(actionType, { itemCode, qty, rate, warehouse, toWarehouse });
    if (typeof built === 'string') {
      setMessage(built);
      return;
    }

    if (navigator.onLine) {
      try {
        await submitScanAction(built);
        setMessage(`${ACTION_LABELS[actionType]} berhasil dikirim.`);
      } catch {
        await enqueueAction(built);
        setMessage('Gagal kirim ke server — disimpan untuk sinkron nanti.');
        await refreshQueue();
      }
    } else {
      await enqueueAction(built);
      setMessage('Mode offline — aksi disimpan, akan sinkron otomatis.');
      await refreshQueue();
    }

    setItemCode('');
    setQty('');
    setRate('');
    setToWarehouse('');
  }

  return (
    <main className="app">
      {!isOnline && (
        <div className="offline-banner" role="status">
          Mode Offline — akan sinkron otomatis
        </div>
      )}

      <h1>Hermes Scanner</h1>

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
          <input
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            placeholder="mis. BRG-001 (scan atau ketik manual)"
            inputMode="text"
          />
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
            <li key={item.id}>
              {ACTION_LABELS[item.action.type]} — {item.action.itemCode} ({item.action.qty})
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
