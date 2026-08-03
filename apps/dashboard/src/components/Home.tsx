import { useEffect, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconBoxSeam,
  IconCash,
  IconChevronRight,
  IconCreditCard,
  IconMessageCircle,
  IconReportMoney,
  IconShoppingCart,
} from '@tabler/icons-react';
import { fetchDashboardSummary, fetchPendingPayments, fetchSyncConflicts } from '../lib/api';
import type { AuthUser } from '../lib/auth';
import { formatRupiah } from '../lib/format';

export type HomeTab = 'overview' | 'chat' | 'payments' | 'sync-conflicts';

interface MenuItem {
  id: HomeTab | 'kasir' | 'gudang';
  label: string;
  subtitle: string;
  icon: ReactNode;
}

const MENU_BY_ROLE: Record<AuthUser['role'], MenuItem[]> = {
  Owner: [
    { id: 'overview', label: 'Ringkasan', subtitle: 'Omzet, profit, produk terlaris', icon: <IconReportMoney /> },
    { id: 'chat', label: 'Tanya Hermes', subtitle: 'Tanya jawab data toko', icon: <IconMessageCircle /> },
    { id: 'payments', label: 'Konfirmasi Pembayaran', subtitle: 'Verifikasi pembayaran masuk', icon: <IconCreditCard /> },
    { id: 'sync-conflicts', label: 'Konflik Sinkron', subtitle: 'Tinjau transaksi bermasalah', icon: <IconAlertTriangle /> },
    { id: 'kasir', label: 'Kasir', subtitle: 'Checkout & pembayaran', icon: <IconShoppingCart /> },
    { id: 'gudang', label: 'Gudang', subtitle: 'Stok, transfer, scan barcode', icon: <IconBoxSeam /> },
  ],
  Manager: [
    { id: 'overview', label: 'Ringkasan', subtitle: 'Omzet, profit, produk terlaris', icon: <IconReportMoney /> },
    { id: 'chat', label: 'Tanya Hermes', subtitle: 'Tanya jawab data toko', icon: <IconMessageCircle /> },
    { id: 'payments', label: 'Konfirmasi Pembayaran', subtitle: 'Verifikasi pembayaran masuk', icon: <IconCreditCard /> },
    { id: 'sync-conflicts', label: 'Konflik Sinkron', subtitle: 'Tinjau transaksi bermasalah', icon: <IconAlertTriangle /> },
    { id: 'kasir', label: 'Kasir', subtitle: 'Checkout & pembayaran', icon: <IconShoppingCart /> },
    { id: 'gudang', label: 'Gudang', subtitle: 'Stok, transfer, scan barcode', icon: <IconBoxSeam /> },
  ],
  Cashier: [
    { id: 'payments', label: 'Konfirmasi Pembayaran', subtitle: 'Verifikasi pembayaran masuk', icon: <IconCreditCard /> },
    { id: 'kasir', label: 'Kasir', subtitle: 'Checkout & pembayaran', icon: <IconShoppingCart /> },
  ],
  'Warehouse Staff': [
    { id: 'gudang', label: 'Gudang', subtitle: 'Stok, transfer, scan barcode', icon: <IconBoxSeam /> },
  ],
};

/**
 * Post-login landing screen (UI polish pass — mirrors apps/pwa-scanner's
 * Home.tsx so both apps feel like one product). Stat cards use real data
 * already fetched by the roles that can see them (dashboard-summary and
 * sync-conflicts are Owner/Manager-only server-side, pending-payments is
 * available to Cashier too) — never fabricated placeholder numbers.
 */
export default function Home({
  user,
  onNavigate,
}: {
  user: AuthUser;
  onNavigate: (tab: HomeTab) => void;
}) {
  const [revenue, setRevenue] = useState<number | null>(null);
  const [profit, setProfit] = useState<number | null>(null);
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  const [pendingPaymentCount, setPendingPaymentCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (user.role === 'Owner' || user.role === 'Manager') {
      fetchDashboardSummary()
        .then((summary) => {
          if (!cancelled) {
            setRevenue(summary.today.revenue);
            setProfit(summary.today.profit);
          }
        })
        .catch(() => {
          /* Home screen stats are a convenience, not critical — Ringkasan tab shows the real error if this fails. */
        });
      fetchSyncConflicts()
        .then(({ conflicts }) => {
          if (!cancelled) setConflictCount(conflicts.length);
        })
        .catch(() => {});
    }
    if (user.role === 'Cashier' || user.role === 'Owner' || user.role === 'Manager') {
      fetchPendingPayments()
        .then(({ orders }) => {
          if (!cancelled) setPendingPaymentCount(orders.length);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [user.role]);

  const menuItems = MENU_BY_ROLE[user.role];
  const showFinancialStats = user.role === 'Owner' || user.role === 'Manager';

  return (
    <div>
      <div className="home-greeting">
        <h2 className="page-title">Halo, {user.fullName}</h2>
        <span className="text-muted">{user.role}</span>
      </div>

      {(showFinancialStats || pendingPaymentCount !== null) && (
        <div className="stat-grid">
          {showFinancialStats && (
            <>
              <div className="card stat-card">
                <IconCash size={22} className="stat-card-icon" />
                <span className="stat-card-value">{revenue === null ? '—' : formatRupiah(revenue)}</span>
                <span className="stat-card-label">Omzet Hari Ini</span>
              </div>
              <div className="card stat-card">
                <IconReportMoney size={22} className="stat-card-icon" />
                <span className="stat-card-value">{profit === null ? '—' : formatRupiah(profit)}</span>
                <span className="stat-card-label">Profit Hari Ini</span>
              </div>
              <div className="card stat-card">
                <IconAlertTriangle
                  size={22}
                  className="stat-card-icon"
                  style={{ color: conflictCount ? 'var(--color-warning)' : 'var(--color-success)' }}
                />
                <span className="stat-card-value">{conflictCount ?? '—'}</span>
                <span className="stat-card-label">Konflik Sinkron</span>
              </div>
            </>
          )}
          {pendingPaymentCount !== null && (
            <div className="card stat-card">
              <IconCreditCard size={22} className="stat-card-icon" />
              <span className="stat-card-value">{pendingPaymentCount}</span>
              <span className="stat-card-label">Menunggu Konfirmasi</span>
            </div>
          )}
        </div>
      )}

      <div className="menu-list">
        {menuItems.map((item) =>
          item.id === 'kasir' || item.id === 'gudang' ? (
            <a key={item.id} href="/scan/" className="card menu-card">
              <span className="menu-card-icon">{item.icon}</span>
              <span className="menu-card-body">
                <span className="menu-card-title">{item.label}</span>
                <span className="menu-card-subtitle">{item.subtitle}</span>
              </span>
              <IconChevronRight size={20} className="menu-card-chevron" />
            </a>
          ) : (
            <button
              key={item.id}
              type="button"
              className="card menu-card"
              onClick={() => onNavigate(item.id as HomeTab)}
            >
              <span className="menu-card-icon">{item.icon}</span>
              <span className="menu-card-body">
                <span className="menu-card-title">{item.label}</span>
                <span className="menu-card-subtitle">{item.subtitle}</span>
              </span>
              <IconChevronRight size={20} className="menu-card-chevron" />
            </button>
          ),
        )}
      </div>
    </div>
  );
}
