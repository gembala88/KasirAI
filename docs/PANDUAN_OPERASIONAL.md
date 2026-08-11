# Panduan Operasional Hermes — Untuk Staf Toko

Panduan ini untuk kasir dan staf gudang yang menggunakan aplikasi Hermes sehari-hari. Tidak perlu paham teknis — cukup ikuti langkah-langkahnya.

Jika ada istilah yang belum jelas atau langkah yang tidak sesuai dengan yang Anda lihat di layar, hubungi pemilik toko (lihat bagian [10. Jika Ada Masalah](#10-jika-ada-masalah-hubungi) di akhir panduan ini).

---

## Daftar Isi

1. [Cara Login](#1-cara-login)
2. [Kasir — Cara Memproses Penjualan](#2-kasir--cara-memproses-penjualan)
3. [Gudang — Tambah Stok, Tambah Produk Baru, Cek Daftar Produk](#3-gudang--tambah-stok-tambah-produk-baru-cek-daftar-produk)
4. [Jika Internet Mati (Mode Offline)](#4-jika-internet-mati-mode-offline)
5. [Transaksi "Gagal" vs "Menunggu Sinkron" — Apa Bedanya?](#5-transaksi-gagal-vs-menunggu-sinkron--apa-bedanya)
6. [Riwayat Transaksi & Cetak Ulang Struk](#6-riwayat-transaksi--cetak-ulang-struk)
7. [Konfirmasi Pembayaran QRIS / Transfer](#7-konfirmasi-pembayaran-qris--transfer)
8. [Konfirmasi Pembayaran Kasbon](#8-konfirmasi-pembayaran-kasbon)
9. [Tutup Kasir Harian — Cek Ringkasan Penjualan Hari Ini](#9-tutup-kasir-harian--cek-ringkasan-penjualan-hari-ini)
10. [Jika Ada Masalah, Hubungi](#10-jika-ada-masalah-hubungi)

---

## 1. Cara Login

**Alamat aplikasi:** `https://newpelangi.duckdns.org/scan/`

Buka alamat di atas menggunakan browser HP/tablet/komputer toko (Chrome atau Safari). Simpan alamat ini sebagai bookmark atau tambahkan ke layar utama HP supaya mudah dibuka lagi nanti.

Langkah login:

1. Buka alamat di atas.
2. Masukkan **Email** dan **Password** akun Anda. Akun ini diberikan oleh pemilik toko — setiap staf punya akun sendiri (jangan berbagi akun dengan staf lain).
3. Tekan tombol **Masuk**.

Setelah berhasil, Anda akan masuk ke halaman utama (Beranda) yang menunya menyesuaikan jabatan Anda:

- **Kasir/Cashier**: bisa buka Kasir, Riwayat Transaksi, dan Tagihan Kasbon.
- **Staf Gudang/Warehouse Staff**: bisa buka Gudang saja.
- **Manager** dan **Pemilik/Owner**: bisa buka semua menu, termasuk Dashboard (laporan penjualan) dan Pengaturan toko.

**Anda tidak perlu login ulang setiap hari.** Sekali login, aplikasi akan tetap mengingat Anda selama kurang lebih 30 hari, bahkan kalau HP/tablet sempat mati internetnya semalaman atau lebih. Login ulang hanya diperlukan kalau Anda sengaja menekan tombol **Keluar**, atau kalau sudah lebih dari sebulan aplikasi tidak pernah dibuka sama sekali.

---

## 2. Kasir — Cara Memproses Penjualan

Dari Beranda, tekan **Kasir**.

### Langkah 1 — Masukkan barang

Ada dua cara:

- **Scan barcode**: tekan tombol **Scan** (ikon kamera), arahkan kamera HP ke barcode produk.
- **Cari manual**: ketik nama atau kode barang di kolom pencarian, lalu pilih dari daftar yang muncul.

### Langkah 2 — Atur jumlah (qty)

Setelah barang dipilih, atur jumlahnya dengan keypad angka di layar, atau ketik langsung di kotak jumlah menggunakan keyboard HP/tablet.

- Untuk barang satuan (Pcs, Lusin, Karton): jumlah harus bilangan bulat (1, 2, 3, dst).
- Untuk barang timbangan (Kg): jumlah boleh desimal, misalnya `0.75` untuk 750 gram.

Tekan **Tambah ke Keranjang** untuk memasukkan barang ke keranjang. Ulangi untuk setiap barang yang dibeli pelanggan.

### Langkah 3 — Bayar

Setelah semua barang masuk keranjang, tekan **Bayar**. Pilih salah satu metode:

- **Tunai (Cash)** — masukkan jumlah uang yang diterima dari pelanggan, aplikasi otomatis menghitung kembalian.
- **QRIS** — lihat [bagian 7](#7-konfirmasi-pembayaran-qris--transfer) di bawah.
- **Transfer** — lihat [bagian 7](#7-konfirmasi-pembayaran-qris--transfer) di bawah.
- **Kasbon (utang/bon)** — wajib pilih nama pelanggan dulu (cari dari daftar pelanggan). Kasbon dipakai kalau pelanggan belum bayar sekarang dan akan bayar belakangan. Lihat [bagian 8](#8-konfirmasi-pembayaran-kasbon) untuk cara melunasinya nanti.

Setelah pembayaran selesai, struk akan tampil di layar dan bisa langsung dicetak (lihat [bagian 6](#6-riwayat-transaksi--cetak-ulang-struk)).

---

## 3. Gudang — Tambah Stok, Tambah Produk Baru, Cek Daftar Produk

Dari Beranda, tekan **Gudang**. Ada 3 tab di bagian atas:

### Tab "Input Stok"

Dipakai untuk mencatat perubahan stok barang yang **sudah ada** di sistem. Pilih salah satu **Aksi**:

- **Tambah Stok** — waktu ada barang datang dari supplier. Isi kode/nama barang (bisa scan barcode), jumlah, harga beli per satuan, dan gudang tujuan.
- **Kurangi Stok** — waktu ada barang rusak, hilang, atau dipakai sendiri (bukan terjual lewat Kasir). Isi kode/nama barang dan jumlah yang dikurangi.
- **Transfer** — waktu memindahkan stok dari satu gudang ke gudang lain (kalau toko punya lebih dari satu lokasi penyimpanan).

Setelah diisi, tekan **Kirim**.

### Tab "Tambah Produk Baru"

Dipakai khusus untuk produk yang **belum pernah** ada di sistem. Isi:

- Nama produk.
- Kode barang / barcode (bisa scan langsung, atau ketik manual kalau produk belum punya barcode).
- Satuan (Pcs, Kg, Lusin, Karton, dll) — bisa tambah lebih dari satu satuan kemasan untuk produk yang sama (misal dijual per Pcs dan per Karton sekaligus).
- Harga jual (Retail/Grosir) dan Harga Modal (harga beli).
- Stok awal dan gudang penyimpanan.

Tekan **Simpan** / **Tambah Produk** di akhir form.

### Tab "Daftar Produk"

Daftar semua produk yang ada di toko, lengkap dengan stok saat ini, harga jual, dan Harga Modal. Berguna untuk:

- Cek stok suatu barang tanpa perlu keluar-masuk transaksi.
- Cari produk lewat kolom pencarian (nama atau kode barang).
- Ubah harga jual/harga modal produk — tekan **Edit** di baris produk yang mau diubah (hanya Pemilik/Manager yang bisa mengubah harga).

---

## 4. Jika Internet Mati (Mode Offline)

Aplikasi Hermes **tetap bisa dipakai untuk berjualan** meskipun internet toko sedang mati. Ini penting untuk kasir — jangan panik kalau tiba-tiba internet putus di tengah jam ramai.

Yang perlu diketahui:

- Kasir tetap bisa scan barang dan menyelesaikan transaksi seperti biasa, karena daftar produk dan harga sudah tersimpan di HP/tablet dari sinkronisasi sebelumnya.
- Transaksi yang terjadi saat offline **tidak hilang** — otomatis disimpan dulu di HP, ditandai **"Menunggu Sinkron"**, dan baru benar-benar terkirim ke sistem pusat begitu internet menyala lagi.
- Di halaman Beranda ada kartu **"Menunggu Sinkron"** yang menunjukkan berapa transaksi yang masih menunggu terkirim. Angka ini akan turun sendiri (biasanya dalam beberapa detik) begitu internet kembali normal.
- **Yang TIDAK bisa dilakukan saat offline**: melihat Riwayat Transaksi, Tagihan Kasbon, Daftar Produk terbaru dari server, atau mencetak struk transaksi lama. Ini karena data-data itu perlu diambil langsung dari server setiap kali dibuka.
- Kalau internet mati **cukup lama** (berjam-jam atau semalaman), tidak masalah — begitu internet nyala lagi, cukup buka aplikasinya, semua transaksi yang tertunda akan otomatis terkirim, dan Anda **tidak perlu login ulang**.

**Yang harus dilakukan kasir saat internet mati:**

1. Tetap lanjutkan transaksi seperti biasa — tidak perlu menekan tombol apa pun yang berhubungan dengan "offline".
2. Setelah internet menyala kembali, cek kartu "Menunggu Sinkron" di Beranda sampai angkanya menjadi 0 sebelum tutup toko, untuk memastikan semua transaksi hari itu sudah benar-benar tersimpan di sistem pusat.

---

## 5. Transaksi "Gagal" vs "Menunggu Sinkron" — Apa Bedanya?

Kedua status ini muncul di daftar transaksi yang belum sepenuhnya terkirim (biasanya terlihat di layar Kasir atau Gudang). Bedanya penting:

| Status               | Artinya                                                                                                                                                                               | Yang harus dilakukan                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Menunggu Sinkron** | Transaksi sudah tersimpan di HP, sedang menunggu giliran terkirim ke sistem pusat (biasanya karena internet baru saja mati atau sedang lambat). Ini **normal**, bukan error.          | Tidak perlu apa-apa — tunggu saja, atau tekan tombol **Sinkron Sekarang** kalau internet sudah menyala.                                                                                                                                                                                 |
| **Gagal**            | Transaksi sudah dicoba dikirim ke sistem pusat, tapi **ditolak** karena ada masalah data (misalnya stok tidak cukup, atau kesalahan lain). Ini transaksi yang benar-benar bermasalah. | **Jangan diabaikan.** Baca pesan errornya (muncul di bawah transaksi tersebut), lalu hubungi pemilik toko atau Manager untuk dicek — lihat [bagian 10](#10-jika-ada-masalah-hubungi). Jangan mengulang transaksi yang sama secara manual sebelum dicek, supaya tidak tercatat dua kali. |

---

## 6. Riwayat Transaksi & Cetak Ulang Struk

Dari Beranda, tekan **Riwayat Transaksi**. Layar ini butuh internet aktif (tidak bisa dibuka saat offline).

- Daftar transaksi ditampilkan dari yang terbaru, lengkap dengan nama pelanggan, nomor struk, tanggal/jam, total, dan status (Lunas / Belum Lunas).
- Tekan salah satu transaksi untuk melihat detail lengkapnya (daftar barang yang dibeli, metode bayar).
- Di halaman detail, tekan **Cetak Ulang** untuk menampilkan dan mencetak ulang struknya — berguna kalau pelanggan minta struk dicetak ulang, atau struk pertama macet saat dicetak.

### Mengatur printer thermal (struk 80mm)

Hermes tidak butuh software printer khusus — struk dicetak lewat kotak dialog cetak bawaan Chrome, sama seperti mencetak halaman web biasa. Printer thermal USB atau Bluetooth (kertas 80mm) cukup dipasang sebagai **printer default** di HP/tablet/komputer toko (lewat pengaturan printer bawaan Windows/Android/iOS — bukan pengaturan di dalam Hermes), lalu:

1. Tekan tombol **Cetak Struk** (atau **Cetak Ulang**) di aplikasi.
2. Kotak dialog cetak Chrome akan muncul. Pastikan pengaturannya:
   - **Tujuan/Printer**: pilih printer thermal toko.
   - **Ukuran kertas**: `80mm` × `Auto` (kalau tidak ada pilihan persis ini, pilih ukuran kertas thermal 80mm yang tersedia — jangan pilih A4/Letter, struk akan tercetak terlalu kecil di tengah kertas besar).
   - **Margin**: `None` / `Tidak ada`.
   - **Skala**: `100%` (jangan dicentang "Fit to page" — itu bisa mengecilkan tulisan).
3. Tekan **Cetak**.

Setelah diatur sekali di sebuah HP/tablet/komputer, pengaturan ini biasanya diingat oleh Chrome untuk pencetakan berikutnya di perangkat yang sama.

---

## 7. Konfirmasi Pembayaran QRIS / Transfer

Ini terjadi langsung di layar Kasir, bagian dari proses bayar biasa (bukan layar terpisah):

1. Saat checkout, pelanggan pilih bayar dengan **QRIS** atau **Transfer**.
2. Layar akan berpindah ke **"Menunggu Konfirmasi Pembayaran"**:
   - Kalau QRIS: kode QRIS toko akan tampil di layar — minta pelanggan scan kode tersebut dengan aplikasi e-wallet/mobile banking mereka.
   - Kalau Transfer: nomor rekening toko akan tampil di layar — beritahukan ke pelanggan untuk transfer ke rekening tersebut.
3. **Tunggu sampai Anda benar-benar melihat notifikasi pembayaran masuk** (bunyi notifikasi QRIS, atau pelanggan menunjukkan bukti transfer). Jangan lanjut sebelum yakin uang sudah masuk.
4. Setelah yakin pembayaran diterima, tekan tombol **"Konfirmasi Pembayaran Diterima"**. Transaksi baru akan tercatat lunas setelah tombol ini ditekan.

**Penting:** kalau ternyata pelanggan batal bayar setelah kode QRIS/rekening ditampilkan, jangan tekan "Konfirmasi Pembayaran Diterima" — cukup tekan tombol **Batal** untuk kembali ke keranjang tanpa mencatat transaksi.

---

## 8. Konfirmasi Pembayaran Kasbon

Kasbon adalah penjualan yang dicatat sebagai utang pelanggan (belum dibayar saat transaksi terjadi). Untuk mencatat pelanggan yang datang melunasi utang Kasbon-nya:

1. Dari Beranda, tekan **Tagihan Kasbon**.
2. Semua tagihan yang masih belum lunas akan ditampilkan — nama pelanggan, nomor tagihan, tanggal jatuh tempo, dan jumlah tagihan.
3. Cari nama pelanggan yang sedang membayar, lalu tekan tombol **"Konfirmasi Lunas"** di baris tagihan tersebut.
4. Setelah dikonfirmasi, struk pelunasan akan muncul dan bisa dicetak seperti transaksi biasa.

Tagihan yang sudah dikonfirmasi lunas akan otomatis hilang dari daftar tagihan belum lunas.

---

## 9. Tutup Kasir Harian — Cek Ringkasan Penjualan Hari Ini

**Khusus Pemilik/Owner dan Manager** (Kasir dan Staf Gudang tidak bisa membuka Dashboard).

1. Buka `https://newpelangi.duckdns.org` (alamat tanpa `/scan/` di belakangnya — ini aplikasi Dashboard, terpisah dari aplikasi Kasir/Gudang).
2. Login dengan akun Manager/Owner.
3. Halaman utama langsung menampilkan **Omzet Hari Ini** dan **Profit Hari Ini** — ini angka penjualan real-time hari itu, langsung dari sistem pusat.
4. Untuk detail lebih lengkap (produk terlaris, pelanggan paling aktif, dll), tekan menu **Ringkasan**.
5. Sebelum benar-benar menutup toko, cek juga menu **Konflik Sinkron** — kalau ada transaksi yang tercatat "bermasalah" (lihat [bagian 5](#5-transaksi-gagal-vs-menunggu-sinkron--apa-bedanya) di atas), ini tempat untuk meninjaunya.

Tutup kasir tidak memerlukan langkah "tutup buku" khusus di aplikasi ini — cukup pastikan kartu **Menunggu Sinkron** di aplikasi Kasir sudah menunjukkan angka 0 sebelum staf pulang, supaya tidak ada transaksi hari itu yang tertinggal belum terkirim.

---

## 10. Jika Ada Masalah, Hubungi

Kalau ada transaksi yang gagal terus, aplikasi tidak bisa dibuka, atau ada hal yang membingungkan dan tidak dijelaskan di panduan ini, hubungi:

**Nama:** _[diisi oleh pemilik toko]_
**No. WhatsApp:** _[diisi oleh pemilik toko]_

Saat menghubungi, sebutkan:

- Layar/menu mana yang bermasalah (misalnya "Kasir", "Gudang", "Riwayat Transaksi").
- Apa yang terjadi (pesan error yang muncul, kalau ada — foto layarnya kalau bisa).
- Kira-kira jam berapa kejadiannya.

Informasi ini akan sangat membantu mempercepat penyelesaian masalah.
