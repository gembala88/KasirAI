// Dark mode as default, light mode toggle persisted per user (§9 UI/UX guidelines).
export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'hermes-dashboard-theme';

export function getStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

export function storeTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}
