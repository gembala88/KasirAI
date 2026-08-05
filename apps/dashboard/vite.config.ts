import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { STORE_NAME } from './src/branding';

export default defineConfig({
  plugins: [
    react(),
    // Installable on the store's own PC/tablet as a real app (RUNBOOK.md
    // "Store PC/tablet setup") — added in the pre-launch polish pass since
    // this app previously had no manifest at all and could not actually be
    // installed, unlike apps/pwa-scanner.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: STORE_NAME,
        short_name: STORE_NAME.length > 12 ? 'Dashboard' : STORE_NAME,
        description: 'Owner/manager dashboard — ringkasan, Tanya Hermes, konfirmasi pembayaran.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: 'icon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg}'],
        // Real bug found live: Workbox's generateSW mode auto-adds a
        // NavigationRoute serving this app's own index.html for *every*
        // navigation within its scope — and this app's scope is "/"
        // (correct, since it's genuinely served at the domain root), which
        // technically covers every other top-level path Nginx proxies
        // elsewhere too (/scan/, /erp/, /health), not just this app's own
        // routes. Once this service worker is active and has
        // clientsClaim()'d, it hijacks navigations to any of these paths —
        // silently serving this app's own shell instead, with the browser's
        // address bar showing the real URL but the network request never
        // actually leaving the browser (confirmed live: Nginx's access log
        // showed zero page requests for /erp/, only this app's own API
        // calls with a /erp/ Referer — the service worker never even asked
        // the network). Permanent for any device that's ever loaded this
        // dashboard once, until the service worker itself is updated. This
        // denylist tells Workbox's auto-generated NavigationRoute to pass
        // these paths through to the network instead of serving this app's
        // shell — /scan/ found and fixed first, /erp/ found live later via
        // the exact same mechanism (spec §1.4 "Owner reaches ERPNext
        // directly"), /health added proactively since it's the same class
        // of bug waiting to happen.
        navigateFallbackDenylist: [/^\/scan\//, /^\/erp\//, /^\/health$/],
      },
    }),
  ],
  server: {
    port: 5174,
  },
});
