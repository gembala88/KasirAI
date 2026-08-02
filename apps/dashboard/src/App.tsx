import { useEffect, useState } from 'react';
import { STORE_NAME } from './branding';
import Login from './components/Login';
import Overview from './components/Overview';
import OwnerChat from './components/OwnerChat';
import Payments from './components/Payments';
import SyncConflicts from './components/SyncConflicts';
import { logout } from './lib/api';
import { getStoredAuth, setOnAuthRequired, type AuthUser } from './lib/auth';
import { getStoredTheme, storeTheme, type Theme } from './lib/theme';

type Tab = 'overview' | 'chat' | 'payments' | 'sync-conflicts';

// Which roles see which tabs (backend enforces this too — see
// report-dashboard/ai-gateway/whatsapp/sync routes' requireRole calls;
// this is just so a role isn't shown a tab that would just 403 if
// clicked).
const TABS: Array<{ id: Tab; label: string; roles: AuthUser['role'][] }> = [
  { id: 'overview', label: 'Ringkasan', roles: ['Owner', 'Manager'] },
  { id: 'chat', label: 'Tanya Hermes', roles: ['Owner', 'Manager'] },
  { id: 'payments', label: 'Konfirmasi Pembayaran', roles: ['Owner', 'Manager', 'Cashier'] },
  { id: 'sync-conflicts', label: 'Konflik Sinkron', roles: ['Owner', 'Manager'] },
];

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(() => getStoredAuth()?.user ?? null);
  const [tab, setTab] = useState<Tab | null>(null);
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storeTheme(theme);
  }, [theme]);

  useEffect(() => {
    setOnAuthRequired(() => setUser(null));
    return () => setOnAuthRequired(null);
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
    <div className="app">
      <header className="app-header">
        <h1>{STORE_NAME}</h1>
        <div className="header-actions">
          <span className="hint">
            {user.fullName} · {user.role}
          </span>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          >
            {theme === 'dark' ? '☀️ Mode Terang' : '🌙 Mode Gelap'}
          </button>
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
        <p className="hint">Belum ada tampilan dashboard untuk role Anda ({user.role}).</p>
      ) : (
        <>
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

          <main className="app-main">
            {tab === 'overview' && <Overview />}
            {tab === 'chat' && <OwnerChat />}
            {tab === 'payments' && <Payments />}
            {tab === 'sync-conflicts' && <SyncConflicts />}
          </main>
        </>
      )}
    </div>
  );
}
