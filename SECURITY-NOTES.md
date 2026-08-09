# Catatan Keamanan

Kerentanan yang ditemukan di PhotoFlow, bagaimana masing-masing bisa
dieksploitasi, bagaimana diperbaiki, dan tes mana yang membuktikannya.

Berkas ini ditulis untuk dibaca, bukan untuk menjual. Beberapa temuan di bawah
adalah kesalahan yang saya buat sendiri di kode ini. Dua bagian terakhir adalah
dugaan yang ternyata salah, dan itu sengaja dibiarkan tercatat.

Daftar temuan lengkap beserta status yang masih terbuka ada di
[`FINDINGS.md`](FINDINGS.md).

---

## 1. Identitas diambil dari header yang bisa diketik siapa saja

**Masalah.** Setiap rute admin menentukan siapa pemanggilnya dengan membaca
header `X-User-ID`:

```go
userID := c.GetHeader("X-User-ID")
if userID == "" {
    c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
    return
}
```

Handler kemudian memakai nilai itu pada klausa `WHERE user_id = ?`.

**Kenapa berbahaya.** Header adalah masukan dari pemanggil. Tidak ada yang
memverifikasinya. Siapa pun yang mengetahui UUID seorang fotografer — dan UUID
itu ikut terkirim di dalam payload project — dapat membaca, mengubah, dan
menghapus seluruh project milik orang tersebut:

```bash
curl -H "X-User-ID: <uuid-korban>" https://photoflow-backend.vercel.app/api/projects
```

Satu perintah, tanpa password, tanpa token. Ini broken access control dalam
bentuknya yang paling telanjang: aplikasi menanyakan "kamu siapa?" lalu
mempercayai jawabannya.

**Perbaikan.** `middleware/auth.go` memverifikasi JWT terbitan Supabase terhadap
kunci publik dari endpoint JWKS project, lalu mengambil identitas dari klaim
`sub`. Yang diperiksa bukan hanya tanda tangannya:

| Diperiksa | Alasan |
|---|---|
| tanda tangan | inti verifikasi |
| `alg` dibatasi ES256/RS256 | menolak algorithm confusion |
| `exp` | token kedaluwarsa ditolak |
| `iss` | token dari project Supabase lain ditolak |
| `aud` = `authenticated` | token anon ditolak |
| `sub` berupa UUID | subject aneh berhenti sebagai 401, bukan 500 dari Postgres |

`X-User-ID` dihapus dari kode dan dari daftar header yang diizinkan CORS.

**Tes yang membuktikan.** `handlers/authz_test.go` menjalankan router lengkap
dengan JWKS sungguhan, menerbitkan token untuk dua user berbeda, dan memastikan
user B tidak dapat melihat, mengedit, atau menghapus project milik user A —
serta bahwa barisnya benar-benar tidak berubah, bukan sekadar mendapat 404.
`TestRequestWithoutTokenIsRejected` mengirim `X-User-ID` persis seperti serangan
di atas dan menuntut 401.

Tesnya diuji balik: mencabut `AND user_id = ?` dari handler membuat ketiganya
gagal.

---

## 2. Race condition pada penguncian galeri

**Masalah.** Galeri dikunci agar klien tidak bisa mengirim pilihan dua kali.
Pemeriksaannya terpisah jauh dari perubahannya:

```go
if project.Status == "submitted" {           // dibaca di sini
    c.JSON(http.StatusForbidden, ...)
    return
}

db.Where("project_id = ?", project.ID).Delete(&Photo{})
db.Create(&photosToInsert)
db.Model(&project).Update("status", "submitted")   // diubah di sini
```

**Kenapa berbahaya.** `SELECT` biasa tidak mengunci apa pun. Dua permintaan yang
tiba bersamaan sama-sama membaca `"pending"`, sama-sama menyimpulkan boleh
lanjut, lalu sama-sama menghapus seluruh foto dan menulis daftarnya sendiri.
Yang belakangan menimpa yang duluan — pilihan klien hilang, dan tidak ada jejak
bahwa itu pernah terjadi.

Klien tidak perlu berniat jahat: dua kali klik pada koneksi lambat sudah cukup.

**Perbaikan.** Pemeriksaan dipindahkan ke dalam perintah perubahannya, sehingga
keduanya jadi satu operasi yang tak terbagi:

```sql
UPDATE projects SET status = 'submitted'
 WHERE id = ? AND status <> 'submitted'
```

`RowsAffected == 0` berarti ada yang lebih dulu mengklaim, dan pemanggilnya
membalas 409. Kunci diklaim **sebelum** foto lama disentuh, jadi yang kalah
berhenti tanpa merusak apa pun. Seluruhnya dibungkus satu transaksi.

Kenapa ini bekerja sementara pemeriksaan terpisah tidak: perintah pertama
mengunci baris project, perintah kedua menunggu. Setelah yang pertama commit,
Postgres di bawah isolasi READ COMMITTED **menilai ulang** klausa `WHERE` milik
perintah kedua terhadap versi baris yang baru. Yang kedua kini melihat status
sudah `submitted`, tidak cocok lagi, dan mengubah nol baris.

**Tes yang membuktikan.** `handlers/submit_test.go` menembakkan 8 submit
bersamaan pada galeri yang sama dan menuntut tepat satu berhasil.

Tesnya diuji balik dengan menulis ulang logika lama sebagai tes sementara:

```
PENDEKATAN LAMA: 8 dari 8 submit lolos, foto tersisa 5
PENDEKATAN LAMA: 5 dari 8 submit lolos, foto tersisa 3
PENDEKATAN LAMA: 4 dari 8 submit lolos, foto tersisa 3
```

"Foto tersisa 5" adalah foto dari beberapa submit berbeda yang saling bercampur.
Versi yang diperbaiki lolos 15 kali berturut-turut dengan 8 submit bersamaan.

---

## 3. Magic link 4 byte

**Masalah.** Tautan galeri dibuat dari 4 byte acak, menghasilkan token 8
karakter heksadesimal.

**Kenapa berbahaya.** 4 byte berarti 2³² kemungkinan — sekitar 4,3 miliar.
Terdengar besar, tapi tautan ini adalah satu-satunya yang menjaga foto klien,
dan ruang sebesar itu dapat dijelajahi dengan permintaan otomatis. Tidak ada
pembatasan percobaan sama sekali saat itu.

Ada masalah kedua yang lebih sunyi: kolomnya `unique`. Pada 2³² ruang kunci,
tabrakan menjadi mungkin jauh sebelum ruangnya habis, dan tabrakan berarti
pembuatan project gagal.

**Perbaikan.** Dinaikkan ke 16 byte, yaitu 2¹²⁸. Token yang sudah terbit tetap
berlaku: pencarian membandingkan nilai pada kolom `text` tanpa asumsi panjang di
mana pun, jadi tidak ada tautan di tangan klien yang patah.

Ditambah pembatasan percobaan pada pencarian magic link — 20 kegagalan per 10
menit per IP. Yang dihitung **hanya pencarian yang gagal**. Klien sah membuka
galerinya berulang kali; menghitung permintaan yang berhasil berarti mencekik
pengguna yang membayar, sementara penebak token menurut definisinya hanya
menghasilkan kegagalan.

Penghitungnya disimpan di PostgreSQL, bukan memori proses, karena backend
berjalan sebagai fungsi serverless: memori tidak bertahan antar invocation dan
beberapa instance berjalan berdampingan. Penghitung in-memory di sini bukan
sekadar tidak persisten — ia memberi kesan terlindungi sambil praktis tidak
menahan apa pun.

**Tes yang membuktikan.** `middleware/ratelimit_test.go`, termasuk satu tes yang
menembakkan 50 permintaan bersamaan dan menuntut hitungannya tepat 50 — properti
yang justru tidak bisa diberikan penghitung in-memory. Satu tes lain memastikan
`X-Forwarded-For` yang dikirim klien diabaikan; kalau header itu dipercaya, satu
header berbeda per permintaan sudah cukup untuk mendapat bucket baru setiap kali
dan limiternya berubah jadi hiasan.

**Bukti dari produksi.** 20 permintaan berturut-turut membalas 404, permintaan
ke-21 membalas 429. `X-Forwarded-For` palsu tidak mengubah IP yang terbaca.

---

## 4. Row Level Security mati di dua tabel publik

**Masalah.** Supabase Security Advisor menandai `public.projects` dan
`public.photos` sebagai **CRITICAL — "RLS Disabled in Public"**.

**Kenapa berbahaya.** Ini yang paling penting dipahami dari seluruh berkas ini.

Setiap variabel berprefix `VITE_` di-inline oleh Vite ke bundle JavaScript yang
dikirim ke browser. `VITE_SUPABASE_ANON_KEY` karena itu memang publik, dan siapa
pun dapat membacanya dari devtools. Itu bukan kebocoran — anon key memang
dirancang untuk publik. Yang membatasi apa yang bisa dilakukan dengannya
hanyalah Row Level Security.

Dengan RLS mati, kunci publik itu memberi akses baca-tulis langsung ke tabel
lewat REST API Supabase. Artinya **seluruh lapisan autentikasi di backend Go
dapat dilewati tanpa disentuh sama sekali**: penyerang tidak perlu menembus
verifikasi JWT kalau ia tidak perlu melewati backend. Ia cukup mengambil anon
key dari bundle dan berbicara langsung ke Supabase, membaca seluruh project
milik semua fotografer.

Pelajarannya: autentikasi di lapisan aplikasi tidak berarti apa-apa kalau ada
jalur lain menuju data yang sama.

**Perbaikan.** RLS dinyalakan pada keempat tabel. Tiga di antaranya sengaja
dibiarkan **tanpa policy**, dan itu memang posisi terkuatnya: RLS aktif tanpa
policy menolak seluruh akses lewat anon key, dan tidak ada kode frontend yang
menyentuh tabel-tabel itu. Backend Go terhubung sebagai pemilik tabel lewat
connection string PostgreSQL, dan pemilik tabel tidak tunduk pada RLS kecuali
tabelnya disetel `FORCE ROW LEVEL SECURITY` — jadi backend tidak terpengaruh.

**Belum selesai.** Policy pada `profiles` memakai peran `public` dan klausa
`USING`-nya belum diperiksa. Kalau tidak membatasi ke baris sendiri, satu
pengguna dapat membaca `gdrive_refresh_token` milik pengguna lain — dan token
itu memberi akses ke Google Drive orang tersebut. Tercatat sebagai F-16.

---

## 5. Tabel rate_limits lahir tanpa RLS, dan limiternya jadi bisa dilewati

**Masalah.** Tabel `rate_limits` yang dibuat untuk menyimpan penghitung
pembatasan dibuat lewat `AutoMigrate` GORM. GORM memakai `CREATE TABLE` biasa,
dan PostgreSQL membuat tabel baru tanpa RLS.

**Kenapa berbahaya.** Ini membatalkan seluruh guna limiternya. Anon key ada di
bundle frontend; dengan RLS mati, siapa pun yang memilikinya dapat menghapus
baris penghitungnya sendiri lewat REST API Supabase, lalu mengulang percobaan
menebak magic link dari nol. Pembatasan yang sudah dibuktikan bekerja di
produksi dapat dilewati **tanpa menyentuh backend sama sekali**.

Yang membuat temuan ini layak diceritakan bukan tabelnya, melainkan polanya:
setiap tabel yang dibuat `AutoMigrate` di project Supabase akan lahir tanpa RLS,
dan tidak ada yang memberi tahu selain advisor. Memperbaiki satu tabel tidak
menyelesaikan apa pun — tabel berikutnya akan lolos dengan cara yang sama.

**Perbaikan.** Migrasi dipindahkan keluar dari jalur startup ke `cmd/migrate`,
sehingga pembuatan skema jadi tindakan yang disengaja. Perintah itu menyalakan
RLS pada tabel yang dikelolanya, lalu **memeriksa seluruh skema `public`** dan
berhenti dengan error kalau ada satu tabel pun tanpa RLS — termasuk tabel yang
ditambahkan orang lain di kemudian hari.

**Bukti.** Diuji dengan membuat tabel tanpa RLS lalu menjalankan migrasi:

```
🔴 Migrasi gagal: tabel berikut ada di skema public tanpa RLS: invoices.
exit status 1
```

---

## 6. Proxy Google Drive yang terbuka

**Masalah.** Galeri klien memuat fotonya lewat rute publik yang menerima ID
folder mentah:

```
GET /api/gdrive/:folderId
```

Rute itu membaca folder memakai service account bersama milik aplikasi, tanpa
satu pun pemeriksaan yang menghubungkan pemanggil dengan folder yang dimintanya.

**Kenapa berbahaya.** Backend berfungsi sebagai proxy terbuka ke **setiap folder
yang pernah dibagikan ke service account itu**, milik fotografer mana pun.
Penyerang tidak perlu magic link, tidak perlu akun, dan tidak perlu menebak ID
folder: `drive_folder_id` ikut terkirim di dalam payload `GET /api/p/:magic_link`,
jadi satu tautan galeri yang sah sudah cukup untuk memanen ID folder, dan ID itu
dapat dipakai tanpa batasan apa pun.

**Perbaikan.** Rutenya dihapus. Penggantinya `GET /api/p/:magic_link/photos` —
magic link menentukan project, project menentukan pemiliknya, dan kredensial
pemilik itulah yang dipakai membaca Drive. Tidak ada lagi cara meminta isi
folder yang bukan bagian dari galeri mana pun.

Akar masalahnya juga dicabut: pembacaan Drive tidak lagi memakai satu service
account bersama. Sebelumnya ada **tiga** kredensial berbeda yang membaca Drive —
service account, API key, dan OAuth per-user. Ketiganya kini disatukan ke
kredensial OAuth milik pemilik project, sehingga token yang bocor membuka Drive
satu fotografer, bukan setiap folder yang pernah dibagikan ke aplikasi.

Scope OAuth juga dipersempit dari `drive` penuh ke `drive.readonly`. Aplikasi
ini hanya membaca; scope penuh berarti satu token yang bocor dapat menghapus
seluruh arsip foto fotografer. Perlu dicatat: refresh token yang sudah terbit
tetap membawa scope lama, jadi penyempitan ini hanya berlaku untuk otorisasi
baru.

**Tes yang membuktikan.** `handlers/gallery_photos_test.go` berjalan tanpa satu
pun panggilan jaringan lewat `storage.FakeStore`, dan memastikan galeri tetap
tampil dari salinan tersimpan ketika Drive tidak dapat dibaca — sehingga
perpindahan ke kredensial per-user tidak mematikan galeri milik fotografer yang
belum menghubungkan Drive-nya.

---

## 7. Parameter `state` OAuth membawa user_id mentah

**Masalah.** Alur koneksi Google Drive dimulai dengan:

```
GET /api/auth/google/login?user_id=<uuid>
```

`user_id` itu diteruskan apa adanya sebagai parameter `state` OAuth, dan callback
mempercayainya sebagai identitas.

**Kenapa berbahaya.** Penyerang yang mengetahui UUID korban dapat membuka alur
koneksi atas nama korban, menyetujuinya dengan **akun Google miliknya sendiri**,
dan refresh token miliknya tersimpan di profil korban. Setelah itu project milik
korban menarik foto dari Drive penyerang.

Ada kerugian kedua: `state` ada justru untuk mencegah CSRF pada alur OAuth.
Dipakai sebagai pembawa data, perlindungan itu hilang seluruhnya.

**Perbaikan.** Rute pembukanya kini `POST /api/auth/google/url`, terautentikasi
lewat JWT, dan mengembalikan URL alih-alih melakukan redirect. Bentuk itu
dipilih karena alasan teknis yang menjelaskan kenapa desain lamanya muncul:
navigasi teratas browser tidak membawa header `Authorization`, sehingga sebuah
redirect tidak punya cara membuktikan siapa yang memintanya. Menerima `user_id`
dari query adalah jalan pintas yang menghindari masalah itu dengan menyerahkan
identitas kepada pihak yang sedang diautentikasi.

`state` sekarang 32 byte acak, disimpan di tabel `oauth_states` bersama user yang
memulainya, sekali pakai, dan kedaluwarsa 10 menit. Callback menukarnya lewat
satu perintah `DELETE ... RETURNING` — bukan `SELECT` lalu `DELETE` terpisah,
karena alasan yang sama seperti penguncian galeri di bagian 2.

---

## 8. Koreksi: error `rand.Read` yang ternyata bukan kerentanan

Kode lama mengabaikan nilai kembalian `rand.Read` saat membuat magic link:

```go
bytes := make([]byte, 4)
rand.Read(bytes)     // error diabaikan
```

Mengabaikan error dari sumber acak terlihat seperti kerentanan klasik: kalau
gagal, buffer tetap berisi nol dan token menjadi dapat ditebak.

**Ternyata tidak, di versi Go ini.** Dari dokumentasi `crypto/rand` pada Go 1.26:

> Read fills b with cryptographically secure random bytes. **It never returns an
> error**, and always fills b entirely. Read calls io.ReadFull on Reader and
> **crashes the program irrecoverably** if an error is returned.

Sejak Go 1.24, kegagalan sumber acak sistem menjatuhkan proses, bukan diam-diam
menghasilkan byte lemah. Jadi error yang diabaikan itu tidak pernah menjadi
jalan menuju token yang dapat ditebak.

Errornya tetap diteruskan sekarang, supaya kegagalannya eksplisit dan tidak
bergantung pada janji versi Go tertentu — tapi itu kebersihan kode, bukan
penambalan lubang. Yang benar-benar menutup celah penebakan di fungsi itu adalah
perubahan 4 byte menjadi 16 byte.

Dicatat di sini karena mengklaim lebih dari yang bisa dibuktikan justru merusak
seluruh isi berkas ini.

---

## 9. Koreksi: dugaan RLS memblokir upsert profil yang ternyata salah

Frontend memanggil ini tepat setelah registrasi berhasil, dan hasilnya tidak
diperiksa sama sekali:

```js
await supabase.from('profiles').upsert({ id, full_name, whatsapp, email })
```

Dugaan awal saya: RLS pada `profiles` memblokir penulisan itu, sehingga baris
profil tidak pernah terbentuk, dan karenanya pengguna baru tidak akan pernah
bisa menghubungkan Google Drive.

**Dugaan itu gugur setelah database diperiksa langsung.** `auth.users` berisi 3
baris dan `profiles` juga 3 — dan dua di antaranya punya `gdrive_refresh_token`
terisi, artinya alur OAuth pernah berjalan sampai selesai. Baris profil memang
terbentuk, lewat trigger `handle_new_user()`, bukan lewat upsert dari frontend.

Penyebab sebenarnya lebih sederhana: skema `profiles` hanya punya `id`,
`full_name`, `gdrive_refresh_token`, dan `updated_at`. Kolom `whatsapp` dan
`email` yang dikirim upsert itu **tidak ada**, jadi panggilannya selalu gagal
karena ketidakcocokan skema — dan tidak pernah ketahuan karena hasilnya tidak
pernah dibaca.

Nomor WhatsApp yang coba disimpan di sana sebenarnya sudah tersimpan di kolom
`admin_whats_app` dan `client_whats_app` pada tabel `projects`. Jadi
panggilannya bukan cuma salah, ia juga tidak dibutuhkan.

Dua pelajaran yang saya ambil, dan keduanya alasan bagian ini ditulis:

1. Panggilan yang hasilnya tidak diperiksa akan gagal tanpa suara. Kegagalan ini
   bertahan cukup lama untuk memunculkan dua dugaan keliru sebelum ada yang
   benar-benar melihat isi databasenya.
2. Saya menulis dugaan itu ke dalam catatan seolah kesimpulan. Memeriksanya
   memakan satu query. Sekarang catatannya menyebut mana yang diverifikasi dan
   mana yang belum.
