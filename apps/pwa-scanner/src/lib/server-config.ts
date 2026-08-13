/**
 * Configurable server URL (Item 2C) — lets one generic app build (an APK
 * or Windows package with no store-specific URL baked in) be pointed at
 * any client's own VPS from a first-run setup screen, instead of needing
 * a separate build per client.
 *
 * Deliberately does NOT change behavior for the normal way this app is
 * actually used today: a browser tab or an installed PWA/TWA wrapping a
 * real https:// page (see docs/PACKAGING.md) already has a perfectly
 * good window.location.origin — that's still used automatically, with
 * nothing stored and no setup screen ever shown, exactly like before this
 * existed. The setup screen only appears when neither a stored override
 * nor a usable page origin exists (a genuinely blank packaged shell).
 */

const STORAGE_KEY = 'kasirai-server-url';

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * True inside a real Capacitor native shell (Android/iOS) — set by
 * @capacitor/android's native-bridge.js, injected into the WebView by the
 * native app itself before any page script runs (no npm dependency on
 * @capacitor/core needed in this bundle for it to appear). Needed because
 * Capacitor serves the local bundle from https://localhost by default —
 * syntactically a real, usable-looking https:// origin, but not an actual
 * server. Without this check, hasUsablePageOrigin() below would treat
 * "https://localhost" as the real server origin and every API call would
 * go there instead of the configured server, returning the app's own
 * index.html (a 404 fallback) instead of JSON.
 */
function isCapacitorNative(): boolean {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

function hasUsablePageOrigin(): boolean {
  return (
    typeof window !== 'undefined' &&
    /^https?:$/.test(window.location.protocol) &&
    !isCapacitorNative()
  );
}

/**
 * True under Electron's file:// shell or Capacitor's local asset scheme —
 * neither is the real server origin, so a same-tab relative link (e.g.
 * href="/") resolves to nothing (a blank page) instead of the dashboard.
 * Callers use this to decide whether a link needs an absolute URL instead
 * of the normal in-page relative link.
 */
export function isPackagedShell(): boolean {
  return !hasUsablePageOrigin();
}

/**
 * True only inside the actual Electron shell — set via
 * apps/electron/src/preload.js's contextBridge, not user-agent sniffing.
 * Electron's main.js owns a second BrowserWindow it can open the
 * dashboard into (see dashboardLinkProps below); Capacitor has no such
 * window, so that shell uses its own in-app browser instead (see
 * openInAppBrowser below) — either way, never the system browser.
 */
function isElectronShell(): boolean {
  return typeof window !== 'undefined' && window.kasirai?.isElectron === true;
}

/**
 * Opens a URL in Capacitor's in-app browser (Chrome Custom Tabs on
 * Android — a sheet with its own close button that returns straight to
 * the app, not a separate system browser app/window). A plain
 * `<a target="_blank">` click in the WebView gets intercepted and handed
 * to the OS as an ACTION_VIEW intent instead — that's what was opening
 * the real system browser. Dynamically imported so Electron's and the
 * plain browser build's bundles don't pay for a plugin they never call
 * (this path only runs when isCapacitorNative() is true).
 */
async function openInAppBrowser(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

/**
 * The dashboard is a separate app served at "/", not part of this SPA.
 * A relative href="/" only works in a real browser tab (resolves against
 * window.location); under a packaged shell it resolves to nothing and
 * shows a blank page. Packaged shells get the real server URL instead,
 * opened without ever leaving the app:
 * - Electron: target="kasirai-dashboard-window" — main.js's
 *   setWindowOpenHandler recognizes that exact name and opens the
 *   dashboard in a second window it owns.
 * - Capacitor: an onClick handler that prevents the default (system
 *   browser) navigation and opens Browser.open() (Custom Tabs) instead —
 *   href/target are kept as a harmless fallback for anything that reads
 *   them without executing onClick (e.g. right-click "copy link").
 * A normal browser tab keeps the exact same relative-link behavior as
 * before this existed.
 */
export function dashboardLinkProps(): {
  href: string;
  target?: string;
  rel?: string;
  onClick?: (event: { preventDefault(): void }) => void;
} {
  if (!isPackagedShell()) return { href: '/' };
  const serverUrl = getServerUrl();
  const href = serverUrl ? `${serverUrl}/` : '/';
  if (isElectronShell()) {
    return { href, target: 'kasirai-dashboard-window', rel: 'noopener noreferrer' };
  }
  if (isCapacitorNative()) {
    return {
      href,
      onClick: (event) => {
        event.preventDefault();
        void openInAppBrowser(href);
      },
    };
  }
  return { href, target: '_blank', rel: 'noopener noreferrer' };
}

/** null only when there's truly no known server — a fresh, generic packaged app before its one-time setup screen has been completed. */
export function getServerUrl(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return stored;
  if (hasUsablePageOrigin()) return window.location.origin;
  return null;
}

export function hasServerUrl(): boolean {
  return getServerUrl() !== null;
}

export function setServerUrl(url: string): void {
  const trimmed = stripTrailingSlash(url);
  if (trimmed) localStorage.setItem(STORAGE_KEY, trimmed);
}

/** Lets a store manager point the app at a different server later (e.g. moving to a new VPS) — not wired into the UI yet, exposed for a future Settings option. */
export function clearServerUrl(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Real network probe against the candidate server's /health route — never assumes success from a well-formed URL alone. 5s timeout so a typo'd/unreachable host fails fast instead of hanging the "Test Koneksi" button. */
export async function testServerConnection(url: string): Promise<boolean> {
  const trimmed = stripTrailingSlash(url);
  if (!trimmed) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${trimmed}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
