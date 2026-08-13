// Deliberately empty (beyond existing by contract) — the loaded page is
// the real KasirAI web app and needs no Node/Electron APIs exposed to it,
// only the browser APIs it already uses in a normal tab (fetch,
// localStorage, IndexedDB, camera via getUserMedia). Kept as a real file
// (not omitted from webPreferences.preload in main.js) so contextIsolation
// has an explicit, auditable boundary — if a bridge to the main process
// is ever needed later (e.g. a native camera permission prompt), it's
// exposed here via contextBridge.exposeInMainWorld, not by loosening
// nodeIntegration/contextIsolation on the window itself.
