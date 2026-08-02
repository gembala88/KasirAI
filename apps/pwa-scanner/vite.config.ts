import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { STORE_NAME } from './src/branding';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        // Same STORE_NAME as the app header (src/branding.ts) — this is
        // also what shows under the icon once installed on a home screen.
        name: STORE_NAME,
        short_name: STORE_NAME.length > 12 ? 'Kasir' : STORE_NAME,
        description: 'Barcode/QR scanning for Hermes — stock in/out, transfer, stock opname.',
        theme_color: '#111827',
        background_color: '#111827',
        display: 'standalone',
        start_url: '/',
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
});
