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
      },
    }),
  ],
  server: {
    port: 5174,
  },
});
