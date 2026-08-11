# PhotoFlow Web Portal

Dua antarmuka dalam satu aplikasi React, dibedakan oleh alamat yang dibuka:

| Rute | Untuk siapa | Autentikasi |
|---|---|---|
| `/dashboard` | Fotografer | Supabase Auth, JWT pada setiap permintaan |
| `/?token=<magic link>` | Klien | Tanpa akun — tautan itu sendiri yang jadi kuncinya |
| `/` | Fotografer | Layar masuk; kalau sudah punya sesi, dialihkan ke `/dashboard` |
| `/admin` | — | Jalur lama, dialihkan ke `/dashboard` |

Ruang kerja fotografer dulu berada di `/admin`. Nama itu menyesatkan: tidak ada
tingkatan hak akses di aplikasi ini. Setiap fotografer membuka jalur yang sama
dan melihat proyeknya sendiri, karena datanya disaring per `user_id` oleh Row
Level Security di Supabase. Tidak ada peran istimewa yang bisa melihat proyek
orang lain. `/admin` tetap dilayani sebagai pengalihan supaya tautan lama —
termasuk tombol "Buka Dashboard" di aplikasi desktop — tidak mati.

Galeri klien sengaja tidak punya login. Yang membuat tautannya tidak dapat
ditebak adalah entropi 16 byte-nya, dan backend membatasi percobaan gagal per
IP untuk mempersulit penebakan. Pilihan itu diambil karena meminta klien
membuat akun demi memilih foto satu kali adalah gesekan yang membuat alatnya
tidak dipakai.

## Struktur

```
src/
  App.jsx                    routing, pengambilan galeri, state pemilihan
  components/
    AdminLogin.jsx           masuk, daftar, pemulihan password
    AdminDashboard.jsx       daftar project, pembuatan, magic link
    PhotoCard.jsx            satu foto di grid
    PreviewModal.jsx         pratinjau resolusi tinggi, zoom, geser
    FloatingBar.jsx          penghitung pilihan dan tombol kirim
    Header.jsx, Toast.jsx
  lib/
    supabase.js              klien Supabase
    api.js                   alamat backend
    recovery.js              deteksi tautan pemulihan password
    utils.js                 helper kecil
```

## Menjalankan

```bash
cp .env.example .env
npm install
npm run dev
```

Isi `.env` sesuai keterangan di [`.env.example`](.env.example). `VITE_API_BASE`
boleh dikosongkan — kalau kosong, frontend memakai backend produksi, sehingga
repo ini bisa di-clone lalu langsung dijalankan.

```bash
npm run build     # produksi
npm run lint
```

## Pemulihan password

Tombol "Lupa password" memakai `supabase.auth.resetPasswordForEmail()`. Supabase
mengirim tautan yang kembali ke aplikasi ini membawa token pemulihan di fragment
URL.

Alamat tujuannya harus terdaftar di **Supabase → Authentication → URL
Configuration → Redirect URLs**, jika tidak Supabase menolak mengirimkan tautan.
Untuk pengembangan lokal, daftarkan `http://localhost:5173`.

Dua hal yang tidak terlihat dari membaca alurnya sekilas:

- Tautan itu **membawa sesi yang sah**. Tanpa penanda terpisah, aplikasi
  menyimpulkan orangnya sudah masuk dan langsung melemparnya ke dashboard —
  layar penggantian password tidak pernah muncul. Karena itu `lib/recovery.js`
  membaca fragment URL dan `App.jsx` mendahulukannya di atas seluruh routing
  lain.
- Fragment itu **dihapus supabase-js segera setelah diproses**, dan pemrosesan
  terjadi saat klien dibuat. `lib/supabase.js` karena itu mengimpor
  `lib/recovery.js` sebelum memanggil `createClient`; urutan modul itulah yang
  menjamin fragmennya masih ada saat dibaca.

## Catatan

Frontend memuat anon key Supabase, dan kunci itu ikut ke dalam bundle yang
dikirim ke browser. Kunci itu memang dirancang untuk dipegang klien: yang
membatasi apa yang bisa dilakukannya adalah Row Level Security di sisi
database. Uraian lengkapnya, termasuk saat jaminan itu sempat tidak berlaku,
ada di [`FINDINGS.md`](../FINDINGS.md) F-02 dan F-14.

`npm run lint` masih menyisakan pelanggaran yang ada sebelum CI dipasang, dan
CI belum menggagalkan build karenanya. Sebagian besar berasal dari konfigurasi
ESLint yang tidak memuat `eslint-plugin-react`, sehingga identifier yang hanya
dipakai di dalam JSX terbaca sebagai tidak terpakai. Satu sisanya nyata:
`PreviewModal.jsx` memanggil `setState` langsung di dalam `useEffect`.
