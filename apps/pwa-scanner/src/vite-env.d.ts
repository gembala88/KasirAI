/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Exposed by apps/electron/src/preload.js via contextBridge — undefined
// everywhere else (browser tab, Capacitor), so always optionally-chained.
interface Window {
  kasirai?: {
    isElectron: true;
  };
  // Injected automatically by @capacitor/android's native-bridge.js before
  // any page script runs — undefined everywhere else (browser tab,
  // Electron). Only the one method server-config.ts actually needs is
  // typed here; the real global has many more (see @capacitor/core).
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
}
