# Packaging KasirAI as a Windows App / Android APK

KasirAI is already a real installable PWA (Progressive Web App) — anyone
can open the server's `/scan/` URL in Chrome and tap "Install app" for a
home-screen icon with no browser chrome, working offline exactly like a
native app. This document is for the extra step of turning that same PWA
into a standalone Windows installer or Android APK.

This used to go through **PWABuilder** (pwabuilder.com), a third-party
site that reads a PWA's manifest and hands back a wrapper package. That
approach is gone — both platforms are now built directly in this repo:

- **Windows**: `apps/electron/` — a real [Electron](https://electronjs.org)
  app, packaged into a `.exe` installer with
  [electron-builder](https://www.electron.build). No PWABuilder account,
  no third-party site reading the live deployment.
- **Android**: `apps/android/` — a real
  [Capacitor](https://capacitorjs.com) app (not a Trusted Web Activity),
  wrapping the PWA in a native `WebView` inside an Android Studio/Gradle
  project you build yourself.

Both load the **exact same PWA build** — `apps/pwa-scanner`'s
`build:electron` script (relative asset paths, so it works loaded from
`file://` under Electron or from Capacitor's local asset server, neither
of which is `http(s)://`). Nothing in `apps/pwa-scanner`'s application
code is duplicated or forked for either shell.

## What's already prepared

- `apps/pwa-scanner/package.json`'s `build:electron` script — builds the
  PWA with `--base=./` (relative asset paths) into `dist-electron/`,
  instead of the normal `/scan/`-absolute build used for server
  deployment.
- `apps/pwa-scanner/src/lib/server-config.ts` — already the single source
  of truth for "what server does this app talk to." Under a normal
  browser tab it defaults to the page's own origin; under `file://`
  (Electron) or Capacitor's local scheme there's no usable origin, so it
  falls through to whatever's saved in `localStorage` under the
  `kasirai-server-url` key, or `null` if nothing's saved yet — which is
  exactly when `SetupWizard` takes over. Both shells get this for free,
  with zero shell-specific setup code.
- `apps/electron/` — `src/main.js` (window creation, menu, window-state
  persistence), `src/preload.js`, `package.json` (electron-builder config:
  appId `com.newpelangi.kasirai`, NSIS installer target), `build/icon.ico`
  + `build/icon.png` (generated from the same source art as the PWA
  icons).
- `apps/android/` — `capacitor.config.ts` (points `webDir` at
  `apps/pwa-scanner`'s `dist-electron` build, same as Electron),
  `package.json` (`@capacitor/core`/`cli`/`android`/`camera`), and a
  generated `android/` native Gradle project (from `npx cap add android`)
  with:
  - `CAMERA` permission declared in `AndroidManifest.xml` (needed for
    barcode scanning in Kasir/Gudang) — both explicitly, and via
    `@capacitor/camera`'s own manifest merge.
  - Real KasirAI launcher icons (not Capacitor's default placeholder) in
    every `mipmap-*` density folder.
  - App name `KasirAI` in `res/values/strings.xml`.

> **Note on the localStorage key**: if you've seen `kasirServerUrl`
> mentioned elsewhere, the actual key used throughout the codebase
> (`server-config.ts`, `SetupWizard`, both shells below) is
> **`kasirai-server-url`**. This doc and all shipped code use the real
> key.

## A. Windows desktop app (Electron)

### Prerequisites

Just Node.js 22+ and this repo — `npm install` at the repo root pulls in
`electron`/`electron-builder` as part of the `apps/electron` workspace.
No separate SDK or account needed.

### Build

```bash
# From the repo root — builds the PWA (relative paths) then packages it:
npm run build:electron            # unpacked app, for quick local testing
npm run build:electron:installer  # real NSIS .exe installer
```

Equivalent step-by-step, if you want to run the pieces individually:

```bash
npm run build:electron --workspace=apps/pwa-scanner   # → apps/pwa-scanner/dist-electron/
npm run dist --workspace=apps/electron                # → apps/electron/release/win-unpacked/
npm run dist:installer --workspace=apps/electron       # → apps/electron/release/KasirAI Setup <version>.exe
```

### Output

- `apps/electron/release/win-unpacked/KasirAI.exe` — run this directly,
  no install, for quick local testing.
- `apps/electron/release/KasirAI Setup <version>.exe` — the real
  installer: double-click, choose an install directory, get a Start Menu
  + desktop shortcut with the KasirAI icon, uninstall entry in Windows
  Settings.

**Verified in this environment**: both build modes were run end-to-end —
the unpacked `KasirAI.exe` was launched and confirmed to start and stay
running (not just compile), and the NSIS installer
(`KasirAI Setup 0.1.0.exe`, ~80MB) was built successfully via
electron-builder. This is an unsigned debug/test build, as requested — no
code-signing certificate is applied, so Windows SmartScreen will show an
"unknown publisher" warning on first run until one is added.

### What you get

- **Menu** (hidden behind `autoHideMenuBar` — press <kbd>Alt</kbd> to
  reveal it): Refresh, Open DevTools (for debugging), About KasirAI, Exit.
- **Window size/position** is remembered between sessions (written to a
  JSON file in the app's user-data folder, not the registry).
- **External links** (e.g. "Edit tata letak struk di ERPNext →" in
  Pengaturan) open in the system's default browser instead of a second
  Electron window.
- **Offline behavior**: unchanged from the browser PWA — the same
  IndexedDB action queue and cached catalog data apply, since it's the
  same app code. (The service worker itself doesn't register under
  `file://`, but it's redundant here anyway — the whole app already ships
  as local files inside the installer, there's nothing left to precache.)
- **First run**: with no `kasirai-server-url` saved yet, the app shows the
  same `SetupWizard` screen ("URL Server" / "Test Koneksi") as the PWA
  does, before loading the real app.

## B. Android APK (Capacitor)

### Prerequisites

This one needs a real Android build toolchain, not just Node:

- Node.js 22+ (same as above)
- JDK 17
- Android SDK — at minimum `platform-tools`, `platforms;android-34`, and
  `build-tools` matching `compileSdkVersion = 34` (set in
  `apps/android/android/variables.gradle`)
- Easiest way to get all three at once: install
  [Android Studio](https://developer.android.com/studio) — it bundles a
  JDK and lets you install SDK components through its SDK Manager UI. Set
  `ANDROID_HOME`/`JAVA_HOME` to match afterwards if you build from the
  command line instead of Android Studio's own "Run" button.

### Build

```bash
# From the repo root:
npm run build:android
```

Equivalent step-by-step:

```bash
npm run build:electron --workspace=apps/pwa-scanner   # → apps/pwa-scanner/dist-electron/
npm run sync --workspace=apps/android                  # copies the build into android/app/src/main/assets/public
npm run build:debug --workspace=apps/android            # ./gradlew assembleDebug
```

Or open `apps/android/android` directly in Android Studio and hit Run —
that's the more reliable path if command-line Gradle gives you SDK
licensing prompts the first time (`sdkmanager --licenses` needs to be
accepted once per machine).

### Output

`apps/android/android/app/build/outputs/apk/debug/app-debug.apk` — an
unsigned debug APK. Copy it to a device (or `adb install app-debug.apk`)
and Android will prompt to allow installing from that source the first
time.

**Verified in this environment**: the full chain was run end-to-end,
including a real `./gradlew assembleDebug` — not just the scaffold. This
sandbox doesn't ship a JDK or Android SDK by default, so a portable JDK 17
and a minimal Android SDK (`platform-tools`, `platforms;android-34`,
`build-tools;34.0.0`) were fetched to unblock Gradle. The build finished
with `BUILD SUCCESSFUL` and produced a real 6.4MB
`app/build/outputs/apk/debug/app-debug.apk`, confirmed via `aapt dump
badging`: package `com.newpelangi.kasirai`, label `KasirAI`,
`android.permission.CAMERA` + `android.permission.INTERNET` both present,
and the actual PWA build (`assets/public/index.html`,
`manifest.webmanifest`) bundled inside. A machine with Android Studio
installed (the normal case for Android development) builds this the same
way, just without needing to fetch a JDK/SDK first.

### What you get

- **Camera permission** pre-declared (`android.permission.CAMERA` in
  `AndroidManifest.xml`), needed for the barcode scanner in Kasir/Gudang —
  the OS will still prompt the user to grant it the first time the app
  actually opens the camera, same as any Android app.
- **Full screen, no browser chrome** — it's a native `WebView`, not a tab.
- **Same offline cache/action queue** as the browser PWA and the Electron
  app — same underlying build.
- **First run**: same `SetupWizard` fallback as Electron, for the same
  reason (`server-config.ts` finds no usable page origin under
  Capacitor's local asset scheme, and no saved `kasirai-server-url` yet).

### Release/signed builds — out of scope here

Both shells above are debug/test builds, per the current ask. For a real
release:

- **Windows**: buy or generate a code-signing certificate and add a
  `certificateFile`/`certificatePassword` (or `signtoolOptions`) to
  `apps/electron/package.json`'s `build.win` config, then rebuild
  `dist:installer`.
- **Android**: generate a signing keystore (`keytool -genkey -v -keystore
  kasirai-release.keystore ...`), configure `apps/android/android/app`'s
  `build.gradle` `signingConfigs`, and run `./gradlew assembleRelease` (or
  `bundleRelease` for a Play Store `.aab`) instead of `assembleDebug`.
  Every future update needs the **same** keystore, or Android refuses to
  install it as an update over the existing one.

## Regenerating icons

Both shells' icons are generated from the same source art as the PWA
(`apps/pwa-scanner/public/icon-512.png` / `.svg`). If that source art ever
changes, regenerate:

- **Electron**: rasterize the SVG at 16/24/32/48/64/128/256px (e.g. with
  `sharp`) and combine into `apps/electron/build/icon.ico` (e.g. with
  `png-to-ico`); copy the 512px PNG to `apps/electron/build/icon.png`.
- **Android**: resize into `apps/android/android/app/src/main/res/mipmap-
  {mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png` (48/72/96/144/192px)
  and `ic_launcher_round.png` (same sizes, circular alpha mask) and
  `ic_launcher_foreground.png` (used by the adaptive icon XML in
  `mipmap-anydpi-v26/`).

## Verifying either packaged app

Same checklist regardless of shell:

- Opens straight to the login screen (after `SetupWizard`, if this is the
  first run) with no browser UI at all.
- Turn off Wi-Fi/mobile data after logging in once — Kasir should still
  let you scan and check out (same offline-first behavior as the browser
  PWA, see `docs/PANDUAN_OPERASIONAL.md` section 4).
- Window size (Windows) reopens where you left it after a restart.
- Camera scan button in Kasir actually opens the camera (Android — first
  launch prompts for the permission declared above).
