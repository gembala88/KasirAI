import { useEffect, useState } from 'react';
import { fetchDashboardSummary } from '../lib/api';
import { formatRupiah } from '../lib/format';
import type { DashboardSummary } from '../lib/types';

export default function Overview() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSummary(await fetchDashboardSummary());
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
    return <p className="hint">Memuat data dari ERPNext…</p>;
  }
  if (error) {
    return (
      <div className="error-box">
        <p>Gagal memuat ringkasan: {error}</p>
        <button type="button" onClick={() => void load()}>
          Coba lagi
        </button>
      </div>
    );
  }
  if (!summary) {
    return null;
  }

  return (
    <div className="overview">
      <div className="card-grid">
        <div className="card">
          <span className="card-label">Omzet Hari Ini</span>
          <span className="card-value">{formatRupiah(summary.today.revenue)}</span>
          <span className="card-sub">{summary.today.invoiceCount} transaksi</span>
        </div>
        <div className="card">
          <span className="card-label">Profit Hari Ini</span>
          <span className="card-value">{formatRupiah(summary.today.profit)}</span>
        </div>
        <div className="card">
          <span className="card-label">Supplier Terbaik ({summary.rankingWindowDays} hari)</span>
          <span className="card-value">{summary.bestSupplier?.supplierName ?? '—'}</span>
          <span className="card-sub">
            {summary.bestSupplier ? formatRupiah(summary.bestSupplier.totalPurchased) : 'Belum ada data'}
          </span>
        </div>
        <div className="card">
          <span className="card-label">Pelanggan Paling Aktif ({summary.rankingWindowDays} hari)</span>
          <span className="card-value">{summary.mostActiveCustomer?.customerName ?? '—'}</span>
          <span className="card-sub">
            {summary.mostActiveCustomer
              ? `${summary.mostActiveCustomer.invoiceCount}x, ${formatRupiah(summary.mostActiveCustomer.totalSpent)}`
              : 'Belum ada data'}
          </span>
        </div>
      </div>

      <div className="table-grid">
        <section>
          <h2>Produk Terlaris</h2>
          <table>
            <thead>
              <tr>
                <th>Produk</th>
                <th>Qty</th>
                <th>Omzet</th>
              </tr>
            </thead>
            <tbody>
              {summary.bestSellers.length === 0 && (
                <tr>
                  <td colSpan={3}>Belum ada data</td>
                </tr>
              )}
              {summary.bestSellers.map((item) => (
                <tr key={item.itemCode}>
                  <td>{item.itemName}</td>
                  <td>{item.qtySold}</td>
                  <td>{formatRupiah(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Produk Kurang Laris</h2>
          <table>
            <thead>
              <tr>
                <th>Produk</th>
                <th>Qty</th>
                <th>Omzet</th>
              </tr>
            </thead>
            <tbody>
              {summary.worstSellers.length === 0 && (
                <tr>
                  <td colSpan={3}>Belum ada data</td>
                </tr>
              )}
              {summary.worstSellers.map((item) => (
                <tr key={item.itemCode}>
                  <td>{item.itemName}</td>
                  <td>{item.qtySold}</td>
                  <td>{formatRupiah(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Stok Hampir Habis</h2>
          <table>
            <thead>
              <tr>
                <th>Produk</th>
                <th>Gudang</th>
                <th>Sisa</th>
              </tr>
            </thead>
            <tbody>
              {summary.nearOutOfStock.length === 0 && (
                <tr>
                  <td colSpan={3}>Tidak ada yang hampir habis</td>
                </tr>
              )}
              {summary.nearOutOfStock.map((item) => (
                <tr key={`${item.itemCode}-${item.warehouse}`}>
                  <td>{item.itemName}</td>
                  <td>{item.warehouse}</td>
                  <td>{item.actualQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Mendekati Kadaluarsa</h2>
          <table>
            <thead>
              <tr>
                <th>Produk</th>
                <th>Kadaluarsa</th>
                <th>Sisa Hari</th>
                <th>Qty</th>
              </tr>
            </thead>
            <tbody>
              {summary.expiringItems.length === 0 && (
                <tr>
                  <td colSpan={4}>Tidak ada yang mendekati kadaluarsa</td>
                </tr>
              )}
              {summary.expiringItems.map((item) => (
                <tr key={item.batchId}>
                  <td>{item.itemCode}</td>
                  <td>{item.expiryDate}</td>
                  <td>{item.daysUntilExpiry}</td>
                  <td>{item.batchQty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
