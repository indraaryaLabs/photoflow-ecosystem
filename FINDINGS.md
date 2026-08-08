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

## F-04 — Desktop harvester perlu diperbarui: `/api/login-desktop` dihapus

**Ditemukan saat:** Fase 3.1
**Status:** Perlu tindakan di repo desktop app (di luar repo ini)

Fase 3.1 menghapus `POST /api/login-desktop`. Rute itu query langsung ke tabel
`auth.users` milik Supabase dan membandingkan hash bcrypt sendiri — menembus
lapisan Auth yang seharusnya jadi satu-satunya pintu. Rute itu juga
mengembalikan token dari `generateSessionToken()` yang tidak pernah
diverifikasi di mana pun, jadi tokennya dekoratif.

Tidak ada pemanggil rute ini di dalam repo. Konsumennya adalah desktop
harvester yang tinggal di repo terpisah, dan **login-nya akan gagal sampai
aplikasi itu diperbarui.**

Alur pengganti, tanpa backend sebagai perantara:

1. Desktop app login langsung ke Supabase Auth:
   `POST <SUPABASE_URL>/auth/v1/token?grant_type=password`
   dengan header `apikey: <anon key>` dan body JSON `{email, password}`.
2. Responsnya memuat `access_token` (JWT) dan `refresh_token`. Simpan keduanya
   di penyimpanan aman milik OS, bukan di file polos.
3. Panggil `GET /api/gdrive/token` dengan header
   `Authorization: Bearer <access_token>`.
4. Saat backend membalas 401 berkode `token_expired`, tukar refresh token lewat
   `POST <SUPABASE_URL>/auth/v1/token?grant_type=refresh_token`, lalu ulangi.

Keuntungannya: password tidak pernah melewati backend PhotoFlow sama sekali,
dan backend tidak lagi butuh akses baca ke `auth.users`.

---

## F-05 — Alur OAuth Google memakai `user_id` mentah sebagai `state`

**Ditemukan saat:** Fase 3.1
**Status:** BELUM DITANGANI — di luar cakupan 3.1, relevan untuk Fase 2

`GET /api/auth/google/login` menerima `user_id` sebagai query parameter dan
meneruskannya apa adanya sebagai parameter `state` OAuth. Callback lalu
mempercayai `state` itu sebagai identitas dan menyimpan refresh token Google ke
baris `profiles` dengan id tersebut.

Dua akibatnya:

1. **Account linking paksa.** Penyerang yang tahu user_id korban bisa membuka
   alur OAuth dengan `user_id` korban, menyetujui dengan akun Google miliknya
   sendiri, dan refresh token miliknya tersimpan di profil korban. Setelah itu
   project korban menarik foto dari Drive penyerang.
2. **`state` kehilangan fungsi aslinya.** Parameter `state` ada untuk mencegah
   CSRF pada alur OAuth; dipakai sebagai pembawa data, perlindungan itu hilang.

Perbaikan yang disarankan (kerjakan di Fase 2, bukan sekarang): jangan terima
`user_id` dari query. Ambil identitas dari JWT terverifikasi seperti rute admin
lain, lalu isi `state` dengan nilai acak sekali-pakai yang disimpan server-side
dan dicocokkan saat callback.

---

## F-07 — Perilaku JWKS yang perlu diketahui saat mengubah middleware auth

**Ditemukan saat:** Fase 3.1
**Status:** Sudah ditangani — dicatat supaya tidak diregresikan

Perilaku `keyfunc/v3` + `jwkset` di bawah ini diverifikasi lewat percobaan,
bukan dibaca dari dokumentasi. Siapa pun yang menyentuh `middleware/auth.go`
perlu tahu, karena beberapa di antaranya tidak terlihat dari kodenya sendiri.

1. **`kid` tak dikenal ditolak, bukan dicoba dengan kunci lain.** Kalau `kid`
   hadir tapi tidak ada di JWKS, verifikasi gagal. Memakai `kid` yang sah pun
   tidak menolong kalau signature-nya tidak cocok.
2. **Token tanpa `kid` dicoba terhadap semua kunci.** Ini perilaku bawaan
   library. Bukan bypass — tetap wajib ada signature sah dari kunci di JWKS —
   tapi perlu diketahui. Supabase selalu mengirim `kid`.
3. **`kid` tak dikenal memicu penarikan ulang JWKS, dibatasi 1 kali per 5
   menit** (`RefreshUnknownKID`), dan permintaan berlebih gagal seketika alih
   alih menggantung. Jangan longgarkan batas ini: itu yang mencegah token
   dengan `kid` acak dipakai memancing banjir permintaan ke Supabase.
4. **CURRENT KEY dan PREVIOUS KEY dua-duanya terverifikasi**, karena keduanya
   ada di dokumen JWKS yang sama. Rotasi kunci Supabase tidak memutus sesi yang
   tokennya masih ditandatangani kunci lama.
5. **Constructor tetap sukses walau penarikan JWKS pertama gagal**
   (`NoErrorReturnFirstHTTPReq`). Jadi konstruksi yang berhasil BUKAN jaminan
   ada kunci. Yang tersisa adalah storage kosong, dan itu harus ditangani
   terpisah.
6. **Pemulihan setelah gangguan datang dari goroutine refresh latar, bukan dari
   limiter `kid` tak dikenal.** Bawaannya 1 jam; di sini disetel 30 detik lewat
   `jwksRefreshInterval` supaya jendela tanpa kunci tetap pendek.
7. **Penarikan ulang yang gagal tidak mengosongkan storage.** Fungsi refresh
   keluar lebih dulu pada error jaringan, status non-200, maupun decode gagal —
   `KeyReplaceAll` baru dipanggil setelah key set berhasil di-parse. Inilah yang
   membuat pembeda "storage kosong" tidak bisa dibalik dari luar, dan karena itu
   token palsu selalu mendapat 401 selama backend punya kunci.

Konsekuensi yang diterima secara sadar: **selama storage kosong, token palsu
ikut mendapat 503, bukan 401.** Saat backend tidak punya satu pun kunci publik,
token sah dan token palsu memang tidak bisa dibedakan. Request tetap ditolak dan
handler tetap tidak dijalankan, jadi tidak ada bypass — yang berbeda hanya kode
statusnya.

---

## F-08 — Magic link lama tetap 8 karakter

**Ditemukan saat:** Fase 3.2
**Status:** Diterima secara sadar

Fase 3.2 menaikkan entropi magic link dari 4 byte ke 16 byte, tapi hanya untuk
token yang dibuat setelahnya. Token lama tetap berlaku karena pencarian memakai
perbandingan nilai pada kolom `text` tanpa asumsi panjang, jadi tidak ada link
yang patah dan tidak ada migrasi yang wajib.

Konsekuensinya project lama tetap pada 2^32 kemungkinan, bukan 2^128. Dengan
pembatasan 20 kegagalan per 10 menit per IP, menjelajahi ruang sebesar itu dari
satu alamat tidak realistis, tapi angkanya tetap jauh di bawah token baru.

Saat temuan ini ditulis, satu-satunya project di database adalah data uji yang
akan dihapus manual oleh pemilik repo (memuat nomor telepon asli), sehingga
tidak ada link nyata di tangan klien. Artinya begitu data uji itu hilang, tidak
akan ada lagi token 8 karakter yang tersisa dan temuan ini otomatis selesai.

Kalau di kemudian hari ternyata masih ada token lama yang beredar, opsinya
adalah regenerasi selektif untuk project yang belum `submitted`. Itu mematikan
link yang sudah dikirim ke klien, jadi perlu pengiriman ulang manual.

---

## F-09 — Sumber IP untuk rate limiting belum dibuktikan di produksi

**Ditemukan saat:** Fase 3.2
**Status:** PERLU PEMBUKTIAN setelah deploy

Rate limiting pada `GET /api/p/:magic_link` mengunci penghitung pada IP klien.
Kekuatannya sepenuhnya bergantung pada apakah header sumber IP benar-benar
diset oleh platform dan tidak bisa dikirim sendiri oleh pemanggil.

Urutan bawaannya `x-vercel-forwarded-for` lalu `x-real-ip`, dan
`x-forwarded-for` sengaja TIDAK dipercaya. Urutan itu **belum diverifikasi
terhadap perilaku Vercel yang sebenarnya** — dokumentasinya tidak dapat diakses
dari lingkungan tempat perubahan ini dikerjakan.

Cara membuktikannya ada di `GET /api/debug/client-ip` (aktif hanya bila
`DEBUG_CLIENT_IP=1`). Yang harus dipastikan: `resolved` bernilai true, dan
`resolved_ip` TIDAK berubah ketika pemanggil mengirim `x-forwarded-for` sendiri.
Kalau berubah, limiternya bisa dilewati dan `CLIENT_IP_HEADER` harus disetel.

Batas yang tetap ada walau header sudah benar: pembatasan per IP bisa dilewati
penyerang yang punya banyak alamat. Pertahanan utama terhadap penebakan token
adalah entropi 16 byte; pembatasan ini lapis kedua.

Kalau IP tidak dapat ditentukan, limiter sengaja DILEWATI dan dicatat keras di
log, bukan memakai satu bucket bersama. Bucket bersama berarti 20 percobaan
dari siapa pun akan mengunci galeri untuk seluruh klien — salah konfigurasi
tidak boleh berubah jadi pemadaman.

---

## F-10 — `selected_photos` kosong diterima oleh endpoint submit

**Ditemukan saat:** Fase 3.3
**Status:** BELUM DITANGANI — perilaku lama, relevan untuk Fase 4

Tag `required` pada `selected_photos` tidak menolak array kosong. Akibatnya
`POST /api/p/:magic_link/submit` dengan `{"selected_photos": []}` akan menghapus
seluruh foto milik project lalu mengunci galerinya dengan status `submitted`,
tanpa menyisakan satu pun pilihan.

Ini perilaku yang sudah ada sebelum Fase 3.3 dan tidak berubah karenanya.
Diperbaiki bersama Fase 4, yang memang menyentuh handler submit untuk urusan
transaksi dan gallery lock — di sana penghapusan-lalu-insert itu akan dibungkus
transaksi, dan aturan "minimal satu pilihan" paling tepat ditambahkan sekalian.

---

## F-06 — Middleware auth belum punya test

**Ditemukan saat:** Fase 3.1
**Status:** Dijadwalkan di Fase 6

`middleware/auth.go` menentukan siapa yang boleh menyentuh data siapa, tapi
belum punya satu test pun. Kasus yang paling berharga untuk diuji: token
kedaluwarsa ditolak, token bersignature asal ditolak, token dari issuer lain
ditolak, token HS256 ditolak walaupun signature-nya cocok, dan `sub` benar-benar
sampai ke context. Fase 6 sudah mengagendakan test isolasi antar-user, yang
bertumpu langsung pada middleware ini.

---

## F-03 — `gdrive-key.json` disebut di .gitignore

**Ditemukan saat:** Fase 1
**Status:** Informasi saja

`photoflow-backend/.gitignore` punya entri `gdrive-key.json`. File itu tidak ada
di working tree sekarang dan tidak tracked — jadi tidak ada masalah aktif.
Disebut di sini hanya supaya diperiksa apakah file itu pernah ter-commit di
riwayat, bersamaan dengan pengecekan F-01.
