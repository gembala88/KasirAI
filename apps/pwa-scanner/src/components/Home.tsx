import { useEffect, useState, type ReactNode } from 'react';
import {
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
import type { AuthUser } from '../lib/auth';

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
      subtitle: 'Template struk',
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
      subtitle: 'Template struk',
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

  useEffect(() => {
    let cancelled = false;
    listQueuedActions().then((items) => {
      if (!cancelled) setPendingCount(items.length);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      </div>

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
