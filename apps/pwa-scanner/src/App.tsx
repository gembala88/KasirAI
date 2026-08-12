import { useEffect, useState } from 'react';
import { IconArrowLeft, IconMenu2, IconX } from '@tabler/icons-react';
import Home, { MENU_BY_ROLE, type HomeDestination } from './components/Home';
import Kasir from './components/Kasir';
import Login from './components/Login';
import RiwayatTransaksi from './components/RiwayatTransaksi';
import Settings from './components/Settings';
import SetupWizard from './components/SetupWizard';
import TagihanKasbon from './components/TagihanKasbon';
import WarehouseScan from './components/WarehouseScan';
import { STORE_NAME } from './branding';
import { logout, triggerCatalogSync } from './lib/api';
import { getStoredAuth, setOnAuthRequired, type AuthUser } from './lib/auth';
import { hasServerUrl } from './lib/server-config';
import { syncPendingQueue } from './lib/sync';

type Tab = HomeDestination;
type View = 'home' | Tab;

// Which roles see which tabs (the backend enforces this too — see
// inventory.routes.ts's INVENTORY_MANAGE_ROLES and sales-pos.routes.ts's
// POS_ROLES; this is just so a role isn't shown a tab that would just 403
// if used).
const TABS: Array<{ id: Tab; label: string; roles: AuthUser['role'][] }> = [
  { id: 'warehouse', label: 'Gudang', roles: ['Owner', 'Manager', 'Warehouse Staff'] },
  { id: 'kasir', label: 'Kasir', roles: ['Owner', 'Manager', 'Cashier'] },
];

export default function App() {
  // Only false for a genuinely blank packaged app with no server URL known
  // yet (see server-config.ts) — re-read as state (not just called inline
  // in the render below) so saving one in SetupWizard actually re-renders
  // past it, since localStorage writes don't trigger React updates on
  // their own.
  const [serverConfigured, setServerConfigured] = useState(() => hasServerUrl());
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuth()?.user ?? null);
  const [view, setView] = useState<View>('home');
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  // Set only when Beranda's low-stock stat card/banner navigates to Gudang —
  // tells WarehouseScan to open straight into Daftar Produk, pre-filtered.
  // WarehouseScan remounts fresh every time `view` becomes 'warehouse' (it's
  // unmounted whenever the user is elsewhere), so this only needs to be read
  // once at mount, not kept in sync afterwards.
  const [lowStockNavFilter, setLowStockNavFilter] = useState<string[] | null>(null);
  // Mobile-only (<1024px) nav drawer (Part 3) — desktop never opens this,
  // it has the full menu grid on Beranda instead.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setOnAuthRequired(() => setUser(null));
    return () => setOnAuthRequired(null);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Reconnect is exactly when a catalog sync matters most — a shift
      // that started offline (or went offline mid-shift) should pick up
      // the current catalog the moment connectivity comes back, not wait
      // for the next login. No-ops harmlessly if not logged in yet.
      void triggerCatalogSync();
      // Real bug found live: this used to only exist inside WarehouseScan's
      // own effect, so reconnecting while on Kasir (or the Home screen)
      // never retried the pending queue at all — it just sat there until
      // someone happened to open Gudang or tap "Sinkron Sekarang" by hand.
      // App-level means every screen gets the same instant-on-reconnect
      // behavior; each screen listens for offline-queue's
      // QUEUE_CHANGED_EVENT to keep its own displayed list in sync.
      void syncPendingQueue();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // The 'online' event only fires on an actual offline→online transition
    // — it never fires for a session that's simply been open and connected
    // the whole time, which is the common real case for a stuck queue (no
    // reconnect ever happens, so nothing ever re-triggers a sweep). This
    // covers "app opened fresh (or already open) with items left over from
    // earlier" without waiting for a network state change that may never
    // come.
    if (user && navigator.onLine) {
      void syncPendingQueue();
    }
  }, [user]);

  const visibleTabs = user ? TABS.filter((t) => t.roles.includes(user.role)) : [];

  useEffect(() => {
    // The low-stock filter is only meant for the one WarehouseScan mount
    // that immediately follows a tap on Beranda's low-stock card — clear it
    // the moment the user leaves Gudang, so a later plain tap on the
    // "Gudang" tab (not through the stat card) opens unfiltered.
    if (view !== 'warehouse') {
      setLowStockNavFilter(null);
    }
  }, [view]);

  useEffect(() => {
    // Reset to the home screen on login/logout/role change, rather than
    // trying to land back on a tab that role might not even have.
    setView('home');
  }, [user]);

  useEffect(() => {
    // Never leave the drawer open across a navigation — every nav item
    // click already closes it explicitly, but this also covers browser
    // back/forward and the low-stock card's programmatic navigation.
    setDrawerOpen(false);
  }, [view]);

  if (!serverConfigured) {
    return <SetupWizard onConfigured={() => setServerConfigured(true)} />;
  }

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  const drawerItems = MENU_BY_ROLE[user.role];

  return (
    <main
      className={view === 'kasir' ? 'app app--kasir' : view === 'home' ? 'app app--home' : 'app'}
    >
      {!isOnline && (
        <div className="offline-banner" role="status">
          Mode Offline — akan sinkron otomatis
        </div>
      )}

      <header className={view === 'home' ? 'app-header app-header--home' : 'app-header'}>
        <button
          type="button"
          className="hamburger-button"
          aria-label="Buka menu navigasi"
          onClick={() => setDrawerOpen(true)}
        >
          <IconMenu2 size={22} />
        </button>
        {view === 'home' ? (
          <h1>{STORE_NAME}</h1>
        ) : (
          <button type="button" className="link-button home-back" onClick={() => setView('home')}>
            <IconArrowLeft size={18} /> Beranda
          </button>
        )}
        <div className="header-actions">
          <button type="button" className="theme-toggle" onClick={handleLogout}>
            Keluar
          </button>
        </div>
      </header>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="nav-drawer-backdrop"
            aria-label="Tutup menu navigasi"
            onClick={() => setDrawerOpen(false)}
          />
          <nav className="nav-drawer" aria-label="Navigasi utama">
            <div className="nav-drawer-header">
              <span className="nav-drawer-title">{STORE_NAME}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Tutup"
                onClick={() => setDrawerOpen(false)}
              >
                <IconX size={20} />
              </button>
            </div>
            <ul className="nav-drawer-list">
              {drawerItems.map((item) =>
                item.id === 'dashboard' ? (
                  <li key={item.id}>
                    <a href="/" className="nav-drawer-item">
                      <span className={`grid-card-icon grid-card-icon--${item.color}`}>
                        {item.icon}
                      </span>
                      {item.label}
                    </a>
                  </li>
                ) : (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="nav-drawer-item"
                      onClick={() => {
                        setLowStockNavFilter(null);
                        setView(item.id as HomeDestination);
                      }}
                    >
                      <span className={`grid-card-icon grid-card-icon--${item.color}`}>
                        {item.icon}
                      </span>
                      {item.label}
                    </button>
                  </li>
                ),
              )}
            </ul>
          </nav>
        </>
      )}

      {view === 'home' && (
        <Home
          user={user}
          isOnline={isOnline}
          onLogout={handleLogout}
          onNavigate={(destination, lowStockItemCodes) => {
            setLowStockNavFilter(lowStockItemCodes ?? null);
            setView(destination);
          }}
        />
      )}

      {(view === 'warehouse' || view === 'kasir') &&
        (visibleTabs.length === 0 ? (
          <p className="hint">Belum ada tampilan untuk role Anda ({user.role}).</p>
        ) : (
          <>
            {visibleTabs.length > 1 && (
              <nav className="tabs">
                {visibleTabs.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={view === item.id ? 'tab tab--active' : 'tab'}
                    onClick={() => setView(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            )}

            {view === 'warehouse' && (
              <WarehouseScan
                initialMode={lowStockNavFilter ? 'daftar-produk' : undefined}
                lowStockItemCodes={lowStockNavFilter ?? undefined}
              />
            )}
            {view === 'kasir' && <Kasir />}
          </>
        ))}

      {/* Standalone screens, not part of the Warehouse/Kasir tab-bar above —
          each is already role-gated at the Home menu level (same
          hide-from-menu + trust-the-server-403 pattern as every other
          role-restricted action in this app). */}
      {view === 'riwayat' && <RiwayatTransaksi />}
      {view === 'kasbon' && <TagihanKasbon />}
      {view === 'settings' && <Settings />}
    </main>
  );
}
