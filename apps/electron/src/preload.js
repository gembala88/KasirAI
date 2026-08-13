// contextIsolation boundary — the loaded page is the real KasirAI web app
// and needs no Node/Electron APIs beyond the one flag below (checked via
// window.kasirai?.isElectron, not user-agent sniffing, which is what lets
// apps/pwa-scanner/src/lib/server-config.ts's dashboardLinkProps() open the
// Dashboard as a second Electron-owned window here specifically — while
// Capacitor/plain-browser shells, which have no such window to open,
// keep the previous open-in-system-browser fallback).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('kasirai', {
  isElectron: true,
});
