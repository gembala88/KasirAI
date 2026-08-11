import { useEffect, useState, type ReactNode } from 'react';
import {
  IconAlertTriangle,
  IconBoxSeam,
  IconCalendarTime,
  IconCash,
  IconChevronRight,
  IconClockHour4,
  IconHistory,
  IconLayoutDashboard,
  IconLogout,
  IconRefresh,
  IconSettings,
  IconShoppingCart,
  IconTrendingUp,
  IconUserCircle,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import { listQueuedActions } from '../lib/offline-queue';
import {
  fetchDashboardSummary,
  fetchKasbonInvoices,
  fetchLowStockAlerts,
  fetchPendingPayments,
  type LowStockAlert,
} from '../lib/api';
import { getLastSyncedAt } from '../lib/catalog-cache';
import type { AuthUser } from '../lib/auth';
import { formatQty, formatRupiah, formatSyncedAt } from '../lib/format';
import { STORE_NAME } from '../branding';

/** Same role check as the report-dashboard's owner-facing analytics — Cashier and Warehouse Staff aren't shown store-wide stock-level alerts, just what's needed for their own screens. */
const LOW_STOCK_VISIBLE_ROLES = new Set<AuthUser['role']>(['Owner', 'Manager']);
const FINANCIAL_SUMMARY_ROLES = new Set<AuthUser['role']>(['Owner', 'Manager']);
const PENDING_PAYMENT_VISIBLE_ROLES = new Set<AuthUser['role']>(['Owner', 'Manager', 'Cashier']);

export type HomeDestination = 'warehouse' | 'kasir' | 'riwayat' | 'kasbon' | 'settings';

/** Max items shown inline in the low-stock glance card — keeps Beranda's critical actions (Kasir, Gudang) reachable without scrolling on a real phone (375×812) even when many items are flagged. The full list is one tap away via the stat card or "lihat semua". */
const LOW_STOCK_BANNER_PREVIEW_COUNT = 3;

type MenuColor = 'blue' | 'green' | 'purple' | 'amber';

export interface MenuItem {
  id: HomeDestination | 'dashboard';
  label: string;
  subtitle: string;
  icon: ReactNode;
  color: MenuColor;
}

/** Exported so App.tsx's mobile hamburger drawer (Part 3) shares the exact same role-gated nav list as the desktop menu grid — one place to add/remove a destination. */
export const MENU_BY_ROLE: Record<AuthUser['role'], MenuItem[]> = {
  Owner: [
    {
      id: 'kasir',
      label: 'Kasir',
      subtitle: 'Checkout & pembayaran',
      icon: <IconShoppingCart />,
      color: 'blue',
    },
    {
      id: 'warehouse',
      label: 'Gudang',
      subtitle: 'Stok, transfer, scan barcode',
      icon: <IconBoxSeam />,
      color: 'green',
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Laporan & analitik',
      icon: <IconLayoutDashboard />,
      color: 'purple',
    },
    {
      id: 'riwayat',
      label: 'Riwayat Transaksi',
      subtitle: 'Daftar & detail transaksi, cetak ulang struk',
      icon: <IconHistory />,
      color: 'blue',
    },
    {
      id: 'kasbon',
      label: 'Tagihan Kasbon',
      subtitle: 'Tagihan belum lunas, konfirmasi pembayaran',
      icon: <IconCalendarTime />,
      color: 'amber',
    },
    {
      id: 'settings',
      label: 'Pengaturan',
      subtitle: 'Profil toko & template struk',
      icon: <IconSettings />,
      color: 'green',
    },
  ],
  Manager: [
    {
      id: 'kasir',
      label: 'Kasir',
      subtitle: 'Checkout & pembayaran',
      icon: <IconShoppingCart />,
      color: 'blue',
    },
    {
      id: 'warehouse',
      label: 'Gudang',
      subtitle: 'Stok, transfer, scan barcode',
      icon: <IconBoxSeam />,
      color: 'green',
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Laporan & analitik',
      icon: <IconLayoutDashboard />,
      color: 'purple',
    },
    {
      id: 'riwayat',
      label: 'Riwayat Transaksi',
      subtitle: 'Daftar & detail transaksi, cetak ulang struk',
      icon: <IconHistory />,
      color: 'blue',
    },
    {
      id: 'kasbon',
      label: 'Tagihan Kasbon',
      subtitle: 'Tagihan belum lunas, konfirmasi pembayaran',
      icon: <IconCalendarTime />,
      color: 'amber',
    },
    {
      id: 'settings',
      label: 'Pengaturan',
      subtitle: 'Profil toko & template struk',
      icon: <IconSettings />,
      color: 'green',
    },
  ],
  Cashier: [
    {
      id: 'kasir',
      label: 'Kasir',
      subtitle: 'Checkout & pembayaran',
      icon: <IconShoppingCart />,
      color: 'blue',
    },
    {
      id: 'riwayat',
      label: 'Riwayat Transaksi',
      subtitle: 'Daftar & detail transaksi, cetak ulang struk',
      icon: <IconHistory />,
      color: 'blue',
    },
    {
      id: 'kasbon',
      label: 'Tagihan Kasbon',
      subtitle: 'Tagihan belum lunas, konfirmasi pembayaran',
      icon: <IconCalendarTime />,
      color: 'amber',
    },
    {
      id: 'dashboard',
      label: 'Dashboard',
      subtitle: 'Konfirmasi pembayaran',
      icon: <IconLayoutDashboard />,
      color: 'purple',
    },
  ],
  'Warehouse Staff': [
    {
      id: 'warehouse',
      label: 'Gudang',
      subtitle: 'Stok, transfer, scan barcode',
      icon: <IconBoxSeam />,
      color: 'green',
    },
  ],
};

const TODAY_LABEL = new Intl.DateTimeFormat('id-ID', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Post-login landing screen. Renders two variants of the same data — one
 * mobile (the original stacked-card layout, untouched), one desktop (a
 * fixed-width "Ringkasan Hari Ini" panel + a 3x2 menu grid, no sidebar) —
 * switched purely by CSS media query (`.home-mobile`/`.home-desktop`), not
 * JS, so there's no layout-shift or double-fetch when the viewport crosses
 * 1024px.
 */
export default function Home({
  user,
  isOnline,
  onNavigate,
  onLogout,
}: {
  user: AuthUser;
  isOnline: boolean;
  /** `lowStockItemCodes` is only passed when navigating to Gudang from the low-stock stat card/banner — tells Daftar Produk to open pre-filtered instead of showing every product. */
  onNavigate: (destination: HomeDestination, lowStockItemCodes?: string[]) => void;
  onLogout: () => void;
}) {
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [lowStock, setLowStock] = useState<LowStockAlert[] | null>(null);
  const [revenue, setRevenue] = useState<number | null>(null);
  const [profit, setProfit] = useState<number | null>(null);
  const [invoiceCount, setInvoiceCount] = useState<number | null>(null);
  const [pendingPaymentCount, setPendingPaymentCount] = useState<number | null>(null);
  const [kasbonCount, setKasbonCount] = useState<number | null>(null);
  const canSeeLowStock = LOW_STOCK_VISIBLE_ROLES.has(user.role);
  const canSeeFinancials = FINANCIAL_SUMMARY_ROLES.has(user.role);
  const canSeePendingPayments = PENDING_PAYMENT_VISIBLE_ROLES.has(user.role);
  const lastSyncedAt = getLastSyncedAt();

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

  useEffect(() => {
    if (!canSeeFinancials) return;
    let cancelled = false;
    fetchDashboardSummary()
      .then(({ today }) => {
        if (!cancelled) {
          setRevenue(today.revenue);
          setProfit(today.profit);
          setInvoiceCount(today.invoiceCount);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canSeeFinancials]);

  useEffect(() => {
    if (!canSeePendingPayments) return;
    let cancelled = false;
    fetchPendingPayments()
      .then(({ orders }) => {
        if (!cancelled) setPendingPaymentCount(orders.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [canSeePendingPayments]);

  useEffect(() => {
    let cancelled = false;
    fetchKasbonInvoices()
      .then(({ invoices }) => {
        if (!cancelled) setKasbonCount(invoices.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const menuItems = MENU_BY_ROLE[user.role];
  const badgeForItem = (id: MenuItem['id']): number | null => {
    if (id === 'kasbon') return kasbonCount;
    if (id === 'dashboard' && canSeePendingPayments) return pendingPaymentCount;
    return null;
  };

  const lowStockBanner = canSeeLowStock && lowStock && lowStock.length > 0 && (
    <button
      type="button"
      className="card low-stock-banner"
      onClick={() =>
        onNavigate(
          'warehouse',
          lowStock.map((item) => item.itemCode),
        )
      }
    >
      <h3 className="low-stock-banner-title">
        <IconAlertTriangle size={18} /> {lowStock.length} produk stoknya hampir habis
      </h3>
      <ul className="low-stock-list">
        {lowStock.slice(0, LOW_STOCK_BANNER_PREVIEW_COUNT).map((item) => (
          <li key={item.itemCode}>
            <span className="low-stock-item-name">{item.itemName}</span>
            <span className="low-stock-item-qty">
              Sisa {formatQty(item.actualQty)} (batas {formatQty(item.threshold)})
            </span>
          </li>
        ))}
      </ul>
      {lowStock.length > LOW_STOCK_BANNER_PREVIEW_COUNT && (
        <span className="low-stock-banner-more">
          +{lowStock.length - LOW_STOCK_BANNER_PREVIEW_COUNT} produk lainnya — lihat semua
        </span>
      )}
    </button>
  );

  function renderMenuCard(item: MenuItem, variant: 'mobile' | 'desktop') {
    const badge = badgeForItem(item.id);
    const body =
      variant === 'mobile' ? (
        <>
          <span className={`menu-card-icon menu-card-icon--${item.color}`}>{item.icon}</span>
          <span className="menu-card-body">
            <span className="menu-card-title">{item.label}</span>
            <span className="menu-card-subtitle">{item.subtitle}</span>
          </span>
          <IconChevronRight size={20} className="menu-card-chevron" />
        </>
      ) : (
        <>
          <span className={`grid-card-icon grid-card-icon--${item.color}`}>{item.icon}</span>
          {!!badge && <span className="grid-card-badge">{badge}</span>}
          <span className="grid-card-title">{item.label}</span>
          <span className="grid-card-subtitle">{item.subtitle}</span>
        </>
      );
    const className = variant === 'mobile' ? 'card menu-card' : 'card grid-card';
    return item.id === 'dashboard' ? (
      <a key={item.id} href="/" className={className}>
        {body}
      </a>
    ) : (
      <button
        key={item.id}
        type="button"
        className={className}
        onClick={() => onNavigate(item.id as HomeDestination)}
      >
        {body}
      </button>
    );
  }

  return (
    <>
      {/* --- Mobile (<1024px): original stacked layout, unchanged --- */}
      <div className="home-mobile">
        <div className="home-greeting">
          <h2 className="page-title">Halo, {user.fullName}</h2>
          <span className="text-muted">{user.role}</span>
        </div>

        <div className="stat-grid">
          <div className="card stat-card">
            <IconRefresh size={22} className="stat-card-icon" />
            <span className="stat-card-value">{pendingCount ?? '—'}</span>
            <span className="stat-card-label">Menunggu Disimpan</span>
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
          {canSeeLowStock &&
            (lowStock && lowStock.length > 0 ? (
              <button
                type="button"
                className="card stat-card stat-card--button"
                onClick={() =>
                  onNavigate(
                    'warehouse',
                    lowStock.map((item) => item.itemCode),
                  )
                }
              >
                <IconAlertTriangle
                  size={22}
                  className="stat-card-icon"
                  style={{ color: 'var(--color-warning)' }}
                />
                <span className="stat-card-value">{lowStock.length}</span>
                <span className="stat-card-label">Stok Hampir Habis</span>
              </button>
            ) : (
              <div className="card stat-card">
                <IconAlertTriangle size={22} className="stat-card-icon" />
                <span className="stat-card-value">{lowStock?.length ?? '—'}</span>
                <span className="stat-card-label">Stok Hampir Habis</span>
              </div>
            ))}
        </div>

        {lowStockBanner}

        <div className="menu-list">{menuItems.map((item) => renderMenuCard(item, 'mobile'))}</div>
      </div>

      {/* --- Desktop (>=1024px): top bar + two-panel layout, no sidebar --- */}
      <div className="home-desktop">
        <header className="desktop-topbar">
          <div className="desktop-topbar-brand">
            <span className="desktop-topbar-logo">{STORE_NAME.slice(0, 1)}</span>
            <span className="desktop-topbar-store">
              <span className="desktop-topbar-store-name">{STORE_NAME}</span>
              <span className="desktop-topbar-tagline">Toko New Pelangi · Grosir &amp; Ecer</span>
            </span>
          </div>
          <div className="desktop-topbar-actions">
            <span className={isOnline ? 'status-chip status-chip--online' : 'status-chip'}>
              <span className="status-chip-dot" /> {isOnline ? 'Online' : 'Offline'}
            </span>
            <span className="desktop-topbar-user">
              <IconUserCircle size={28} />
              <span className="desktop-topbar-user-text">
                <span className="desktop-topbar-user-name">{user.fullName}</span>
                <span className="desktop-topbar-user-role">{user.role}</span>
              </span>
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Pengaturan"
              onClick={() => onNavigate('settings')}
            >
              <IconSettings size={20} />
            </button>
            <button type="button" className="icon-button" aria-label="Keluar" onClick={onLogout}>
              <IconLogout size={20} />
            </button>
          </div>
        </header>

        <div className="desktop-body">
          <aside className="desktop-sidebar">
            <h3 className="section-label">Ringkasan Hari Ini</h3>
            <ul className="desktop-summary-list">
              <li>
                <span className="desktop-summary-icon">
                  <IconCash size={18} />
                </span>
                <span className="desktop-summary-label">Omzet</span>
                <span className="desktop-summary-value">
                  {canSeeFinancials ? (revenue === null ? '—' : formatRupiah(revenue)) : '—'}
                </span>
              </li>
              <li>
                <span className="desktop-summary-icon">
                  <IconTrendingUp size={18} />
                </span>
                <span className="desktop-summary-label">Profit</span>
                <span className="desktop-summary-value">
                  {canSeeFinancials ? (profit === null ? '—' : formatRupiah(profit)) : '—'}
                </span>
              </li>
              <li>
                <span className="desktop-summary-icon">
                  <IconShoppingCart size={18} />
                </span>
                <span className="desktop-summary-label">Transaksi</span>
                <span className="desktop-summary-value">
                  {canSeeFinancials ? (invoiceCount ?? '—') : '—'}
                </span>
              </li>
              <li>
                <span className="desktop-summary-icon">
                  <IconClockHour4 size={18} />
                </span>
                <span className="desktop-summary-label">Menunggu konfirmasi</span>
                <span className="desktop-summary-value">
                  {canSeePendingPayments ? (pendingPaymentCount ?? '—') : '—'}
                </span>
              </li>
              <li>
                <span className="desktop-summary-icon">
                  <IconCalendarTime size={18} />
                </span>
                <span className="desktop-summary-label">Tagihan kasbon</span>
                <span className="desktop-summary-value">{kasbonCount ?? '—'}</span>
              </li>
              <li>
                <span className="desktop-summary-icon">
                  <IconRefresh size={18} />
                </span>
                <span className="desktop-summary-label">Sinkron terakhir</span>
                <span className="desktop-summary-value desktop-summary-value--small">
                  {lastSyncedAt ? formatSyncedAt(lastSyncedAt) : '—'}
                </span>
              </li>
            </ul>

            {lowStockBanner}
          </aside>

          <section className="desktop-main">
            <p className="desktop-date-subtitle">{TODAY_LABEL.format(new Date())}</p>
            <div className="desktop-grid">
              {menuItems.map((item) => renderMenuCard(item, 'desktop'))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
