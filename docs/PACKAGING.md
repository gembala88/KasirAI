# Packaging KasirAI as an Android APK / Windows App

KasirAI is already a real installable PWA (Progressive Web App) — anyone can
open `https://newpelangi.duckdns.org/scan/` in Chrome and tap "Install app"
to get a home-screen icon with no browser chrome, working offline exactly
like a native app. This document is for the extra step of turning that PWA
into a standalone **APK** (Android) or **Windows app package** that can be
installed without going through a browser first, or submitted to the Google
Play Store / Microsoft Store.

The actual packaging is done by **[PWABuilder](https://www.pwabuilder.com)**,
a free Microsoft-run tool built exactly for this — it reads the app's PWA
manifest, generates a native wrapper around it (a "Trusted Web Activity" on
Android, an MSIX package on Windows), and hands you a ready-to-build
project. This repo's job is to make sure the manifest PWABuilder reads is
complete and correct — that part is already done (see "What's already
prepared" below). Actually compiling/signing the final APK or MSIX has to
happen on PWABuilder's own site or a machine with the Android/Windows build
tools installed; neither can run inside this repo's own CI or dev
environment.

## What's already prepared

- `apps/pwa-scanner/src/branding.ts` — app name shown under the icon
  (`KasirAI`).
- `apps/pwa-scanner/vite.config.ts`'s `manifest` block — `display:
'standalone'` (no browser UI), `start_url`/`scope` scoped to `/scan/`,
  theme/background colors, and icons at both required sizes:
  - `icon-192.png` / `icon-512.png` — real PNG raster icons (PWABuilder's
    Android/Windows packaging needs PNG, not just SVG — the original
    SVG-only icons were the one thing that would have blocked packaging).
  - `icon-512.png` is also declared with `purpose: "maskable"`, so Android
    can safely crop it into a circle/squircle without cutting off the logo.
  - The original `icon-192.svg` / `icon-512.svg` stay too, for browsers
    that prefer a scalable icon.
- `apps/pwa-scanner/src/main.tsx` already registers a real service worker
  (Workbox, via `vite-plugin-pwa`) that precaches the app shell — offline
  behavior inside the packaged app works exactly like it does in a browser
  tab today, because it's the same PWA underneath.

If you ever change the store name, logo, or theme color, re-run through
this doc afterwards — PWABuilder reads whatever the _deployed_ manifest
says at the time you package, not what's in this repo.

## A. Android APK

1. Make sure the latest build is actually deployed (PWABuilder reads the
   **live** site, not this repo) — see the main deploy steps in
   `RUNBOOK.md` / the VPS guide (`docs/PANDUAN_VPS_BARU.md`) if you're not
   sure it's current.
2. Go to **<https://www.pwabuilder.com>**.
3. Enter `https://newpelangi.duckdns.org/scan/` (use your own domain if
   this is a different client's server — see `docs/PANDUAN_VPS_BARU.md`)
   and click **Start**.
4. PWABuilder scores the manifest and service worker. With the icons above
   already in place you should see manifest and service worker both pass;
   if anything's flagged, PWABuilder's own "Fix" buttons can usually patch
   it directly in their editor without touching this repo.
5. Click **Package for stores**, choose **Android**.
6. Fill in the package identity:
   - **Package ID**: reverse-domain style, e.g. `com.newpelangi.kasirai`
     (use a different one per client if packaging this for more than one
     store).
   - **App name**: `KasirAI`.
   - **Signing key**: for a first build, let PWABuilder **generate a new
     signing key** and download it — keep that `.keystore`/`.jks` file and
     its password somewhere safe. Every future update to this same app
     (on the same device, or on the Play Store) must be signed with the
     _same_ key, or Android will refuse to install it as an update.
7. Download the generated package (a `.zip` containing an Android Studio
   project plus a pre-built `.apk`/`.aab`).
8. **If you just need an installable APK** (sideloading, not the Play
   Store): the zip already contains a signed `app-release-signed.apk` —
   copy it to the device and install it directly (Android will prompt to
   allow installing from this source the first time).
9. **If you're publishing to the Google Play Store**: open the project in
   [Android Studio](https://developer.android.com/studio), build the
   `.aab` (Android App Bundle) instead of the raw APK, and follow Google's
   normal Play Console upload flow. This needs a (one-time, $25) Google
   Play Developer account.

### Verifying the packaged app

Once installed, confirm it behaves like the real app, not a broken shell:

- Opens straight to the login screen with **no visible browser
  address bar/tabs** (that's the "Trusted Web Activity" working —
  Chrome is still rendering it under the hood, just without its own UI).
- Turn off Wi-Fi/mobile data after logging in once: Kasir should still let
  you scan and check out (same offline-first behavior as the browser PWA —
  see `docs/PANDUAN_OPERASIONAL.md` section 4).
- If this APK was built generically (not pointed at one specific store's
  URL) — see the note on generic builds below — the first launch should
  show the **first-run setup screen** ("URL Server" / "Test Koneksi") from
  Item 2C instead of going straight to login.

## B. Windows app package

1. From the same PWABuilder run as above (same
   `https://newpelangi.duckdns.org/scan/` scan), click **Package for
   stores** → **Windows**.
2. Fill in the package identity (publisher name/ID — if you plan to submit
   to the Microsoft Store, these need to match your Partner Center
   account; for internal/sideloaded use, any values work).
3. Download the generated `.msix` (or `.msixbundle` for multiple CPU
   architectures).
4. **To install directly** (no Microsoft Store): the `.msix` needs to be
   signed with a certificate the target Windows machine trusts.
   PWABuilder's Windows package includes a self-signed test certificate —
   for real store-PC deployment, either:
   - Install that test certificate into the PC's trusted store first
     (PWABuilder's download includes an `install.ps1` script that does
     this and installs the app in one step — the intended path for a
     store's own PC, per `RUNBOOK.md`'s "Store PC/tablet setup"), or
   - Re-sign the package with a real code-signing certificate if you have
     one, for a smoother install with no trust warnings.
5. **To publish to the Microsoft Store** instead: upload the `.msix`
   through Partner Center; Microsoft handles signing.

### Verifying the packaged app

Same checklist as Android: standalone window (no browser chrome), works
offline after the first login, and — for a generic (non-store-specific)
build — shows the first-run setup screen before login.

## Generic vs. store-specific builds

Every step above packages the app **pointed at one specific URL**
(`https://newpelangi.duckdns.org/scan/` in the examples). That's the
right choice when you're building for _this_ store — the packaged app
just opens that exact page, same as a bookmark, and never needs the
first-run setup screen at all.

If you want **one generic APK/MSIX you can hand to any future client** and
have them point it at their own VPS, package a URL that has no real
server behind it (e.g. a static placeholder page, or the repo's own GitHub
Pages if one exists) instead of a specific client's domain. On first
launch, `apps/pwa-scanner/src/lib/server-config.ts` won't find a usable
page origin, so `SetupWizard` (Item 2C) takes over automatically — the
client types in their own server's URL, taps **Test Koneksi** to confirm
it's reachable, then **Simpan & Lanjutkan**. From then on that device
remembers the URL (stored in its own `localStorage`) and behaves exactly
like a store-specific build pointed at that server.
