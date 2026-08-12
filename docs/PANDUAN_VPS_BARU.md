# Panduan Setup VPS Baru untuk KasirAI

Panduan ini untuk memasang KasirAI dari nol di VPS (server) yang benar-benar
baru — ditulis untuk orang yang **belum pernah pakai VPS sama sekali**,
tapi bisa mengikuti langkah demi langkah dan menyalin-tempel perintah.
Setiap perintah dijelaskan dulu sebelum Anda menjalankannya.

Kalau Anda hanya perlu tahu cara **memakai** aplikasi sehari-hari (bukan
memasangnya), lihat [PANDUAN_OPERASIONAL.md](PANDUAN_OPERASIONAL.md).
Panduan ini khusus untuk yang memasang/mengelola server.

---

## Daftar Isi

1. [Spesifikasi VPS Minimum](#1-spesifikasi-vps-minimum)
2. [Setup Awal VPS](#2-setup-awal-vps)
3. [Clone Repo KasirAI dari GitHub](#3-clone-repo-kasirai-dari-github)
4. [Konfigurasi File .env](#4-konfigurasi-file-env)
5. [Menjalankan Seed Script (Data Awal ERPNext)](#5-menjalankan-seed-script-data-awal-erpnext)
6. [Domain/DuckDNS dan HTTPS (certbot)](#6-domainduckdns-dan-https-certbot)
7. [Buka Port Firewall (Contoh: Tencent Cloud Lighthouse)](#7-buka-port-firewall-contoh-tencent-cloud-lighthouse)
8. [Login Pertama Kali dan Verifikasi](#8-login-pertama-kali-dan-verifikasi)
9. [Cara Update KasirAI ke Versi Baru](#9-cara-update-kasirai-ke-versi-baru)
10. [Setup Backup Otomatis](#10-setup-backup-otomatis)

---

## 1. Spesifikasi VPS Minimum

Sebelum sewa VPS, pastikan spesifikasinya minimal:

| Spesifikasi       | Minimum      | Disarankan   |
| ----------------- | ------------ | ------------ |
| CPU               | 2 vCPU       | 2 vCPU       |
| RAM               | 2 GB         | **4 GB**     |
| Penyimpanan (SSD) | 40 GB        | 40 GB        |
| Sistem Operasi    | Ubuntu 22.04 | Ubuntu 22.04 |

**Kenapa 4GB RAM disarankan meskipun minimumnya 2GB?** KasirAI berjalan di
atas ERPNext, yang cukup berat untuk RAM. Dengan 2GB, aplikasi tetap bisa
jalan tapi mengandalkan _swap_ (RAM cadangan dari disk, lebih lambat) saat
sedang ramai. Dengan 4GB, semuanya jalan lebih lancar tanpa perlu terlalu
mengandalkan swap.

Penyedia VPS apa saja bisa dipakai selama memberi akses **root SSH** —
Tencent Cloud Lighthouse, DigitalOcean, Vultr, AWS Lightsail, dll. Panduan
ini memakai Tencent Cloud Lighthouse sebagai contoh di bagian firewall
(bagian 7), karena itu yang dipakai untuk deployment KasirAI yang sudah
berjalan — tapi langkah-langkah lain berlaku sama untuk penyedia manapun.

---

## 2. Setup Awal VPS

### 2.1 Login SSH ke VPS

Setelah VPS aktif, penyedia VPS akan memberi Anda:

- Alamat IP VPS (contoh: `123.45.67.89`)
- Password root (atau file kunci SSH, tergantung penyedia)

Buka **Terminal** (Mac/Linux) atau **PowerShell/Git Bash** (Windows), lalu
ketik:

```bash
ssh root@123.45.67.89
```

(Ganti `123.45.67.89` dengan IP VPS Anda yang sebenarnya.) Kalau diminta
password, masukkan password root yang diberikan penyedia VPS. Kalau muncul
pertanyaan "Are you sure you want to continue connecting?", ketik `yes`
lalu Enter — ini normal untuk koneksi pertama kali.

Kalau berhasil, prompt terminal akan berubah menjadi sesuatu seperti
`root@nama-vps:~#` — artinya Anda sekarang "berada di dalam" VPS.

### 2.2 Update paket sistem

Selalu update dulu sebelum memasang apa pun:

```bash
apt update && apt upgrade -y
```

Ini bisa memakan waktu beberapa menit — tunggu sampai selesai (kembali ke
prompt `root@...#`).

### 2.3 Pasang Docker dan Docker Compose

KasirAI berjalan di dalam **Docker** (semacam "kotak" terisolasi untuk
setiap bagian aplikasi — database, server, dll — supaya tidak bentrok satu
sama lain dan mudah dipindah antar server). Pasang dengan script resmi
Docker:

```bash
curl -fsSL https://get.docker.com | sh
```

Setelah selesai, cek sudah terpasang dengan benar:

```bash
docker --version
docker compose version
```

Keduanya harus menampilkan nomor versi (bukan pesan error "command not
found").

### 2.4 Tambah Swap (Cadangan RAM dari Disk)

Ini langkah keamanan tambahan supaya aplikasi tidak langsung mati kalau
RAM sempat penuh sesaat. Akan dijalankan otomatis oleh script di repo
setelah repo di-clone (lihat bagian 3) — jangan jalankan manual dulu di
sini, cukup diketahui bahwa langkah ini ada.

---

## 3. Clone Repo KasirAI dari GitHub

**Clone** artinya menyalin seluruh kode KasirAI dari GitHub ke VPS Anda.

```bash
cd /opt
git clone https://github.com/gembala88/KasirAI.git hermes-platform
cd hermes-platform
```

Sekarang jalankan script penambah swap yang disebutkan di bagian 2.4:

```bash
sudo bash infra/erpnext/scripts/setup-vps-swap.sh
```

**Catatan penting untuk masa depan**: karena repo ini di-**clone** (bukan
disalin file satu-satu), meng-update KasirAI nanti semudah `git pull` —
lihat bagian 9. (Kalau Anda mewarisi VPS lama yang kodenya disalin manual
tanpa `git clone`, deploy/update jadi lebih ribet — pastikan mulai dari
`git clone` seperti di atas untuk VPS baru.)

---

## 4. Konfigurasi File .env

KasirAI butuh dua file konfigurasi (`.env`) berisi kredensial dan
pengaturan — satu untuk aplikasi KasirAI sendiri, satu untuk ERPNext.
Keduanya **tidak ikut ter-clone dari GitHub** (sengaja, karena berisi
password/kunci rahasia) — Anda salin dari contoh (`.env.example`) lalu isi
sendiri.

### 4.1 Salin file contoh

```bash
cp .env.example .env
cp infra/docker/.env.example infra/docker/.env
```

### 4.2 Isi `infra/docker/.env`

Buka dengan editor teks di terminal (`nano` paling mudah untuk pemula):

```bash
nano infra/docker/.env
```

Isi setiap baris:

| Variabel                    | Penjelasan                                                                             | Contoh               |
| --------------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| `ERPNEXT_VERSION`           | Versi ERPNext — **jangan diubah**, biarkan nilai bawaan.                               | `v16.30.0`           |
| `SITE_NAME`                 | Nama internal situs ERPNext — bebas, tapi tanpa spasi.                                 | `tokoanda.local`     |
| `ADMIN_PASSWORD`            | Password admin ERPNext — **buat password baru yang kuat**, jangan pakai contoh bawaan. | (password acak Anda) |
| `DB_ROOT_PASSWORD`          | Password root database — **buat password baru yang kuat**, beda dari `ADMIN_PASSWORD`. | (password acak Anda) |
| `HTTP_PUBLISH_PORT`         | Port internal ERPNext — biarkan `8080`.                                                | `8080`               |
| `HERMES_REDIS_PUBLISH_PORT` | Port internal Redis — biarkan `6380`.                                                  | `6380`               |
| `DASHBOARD_API_BASE_URL`    | **Biarkan kosong** — lihat komentar di file, mengisi ini salah justru bikin error.     | (kosong)             |
| `PWA_SCANNER_API_BASE_URL`  | **Biarkan kosong** juga, alasan sama.                                                  | (kosong)             |

Simpan dan keluar dari `nano`: tekan `Ctrl+O` lalu `Enter` (menyimpan),
lalu `Ctrl+X` (keluar).

### 4.3 Isi `.env` (di root repo)

```bash
nano .env
```

Baris-baris paling penting untuk diisi sekarang:

| Variabel                                 | Penjelasan                                                                       | Cara isi                                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                               | Mode aplikasi.                                                                   | Ubah ke `production`                                                                                           |
| `JWT_SECRET`                             | Kunci rahasia untuk sesi login. **Wajib diganti**, jangan pakai contoh bawaan.   | Jalankan `openssl rand -base64 48` di terminal, salin hasilnya ke sini                                         |
| `CORS_ALLOWED_ORIGINS`                   | Domain mana saja yang boleh mengakses API.                                       | Ganti `*` dengan domain asli Anda, contoh `https://tokoanda.duckdns.org` (isi setelah domain siap di bagian 6) |
| `ERPNEXT_BASE_URL`                       | Alamat internal ERPNext — **jangan diubah**.                                     | `http://localhost:8080`                                                                                        |
| `ERPNEXT_API_KEY` / `ERPNEXT_API_SECRET` | Kunci API ERPNext — **diisi belakangan**, di bagian 5, setelah ERPNext aktif.    | (kosongkan dulu)                                                                                               |
| `ERPNEXT_DEFAULT_COMPANY`                | Nama toko di ERPNext — akan diisi ulang setelah bagian 5.                        | Biarkan bawaan dulu                                                                                            |
| `ERPNEXT_DEFAULT_WAREHOUSE`              | Nama gudang default — **jangan diubah**.                                         | `Gudang Utama - TH`                                                                                            |
| `ERPNEXT_WEBHOOK_SECRET`                 | Kunci rahasia webhook. **Wajib diisi**, boleh sama caranya seperti `JWT_SECRET`. | `openssl rand -base64 32`                                                                                      |
| `REDIS_URL`                              | Alamat Redis internal — **jangan diubah**.                                       | `redis://localhost:6380`                                                                                       |

Variabel lain (AI provider, WhatsApp, QRIS/pembayaran, Sentry) **boleh
dikosongkan dulu** — aplikasi tetap berjalan normal untuk fitur kasir/
gudang tanpa itu semua. Isi belakangan kalau fitur-fitur tersebut memang
mau dipakai (lihat komentar di dalam file `.env.example` untuk masing-
masing).

Simpan dengan `Ctrl+O`, `Enter`, `Ctrl+X` seperti sebelumnya.

### 4.4 Nyalakan ERPNext

```bash
cd infra/docker
docker compose up -d
```

Ini akan mengunduh dan menyalakan semua komponen ERPNext — **bisa memakan
waktu 5–15 menit** tergantung kecepatan internet VPS, terutama pertama
kali. Pantau proses pembuatan situs ERPNext dengan:

```bash
docker compose logs -f create-site
```

Tunggu sampai muncul baris yang menunjukkan proses selesai (perintah akan
berhenti sendiri dan kembali ke prompt) — tekan `Ctrl+C` untuk keluar dari
tampilan log kalau sudah selesai.

Setelah itu, coba buka `http://<ip-vps-anda>:8080` di browser komputer
Anda — harus muncul halaman login ERPNext. Login sebagai `Administrator`
dengan `ADMIN_PASSWORD` yang Anda isi di langkah 4.2. ERPNext akan
menampilkan **Setup Wizard** — pilih domain bisnis **Distribution** (paling
cocok untuk toko grosir/ecer).

---

## 5. Menjalankan Seed Script (Data Awal ERPNext)

**Seed script** adalah script yang otomatis membuat data dasar yang
dibutuhkan KasirAI di ERPNext — daftar harga (Retail/Grosir/Member),
satuan barang (Pcs/Lusin/Karton/Kg), gudang default, template struk, dll
— supaya Anda tidak perlu membuatnya satu-satu secara manual.

### 5.1 Buat kunci API ERPNext

KasirAI (aplikasinya sendiri, bukan Anda sebagai admin) butuh kunci API
sendiri untuk bicara dengan ERPNext:

```bash
docker compose exec backend bench --site "$SITE_NAME" execute \
  frappe.core.doctype.user.user.generate_keys --args "['Administrator']"
```

(Ganti `$SITE_NAME` dengan nilai `SITE_NAME` yang Anda isi di langkah 4.2,
atau jalankan `source ../../.env` dulu supaya variabelnya terbaca
otomatis dari file.)

Perintah ini menampilkan `api_key` dan `api_secret` — **salin keduanya**.

### 5.2 Isi kunci API ke `.env`

```bash
nano ../../.env
```

Isi `ERPNEXT_API_KEY` dan `ERPNEXT_API_SECRET` dengan hasil dari langkah
5.1. Simpan (`Ctrl+O`, `Enter`, `Ctrl+X`).

### 5.3 Jalankan seed script

Kembali ke folder utama repo:

```bash
cd /opt/hermes-platform
npm install
npm run seed:erpnext --workspace=apps/api
```

`npm install` mengunduh semua library yang dibutuhkan (sekali saja, bisa
beberapa menit). Seed script sendiri aman dijalankan berkali-kali — setiap
langkah di dalamnya mengecek dulu sebelum membuat apa pun, jadi tidak akan
membuat data duplikat kalau Anda jalankan ulang nanti.

### 5.4 Ganti nama toko

Di ERPNext (`http://<ip-vps>:8080`), buka **Setup > Company**, ganti nama
dari nama sementara ("Toko KasirAI") ke nama toko Anda yang sebenarnya, dan
isi alamat toko (akan muncul di struk).

**Langkah wajib setelah ganti nama**: buka lagi `.env`, ubah
`ERPNEXT_DEFAULT_COMPANY` ke nama baru persis seperti yang Anda isi di
ERPNext, lalu restart aplikasi API:

```bash
cd infra/docker
docker compose up -d api
```

**Kenapa ini wajib?** Setiap transaksi yang dibuat KasirAI ditandai dengan
nama perusahaan ini persis. Kalau `.env` masih menyimpan nama lama setelah
Anda ganti di ERPNext, semua transaksi baru akan gagal dengan error
"Cannot find Company" — meskipun tidak ada yang salah dengan kodenya.

---

## 6. Domain/DuckDNS dan HTTPS (certbot)

### 6.1 Daftar domain gratis via DuckDNS (opsional, kalau belum punya domain)

1. Buka [duckdns.org](https://www.duckdns.org), login (bisa pakai akun
   Google/GitHub).
2. Buat subdomain gratis, contoh `tokoanda.duckdns.org`.
3. Isi kolom IP dengan alamat IP VPS Anda, klik **update**.

Kalau sudah punya domain sendiri (bukan DuckDNS), cukup arahkan **A
record** domain tersebut ke IP VPS lewat panel DNS penyedia domain Anda —
langkah 6.2 ke bawah sama saja.

### 6.2 Pasang Nginx dan certbot

**Nginx** adalah "penjaga pintu depan" yang menerima semua permintaan dari
internet dan meneruskannya ke bagian KasirAI yang tepat (API, aplikasi
kasir, ERPNext). **certbot** adalah alat gratis untuk membuat sertifikat
HTTPS (kunci gembok hijau di browser) dari Let's Encrypt.

```bash
apt install -y nginx certbot python3-certbot-nginx
```

### 6.3 Salin konfigurasi Nginx

```bash
cp infra/nginx/hermes.conf.template /etc/nginx/sites-available/kasirai
```

Buka file itu dan ganti setiap kemunculan domain contoh dengan domain asli
Anda:

```bash
nano /etc/nginx/sites-available/kasirai
```

(Cari-ganti `newpelangi.duckdns.org` menjadi domain Anda, contoh
`tokoanda.duckdns.org`.)

Aktifkan konfigurasi ini:

```bash
ln -s /etc/nginx/sites-available/kasirai /etc/nginx/sites-enabled/
nginx -t   # cek tidak ada salah ketik di konfigurasi
systemctl reload nginx
```

Kalau `nginx -t` menampilkan "syntax is ok" dan "test is successful",
lanjut ke langkah berikutnya. Kalau ada error, baca pesannya — biasanya
menunjuk baris mana yang salah.

### 6.4 Aktifkan HTTPS

```bash
certbot --nginx -d tokoanda.duckdns.org
```

(Ganti dengan domain Anda.) certbot akan menanyakan email (untuk
notifikasi kalau sertifikat mau kedaluwarsa) dan menawarkan untuk
otomatis mengalihkan HTTP ke HTTPS — pilih **ya**.

Cek pembaruan otomatis sertifikat berfungsi (sertifikat Let's Encrypt
berlaku 90 hari, certbot memperbaruinya otomatis sebelum kedaluwarsa):

```bash
certbot renew --dry-run
```

Harus menampilkan "Congratulations, all simulated renewals succeeded".

---

## 7. Buka Port Firewall (Contoh: Tencent Cloud Lighthouse)

VPS biasanya punya firewall dari sisi **penyedia cloud** (terpisah dari
firewall di dalam VPS itu sendiri) — kalau ini tidak dibuka, domain Anda
tidak akan bisa diakses dari luar sama sekali meskipun semuanya sudah
benar di dalam VPS.

Langkah untuk **Tencent Cloud Lighthouse** (sesuaikan menu kalau memakai
penyedia lain — DigitalOcean/Vultr/AWS punya panel serupa dengan nama
berbeda):

1. Login ke [Tencent Cloud Console](https://console.cloud.tencent.com/).
2. Buka **Lighthouse** (mesin virtual ringan).
3. Pilih instance VPS Anda.
4. Buka tab **Firewall** (atau "Security Group" tergantung versi panel).
5. Tambah aturan baru untuk membuka port:
   - **Port 80** (HTTP) — protokol TCP, sumber `0.0.0.0/0` (semua alamat).
   - **Port 443** (HTTPS) — protokol TCP, sumber `0.0.0.0/0`.
   - Port 22 (SSH) biasanya sudah terbuka bawaan — **jangan matikan**,
     atau Anda akan terkunci dari VPS sendiri.
6. Simpan aturan.

**Verifikasi dari luar VPS** (bukan dari dalam VPS itu sendiri) — buka
`https://tokoanda.duckdns.org` di browser laptop/HP Anda. Kalau muncul
halaman login KasirAI dengan gembok hijau di address bar, firewall dan
HTTPS sudah benar.

---

## 8. Login Pertama Kali dan Verifikasi

### 8.1 Nyalakan aplikasi KasirAI

```bash
cd /opt/hermes-platform
docker compose -f infra/docker/docker-compose.yml up -d --build api dashboard pwa-scanner
```

Ini membangun dan menyalakan tiga bagian aplikasi (API, dashboard pemilik,
aplikasi kasir/gudang). Proses build pertama kali bisa memakan beberapa
menit.

### 8.2 Buat akun staf pertama

Seed script (bagian 5) sudah membuat beberapa akun contoh dengan role
`hermes_role` di ERPNext (Owner/Manager/Cashier/Warehouse Staff) — cek di
ERPNext (**User List**), atau buat User baru dan set field custom
`hermes_role` sesuai jabatan staf tersebut.

### 8.3 Login dan cek semua fitur inti

- Buka `https://tokoanda.duckdns.org/` (dashboard pemilik) dan
  `https://tokoanda.duckdns.org/scan/` (aplikasi kasir/gudang) — keduanya
  harus menampilkan layar login, bukan error.
- Login dengan salah satu akun staf.
- **Kasir**: coba cari produk, tambah ke keranjang, bayar tunai — pastikan
  transaksi tersimpan.
- **Gudang**: coba tambah stok untuk satu produk.
- **Cetak struk**: dari Riwayat Transaksi, cetak ulang salah satu
  transaksi — pastikan struk tampil dengan benar (nama toko, item, total).

Untuk verifikasi lebih lengkap dan menyeluruh, gunakan
[DEPLOY_CHECKLIST.md](../DEPLOY_CHECKLIST.md) sebagai daftar centang —
setiap butir di sana relevan untuk deployment baru juga, bukan cuma yang
lama.

---

## 9. Cara Update KasirAI ke Versi Baru

Karena repo di-clone lewat `git clone` (bagian 3), update jadi sederhana:

```bash
cd /opt/hermes-platform
git pull origin main
```

Ini mengunduh perubahan kode terbaru. Lalu bangun ulang dan nyalakan ulang
bagian yang berubah:

```bash
docker compose -f infra/docker/docker-compose.yml build api dashboard pwa-scanner
docker compose -f infra/docker/docker-compose.yml up -d api dashboard pwa-scanner
```

**Kalau ada perubahan pada `apps/api/scripts/seed-erpnext.ts`** (jarang,
tapi kadang terjadi saat ada fitur baru yang butuh data ERPNext tambahan),
jalankan ulang seed script juga — aman dijalankan berkali-kali:

```bash
npm run seed:erpnext --workspace=apps/api
```

**Setelah update aplikasi kasir (`pwa-scanner`)**, karena itu adalah PWA
dengan _service worker_ yang menyimpan cache di browser/perangkat, versi
baru kadang butuh langkah tambahan di perangkat kasir supaya benar-benar
memakai versi terbaru (biasanya otomatis dalam semenit, tapi kalau tidak
terlihat berubah): buka aplikasinya, tutup sepenuhnya, buka lagi.

---

## 10. Setup Backup Otomatis

Backup harian sudah disiapkan sebagai _systemd timer_ (jadwal otomatis
bawaan Linux) di `infra/systemd/`. Pasang begini:

```bash
cd /opt/hermes-platform
cp infra/systemd/hermes-backup.* /etc/systemd/system/
```

**Sebelum menyalakan**, buka `hermes-backup.service` dan pastikan dua hal
cocok dengan VPS Anda:

```bash
nano /etc/systemd/system/hermes-backup.service
```

- `SITE_NAME` di dalam file harus sama persis dengan `SITE_NAME` yang Anda
  isi di `infra/docker/.env` (bagian 4.2).
- Path di baris `ExecStart` harus sesuai lokasi repo di-clone — kalau
  Anda mengikuti bagian 3 persis (`/opt/hermes-platform`), ini sudah benar
  dan tidak perlu diubah.

Aktifkan jadwalnya:

```bash
systemctl daemon-reload
systemctl enable --now hermes-backup.timer
```

Cek jadwal aktif dan kapan backup berikutnya akan berjalan:

```bash
systemctl list-timers hermes-backup.timer
```

**Coba jalankan sekali secara manual** untuk memastikan tidak ada error,
daripada menunggu jadwal otomatis besok:

```bash
systemctl start hermes-backup.service
journalctl -u hermes-backup.service -n 50
```

Baca 50 baris log terakhir — pastikan tidak ada pesan error, dan file
backup baru muncul di `/opt/hermes-backups`.

**Sangat disarankan**: sesekali coba proses **restore** dari backup ke
situs percobaan (bukan situs asli) untuk memastikan backup-nya benar-benar
bisa dipakai kalau suatu saat dibutuhkan — lihat bagian "Backups" di
[RUNBOOK.md](../RUNBOOK.md) untuk perintah `--verify-only` yang aman
(tidak menyentuh data asli).

---

Selesai — KasirAI sekarang berjalan di VPS baru Anda. Untuk operasional
sehari-hari (cara pakai aplikasi kasir/gudang), bagikan
[PANDUAN_OPERASIONAL.md](PANDUAN_OPERASIONAL.md) ke staf toko. Untuk
memasang aplikasi sebagai APK Android atau aplikasi Windows, lihat
[PACKAGING.md](PACKAGING.md).
