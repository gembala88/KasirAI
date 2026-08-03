import { useEffect, useState } from 'react';
import { IconCircleCheck } from '@tabler/icons-react';
import { confirmPendingPayment, fetchPendingPayments } from '../lib/api';
import { formatRupiah } from '../lib/format';
import type { PaymentMethod, PendingPaymentOrder } from '../lib/types';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  qris: 'QRIS',
  transfer: 'Transfer Bank',
  cod: 'COD (Cash)',
};

interface RowState {
  method: PaymentMethod;
  phoneNumber: string;
}

export default function Payments() {
  const [orders, setOrders] = useState<PendingPaymentOrder[]>([]);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingName, setConfirmingName] = useState<string | null>(null);
  const [confirmedNames, setConfirmedNames] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { orders: fetched } = await fetchPendingPayments();
      setOrders(fetched);
      setRowState((prev) => {
        const next = { ...prev };
        for (const order of fetched) {
          next[order.name] ??= { method: 'qris', phoneNumber: order.contactMobile ?? '' };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleConfirm(order: PendingPaymentOrder) {
    const state = rowState[order.name];
    if (!state?.phoneNumber) {
      setError(`Nomor WhatsApp untuk pesanan ${order.name} belum diisi`);
      return;
    }
    setError(null);
    setConfirmingName(order.name);
    try {
      await confirmPendingPayment(order.name, state.phoneNumber, state.method);
      setConfirmedNames((prev) => new Set(prev).add(order.name));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmingName(null);
    }
  }

  if (loading) {
    return <p className="hint">Memuat pesanan menunggu konfirmasi…</p>;
  }

  return (
    <div className="payments">
      <p className="hint">
        Pesanan WhatsApp yang sudah dibuat invoice draft-nya, menunggu konfirmasi pembayaran manual (§7).
      </p>
      {error && <p className="error-box">{error}</p>}

      {orders.length === 0 ? (
        <p className="hint">Tidak ada pesanan yang menunggu konfirmasi saat ini.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Pesanan Asal</th>
              <th>Pelanggan</th>
              <th>Total</th>
              <th>Metode</th>
              <th>No. WhatsApp</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const state = rowState[order.name] ?? { method: 'qris' as PaymentMethod, phoneNumber: '' };
              const confirmed = confirmedNames.has(order.name);
              return (
                <tr key={order.name}>
                  <td>{order.name}</td>
                  <td>{order.poNo ?? '—'}</td>
                  <td>{order.customer}</td>
                  <td>{formatRupiah(order.grandTotal)}</td>
                  <td>
                    <select
                      value={state.method}
                      disabled={confirmed}
                      onChange={(event) =>
                        setRowState((prev) => ({
                          ...prev,
                          [order.name]: { ...state, method: event.target.value as PaymentMethod },
                        }))
                      }
                    >
                      {(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((method) => (
                        <option key={method} value={method}>
                          {METHOD_LABELS[method]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={state.phoneNumber}
                      disabled={confirmed}
                      placeholder="62..."
                      onChange={(event) =>
                        setRowState((prev) => ({
                          ...prev,
                          [order.name]: { ...state, phoneNumber: event.target.value },
                        }))
                      }
                    />
                  </td>
                  <td>
                    {confirmed ? (
                      <span className="status-badge status-badge--synced">
                        <IconCircleCheck size={14} /> Dikonfirmasi
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleConfirm(order)}
                        disabled={confirmingName === order.name}
                      >
                        {confirmingName === order.name ? 'Memproses…' : 'Konfirmasi Pembayaran'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
