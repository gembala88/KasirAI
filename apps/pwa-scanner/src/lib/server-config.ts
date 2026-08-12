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

function hasUsablePageOrigin(): boolean {
  return typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol);
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
