import { useEffect, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconBoxSeam,
  IconCalendarTime,
  IconChevronRight,
  IconHistory,
  IconLayoutDashboard,
  IconRefresh,
  IconSettings,
  IconShoppingCart,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import { listQueuedActions } from '../lib/offline-queue';
import { fetchLowStockAlerts, type LowStockAlert } from '../lib/api';
import type { AuthUser } from '../lib/auth';
import { formatQty } from '../lib/format';

/** Same role check as the report-dashboard's owner-facing analytics — Cashier and Warehouse Staff aren't shown store-wide stock-level alerts, just what's needed for their own screens. */
const LOW_STOCK_VISIBLE_ROLES = new Set<AuthUser['role']>(['Owner', 'Manager']);

export type HomeDestination = 'warehouse' | 'kasir' | 'riwayat' | 'kasbon' | 'settings';

interface MenuItem {
  id: HomeDestination | 'dashboard';
  label: string;
  subtitle: string;
  icon: ReactNode;
}

const MENU_BY_ROLE: Record<AuthUser['role'], MenuItem[]> = {
  Owner: [
    { id: 'kasir', label: 'Kasir', subtitle: 'Checkout & pembayaran', icon: <IconShoppingCart /> },
    {
      id: 'warehouse',
      label: 'Gudang',
      subtitle: 'Stok, transfer, scan barcode',
      icon: <IconBoxSeam />,
    },
    {
      id: 'riwayat',
      label: 'Riwayat Transaksi',
      subtitle: 'Daftar & detail transaksi, cetak ulang struk',
      icon: <IconHistory />,
    },
    {
      id: 'kasbon',
      label: 'Tagihan Kasbon',
      subtitle: 'Tagihan belum lunas, konfirmasi pembayaran',
      icon: <IconCalendarTime />,
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Laporan & analitik',
      icon: <IconLayoutDashboard />,
    },
    {
      id: 'settings',
      label: 'Pengaturan',
      subtitle: 'Profil toko & template struk',
      icon: <IconSettings />,
    },
  ],
  Manager: [
    { id: 'kasir', label: 'Kasir', subtitle: 'Checkout & pembayaran', icon: <IconShoppingCart /> },
    {
      id: 'warehouse',
      label: 'Gudang',
      subtitle: 'Stok, transfer, scan barcode',
      icon: <IconBoxSeam />,
    },
    {
      id: 'riwayat',
      label: 'Riwayat Transaksi',
      subtitle: 'Daftar & detail transaksi, cetak ulang struk',
      icon: <IconHistory />,
    },
    {
      id: 'kasbon',
      label: 'Tagihan Kasbon',
      subtitle: 'Tagihan belum lunas, konfirmasi pembayaran',
      icon: <IconCalendarTime />,
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Laporan & analitik',
      icon: <IconLayoutDashboard />,
    },
    {
      id: 'settings',
      label: 'Pengaturan',
      subtitle: 'Profil toko & template struk',
      icon: <IconSettings />,
    },
  ],
  Cashier: [
    { id: 'kasir', label: 'Kasir', subtitle: 'Checkout & pembayaran', icon: <IconShoppingCart /> },
    {
      id: 'riwayat',
      label: 'Riwayat Transaksi',
      subtitle: 'Daftar & detail transaksi, cetak ulang struk',
      icon: <IconHistory />,
    },
    {
      id: 'kasbon',
      label: 'Tagihan Kasbon',
      subtitle: 'Tagihan belum lunas, konfirmasi pembayaran',
      icon: <IconCalendarTime />,
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Konfirmasi pembayaran',
      icon: <IconLayoutDashboard />,
    },
  ],
  'Warehouse Staff': [
    {
      id: 'warehouse',
      label: 'Gudang',
      subtitle: 'Stok, transfer, scan barcode',
      icon: <IconBoxSeam />,
    },
  ],
};

/**
 * Post-login landing screen (UI polish pass) — real UX gap found live: a
 * user previously had no way to reach the dashboard, or to see which of
 * Gudang/Kasir they even had access to, without either already knowing
 * the URL or clicking through the small in-app tab bar. Menu items are
 * role-gated the same way App.tsx's TABS array already was; this is a
 * presentation change, not a new permissions model.
 */
export default function Home({
  user,
  isOnline,
  onNavigate,
}: {
  user: AuthUser;
  isOnline: boolean;
  onNavigate: (destination: HomeDestination) => void;
}) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [lowStock, setLowStock] = useState<LowStockAlert[] | null>(null);
  const canSeeLowStock = LOW_STOCK_VISIBLE_ROLES.has(user.role);

  useEffect(() => {
    let cancelled = false;
    listQueuedActions().then((items) => {
      if (!cancelled) setPendingCount(items.length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!canSeeLowStock) {
      return;
    }
    let cancelled = false;
    fetchLowStockAlerts()
      .then(({ alerts }) => {
        if (!cancelled) setLowStock(alerts);
      })
      .catch(() => {
        // Offline or a transient API error — the stat card falls back to
        // "—" and the banner just doesn't show, same as pendingCount's own
        // silent-failure behavior above. Not worth a visible error box on
        // the landing screen for a secondary, non-blocking alert.
        if (!cancelled) setLowStock(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeLowStock]);

  const menuItems = MENU_BY_ROLE[user.role];

  return (
    <div>
      <div className="home-greeting">
        <h2 className="page-title">Halo, {user.fullName}</h2>
        <span className="text-muted">{user.role}</span>
      </div>

      <div className="stat-grid">
        <div className="card stat-card">
          <IconRefresh size={22} className="stat-card-icon" />
          <span className="stat-card-value">{pendingCount ?? '—'}</span>
          <span className="stat-card-label">Menunggu Sinkron</span>
        </div>
        <div className="card stat-card">
          {isOnline ? (
            <IconWifi
              size={22}
              className="stat-card-icon"
              style={{ color: 'var(--color-success)' }}
            />
          ) : (
            <IconWifiOff
              size={22}
              className="stat-card-icon"
              style={{ color: 'var(--color-warning)' }}
            />
          )}
          <span className="stat-card-value">{isOnline ? 'Online' : 'Offline'}</span>
          <span className="stat-card-label">Status Koneksi</span>
        </div>
        {canSeeLowStock && (
          <div className="card stat-card">
            <IconAlertTriangle
              size={22}
              className="stat-card-icon"
              style={
                lowStock && lowStock.length > 0 ? { color: 'var(--color-warning)' } : undefined
              }
            />
            <span className="stat-card-value">{lowStock?.length ?? '—'}</span>
            <span className="stat-card-label">Stok Menipis</span>
          </div>
        )}
      </div>

      {canSeeLowStock && lowStock && lowStock.length > 0 && (
        <div className="card low-stock-banner">
          <h3 className="low-stock-banner-title">
            <IconAlertTriangle size={18} /> {lowStock.length} produk stoknya menipis
          </h3>
          <ul className="low-stock-list">
            {lowStock.map((item) => (
              <li key={item.itemCode}>
                <span className="low-stock-item-name">{item.itemName}</span>
                <span className="low-stock-item-qty">
                  Sisa {formatQty(item.actualQty)} (batas {formatQty(item.threshold)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="menu-list">
        {menuItems.map((item) =>
          item.id === 'dashboard' ? (
            <a key={item.id} href="/" className="card menu-card">
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
              onClick={() => onNavigate(item.id as HomeDestination)}
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
