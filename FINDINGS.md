# FINDINGS

Catatan masalah yang ditemukan di luar cakupan fase yang sedang dikerjakan.
Tidak diperbaiki di sini — hanya dicatat.

Aturan file ini: **tidak boleh berisi nilai kredensial apa pun.** Hanya nama
variabel dan deskripsi masalah.

## Cara membaca daftar ini

Project ini masih tahap pengembangan, bukan produk berlangganan. Dua hal yang
sedang dikejar: **aplikasi berjalan benar dari ujung ke ujung**, dan **repo yang
layak dibaca**. Temuan yang alasannya semata "tidak layak untuk produk publik"
sengaja diturunkan prioritasnya, dan penurunan itu ditulis di entri
masing-masing supaya alasannya bisa ditinjau ulang kalau keadaan berubah.

Yang TIDAK ikut diturunkan, walau terdengar seperti urusan produk publik:

- **Isolasi antar pengguna.** Satu pengguna membaca atau mengubah data pengguna
  lain adalah aplikasi yang berjalan salah, bukan kekurangan pengerasan. Dengan
  tiga akun pun tetap salah.
- **Kehilangan data.** Pekerjaan klien yang hilang permanen tidak jadi lebih
  ringan karena penggunanya sedikit.
- **Apa yang terbaca pembaca repo.** Repo ini publik dan ditujukan untuk dibaca
  peninjau teknis, jadi hal yang memalukan saat dibaca tetap perlu dibereskan
  walau tidak lagi berbahaya.

---

## F-01 — Kredensial produksi ada di riwayat git (DITANGANI SEBAGIAN)

**Ditemukan saat:** Fase 1
**Status:** Kredensial sudah diamankan — sisa pekerjaan pembersihan riwayat

`photoflow-backend/.env` dan `photoflow-web-portal/.env` ter-commit ke repo dan
sudah ter-push ke `origin`. Fase 1 hanya melakukan `git rm --cached`, yang
menghapus file dari commit berikutnya tapi **tidak menghapusnya dari riwayat**.
Nilai-nilainya masih bisa diambil siapa pun yang punya akses repo lewat
`git log` / `git show`.

Catatan: seluruh nilai yang terekspos kini sudah tidak berlaku — password
Supabase dirotasi, kredensial Google mati bersama akunnya. Rewrite riwayat
tetap dilakukan untuk kebersihan, bukan karena nilainya masih berbahaya.

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

1. **SELESAI.** Kredensial Google (`GDRIVE_CREDENTIALS_JSON`,
   `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_API_KEY`) tidak bisa dan tidak perlu
   dirotasi — akun pemiliknya ditangguhkan, sehingga kunci-kunci itu mati
   bersama akunnya. Penangguhan itu tidak berkaitan dengan kebocoran ini;
   urutan waktunya tidak cocok. Penggantinya dibuat di Google Cloud project
   baru pada Fase 2, bukan dirotasi di tempat.
2. **SELESAI.** Password database Supabase sudah dirotasi. Ini satu-satunya
   kredensial bocor yang masih hidup dan masih di bawah kendali pemilik repo,
   jadi dengan rotasi ini tidak ada lagi kredensial aktif yang terekspos.
3. Jangan pernah pakai ulang nilai lama mana pun, termasuk di project Google
   yang baru.
4. **BELUM.** Rewrite riwayat git (`git filter-repo`) lalu force push. Nilai
   lama masih terbaca lewat `git log` walau sudah tidak berlaku. Ini memaksa
   setiap clone yang ada dibuat ulang — koordinasikan kalau repo dipakai
   bersama.
5. **BELUM.** Aktifkan GitHub secret scanning + push protection supaya tidak
   terulang.

Rewrite riwayat saja **tidak cukup** dan bukan pengganti langkah 2. Clone,
fork, dan cache yang sudah ada bisa tetap menyimpan commit lama.

**Prioritas.** Setelah langkah 1 dan 2 selesai, tidak ada lagi kredensial hidup
di riwayat, jadi alasan keamanannya sudah habis. Yang tersisa adalah alasan
presentasi, dan itu justru relevan dengan tujuan repo ini: repo-nya publik dan
ditujukan untuk dibaca peninjau teknis, dan `git log` masih memperlihatkan
private key service account di dalam `.env` yang ter-commit. Peninjau yang
menemukannya tidak akan tahu kunci itu sudah mati. Kerjakan sebelum repo
disodorkan ke siapa pun, bukan karena mendesak secara teknis.

---

## F-02 — RLS mati di `projects` dan `photos`, dengan anon key yang publik (KRITIS)

**Ditemukan saat:** Fase 1, dikonfirmasi lewat pemeriksaan langsung ke Supabase
**Status:** Kerentanannya sudah ditutup — policy `profiles` masih perlu ditinjau

Catatan awal temuan ini menyebut "kemungkinan besar bukan masalah". Itu asumsi,
dan asumsi itu salah. Supabase Security Advisor menandai `public.projects` dan
`public.photos` sebagai **CRITICAL — "RLS Disabled in Public"**. Hanya
`profiles` yang sudah mengaktifkannya.

**Kenapa itu kritis.** Semua variabel berprefix `VITE_` di-inline oleh Vite ke
bundle JavaScript yang dikirim ke browser, jadi `VITE_SUPABASE_ANON_KEY` memang
publik dan siapa pun bisa membacanya dari devtools. Anon key sendiri bukan
rahasia — Row Level Security-lah satu-satunya yang membatasi apa yang bisa
dilakukan dengannya. Dengan RLS mati, kunci publik itu memberi akses baca-tulis
langsung ke `projects` dan `photos` lewat REST API Supabase.

Artinya seluruh lapisan autentikasi yang dibangun di Fase 3.1 bisa dilewati
begitu saja. Verifikasi JWT di backend Go tidak relevan bagi penyerang yang
tidak perlu melewati backend sama sekali: ia cukup memakai anon key dari bundle
dan berbicara langsung ke Supabase — membaca seluruh project milik semua
fotografer, mengubahnya, atau menghapusnya.

**Sudah diperbaiki:** RLS kini aktif di `projects`, `photos`, `profiles`, dan
`rate_limits`. Advisor tidak lagi melaporkan satu pun tabel tanpa RLS.

`projects`, `photos`, dan `rate_limits` sengaja dibiarkan **tanpa policy**. RLS
aktif tanpa policy menolak seluruh akses lewat anon key, dan itu memang yang
diinginkan: tidak ada kode frontend yang menyentuh ketiganya. Backend Go
terhubung sebagai pemilik tabel lewat connection string Postgres, dan pemilik
tabel tidak tunduk pada RLS kecuali tabelnya disetel `FORCE ROW LEVEL SECURITY`,
jadi backend tidak terpengaruh. Advisor melaporkan ketiganya sebagai INFO
"RLS Enabled No Policy"; untuk tabel-tabel ini status itu benar dan disengaja.

**Koreksi atas dugaan sebelumnya.** Catatan versi lama menduga RLS memblokir
`supabase.from('profiles').upsert(...)` di frontend dan karenanya registrasi
gagal membuat baris profil. Dugaan itu **gugur** setelah diperiksa langsung:
`auth.users` berisi 3 baris dan `profiles` juga 3, dan dua di antaranya punya
`gdrive_refresh_token` terisi — artinya alur OAuth Google pernah berjalan sampai
selesai. Baris profil tetap terbentuk, kemungkinan besar lewat trigger
`handle_new_user()` yang berjalan sebagai `SECURITY DEFINER`, bukan lewat upsert
dari frontend.

Penyebab sebenarnya upsert itu gagal ada di F-17: kolom yang dikirim tidak ada
di skema. Kegagalannya tidak pernah terlihat karena hasilnya tidak diperiksa.

Sisa yang masih perlu ditinjau ada di F-16 (policy `profiles` memakai peran
`public`, dan tidak ada policy INSERT).

---

## F-04 — Desktop harvester perlu diperbarui: `/api/login-desktop` dihapus

**Ditemukan saat:** Fase 3.1
**Status:** SELESAI — aplikasi desktop kini ada di repo ini

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

**Penutupan.** Aplikasi desktop digabung ke repo ini sebagai `photoflow-desktop/`
dan alur di atas diterapkan persis. Login ada di `photoflow-desktop/auth.py`:
`SupabaseSession.sign_in()` menukar email dan password lewat
`grant_type=password`, `refresh()` memakai `grant_type=refresh_token`, dan
`access_token()` memperbarui sendiri saat sisa umurnya di bawah dua menit.
Refresh token disimpan di keyring OS; pada sistem tanpa backend keyring ia
jatuh ke berkas 0600 dan mengumumkan hal itu di log alih-alih diam.

Satu hal yang tidak disebut resep aslinya tapi muncul saat menerapkannya:
Supabase memutar refresh token setiap kali dipakai. Karena Eel melayani tiap
panggilan frontend di worker-nya sendiri, dua permintaan Drive yang berbarengan
bisa sama-sama mendapati token kedaluwarsa dan sama-sama menukar refresh token
yang sama — yang kalah cepat lalu memegang token yang sudah dibatalkan, dan
kegagalannya baru muncul jauh setelahnya. Pembaruan token karena itu dijaga satu
kunci, dan ada tesnya di
`photoflow-desktop/tests/test_auth.py::test_refresh_bersamaan_hanya_sekali`.

---

## F-05 — Alur OAuth Google memakai `user_id` mentah sebagai `state`

**Ditemukan saat:** Fase 3.1
**Status:** SELESAI di Fase 2

Alur pembukanya kini `POST /api/auth/google/url`, terautentikasi lewat JWT, dan
mengembalikan URL alih-alih redirect. Bentuk itu dipilih karena navigasi teratas
browser tidak membawa header `Authorization`, sehingga sebuah redirect tidak
punya cara membuktikan siapa yang memintanya — dan itulah yang dulu "diselesaikan"
dengan menerima `user_id` dari query string.

`state` sekarang 32 byte acak, disimpan di tabel `oauth_states` bersama user yang
memulainya, sekali pakai, dan kedaluwarsa 10 menit. Callback menukarnya lewat
`DELETE ... RETURNING` dalam satu perintah, bukan SELECT lalu DELETE terpisah —
alasan yang sama seperti gallery lock di Fase 4: dua perintah terpisah
menyisakan celah bagi dua callback bersamaan memakai state yang sama.

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
**Status:** SELESAI — tidak ada token lama yang beredar

Fase 3.2 menaikkan entropi magic link dari 4 byte ke 16 byte, tapi hanya untuk
token yang dibuat setelahnya. Token lama tetap berlaku karena pencarian memakai
perbandingan nilai pada kolom `text` tanpa asumsi panjang, jadi tidak ada link
yang patah dan tidak ada migrasi yang wajib.

Kekhawatirannya adalah project lama tertinggal pada 2^32 kemungkinan. Itu tidak
terjadi: pemilik repo mengonfirmasi satu-satunya project di database adalah data
dummy, bukan data klien, jadi tidak pernah ada link 8 karakter di tangan siapa
pun. Tidak ada yang perlu diregenerasi.

Catatan awal temuan ini menyebut data uji tersebut memuat nomor telepon asli.
Itu keliru dan sudah dikoreksi di sini supaya tidak terbawa ke SECURITY-NOTES.md
nanti: datanya dummy.

Kalau di kemudian hari ternyata masih ada token lama yang beredar, opsinya
adalah regenerasi selektif untuk project yang belum `submitted`. Itu mematikan
link yang sudah dikirim ke klien, jadi perlu pengiriman ulang manual.

---

## F-09 — Sumber IP untuk rate limiting

**Ditemukan saat:** Fase 3.2
**Status:** SELESAI — terbukti di produksi

Rate limiting pada `GET /api/p/:magic_link` mengunci penghitung pada IP klien.
Kekuatannya sepenuhnya bergantung pada apakah header sumber IP benar-benar
diset oleh platform dan tidak bisa dikirim sendiri oleh pemanggil.

Urutan bawaannya `x-vercel-forwarded-for` lalu `x-real-ip`, dan
`x-forwarded-for` sengaja TIDAK dipercaya. Urutan itu tidak dapat diverifikasi
saat kodenya ditulis karena dokumentasi Vercel tidak bisa diakses dari
lingkungan tersebut, sehingga sengaja dibuat mudah dibuktikan lewat
`GET /api/debug/client-ip` dan dapat dikoreksi lewat `CLIENT_IP_HEADER` tanpa
mengubah kode.

Hasil pembuktian di produksi (`DEBUG_CLIENT_IP` sudah dimatikan kembali):

- 20 request berturut-turut membalas 404, request ke-21 membalas 429 — limiter
  aktif dan ambangnya sesuai.
- `X-Forwarded-For` palsu TIDAK mengubah `resolved_ip` — bucket tidak bisa
  diperbarui dengan mengganti header, jadi limiternya tidak dapat dilewati
  dengan cara itu.

Urutan header bawaan terbukti benar; `CLIENT_IP_HEADER` tidak perlu disetel.

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
**Status:** SELESAI di Fase 4

Tag `required` pada `selected_photos` tidak menolak array kosong. Akibatnya
`POST /api/p/:magic_link/submit` dengan `{"selected_photos": []}` menghapus
seluruh foto milik project lalu mengunci galerinya dengan status `submitted`,
tanpa menyisakan satu pun pilihan.

Handler sekarang menolak daftar kosong dengan 400 sebelum menyentuh database.
Penolakannya sengaja ditaruh di handler, bukan di tag binding: `required` pada
slice memang tidak berarti "tidak boleh kosong", dan menaruhnya di handler
membuat alasannya bisa dijelaskan di tempat kejadian.

Perbaikan ini menutup jalur kerusakannya, bukan penyebabnya. Penyebabnya ada di
F-12.

---

## F-11 — Tes binding submit menguji salinan struct, bukan struct aslinya

**Ditemukan saat:** Fase 3.3
**Status:** SELESAI di Fase 5

Struct input untuk `POST /api/p/:magic_link/submit` dideklarasikan inline di
dalam closure handler, sehingga tidak bisa dirujuk dari berkas tes.
`app/binding_test.go` karena itu menyalin definisinya.

Konsekuensinya nyata: kalau tag binding di handler diubah dan salinan di tes
tidak ikut diubah, tes tetap hijau sambil menguji struct yang tidak dipakai
siapa pun. Tes `CreateProjectInput` tidak punya masalah ini karena tipenya
memang bernama dan diuji langsung.

Struct itu kini menjadi `models.SubmitSelectionInput`, dan tesnya mengikat tipe
tersebut langsung. Salinannya dihapus, sehingga tag binding tidak lagi bisa
berubah di handler tanpa tesnya ikut menyadari.

---

## F-12 — Submit menghapus katalog foto, padahal kolom untuk menandai sudah ada

**Ditemukan saat:** Fase 4
**Status:** USULAN — perubahan lintas repo, belum dikerjakan

Tabel `photos` dipakai untuk dua hal yang berbeda pada dua fase hidup project:

- sebelum submit, ia adalah katalog lengkap galeri, dengan `thumbnail_url` yang
  dipakai klien untuk melihat foto;
- setelah submit, ia hanya berisi baris hasil pilihan, dengan `thumbnail_url`
  kosong, untuk dibaca desktop harvester.

Peralihan antar keduanya dilakukan dengan menghapus seluruh baris lalu menulis
ulang. Karena itulah daftar kosong bisa menghapus segalanya, dan karena itu pula
katalog aslinya hilang begitu klien submit: tidak ada lagi catatan foto apa saja
yang pernah ditawarkan, dan galeri tidak bisa ditampilkan ulang.

Kolom `is_selected` sudah ada di tabel dan praktis tidak dipakai. Alur yang tidak
menghapus apa pun:

```sql
UPDATE photos SET is_selected = (file_name = ANY(?)) WHERE project_id = ?;
```

Katalog dan thumbnail tetap utuh, pilihan menjadi atribut alih-alih keberadaan
baris, "tidak memilih apa pun" jadi keadaan yang bisa diwakili tanpa kehilangan
data, dan submit ulang tidak lagi merusak.

Belum dikerjakan karena desktop harvester membaca endpoint ini dan saat ini
mengasumsikan setiap baris yang ada adalah baris terpilih. Mengubahnya menuntut
harvester ikut memfilter `is_selected`, jadi perubahan ini perlu dikoordinasikan
dengan repo tersebut — sama seperti F-04.

---

## F-13 — Transaksi pada PUT /api/projects/:id belum punya test

**Ditemukan saat:** Fase 4
**Status:** MASIH TERBUKA — penghalangnya sudah hilang, tesnya belum ditulis

Handler submit diuji lewat `submitSelection`, fungsi yang bisa dipanggil
langsung. Bagian transaksional pada `PUT /api/projects/:id` dulu berupa closure
di dalam pendaftaran rute, sehingga tidak bisa dipanggil dari tes tanpa
membangun seluruh router beserta koneksi database dan konfigurasi auth-nya.

Perilaku yang belum terjaga tes: kalau insert foto baru gagal, penghapusan foto
lama harus ikut dibatalkan; dan kalau penarikan dari Drive gagal, foto lama harus
dipertahankan apa adanya.

Fase 5 memindahkannya keluar jadi method `handlers.Handler.UpdateProject`, dan
Fase 2 menghapus penghalang terakhirnya: pemanggilan Drive tidak lagi lewat
`http.Get` langsung melainkan lewat `Handler.StoreForUser`, yang bisa diganti
`storage.FakeStore` di tes. Pola yang dipakai `gallery_photos_test.go` bisa
disalin apa adanya. Tesnya belum ditulis karena berada di luar cakupan Fase 2.

---

## F-14 — AutoMigrate membuat `rate_limits` tanpa RLS, limiter jadi bisa dilewati (KRITIS)

**Ditemukan saat:** pemeriksaan Supabase setelah Fase 4
**Status:** Tabelnya sudah diperbaiki manual — penjagaan ada di perintah migrasi

Tabel `rate_limits` yang ditambahkan di Fase 3.2 dibuat lewat `AutoMigrate`
GORM. GORM membuat tabel dengan `CREATE TABLE` biasa, dan Postgres membuat tabel
baru **tanpa RLS secara bawaan**. Supabase menandainya CRITICAL.

Dampaknya membatalkan seluruh gunanya limiter itu. Anon key ada di bundle
JavaScript frontend, dan dengan RLS mati siapa pun yang memilikinya bisa
menghapus baris penghitungnya sendiri lewat REST API Supabase, lalu mengulang
percobaan dari nol. Pembatasan 20 kegagalan per 10 menit yang sudah dibuktikan
bekerja di produksi (F-09) bisa dilewati **tanpa menyentuh backend sama sekali**.

Ini pelajaran yang lebih besar dari satu tabel: setiap tabel yang dibuat
`AutoMigrate` di project Supabase akan lahir tanpa RLS, dan tidak ada yang
memberi tahu selain advisor. Perbaikan satu kali tidak cukup — yang dibutuhkan
adalah jalur migrasi yang tidak bisa meninggalkan tabel tanpa RLS.

Sudah dikerjakan di Fase 5:

1. Migrasi dipindahkan keluar dari jalur startup ke perintah tersendiri
   (`cmd/migrate`), sehingga pembuatan skema jadi tindakan yang disengaja dan
   bisa diperiksa, bukan efek samping setiap cold start.
2. Perintah itu menyalakan RLS pada setiap tabel yang dikelolanya, tepat setelah
   `AutoMigrate`.
3. Perintah itu kemudian **memverifikasi seluruh tabel di skema `public`** dan
   berhenti dengan error kalau ada satu saja yang RLS-nya mati — termasuk tabel
   yang ditambahkan orang lain di kemudian hari. Menyalakan saja tidak cukup:
   tanpa verifikasi, tabel berikutnya akan lolos dengan cara yang persis sama.

---

## F-15 — `handle_new_user()` SECURITY DEFINER bisa dieksekusi lewat REST API

**Ditemukan saat:** pemeriksaan Supabase setelah Fase 4
**Status:** BELUM DITANGANI — prioritas rendah, perbaikannya satu baris

**Prioritas diturunkan.** Dampaknya bergantung pada isi fungsinya, dan pada
tahap ini fungsi itu hanya membuat baris profil untuk user yang memang baru
mendaftar. Tetap dicatat karena perbaikannya satu perintah `REVOKE`, jadi
mengerjakannya nanti tidak akan lebih mahal daripada sekarang.

Advisor melaporkan dua peringatan untuk fungsi yang sama:

> Function `public.handle_new_user()` can be executed by the `anon` role as a
> `SECURITY DEFINER` function via `/rest/v1/rpc/handle_new_user`.

Peringatan kedua sama persis untuk peran `authenticated`.

Fungsi ini kemungkinan besar trigger yang membuat baris `profiles` saat user
baru mendaftar — dan itulah yang menjelaskan kenapa baris profil tetap terbentuk
walau upsert dari frontend gagal (lihat F-02).

Masalahnya bukan fungsinya, melainkan fungsi itu ikut terekspos sebagai endpoint
RPC. `SECURITY DEFINER` berarti ia berjalan dengan hak pembuatnya, bukan hak
pemanggilnya, jadi siapa pun yang memegang anon key bisa memanggilnya dengan hak
yang lebih tinggi dari haknya sendiri. Apa yang terjadi kalau dipanggil di luar
konteks trigger bergantung pada isi fungsinya, yang belum diperiksa.

Yang perlu dilakukan: baca isi fungsinya, lalu cabut hak eksekusinya dari peran
`anon` dan `authenticated`. Fungsi trigger tidak perlu dapat dipanggil lewat
REST:

```sql
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
```

Trigger tetap berjalan seperti biasa setelah pencabutan ini, karena trigger
dieksekusi oleh pemilik tabel, bukan oleh peran pemanggil REST.

---

## F-16 — Policy `profiles` memakai peran `public` dan tidak punya INSERT

**Ditemukan saat:** pemeriksaan Supabase setelah Fase 4
**Status:** BELUM DITANGANI — TIDAK diturunkan prioritasnya

**Kenapa tidak diturunkan.** Ini bukan pengerasan untuk produk publik, melainkan
pertanyaan apakah aplikasinya berjalan benar: kalau klausa `USING` policy-nya
tidak membatasi ke baris sendiri, satu pengguna bisa membaca
`gdrive_refresh_token` milik pengguna lain — dan token itu memberi akses ke
Google Drive orang tersebut. Dengan tiga akun pun itu tetap salah. Menyelesaikan
pertanyaan ini butuh satu query untuk membaca isi policy-nya.

`profiles` punya policy untuk SELECT dan UPDATE, keduanya menyasar peran
`public`, dan tidak ada policy untuk INSERT.

Dua hal yang perlu ditinjau:

1. **Peran `public` mencakup `anon`**, yaitu pengunjung yang belum login sama
   sekali. Kalau maksudnya "pengguna yang sudah masuk boleh membaca dan mengubah
   barisnya sendiri", peran yang tepat adalah `authenticated`. Perlu dipastikan
   pula klausa `USING`/`WITH CHECK`-nya benar-benar membatasi ke baris sendiri
   lewat `auth.uid() = id`; tanpa itu, satu pengguna bisa membaca atau mengubah
   profil pengguna lain — termasuk `gdrive_refresh_token` milik orang lain, yang
   memberi akses ke Google Drive mereka.
2. **Tidak adanya policy INSERT** konsisten dengan temuan bahwa baris profil
   dibuat oleh trigger, bukan oleh klien. Itu justru desain yang baik dan
   sebaiknya dipertahankan — asal frontend berhenti mencoba melakukan upsert
   sendiri (F-17).

Isi policy-nya belum dibaca, jadi butir 1 masih dugaan yang perlu diperiksa,
bukan kesimpulan.

---

## F-17 — Upsert profil di frontend mengirim kolom yang tidak ada, hasilnya dibuang

**Ditemukan saat:** pemeriksaan Supabase setelah Fase 4
**Status:** BELUM DITANGANI — frontend, wajar dikerjakan bersama Fase 2

`photoflow-web-portal/src/components/AdminLogin.jsx:71`:

```js
await supabase.from('profiles').upsert({ id, full_name, whatsapp, email })
```

Skema `profiles` hanya punya empat kolom: `id`, `full_name`,
`gdrive_refresh_token`, `updated_at`. `whatsapp` dan `email` tidak ada di sana,
jadi upsert ini **selalu gagal** karena ketidakcocokan skema.

Kegagalannya tidak pernah terlihat karena hasilnya tidak diperiksa sama sekali:
tidak ada `error` yang dibaca, tidak ada pesan ke pengguna. Kode berjalan
seolah-olah berhasil.

Kebetulan tidak ada kerusakan yang terjadi, karena baris profil sudah dibuat
oleh trigger `handle_new_user()`. Jadi panggilan ini bukan cuma salah — ia juga
tidak dibutuhkan.

Nomor WhatsApp yang coba disimpan di sini sebenarnya sudah disimpan di tempat
lain: kolom `admin_whats_app` dan `client_whats_app` pada tabel `projects`, yang
diisi lewat backend. Jadi perbaikannya adalah **menghapus panggilan upsert ini**,
bukan menambah kolom ke `profiles`.

Pelajaran yang lebih umum dan layak dijaga: pemanggilan Supabase dari frontend
yang hasilnya tidak diperiksa akan gagal tanpa suara. Kegagalan ini bertahan
cukup lama untuk sempat memunculkan dua dugaan keliru sebelum diperiksa
langsung ke database.

---

## F-18 — Perlindungan password bocor tidak aktif di Supabase Auth

**Ditemukan saat:** pemeriksaan Supabase setelah Fase 4
**Status:** DITUTUP — tidak tersedia di paket yang dipakai

Advisor melaporkan `auth_leaked_password_protection` dalam keadaan mati.
Ternyata fitur itu hanya tersedia di Supabase Pro Plan, jadi tidak bisa
dinyalakan pada project ini.

Sebagai gantinya, panjang minimum password dinaikkan dari bawaan Supabase (6)
menjadi 8. Itu bukan pengganti setara — pemeriksaan terhadap basis data
kebocoran menangkap password yang panjang tapi sudah pernah bocor — tapi ini
yang tersedia tanpa berpindah paket.

Dibuka lagi kalau project berpindah ke Pro.

---

## F-19 — `GET /api/gdrive/:folderId` adalah proxy Drive terbuka (KRITIS)

**Ditemukan saat:** Fase 2
**Status:** SELESAI di Fase 2 — rutenya dihapus

Rute itu publik dan menerima **ID folder Drive apa pun** dari siapa pun, lalu
membacanya memakai service account bersama milik aplikasi. Tidak ada satu pun
pemeriksaan yang menghubungkan pemanggil dengan folder yang dimintanya.

Akibatnya backend berfungsi sebagai proxy terbuka ke **setiap folder yang pernah
dibagikan ke service account itu**, milik fotografer mana pun. Penyerang tidak
perlu magic link, tidak perlu akun, dan tidak perlu menebak: `drive_folder_id`
ikut dikirim di dalam payload `GET /api/p/:magic_link`, jadi satu magic link
yang sah sudah cukup untuk mendapatkan ID folder, dan ID itu dapat dipakai
langsung tanpa batasan apa pun.

Ini kerentanan paling serius yang ditemukan sesi ini, dan ia lahir dari
kombinasi yang wajar-wajar saja bila dilihat terpisah: satu kredensial bersama
yang bisa membaca banyak folder, ditambah rute yang menerima ID folder mentah.

Penggantinya `GET /api/p/:magic_link/photos`. Magic link menentukan project,
project menentukan pemiliknya, dan kredensial pemilik itulah yang dipakai.
Tidak ada lagi cara meminta isi folder yang bukan bagian dari galeri mana pun,
dan kredensial bersamanya sendiri sudah tidak ada.

---

## F-20 — Jalur cadangan galeri mengirim bentuk data yang salah

**Ditemukan saat:** Fase 2
**Status:** SELESAI di Fase 2

`App.jsx` punya jalur cadangan `setPhotos(data.photos)` untuk project tanpa
folder Drive. Jalur itu mengirim baris database apa adanya, dengan `file_name`
dan `thumbnail_url`, sedangkan `PhotoCard.jsx` membaca `photo.thumbnailLink` dan
penyusun payload submit membaca `p.name`.

Artinya kalau jalur itu pernah terpakai, gambarnya kosong dan setiap
`file_name` yang dikirim saat submit bernilai `undefined` — pilihan klien
tersimpan tanpa nama berkas, dan tidak ada yang bisa diambil desktop app.

Tidak pernah ketahuan karena syaratnya tidak pernah terpenuhi: `folderId` selalu
terisi, sehingga cabang itu tidak pernah dijalankan. Cacat yang menunggu momen
untuk muncul, dan momen itu justru akan tiba bersama perpindahan ke OAuth
per-user.

Sekarang backend mengembalikan bentuk yang seragam untuk kedua sumber, dan
frontend menyelaraskan bentuk pada jalur cadangan terakhirnya.

---

## F-21 — Pemanggil luar `/api/auth/google/login` akan patah

**Ditemukan saat:** Fase 2
**Status:** SELESAI — pemanggilnya kini ada di repo ini

`GET /api/auth/google/login?user_id=...` diganti `POST /api/auth/google/url`
yang menuntut JWT Supabase. Grep di web portal tidak menemukan satu pun
pemanggil rute lama, jadi alur koneksi Drive selama ini dipicu dari luar repo —
kemungkinan desktop app, atau dijalankan manual lewat browser.

Pemanggil itu akan berhenti bekerja. Alur penggantinya:

1. Dapatkan access token Supabase milik user.
2. `POST /api/auth/google/url` dengan header `Authorization: Bearer <token>`.
3. Buka `auth_url` dari responsnya di browser.
4. Setelah user menyetujui, callback menyimpan refresh token-nya sendiri.

Perlu diperiksa juga apakah desktop app menangani `409` berkode
`drive_not_connected` dan `drive_reconnect_required` dari `/api/gdrive/token`,
yang kini menggantikan error mentah.

**Penutupan.** Pemanggil yang dimaksud memang aplikasi desktop, dan sekarang ia
ada di repo ini. `open_google_login()` di `photoflow-desktop/main.py` memanggil
`POST /api/auth/google/url` dengan Bearer JWT lalu membuka `auth_url` dari
responsnya; tidak ada lagi `user_id` yang dikirim sebagai data.

Header `X-User-ID` yang dulu ikut pada setiap permintaan ke `/api/gdrive/token`
juga dihapus. Backend sudah lama mengabaikannya, tapi selama masih dikirim ia
membuat pembaca kode mengira identitas masih ditentukan pengirim. Ada tes yang
menjaga itu:
`photoflow-desktop/tests/test_gdrive.py::test_hanya_authorization_yang_dikirim`.

Kedua kode 409 ditangani: `gdrive._fetch_access_token()` mengubahnya jadi
`DriveNotConnected` yang membawa kodenya sendiri, dibedakan dari kegagalan sesi
karena tindakan yang diminta ke user berbeda — yang satu perlu menghubungkan
Drive, yang lain perlu login ulang.

---

## F-06 — Middleware auth belum punya test

**Ditemukan saat:** Fase 3.1
**Status:** SELESAI di Fase 6

`middleware/auth.go` menentukan siapa yang boleh menyentuh data siapa, tapi
belum punya satu test pun. Kasus yang paling berharga untuk diuji: token
kedaluwarsa ditolak, token bersignature asal ditolak, token dari issuer lain
ditolak, token HS256 ditolak walaupun signature-nya cocok, dan `sub` benar-benar
sampai ke context. Fase 6 sudah mengagendakan test isolasi antar-user, yang
bertumpu langsung pada middleware ini.

---

## F-22 — Pembatasan algoritma JWT tidak dapat dibuktikan sendirian

**Ditemukan saat:** Fase 6
**Status:** Informasi — tidak ada perbaikan yang dibutuhkan

Saat menulis tes untuk `middleware/auth.go`, tes algorithm confusion diuji balik
dengan mencabut `jwt.WithValidMethods` dari kode. **Tesnya tetap lolos.**

Penolakan token HS256 ternyata ditegakkan berlapis, dan dua lapis lain bekerja
lebih dulu:

1. Pustaka `keyfunc` menolak ketika parameter `alg` pada JWK tidak cocok dengan
   `alg` pada header token.
2. `golang-jwt` menolak karena metode HMAC menuntut kunci bertipe `[]byte`,
   sedangkan yang diberikan `*ecdsa.PublicKey`.

Bahkan setelah lapis pertama dilewati — dengan menyajikan JWKS tanpa `alg` —
tokennya tetap ditolak oleh lapis kedua. Tidak ditemukan cara mencabut
`WithValidMethods` sendirian lalu menghasilkan token HS256 yang lolos.

Kesimpulannya, `WithValidMethods` di kode ini adalah pertahanan berlapis yang
eksplisit, bukan satu-satunya yang menahan. Tesnya tetap dipertahankan karena
mengunci perilaku yang benar, tapi komentarnya menyebutkan batas ini apa adanya
supaya tidak ada yang mengira tes itu membuktikan lebih dari yang sebenarnya.

Dicatat karena ini persoalan yang sama dengan F-11: tes yang lolos karena alasan
selain yang diklaim adalah tes yang memberi rasa aman palsu.

---

## F-03 — `gdrive-key.json` disebut di .gitignore

**Ditemukan saat:** Fase 1
**Status:** Informasi saja

`photoflow-backend/.gitignore` punya entri `gdrive-key.json`. File itu tidak ada
di working tree sekarang dan tidak tracked — jadi tidak ada masalah aktif.
Disebut di sini hanya supaya diperiksa apakah file itu pernah ter-commit di
riwayat, bersamaan dengan pengecekan F-01.
