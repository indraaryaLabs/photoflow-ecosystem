-- PhotoFlow — data demo
-- =====================
--
-- Skrip ini mengisi satu akun dengan dua galeri contoh: satu yang masih
-- menunggu klien memilih, satu yang pilihannya sudah dikirim dan karenanya
-- terkunci. Dua keadaan itu yang perlu terlihat oleh siapa pun yang mencoba
-- aplikasi ini.
--
--
-- LANGKAH 1 — buat akunnya, JANGAN lewat form pendaftaran
-- --------------------------------------------------------
-- Form pendaftaran di web portal memanggil supabase.auth.signUp(), yang
-- mengirim email konfirmasi. Alamat demo tidak punya inbox, jadi jalur itu
-- buntu. Lewati dengan membuat user langsung dari dashboard:
--
--     Supabase → Authentication → Users → Add user → Create new user
--     ✅ centang "Auto Confirm User"
--
-- Emailnya bebas, misalnya demo@photoflow.app. User yang dihasilkan identik
-- dengan hasil pendaftaran normal — email_confirmed_at terisi — jadi login
-- lewat web portal maupun aplikasi desktop langsung bekerja.
--
--
-- LANGKAH 2 — isi user id dan sumber fotonya di bawah, lalu jalankan
-- -------------------------------------------------------------------
-- Jalankan di Supabase → SQL Editor.
--
-- Tentang thumbnail: bentuk `https://drive.google.com/thumbnail?id=<ID>&sz=w800`
-- hanya tampil kalau berkasnya dibagikan "Anyone with the link" di Drive.
-- Kalau folder demo masih privat, gambarnya muncul untukmu — karena browser-mu
-- login Google — tapi kosong untuk orang lain. Periksa lewat jendela
-- penyamaran sebelum mencantumkan tautannya di mana pun.
--
-- Galeri klien tidak menuntut Drive terhubung: kalau Drive tidak terbaca,
-- backend menyajikan salinan dari tabel photos yang diisi skrip ini. Jadi
-- akun demo tetap bisa dipertunjukkan tanpa pernah menyetujui OAuth Google.

begin;

with pengaturan as (
    select
        -- Ganti dengan id user demo. Ambil dari Authentication → Users.
        '00000000-0000-0000-0000-000000000000'::uuid as user_id,

        -- Folder Drive sumber foto. Boleh dibiarkan kalau Drive tidak dipakai;
        -- nilainya hanya tersimpan, tidak wajib bisa dibaca.
        'https://drive.google.com/drive/folders/GANTI_ID_FOLDER' as drive_folder_url,
        'GANTI_ID_FOLDER'                                        as drive_folder_id,

        -- Nomor WhatsApp sengaja placeholder. Baris project dikembalikan utuh
        -- oleh GET /api/p/:magic_link, jadi nomor apa pun di sini terbaca oleh
        -- siapa saja yang memegang magic link-nya.
        '6281234567890' as wa_admin
),

-- Daftar foto contoh. Ganti setiap ID dengan id berkas Drive milikmu.
-- Tambah atau kurangi baris sesuai kebutuhan.
foto_sumber(urutan, nama_berkas, drive_id) as (
    values
        (1, 'DSC_0431.ARW', 'GANTI_ID_FOTO_1'),
        (2, 'DSC_0448.ARW', 'GANTI_ID_FOTO_2'),
        (3, 'DSC_0502.ARW', 'GANTI_ID_FOTO_3'),
        (4, 'DSC_0517.ARW', 'GANTI_ID_FOTO_4'),
        (5, 'DSC_0563.ARW', 'GANTI_ID_FOTO_5'),
        (6, 'DSC_0590.ARW', 'GANTI_ID_FOTO_6')
),

-- Galeri pertama: klien belum memilih. Inilah yang paling layak dibagikan —
-- pembukanya bisa langsung mencoba memilih foto dan menekan kirim.
galeri_pending as (
    insert into public.projects
        (user_id, project_name, client_name, max_selections,
         drive_folder_url, drive_folder_id, magic_link_token,
         admin_whats_app, client_whats_app, status, created_at, updated_at)
    select
        s.user_id, 'Prewedding Rina & Anton', 'Rina & Anton', 12,
        s.drive_folder_url, s.drive_folder_id,
        -- 16 byte acak, sama seperti yang dibuat backend. Panjang inilah yang
        -- benar-benar menjaga galeri tanpa login: pembatasan percobaan per IP
        -- hanya lapis kedua.
        encode(gen_random_bytes(16), 'hex'),
        s.wa_admin, '6289876543210', 'pending',
        now() - interval '2 days', now() - interval '2 days'
    from pengaturan s
    returning id, magic_link_token, project_name
),

-- Galeri kedua: sudah dikirim, jadi terkunci. Menunjukkan sisi lain alurnya.
galeri_submitted as (
    insert into public.projects
        (user_id, project_name, client_name, max_selections,
         drive_folder_url, drive_folder_id, magic_link_token,
         admin_whats_app, client_whats_app, status, created_at, updated_at)
    select
        s.user_id, 'Wisuda Nurul Hidayah', 'Nurul Hidayah', 8,
        s.drive_folder_url, s.drive_folder_id,
        encode(gen_random_bytes(16), 'hex'),
        s.wa_admin, '6289876543211', 'submitted',
        now() - interval '9 days', now() - interval '6 days'
    from pengaturan s
    returning id, magic_link_token, project_name
),

-- Galeri pending memuat seluruh katalog, belum ada yang terpilih.
isi_pending as (
    insert into public.photos (project_id, file_name, thumbnail_url, is_selected, created_at)
    select g.id, f.nama_berkas,
           'https://drive.google.com/thumbnail?id=' || f.drive_id || '&sz=w800',
           false, now() - interval '2 days'
    from galeri_pending g cross join foto_sumber f
    returning 1
),

-- Galeri submitted hanya memuat pilihan kliennya — bentuk yang sama dengan
-- hasil submit sungguhan.
isi_submitted as (
    insert into public.photos (project_id, file_name, thumbnail_url, is_selected, created_at)
    select g.id, f.nama_berkas,
           'https://drive.google.com/thumbnail?id=' || f.drive_id || '&sz=w800',
           true, now() - interval '6 days'
    from galeri_submitted g cross join foto_sumber f
    where f.urutan <= 3
    returning 1
)

select project_name,
       'https://photoflow-ecosystem.vercel.app/?token=' || magic_link_token as magic_link
from galeri_pending
union all
select project_name,
       'https://photoflow-ecosystem.vercel.app/?token=' || magic_link_token
from galeri_submitted;

commit;

-- Keluaran perintah di atas adalah dua magic link yang siap dicantumkan di
-- README. Simpan; token-nya acak dan tidak bisa dibentuk ulang.
--
-- Untuk membatalkan seluruh isi skrip ini:
--
--   delete from public.photos
--    where project_id in (select id from public.projects where user_id = '<id user demo>');
--   delete from public.projects where user_id = '<id user demo>';
