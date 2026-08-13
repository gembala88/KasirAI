// KasirAI desktop shell — a thin Electron wrapper around the exact same
// PWA already served at /scan/, not a separate app. It bundles that PWA's
// production build (see ../../pwa-scanner's "build:electron" script,
// which rebuilds it with relative asset paths so it loads correctly from
// file:// instead of the normal /scan/ subpath a real server serves it
// under) and loads it locally — so the very same React app, same
// SetupWizard, same offline-queue logic runs here as in a browser tab.
//
// This is why there's no separate "read the server URL" step in this
// file: apps/pwa-scanner/src/lib/server-config.ts already handles that —
// under file:// there's no usable page origin, so it falls through to
// its stored localStorage value, or SetupWizard if there isn't one yet.
// Electron just needs to load the app and get out of the way.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged;

// Where the bundled PWA build actually lives differs between a raw
// `electron .` dev run (straight from the monorepo, no packaging step)
// and a real installed app (electron-builder copies it into
// process.resourcesPath via the "extraResources" entry in package.json's
// "build" config — see that file's comment for why it's extraResources
// and not "files").
function rendererIndexPath() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'pwa-scanner', 'dist-electron', 'index.html');
  }
  return path.join(process.resourcesPath, 'renderer', 'index.html');
}

const WINDOW_STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const DEFAULT_WINDOW_STATE = { width: 1280, height: 800 };

function loadWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Only trust the fields we actually wrote — a hand-edited or
    // corrupted file falling back to defaults is safer than a window
    // that opens off-screen or at 0x0.
    return {
      width: Number.isFinite(parsed.width) ? parsed.width : DEFAULT_WINDOW_STATE.width,
      height: Number.isFinite(parsed.height) ? parsed.height : DEFAULT_WINDOW_STATE.height,
      x: Number.isFinite(parsed.x) ? parsed.x : undefined,
      y: Number.isFinite(parsed.y) ? parsed.y : undefined,
    };
  } catch {
    // No file yet (first run) or it's unreadable/corrupt — either way,
    // defaults are the correct fallback, not an error worth surfacing.
    return DEFAULT_WINDOW_STATE;
  }
}

function saveWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
  try {
    fs.writeFileSync(WINDOW_STATE_FILE, JSON.stringify(bounds), 'utf-8');
  } catch {
    // Best-effort — losing the remembered size/position on a locked-down
    // filesystem isn't worth crashing over.
  }
}

let mainWindow = null;

function createWindow() {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    ...state,
    minWidth: 900,
    minHeight: 600,
    // "Minimal", not truly frameless (frame: false) — this keeps the
    // real OS minimize/maximize/close controls (removing those needs a
    // hand-built custom title bar drawn *inside* the loaded page, out of
    // scope for this scaffold) while autoHideMenuBar tucks the
    // File-style menu below (Refresh/DevTools/About/Exit) out of sight
    // until Alt is pressed — a real window, just without a
    // permanently-visible menu bar cluttering it.
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  const indexPath = rendererIndexPath();
  if (!fs.existsSync(indexPath)) {
    dialog.showErrorBox(
      'KasirAI — build belum ditemukan',
      `Tidak menemukan ${indexPath}.\n\nJalankan "npm run build:electron --workspace=apps/pwa-scanner" dulu sebelum menjalankan aplikasi ini.`,
    );
    app.quit();
    return;
  }
  mainWindow.loadFile(indexPath);

  // Real gap this closes: without this, clicking a link that opens a new
  // tab in a normal browser (e.g. "Edit tata letak struk di ERPNext →"
  // in Pengaturan) would either silently do nothing or open a second,
  // chromeless Electron window inside the app — neither is right for a
  // link meant to leave the app. Route every such request to the user's
  // real default browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => saveWindowState(mainWindow));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: 'KasirAI',
      submenu: [
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.reload(),
        },
        {
          label: 'Open DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => mainWindow?.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        {
          label: 'About KasirAI',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About KasirAI',
              message: 'KasirAI Desktop',
              detail: `Version ${app.getVersion()}\nElectron ${process.versions.electron}\nChromium ${process.versions.chrome}`,
            });
          },
        },
        { type: 'separator' },
        { label: 'Exit', role: 'quit' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    // macOS convention: clicking the dock icon with no windows open
    // should reopen one, rather than the app just sitting there dead.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
