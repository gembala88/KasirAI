import { useEffect, useState } from 'react';
import { fetchSyncConflicts } from '../lib/api';
import type { SyncConflict } from '../lib/types';

const ACTION_TYPE_LABELS: Record<string, string> = {
  'add-stock': 'Tambah Stok',
  'reduce-stock': 'Kurangi Stok',
  transfer: 'Transfer',
  'pos-sale': 'Penjualan Kasir',
};

/**
 * Manual-review list for offline syncs that landed in Conflict status
 * (spec §15.2 — e.g. two overlapping stock changes would have taken a
 * warehouse negative). Deliberately not auto-resolved: "silently guessing
 * on a stock/money discrepancy is worse than asking the owner to glance
 * at it." A basic read-only table for now, no resolution workflow — that
 * matches what was actually asked for this pass.
 */
export default function SyncConflicts() {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { conflicts: fetched } = await fetchSyncConflicts();
      setConflicts(fetched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) {
    return <p className="hint">Memuat daftar konflik…</p>;
  }

  return (
    <div className="sync-conflicts">
      <p className="hint">
        Transaksi offline yang gagal disinkron karena konflik nyata (mis. stok akan menjadi
        negatif) — tidak diterapkan otomatis, perlu ditinjau manual (§15.2).
      </p>
      {error && <p className="error-box">{error}</p>}

      {conflicts.length === 0 ? (
        <p className="hint">Tidak ada konflik saat ini.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Waktu (perangkat)</th>
              <th>Jenis</th>
              <th>Alasan</th>
              <th>UUID</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((conflict) => (
              <tr key={conflict.uuid}>
                <td>{new Date(conflict.clientTimestamp).toLocaleString('id-ID')}</td>
                <td>{ACTION_TYPE_LABELS[conflict.actionType] ?? conflict.actionType}</td>
                <td>{conflict.errorMessage ?? '—'}</td>
                <td className="hint">{conflict.uuid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
