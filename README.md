# PhotoFlow

[![CI](https://github.com/indraaryaLabs/photoflow-ecosystem/actions/workflows/ci.yml/badge.svg)](https://github.com/indraaryaLabs/photoflow-ecosystem/actions/workflows/ci.yml)

Alat pemilihan foto untuk fotografer dan kliennya.

## Masalah yang dipecahkan

Setelah pemotretan, fotografer perlu klien memilih foto mana yang akan diedit.
Alur yang lazim dipakai buruk untuk keduanya: fotografer mengunggah ratusan foto
ke layanan lain, atau mengirim puluhan gambar lewat WhatsApp, lalu menerima
balasan berupa daftar nomor yang harus dicocokkan manual.

PhotoFlow menghapus langkah unggah ulangnya. Foto tetap berada di Google Drive
milik fotografer; aplikasi ini membacanya di tempat. Fotografer membuat project,
mendapat satu tautan, dan mengirimkannya ke klien. Klien membuka tautan itu
tanpa perlu akun, memilih, lalu mengirim. Setelah terkirim, galeri terkunci dan
fotografer memanen berkas aslinya lewat aplikasi desktop.

Ditujukan untuk fotografer lepas yang menangani sedikit klien sekaligus, bukan
untuk studio besar.

## Arsitektur

```mermaid
flowchart TB
    subgraph Klien["Klien (tanpa akun)"]
        Galeri["Halaman galeri<br/>React + Vite"]
    end

    subgraph Fotografer["Fotografer"]
        Dashboard["Dashboard admin<br/>React + Vite"]
        Desktop["Aplikasi desktop<br/>Python + Eel"]
    end

    subgraph Backend["Backend Go — Vercel Serverless"]
        Router["app/ — pendaftaran rute"]
        Auth["middleware/ — verifikasi JWT, rate limit"]
        Handlers["handlers/"]
        Store["storage/ — PhotoStore"]
    end

    subgraph Supabase
        SBAuth["Supabase Auth<br/>penerbit JWT + JWKS"]
        DB[("PostgreSQL<br/>projects, photos,<br/>profiles, rate_limits,<br/>oauth_states")]
    end

    Drive["Google Drive<br/>milik fotografer"]

    Dashboard -- "email + password" --> SBAuth
    Desktop -- "email + password" --> SBAuth
    SBAuth -- "JWT" --> Dashboard
    SBAuth -- "JWT + refresh token" --> Desktop
    Dashboard -- "Bearer JWT" --> Router
    Desktop -- "Bearer JWT" --> Router

    Galeri -- "magic link, tanpa auth" --> Router

    Router --> Auth
    Auth -- "kunci publik JWKS" --> SBAuth
    Auth --> Handlers
    Handlers --> Store
    Handlers --> DB
    Store -- "OAuth2 token milik pemilik project" --> Drive
```

### Dua jalur masuk, dua model keamanan

**Fotografer** login lewat Supabase Auth dan membawa JWT pada setiap permintaan.
Backend memverifikasi tanda tangannya terhadap kunci publik JWKS Supabase, lalu
mengambil identitas dari klaim `sub`. Backend tidak pernah menerima identitas
yang dikirim pemanggil.

Ini berlaku untuk kedua antarmuka fotografer. Dashboard web dan aplikasi
desktop sama-sama login langsung ke Supabase Auth dan membawa JWT yang sama;
tidak ada jalur login khusus desktop. Bedanya hanya pada tempat menyimpan
refresh token — browser mengurusnya sendiri, sedangkan aplikasi desktop
menyimpannya di keyring milik sistem operasi.

**Klien** tidak punya akun. Aksesnya berupa magic link 16 byte yang menentukan
satu project. Karena tidak ada yang bisa diautentikasi, pertahanannya adalah
entropi tautan, ditambah pembatasan percobaan gagal per IP untuk mempersulit
penebakan.

### Alur koneksi Google Drive

```mermaid
sequenceDiagram
    participant D as Dashboard
    participant B as Backend
    participant DB as PostgreSQL
    participant G as Google

    D->>B: POST /api/auth/google/url (Bearer JWT)
    B->>DB: simpan state acak + user_id
    B-->>D: auth_url
    D->>G: browser diarahkan ke auth_url
    G->>B: GET /api/auth/google/callback?code&state
    B->>DB: tukar state jadi user_id (sekali pakai)
    B->>G: tukar code jadi refresh token
    B->>DB: simpan refresh token ke profiles
```

Parameter `state` tidak membawa data apa pun. Ia hanya nilai acak yang dicocokkan
dengan baris di database, sehingga callback tidak perlu mempercayai apa pun yang
dibawa kembali browser.

## Stack

| Lapisan | Teknologi |
|---|---|
| Backend | Go 1.26, Gin, GORM |
| Database | PostgreSQL (Supabase), Row Level Security |
| Autentikasi | JWT Supabase, diverifikasi lewat JWKS asimetris (ES256/RS256) |
| Integrasi | Google Drive API, OAuth2 dengan scope `drive.readonly` |
| Frontend | React 19, Vite, Tailwind |
| Aplikasi desktop | Python 3.11, Eel, PyInstaller, rawpy |
| Deploy | Vercel (dua project: backend dan web portal), GitHub Actions untuk build desktop |

## Struktur

```
photoflow-backend/
  api/          entry point Vercel Serverless
  app/          SetupRouter — pendaftaran rute saja, tanpa logika
  cmd/migrate/  perintah migrasi skema
  db/           koneksi database
  handlers/     handler HTTP dan logikanya
  middleware/   verifikasi JWT, rate limit, CORS, batas ukuran body
  models/       struct database dan struct input
  storage/      PhotoStore: GDriveStore dan FakeStore

photoflow-web-portal/
  src/components/  AdminLogin, AdminDashboard, galeri klien
  src/lib/         klien Supabase

photoflow-desktop/
  main.py          fungsi yang dipanggil antarmuka, operasi berkas, thumbnail
  auth.py          sesi Supabase Auth, penyimpanan token, pembaruan otomatis
  gdrive.py        operasi Google Drive
  telemetry.py     pelaporan crash, dimuat saat dibutuhkan
  config.py        konstanta, dapat ditimpa lewat environment variable
  web/             antarmuka Eel: HTML, CSS, JS
  tests/           tes unit, tanpa jaringan
```

Aplikasi desktop dulunya tinggal di dua repo terpisah, `photoflow-app` dan
`photoflow-app-macOS`, yang isinya 99% sama — hanya `main.py`, ikon, dan berkas
workflow yang berbeda. Keduanya juga hanya punya workflow build macOS, jadi
tidak ada satu pun yang benar-benar menghasilkan aplikasi Windows. Keduanya
sekarang digabung ke sini, dan satu matrix GitHub Actions membangun kedua
sistem dari sumber yang sama.

## Menjalankan secara lokal

### Backend

```bash
cd photoflow-backend
cp .env.example .env      # isi nilainya; .env tidak pernah di-commit
go run .
```

Variabel yang dibutuhkan ada di [`.env.example`](photoflow-backend/.env.example)
beserta keterangan masing-masing. `DATABASE_URL` dan `SUPABASE_URL` wajib —
server menolak menyala tanpa keduanya.

### Frontend

```bash
cd photoflow-web-portal
cp .env.example .env
npm install
npm run dev
```

### Aplikasi desktop

```bash
cd photoflow-desktop
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Semua alamat yang dituju dapat ditimpa lewat environment variable; daftarnya
ada di [`photoflow-desktop/README.md`](photoflow-desktop/README.md).

### Migrasi

Migrasi **tidak** berjalan otomatis saat startup. Sebelumnya `AutoMigrate`
dipanggil di dalam `SetupRouter`, yang di lingkungan serverless berarti berjalan
pada setiap cold start — perubahan skema jadi efek samping dari lalu lintas
biasa. Sekarang harus dijalankan dengan sengaja:

```bash
cd photoflow-backend
DATABASE_URL="..." go run ./cmd/migrate
```

Perintah itu juga menyalakan Row Level Security pada tabel yang dikelolanya,
lalu memeriksa **seluruh** skema `public` dan berhenti dengan error kalau ada
satu tabel pun tanpa RLS. Penjagaan itu ada karena GORM membuat tabel tanpa RLS,
dan di project Supabase tabel semacam itu dapat dibaca-tulis lewat REST API
memakai anon key yang ada di bundle frontend.

#### Di CI

Menjalankannya dengan tangan sudah pernah terlewat sekali, dan akibatnya bukan
pesan yang jelas: backend membaca dengan `SELECT *` sehingga tetap jalan, tapi
menulis dengan menyebut kolomnya satu per satu sehingga `INSERT` ditolak. Yang
terlihat pemakainya hanya tombol "Create Project" yang gagal.

Sekarang ada dua job di `.github/workflows/ci.yml`:

| Job | Kapan | Yang dikerjakan |
|---|---|---|
| `Schema check` | tiap pull request | `go run ./cmd/migrate -check` — hanya membaca, gagal kalau ada kolom di model yang belum ada di database |
| `Migrate` | push ke `main`, setelah job `Backend` hijau | `go run ./cmd/migrate` |

Keduanya menuntut secret **`DATABASE_URL`** di *Settings → Secrets and variables
→ Actions*. Isinya connection string Postgres milik project Supabase; pakai
**Session pooler**, bukan koneksi langsung, karena runner GitHub tidak punya
IPv6. Tanpa secret itu kedua job **gagal**, bukan dilewati diam-diam:
pemeriksaan yang melewati dirinya sendiri saat tidak dikonfigurasi adalah
pemeriksaan yang tidak pernah menemukan apa-apa.

Yang perlu diketahui: job `Migrate` **tidak** menahan deploy. Vercel men-deploy
dari integrasi Git-nya sendiri, berbarengan dengan GitHub Actions, dan Actions
tidak bisa menghentikannya. Jadi masih ada jendela beberapa puluh detik antara
kode baru live dan skema menyusul. Untuk migrasi yang hanya menambah kolom,
jendela itu berarti sebagian request gagal sebentar, bukan data rusak.
Menghilangkannya sama sekali menuntut deploy dipindahkan ke Actions dan
integrasi Git Vercel dimatikan.

#### Menjaga database tetap bangun

Supabase paket gratis menghentikan project yang tidak menerima query selama
sekitar tujuh hari, dan yang tertidur **tidak bangun sendiri** — tombol resume
harus ditekan manual di dashboard. Untuk aplikasi portofolio itu kegagalan yang
paling mahal: yang membukanya adalah orang yang sedang menilai.

`.github/workflows/keepalive.yml` menjalankan `go run ./cmd/migrate -check`
setiap Senin dan Kamis. Perintahnya hanya membaca `information_schema`, dan
efek sampingnya diinginkan: selisih skema kini berbunyi setiap beberapa hari,
bukan menunggu ada tombol yang rusak. Memakai secret `DATABASE_URL` yang sama.

Secret opsional **`KEEPALIVE_DATABASE_URLS`** menampung connection string
project Supabase lain, satu per baris. Dengan itu satu jadwal di repo ini
menahan seluruh akun tanpa perlu menyalin workflow ke tiap repo; project
tambahan hanya menerima `SELECT 1`, dan yang gagal jadi peringatan, bukan
kegagalan.

Satu batas yang perlu diingat: GitHub menonaktifkan workflow terjadwal di repo
yang tidak menerima commit selama 60 hari.

### Pemberitahuan email

Ketika klien mengirim pilihannya, fotografer diberi tahu lewat email. Fitur ini
**mati secara bawaan** dan aplikasi berjalan penuh tanpanya; yang hilang hanya
pemberitahuannya.

Untuk menyalakannya, isi tiga environment variable di backend:

| Variabel | Isi |
|---|---|
| `RESEND_API_KEY` | API key dari resend.com |
| `NOTIFY_FROM_EMAIL` | alamat pengirim, mis. `PhotoFlow <hello@domainmu.com>` |
| `APP_BASE_URL` | alamat aplikasi web, dipakai untuk tautan di dalam email |

Paket gratis Resend memberi 3.000 email/bulan dan 100/hari, cukup untuk skala
saat ini. **Satu syarat yang mudah terlewat:** pengiriman ke alamat sembarang
menuntut domain pengirim yang sudah diverifikasi. Tanpa domain sendiri,
pengiriman terbatas ke alamat pemilik akun Resend saja.

Emailnya dikirim **sebelum** balasan submit, bukan di goroutine latar. Backend
ini fungsi serverless: begitu balasan terkirim, prosesnya dapat dibekukan, dan
goroutine yang masih berjalan ikut mati. Ongkosnya klien menunggu satu
perjalanan jaringan lagi, dibatasi 5 detik. Kegagalannya tidak pernah
menggagalkan submit.

### Alamat yang diizinkan (CORS)

`ALLOWED_ORIGINS` berisi daftar origin yang boleh memanggil backend, dipisah
koma. Kosong berarti memakai bawaan (`photoflow.vercel.app`,
`photoflow-ecosystem.vercel.app` sebagai alamat lama, dan
`localhost:5173`).

Variabel ini yang harus diisi lebih dulu **sebelum** mengganti alamat frontend.
Origin yang tidak terdaftar berarti setiap panggilan API ditolak peramban, dan
yang terlihat bukan pesan error melainkan galeri kosong dan dashboard yang
gagal memuat.

### Dokumen hukum

`/privacy` dan `/terms` dilayani frontend tanpa login, dan rutenya mendahului
pemeriksaan sesi supaya pembukanya tidak mendapat pemuat berputar maupun
lemparan ke layar masuk.

Keduanya **wajib** sebelum aplikasi ini diajukan ke verifikasi OAuth Google:
`drive.readonly` adalah scope terbatas, dan verifikasinya mensyaratkan
kebijakan privasi publik yang memuat pernyataan Limited Use serta menyebut data
Google apa yang diambil. Tanpa itu pengajuannya ditolak sebelum ditinjau, dan
layar persetujuan terus menampilkan "Google hasn't verified this app".

Satu variabel frontend yang perlu diisi sebelum pengajuan:

| Variabel | Isi |
|---|---|
| `VITE_CONTACT_EMAIL` | alamat kontak untuk pertanyaan privasi dan permintaan penghapusan data |

Selama kosong, kedua dokumen menunjuk ke issue tracker repositori — kanal yang
sungguh terbaca, bukan alamat karangan yang memantulkan setiap email. Pengulas
Google mencari cara menghubungi pemiliknya, jadi isi variabel ini lebih dulu.

### Tes

```bash
cd photoflow-backend
go test ./...    # tes yang butuh database melewatkan dirinya sendiri
```

Untuk menjalankan seluruhnya, sediakan PostgreSQL dan isi `TEST_DATABASE_URL`:

```bash
TEST_DATABASE_URL="host=127.0.0.1 port=5432 user=postgres dbname=postgres sslmode=disable" \
  go test ./...
```

Tes aplikasi desktop tidak menyentuh jaringan dan tidak membuka jendela, jadi
`eel`, `Pillow`, dan `rawpy` tidak perlu terpasang untuk menjalankannya:

```bash
cd photoflow-desktop
pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Variabelnya sengaja terpisah dari `DATABASE_URL`: tes tersebut menjalankan
`DROP TABLE`, jadi menunjuk variabel yang sama dengan produksi akan menghapus
data yang sedang dipakai.

## Demo

- Web portal: https://photoflow.vercel.app
- API: https://photoflow-backend.vercel.app

### Coba tanpa akun

Galeri klien memang tidak butuh login — itu inti produknya. Dua tautan di bawah
membuka galeri sungguhan, persis seperti yang diterima klien lewat WhatsApp.

**Galeri yang menunggu dipilih** — pilih foto, perhatikan penghitung dan batas
maksimalnya:

```
https://photoflow.vercel.app/?token=fb0bd309058553e34dbe46f19f04a405
```

**Galeri yang sudah dikirim** — terkunci, tidak menerima perubahan lagi:

```
https://photoflow.vercel.app/?token=51fafe800d88d1bf22ffbd6f6b13cac6
```

Nomor WhatsApp pada kedua galeri itu sengaja placeholder. Baris project
dikembalikan utuh oleh `GET /api/p/:magic_link`, jadi nomor apa pun yang
tersimpan di sana terbaca oleh siapa saja yang memegang tautannya.

### Dashboard fotografer

Sisi fotografer butuh login. Akun demo dibuat dari dashboard Supabase, bukan
lewat form pendaftaran: form itu memanggil `supabase.auth.signUp()` yang
mengirim email konfirmasi, dan alamat demo tidak punya inbox. Buat lewat
**Authentication → Users → Add user**, centang **Auto Confirm User**, lalu isi
datanya dengan [`scripts/seed-demo.sql`](scripts/seed-demo.sql).

```
Email    : demo@photoflow.app
Password : PhotoFlowDemo2026!
```

Akun ini memang dibuat untuk dibagikan. Ia tidak memuat data pribadi, tidak
terhubung ke Google Drive mana pun, dan berdiri terpisah dari akun sungguhan
yang memakai aplikasi ini. Siapa pun yang membaca repo ini bisa masuk — dan
juga bisa mengubah atau menghapus kedua project contoh di dalamnya. Kalau
tampilannya nanti kosong, jalankan ulang
[`scripts/seed-demo.sql`](scripts/seed-demo.sql).

Karena akun ini tidak menghubungkan Drive, galeri kliennya disajikan dari
salinan foto yang tersimpan di database — jalur cadangan yang sama yang dipakai
saat Drive fotografer sungguhan sedang tidak terbaca.

Nomor WhatsApp pada kedua project itu placeholder, dan seluruh nomor pada data
lain di project ini sudah diganti. Sejak itu backend juga tidak lagi
mengembalikan `client_whats_app` ke halaman galeri sama sekali.

## Catatan keamanan

Repo ini menyimpan dua berkas yang menjelaskan sisi keamanannya:

- [`SECURITY-NOTES.md`](SECURITY-NOTES.md) — kerentanan yang ditemukan dan
  diperbaiki, lengkap dengan cara mengeksploitasinya dan tes yang membuktikan
  perbaikannya.
- [`FINDINGS.md`](FINDINGS.md) — seluruh temuan beserta statusnya, termasuk yang
  sengaja dibiarkan terbuka dan alasannya.

### Nama studio pada galeri klien

Galeri klien menampilkan nama studio fotografernya di kepala halaman,
menggantikan "PhotoFlow", beserta pita sampul yang memakai foto pertama galeri
itu sendiri. Disetel lewat ikon roda gigi di dashboard; kosong berarti kembali
ke "PhotoFlow", jadi fitur ini pilihan.

Tersimpan di `profiles.studio_name`. Lambangnya tetap lambang PhotoFlow —
menggantinya menuntut unggahan berkas, dan itu menuntut penyimpanan berkas yang
belum ada di aplikasi ini.
