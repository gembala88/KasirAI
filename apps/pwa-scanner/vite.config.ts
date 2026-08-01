import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Hermes Scanner',
        short_name: 'Hermes Scan',
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
