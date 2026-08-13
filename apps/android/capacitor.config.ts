import type { CapacitorConfig } from '@capacitor/cli';

// Reuses the exact same relative-asset-path build as apps/electron (see
// apps/pwa-scanner's "build:electron" script) rather than a third build
// variant — Capacitor copies whatever's in webDir into the app's assets
// and serves it locally, and relative paths resolve correctly there the
// same way they do under Electron's file://.
const config: CapacitorConfig = {
  appId: 'com.newpelangi.kasirai',
  appName: 'KasirAI',
  webDir: '../pwa-scanner/dist-electron',
  android: {
    // Full screen, no browser chrome — matches the "wraps the PWA in a
    // native WebView, no browser chrome" requirement.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
