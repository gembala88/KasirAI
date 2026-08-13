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
}
