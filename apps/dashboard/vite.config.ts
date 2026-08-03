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
        // technically covers /scan/ too. Once this service worker is
        // active and has clientsClaim()'d, it hijacks navigations to
        // /scan/ before apps/pwa-scanner's own (more specifically scoped)
        // service worker ever gets a chance to register — permanently, for
        // any device that has ever loaded this dashboard even once. This
        // denylist tells Workbox's auto-generated NavigationRoute to pass
        // /scan/ requests through instead of serving this app's shell.
        navigateFallbackDenylist: [/^\/scan\//],
      },
    }),
  ],
  server: {
    port: 5174,
  },
});
