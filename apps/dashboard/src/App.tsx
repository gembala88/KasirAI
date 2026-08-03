import { useEffect, useState } from 'react';
import { IconArrowLeft } from '@tabler/icons-react';
import { STORE_NAME } from './branding';
import Home, { type HomeTab } from './components/Home';
import Login from './components/Login';
import Overview from './components/Overview';
import OwnerChat from './components/OwnerChat';
import Payments from './components/Payments';
import SyncConflicts from './components/SyncConflicts';
import { logout } from './lib/api';
import { getStoredAuth, setOnAuthRequired, type AuthUser } from './lib/auth';
import { getStoredTheme, storeTheme, type Theme } from './lib/theme';

type Tab = HomeTab;
type View = 'home' | Tab;

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
  const [view, setView] = useState<View>('home');
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
    // Reset to the home screen on login/logout/role change, rather than
    // trying to land back on a tab that role might not even have.
    setView('home');
  }, [user]);

  if (!user) {
    return <Login onLoggedIn={setUser} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        {view === 'home' ? (
          <h1 className="page-title">{STORE_NAME}</h1>
        ) : (
          <button type="button" className="home-back" onClick={() => setView('home')}>
            <IconArrowLeft size={18} /> Beranda
          </button>
        )}
        <div className="header-actions">
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

      {view === 'home' && <Home user={user} onNavigate={(tab) => setView(tab)} />}

      {view !== 'home' && visibleTabs.length === 0 && (
        <p className="hint">Belum ada tampilan dashboard untuk role Anda ({user.role}).</p>
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

          <main className="app-main">
            {view === 'overview' && <Overview />}
            {view === 'chat' && <OwnerChat />}
            {view === 'payments' && <Payments />}
            {view === 'sync-conflicts' && <SyncConflicts />}
          </main>
        </>
      )}
    </div>
  );
}
