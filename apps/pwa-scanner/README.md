# apps/pwa-scanner

Installable PWA (Vite + React) for warehouse scan actions — add stock,
reduce stock, transfer between warehouses (spec §1.3 FR-7).

## What's here (Phase 2)

- Manual barcode entry (an `<input>` field) as a stand-in for camera
  scanning — proves the offline queue and API wiring; swapping in a real
  camera-based scanner (e.g. a barcode-decoding library) is a follow-up,
  not part of this scaffold.
- Offline-first action queue (`src/lib/offline-queue.ts`, IndexedDB via
  `idb`): actions taken while offline are queued locally and synced
  automatically when the `online` browser event fires, or on demand via
  the "Sinkron Sekarang" button.
- Installable PWA manifest + service worker (`vite-plugin-pwa`) for the
  app shell; scan actions always go through the queue, never a Workbox
  HTTP cache, so there's no risk of serving stale write responses.
- Talks to the inventory module's scan endpoints
  (`/api/v1/inventory/scan/{add-stock,reduce-stock,transfer}`) in
  `apps/api`.

## Running locally

```bash
npm install
npm run dev --workspace=apps/pwa-scanner
```

Defaults to `http://localhost:3000` for the API — override with
`VITE_API_BASE_URL` in a `.env` file in this directory if `apps/api` runs
elsewhere.

To exercise the offline queue: open DevTools → Network → set to "Offline",
submit a scan action (it queues), then set back to "Online" and watch it
sync automatically.
