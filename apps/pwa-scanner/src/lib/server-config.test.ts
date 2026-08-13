import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browserOpen = vi.fn().mockResolvedValue(undefined);
vi.mock('@capacitor/browser', () => ({ Browser: { open: browserOpen } }));

// jsdom isn't configured for this project (see auth.test.ts's same
// comment) — localStorage and window.location are stubbed minimally here,
// just enough for these pure storage-logic tests.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value),
  removeItem: (key: string) => store.delete(key),
});
vi.stubGlobal('window', {
  location: { protocol: 'https:', origin: 'https://newpelangi.duckdns.org' },
});

const {
  clearServerUrl,
  dashboardLinkProps,
  getServerUrl,
  hasServerUrl,
  setServerUrl,
  testServerConnection,
} = await import('./server-config');

describe('server-config — Item 2C first-run server URL', () => {
  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://newpelangi.duckdns.org' },
    });
  });

  it("falls back to the page's own origin when nothing is stored — the normal browser-tab/PWA case, never shows the setup wizard", () => {
    expect(getServerUrl()).toBe('https://newpelangi.duckdns.org');
    expect(hasServerUrl()).toBe(true);
  });

  it('prefers an explicitly stored URL over the page origin once one has been saved', () => {
    setServerUrl('https://tokoanda.duckdns.org');
    expect(getServerUrl()).toBe('https://tokoanda.duckdns.org');
  });

  it('strips a trailing slash so paths built as `${url}/api/...` never end up with a double slash', () => {
    setServerUrl('https://tokoanda.duckdns.org/');
    expect(getServerUrl()).toBe('https://tokoanda.duckdns.org');
  });

  it('clearServerUrl reverts back to the page origin default', () => {
    setServerUrl('https://tokoanda.duckdns.org');
    clearServerUrl();
    expect(getServerUrl()).toBe('https://newpelangi.duckdns.org');
  });

  it('has no known server at all for a genuinely blank packaged shell (no usable page origin, nothing stored) — this is exactly when SetupWizard should show', () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', origin: 'null' } });
    expect(getServerUrl()).toBeNull();
    expect(hasServerUrl()).toBe(false);
  });

  it("does NOT treat Capacitor's local https://localhost WebView origin as a real server — SetupWizard must still show on first launch", () => {
    // Real bug found live: Capacitor serves the bundle from
    // https://localhost by default, which passes the plain protocol
    // regex check just like a real deployed server would — every API
    // call went to https://localhost/api/v1/... and got the app's own
    // index.html back ("Unexpected token '<'") instead of the setup
    // wizard ever appearing.
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://localhost' },
      Capacitor: { isNativePlatform: () => true },
    });
    expect(getServerUrl()).toBeNull();
    expect(hasServerUrl()).toBe(false);
  });

  it('once a real server URL is saved (post-SetupWizard), Capacitor correctly uses it instead of https://localhost', () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://localhost' },
      Capacitor: { isNativePlatform: () => true },
    });
    setServerUrl('https://newpelangi.duckdns.org');
    expect(getServerUrl()).toBe('https://newpelangi.duckdns.org');
  });

  it('testServerConnection reports success only on a real 2xx /health response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true } as Response));
    expect(await testServerConnection('https://tokoanda.duckdns.org')).toBe(true);
  });

  it('testServerConnection reports failure on a non-2xx response, without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false } as Response));
    expect(await testServerConnection('https://tokoanda.duckdns.org')).toBe(false);
  });

  it('testServerConnection reports failure (not a thrown error) when the host is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(testServerConnection('https://unreachable.invalid')).resolves.toBe(false);
  });

  it('testServerConnection rejects a blank URL before ever calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await testServerConnection('   ')).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  describe('dashboardLinkProps', () => {
    it('is a plain same-tab relative link in a real browser tab/PWA — unchanged from before this existed', () => {
      expect(dashboardLinkProps()).toEqual({ href: '/' });
    });

    it('falls back to a plain target="_blank" link for an unrecognized packaged shell (neither Electron nor Capacitor) — a reasonable default for anything future/unknown', () => {
      vi.stubGlobal('window', { location: { protocol: 'file:', origin: 'null' } });
      setServerUrl('https://newpelangi.duckdns.org');
      expect(dashboardLinkProps()).toEqual({
        href: 'https://newpelangi.duckdns.org/',
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    });

    it('falls back to "/" under a packaged shell with no known server yet, rather than building a broken "undefined/" URL', () => {
      vi.stubGlobal('window', { location: { protocol: 'file:', origin: 'null' } });
      expect(dashboardLinkProps()).toEqual({
        href: '/',
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    });

    it('under Electron specifically (window.kasirai.isElectron set by preload.js), targets the named window main.js opens in-app instead of the system browser', () => {
      vi.stubGlobal('window', {
        location: { protocol: 'file:', origin: 'null' },
        kasirai: { isElectron: true },
      });
      setServerUrl('https://newpelangi.duckdns.org');
      expect(dashboardLinkProps()).toEqual({
        href: 'https://newpelangi.duckdns.org/',
        target: 'kasirai-dashboard-window',
        rel: 'noopener noreferrer',
      });
    });

    it('under real Capacitor (window.Capacitor.isNativePlatform), returns an onClick handler instead of target="_blank" — no in-app window to target, so it must intercept the click itself', () => {
      vi.stubGlobal('window', {
        location: { protocol: 'https:', origin: 'https://localhost' },
        Capacitor: { isNativePlatform: () => true },
      });
      setServerUrl('https://newpelangi.duckdns.org');
      const props = dashboardLinkProps();
      expect(props.href).toBe('https://newpelangi.duckdns.org/');
      expect(props.target).toBeUndefined();
      expect(typeof props.onClick).toBe('function');
    });

    it('under real Capacitor, clicking the link prevents the default (system browser) navigation and opens Chrome Custom Tabs via Browser.open() instead — real bug found live: a plain target="_blank" click got intercepted by the WebView and handed to the OS as an ACTION_VIEW intent, opening the actual system browser app', async () => {
      vi.stubGlobal('window', {
        location: { protocol: 'https:', origin: 'https://localhost' },
        Capacitor: { isNativePlatform: () => true },
      });
      setServerUrl('https://newpelangi.duckdns.org');
      const props = dashboardLinkProps();
      const preventDefault = vi.fn();
      props.onClick?.({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      // onClick fires the dynamic import + Browser.open() without awaiting —
      // poll until the mocked call has actually landed rather than guessing
      // how many microtask/macrotask hops the dynamic import needs.
      await vi.waitFor(() =>
        expect(browserOpen).toHaveBeenCalledWith({ url: 'https://newpelangi.duckdns.org/' }),
      );
    });
  });
});
