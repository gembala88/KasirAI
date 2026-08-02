import { useEffect, useState } from 'react';
import Kasir from './components/Kasir';
import Login from './components/Login';
import WarehouseScan from './components/WarehouseScan';
import { STORE_NAME } from './branding';
import { logout } from './lib/api';
import { getStoredAuth, setOnAuthRequired, type AuthUser } from './lib/auth';

type Tab = 'warehouse' | 'kasir';

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
  const [tab, setTab] = useState<Tab | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    setOnAuthRequired(() => setUser(null));
    return () => setOnAuthRequired(null);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const visibleTabs = user ? TABS.filter((t) => t.roles.includes(user.role)) : [];

  useEffect(() => {
    if (visibleTabs.length > 0 && (tab === null || !visibleTabs.some((t) => t.id === tab))) {
      setTab(visibleTabs[0]?.id ?? null);
    }
  }, [user, tab, visibleTabs]);

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  return (
    <main className="app">
      {!isOnline && (
        <div className="offline-banner" role="status">
          Mode Offline — akan sinkron otomatis
        </div>
      )}

      <header className="app-header">
        <h1>{STORE_NAME}</h1>
        <div className="header-actions">
          <span className="hint">
            {user.fullName} · {user.role}
          </span>
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

      {visibleTabs.length === 0 ? (
        <p className="hint">Belum ada tampilan untuk role Anda ({user.role}).</p>
      ) : (
        <>
          {visibleTabs.length > 1 && (
            <nav className="tabs">
              {visibleTabs.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={tab === item.id ? 'tab tab--active' : 'tab'}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}

          {tab === 'warehouse' && <WarehouseScan isOnline={isOnline} />}
          {tab === 'kasir' && <Kasir />}
        </>
      )}
    </main>
  );
}
