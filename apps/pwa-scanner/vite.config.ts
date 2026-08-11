import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { STORE_NAME } from './src/branding';

export default defineConfig(({ command }) => ({
  // Nginx routes /scan/ to this app (infra/nginx/hermes.conf.template),
  // stripping nothing off the path when it proxies through — so the built
  // index.html must reference its own assets as /scan/assets/... , not
  // /assets/... (Vite's default). Without this, a request for an asset
  // path collides with whatever's actually mounted at the domain root
  // (apps/dashboard) and silently gets served *that* app's HTML instead —
  // a real bug found live while verifying HTTPS end-to-end: the page
  // loaded (200 OK) but React never mounted, because the "JS" the browser
  // fetched was actually dashboard's index.html. Local dev is unaffected
  // — only the production build serves under a subpath.
  base: command === 'build' ? '/scan/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // The default auto-injected registerSW.js has no hook for us to force
      // an already-open tab onto a newly-activated service worker — a real
      // bug found live: a fix shipped, the container restarted, and 8+
      // minutes later the device was still running the old bundle (a hard
      // refresh doesn't bust a Workbox SW cache the way it busts the HTTP
      // cache). Registering manually in main.tsx lets us reload on
      // controllerchange instead.
      injectRegister: false,
      manifest: {
        // Same STORE_NAME as the app header (src/branding.ts) — this is
        // also what shows under the icon once installed on a home screen.
        name: STORE_NAME,
        short_name: STORE_NAME.length > 12 ? 'Kasir' : STORE_NAME,
        description: 'Barcode/QR scanning for KasirAI — stock in/out, transfer, stock opname.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/scan/',
        scope: '/scan/',
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // App shell only — scan actions always go through the IndexedDB
        // queue in src/lib/offline-queue.ts, never a Workbox HTTP cache.
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
  server: {
    port: 5173,
  },
}));
