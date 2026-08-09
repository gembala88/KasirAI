import { useEffect, useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import Home, { type HomeDestination } from './components/Home';
import Kasir from './components/Kasir';
import Login from './components/Login';
import WarehouseScan from './components/WarehouseScan';
import { STORE_NAME } from './branding';
import { logout, triggerCatalogSync } from './lib/api';
import { getStoredAuth, setOnAuthRequired, type AuthUser } from './lib/auth';
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
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuth()?.user ?? null);
  const [view, setView] = useState<View>('home');
  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
    // Reset to the home screen on login/logout/role change, rather than
    // trying to land back on a tab that role might not even have.
    setView('home');
  }, [user]);

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  return (
    <main className={view === 'kasir' ? 'app app--kasir' : 'app'}>
      {!isOnline && (
        <div className="offline-banner" role="status">
          Mode Offline — akan sinkron otomatis
        </div>
      )}

      <header className="app-header">
        {view === 'home' ? (
          <h1>{STORE_NAME}</h1>
        ) : (
          <button type="button" className="link-button home-back" onClick={() => setView('home')}>
            <IconArrowLeft size={18} /> Beranda
          </button>
        )}
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={() => {
              logout();
              setUser(null);
            }}
          >
            Keluar
          </button>
        </div>
      </header>

      {view === 'home' && (
        <Home user={user} isOnline={isOnline} onNavigate={(destination) => setView(destination)} />
      )}

      {view !== 'home' && visibleTabs.length === 0 && (
        <p className="hint">Belum ada tampilan untuk role Anda ({user.role}).</p>
      )}

      {view !== 'home' && visibleTabs.length > 0 && (
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

          {view === 'warehouse' && <WarehouseScan />}
          {view === 'kasir' && <Kasir />}
        </>
      )}
    </main>
  );
}
