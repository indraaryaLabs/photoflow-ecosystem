# PhotoFlow Desktop

Aplikasi desktop untuk fotografer. Tersedia untuk Windows dan macOS dari satu
sumber kode.

## Peran dalam alur PhotoFlow

Klien memilih fotonya lewat web portal dan menekan kirim. Setelah itu
fotografer punya daftar nama berkas — tapi yang perlu diedit adalah RAW-nya,
yang ada di kartu memori atau hard disk, bukan di Drive.

Aplikasi ini menutup jarak itu. Ia menarik daftar pilihan klien, memindai
folder lokal, mencocokkan nama dasar berkas, lalu menyalin RAW yang cocok ke
satu folder siap edit. Yang tadinya berarti mencari ratusan berkas satu per
satu dari daftar nomor di WhatsApp jadi satu langkah.

Selebihnya adalah alat bantu di sekitar pekerjaan itu:

- Pindai folder lokal secara bertahap, dengan pratinjau RAW (ARW, CR2, CR3,
  NEF, RAF, RW2, ORF, PEF, DNG)
- Thumbnail dibuat sekali lalu disimpan di `~/.photoflow_cache`
- Lightbox resolusi penuh dengan zoom dan geser
- Salin dan pindah berkas lokal secara massal
- Penjelajah Google Drive dua arah: unggah, unduh, pindah, salin, ubah nama,
  buang, buat folder
- Mode offline: pekerjaan pada berkas lokal tetap jalan tanpa internet, fitur
  yang butuh jaringan dinonaktifkan dengan jelas

## Bagaimana ia dibangun

Antarmukanya HTML, CSS, dan JavaScript biasa yang dijalankan di jendela
Chromium; seluruh akses berkas, decode RAW, dan panggilan jaringan terjadi di
proses Python. Jembatan antara keduanya adalah [Eel](https://github.com/python-eel/Eel).

```
main.py      fungsi yang dipanggil antarmuka, operasi berkas, thumbnail
auth.py      sesi Supabase Auth, penyimpanan token, pembaruan otomatis
gdrive.py    operasi Google Drive
telemetry.py pelaporan crash, dimuat saat dibutuhkan
config.py    konstanta, dapat ditimpa lewat environment variable
web/         antarmuka: index.html, style.css, script.js
tests/       tes unit, tanpa jaringan
```

### Waktu buka aplikasi

Tidak ada pustaka berat yang dimuat sebelum jendela muncul. `rawpy`, `Pillow`,
`supabase`, `google-api-python-client`, dan `sentry-sdk` diimpor saat pertama
kali dipakai, bukan saat aplikasi dimulai — jalur impor `main.py` turun dari
sekitar 0,9 detik ke 0,55 detik dengan cache panas, dan jauh lebih banyak lagi
pada peluncuran pertama saat berkasnya belum ada di cache sistem.

Ongkosnya berpindah, bukan hilang: thumbnail pertama tetap menunggu `rawpy`
dimuat. Bedanya, saat itu terjadi jendelanya sudah terbuka.

Dua hal lain yang ikut menentukan: build memakai `--onedir`, bukan `--onefile`
yang mengekstrak ulang seluruh bundle setiap kali dijalankan; dan font serta
ikon dibundel lokal di `web/assets/vendor/`, sehingga tampilan tidak menunggu
jaringan — hal yang juga dibutuhkan mode offline aplikasi ini.

## Autentikasi

Fotografer login dengan akun yang sama seperti di web portal.

```
1. Password dikirim langsung ke Supabase Auth
   POST <SUPABASE_URL>/auth/v1/token?grant_type=password

2. Yang kembali adalah access token (JWT, umur 1 jam) dan refresh token.
   Refresh token disimpan di keyring OS — Keychain di macOS, Credential
   Manager di Windows. Password tidak disimpan di mana pun.

3. Setiap permintaan ke backend membawa access token itu sebagai
   Authorization: Bearer. Backend memverifikasi tanda tangannya ke JWKS
   Supabase dan mengambil identitas dari klaim `sub`.

4. Saat token mendekati kedaluwarsa, ia ditukar sendiri lewat refresh token
   sebelum permintaan berikutnya berangkat.
```

Dua hal yang layak dicatat tentang bentuk ini:

**Password tidak pernah melewati backend PhotoFlow.** Versi sebelumnya login
lewat `POST /api/login-desktop`, rute yang membaca tabel `auth.users` dan
membandingkan hash bcrypt sendiri — menembus lapisan Auth yang seharusnya jadi
satu-satunya pintu — lalu mengembalikan token buatan sendiri yang tidak pernah
diverifikasi di mana pun. Rute itu sudah dihapus (FINDINGS.md F-04).

**Identitas tidak pernah dikirim sebagai data.** Versi sebelumnya menyertakan
header `X-User-ID` dan membuka OAuth Google lewat
`GET /api/auth/google/login?user_id=...`. Selama backend mempercayai nilai itu,
siapa pun yang tahu user_id orang lain bisa membuka alur OAuth atas nama korban
dan menitipkan refresh token Google miliknya sendiri ke profil korban
(FINDINGS.md F-05). Sekarang identitas hanya berasal dari klaim di dalam JWT
yang tanda tangannya sudah diverifikasi.

Menghubungkan Google Drive memakai `POST /api/auth/google/url`: backend membuat
`state` acak sekali-pakai, menyimpannya bersama user yang memulai, dan
mengembalikan URL untuk dibuka di browser.

## Menjalankan dari sumber

Butuh Python 3.10 atau lebih baru.

```bash
cd photoflow-desktop
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Aplikasi memilih browser berbasis Chromium (Chrome, Edge, Chromium, Brave)
kalau ada. Di macOS, Safari dipakai sebagai jalan terakhir dan aplikasi
memberi tahu alasannya: Safari menegakkan CORS pada WebSocket dengan ketat, dan
jembatan Eel berjalan di atas `ws://`.

### Menunjuk ke backend lain

Semua nilai di `config.py` bisa ditimpa lewat environment variable:

| Variabel | Isi |
|---|---|
| `PHOTOFLOW_BACKEND_URL` | Alamat API PhotoFlow |
| `PHOTOFLOW_WEB_APP_URL` | Alamat aplikasi web, dituju tombol "Open Web Dashboard" |
| `PHOTOFLOW_SUPABASE_URL` | Alamat project Supabase |
| `PHOTOFLOW_SUPABASE_ANON_KEY` | Anon key Supabase |
| `PHOTOFLOW_SENTRY_DSN` | DSN Sentry; kosongkan untuk mematikan pelaporan crash |
| `PHOTOFLOW_UPDATE_URL` | Sumber informasi rilis |

### Tes

```bash
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Tesnya tidak menyentuh jaringan dan tidak membuka jendela, jadi `eel`,
`Pillow`, `rawpy`, `supabase`, dan `sentry-sdk` tidak perlu terpasang untuk
menjalankannya.

## Build

GitHub Actions membangun keduanya dari matrix yang sama
([`desktop-build.yml`](../.github/workflows/desktop-build.yml)); hasilnya
tersedia sebagai artifact di setiap run.

Untuk membangun secara lokal:

```bash
pip install pyinstaller

# macOS
pyinstaller main.py --windowed --name PhotoFlow \
  --icon web/assets/icon.icns --add-data "web:web" \
  --hidden-import bottle --hidden-import engineio.async_drivers.gevent

# Windows
pyinstaller main.py --windowed --name PhotoFlow ^
  --icon web/assets/icon.ico --add-data "web;web" ^
  --hidden-import bottle --hidden-import engineio.async_drivers.gevent
```

`--onefile` sengaja tidak dipakai. Bundle onefile mengekstrak dirinya ke
direktori sementara setiap kali dijalankan, dan dengan aset web serta pustaka
RAW di dalamnya itu berarti jeda beberapa detik pada setiap kali aplikasi
dibuka.

Berkas hasil build belum ditandatangani. Di macOS, Gatekeeper akan menolaknya
sampai dibuka lewat klik kanan → Open; di Windows, SmartScreen menampilkan
peringatan penerbit tidak dikenal.

## Catatan tentang anon key

`config.py` memuat anon key Supabase, dan key itu ikut ke dalam binary yang
dibagikan. Kunci itu memang dirancang untuk dipegang klien: yang membatasi apa
yang bisa dilakukannya adalah Row Level Security di sisi database.

Jaminan itu hanya sekuat RLS-nya. FINDINGS.md F-02 dan F-14 mencatat tiga tabel
yang sempat tidak punya RLS, dan selama itu kunci ini berarti akses baca-tulis
penuh ke `projects`, `photos`, dan `rate_limits` tanpa melewati backend sama
sekali. Karena itu `cmd/migrate` sekarang memeriksa seluruh skema `public` dan
menolak berjalan kalau ada satu tabel pun tanpa RLS.
