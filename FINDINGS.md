# FINDINGS

Catatan masalah yang ditemukan di luar cakupan fase yang sedang dikerjakan.
Tidak diperbaiki di sini — hanya dicatat.

Aturan file ini: **tidak boleh berisi nilai kredensial apa pun.** Hanya nama
variabel dan deskripsi masalah.

---

## F-01 — Kredensial produksi ada di riwayat git (KRITIS)

**Ditemukan saat:** Fase 1
**Status:** BELUM DITANGANI

`photoflow-backend/.env` dan `photoflow-web-portal/.env` ter-commit ke repo dan
sudah ter-push ke `origin`. Fase 1 hanya melakukan `git rm --cached`, yang
menghapus file dari commit berikutnya tapi **tidak menghapusnya dari riwayat**.
Nilai-nilainya masih bisa diambil siapa pun yang punya akses repo lewat
`git log` / `git show`.

Kredensial yang terekspos:

| Variabel | Jenis | Dampak kalau disalahgunakan |
|---|---|---|
| `GDRIVE_CREDENTIALS_JSON` | Private key service account Google | Akses penuh ke Google Drive atas nama service account |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth2 client secret | Impersonasi aplikasi saat alur OAuth |
| `GOOGLE_API_KEY` | API key Google | Pemakaian kuota / biaya atas nama project |
| `DATABASE_URL` | Berisi password PostgreSQL Supabase | Akses baca-tulis langsung ke database produksi |
| `VITE_SUPABASE_ANON_KEY` | Anon key Supabase | Rendah — kunci ini memang publik, asal RLS aktif |

**Jendela paparan:** repo ini privat sejak awal dan baru dipublikkan
belakangan, jadi rentang waktu `.env` bisa dibaca pihak luar itu pendek.
Itu memperkecil kemungkinan kebocoran, tapi tidak menghapusnya — riwayat git
tetap memuat nilainya selama belum ditulis ulang.

**Langkah yang perlu diambil:**

1. Kredensial Google (`GDRIVE_CREDENTIALS_JSON`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GOOGLE_API_KEY`) **tidak bisa dirotasi** — akun pemiliknya ditangguhkan,
   console-nya tidak bisa diakses. Penangguhan itu tidak berkaitan dengan
   kebocoran ini; urutan waktunya tidak cocok. Kunci-kunci itu praktis sudah
   mati. Penggantinya dibuat di Google Cloud project baru pada Fase 2, bukan
   dirotasi di tempat.
2. **Password database Supabase wajib dirotasi.** Ini satu-satunya kredensial
   bocor yang masih hidup dan masih di bawah kendalimu. Ditangani di Fase 0.
3. Jangan pernah pakai ulang nilai lama mana pun, termasuk di project Google
   yang baru.
4. Setelah rotasi selesai, pertimbangkan rewrite riwayat git (`git filter-repo`)
   lalu force push. Ini memaksa setiap clone yang ada dibuat ulang —
   koordinasikan dulu kalau repo dipakai bersama.
5. Aktifkan GitHub secret scanning + push protection supaya tidak terulang.

Rewrite riwayat saja **tidak cukup** dan bukan pengganti langkah 2. Clone,
fork, dan cache yang sudah ada bisa tetap menyimpan commit lama.

---

## F-02 — `VITE_SUPABASE_ANON_KEY` ikut ter-bundle ke klien

**Ditemukan saat:** Fase 1
**Status:** Kemungkinan besar bukan masalah — dicek di Fase 0

Semua variabel berprefix `VITE_` di-inline oleh Vite ke bundle JavaScript yang
dikirim ke browser, jadi selalu bisa dibaca publik. Untuk anon key Supabase ini
memang perilaku yang diharapkan.

Yang perlu dipastikan: **Row Level Security aktif di semua tabel Supabase.**
Tanpa RLS, anon key yang publik itu setara akses baca-tulis terbuka ke seluruh
database. Belum diverifikasi di fase ini.

---

## F-03 — `gdrive-key.json` disebut di .gitignore

**Ditemukan saat:** Fase 1
**Status:** Informasi saja

`photoflow-backend/.gitignore` punya entri `gdrive-key.json`. File itu tidak ada
di working tree sekarang dan tidak tracked — jadi tidak ada masalah aktif.
Disebut di sini hanya supaya diperiksa apakah file itu pernah ter-commit di
riwayat, bersamaan dengan pengecekan F-01.
