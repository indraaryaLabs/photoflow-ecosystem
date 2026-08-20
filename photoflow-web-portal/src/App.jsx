import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

import Toast from './components/Toast';
import Header from './components/Header';
import PhotoGrid, { DensityPicker } from './components/PhotoGrid';
import { useDensity } from './lib/useDensity';
import FloatingBar from './components/FloatingBar';
import SubmitConfirmModal from './components/SubmitConfirmModal';
import { ingatGaleri, lupakanGaleri, PRIVACY_PATH, TERMS_PATH } from './lib/legal';

import { API_BASE } from './lib/api';
import { openedFromRecoveryLink } from './lib/recovery';
import { useTheme } from './lib/theme';
import { bacaDraf, simpanDraf, hapusDraf, petakanKeId } from './lib/selectionDraft';
import { withViewTransition } from './lib/viewTransition';
import { useRoute } from './lib/router';

// Tiga bagian yang dimuat hanya kalau benar-benar dibuka.
//
// Sebelum ini seluruh aplikasi dikirim sebagai satu berkas 626 KB, jadi klien
// yang membuka galeri lewat magic link ikut mengunduh seluruh dashboard —
// formulir project, modal-modalnya, halaman hukum — padahal ia tidak punya akun
// dan tidak akan pernah melihat satu pun di antaranya. Sebaliknya juga: seorang
// fotografer mengunduh layar pratinjau galeri sebelum membukanya.
//
// Klien galeri adalah orang yang paling sering membuka aplikasi ini, paling
// sering di ponsel, dan paling sering di jaringan seluler. Ia yang paling
// dirugikan, dan ia yang paling diuntungkan pemisahan ini.
//
// PreviewModal dipisah dengan alasan berbeda: ia satu-satunya bagian galeri
// yang tidak dibutuhkan pada layar pertama, dan menundanya memindahkan
// framer-motion versi beratnya keluar dari jalur muat awal.
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AdminLogin = lazy(() => import('./components/AdminLogin'));
const LegalPage = lazy(() => import('./components/LegalPage'));
const PreviewModal = lazy(() => import('./components/PreviewModal'));


/** Layar tunggu untuk bagian yang dimuat terpisah. */
function Memuat() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ash-50 dark:bg-ash-950">
      <Loader2 size={32} strokeWidth={1.75} className="text-ash-600 dark:text-ash-400 animate-spin" />
    </div>
  );
}

export default function App() {
  // ─── Variables routing (No hook dependencies) ────────────────
  // Ruang kerja fotografer dulu berada di /admin. Namanya menyesatkan: tidak
  // ada tingkatan hak akses di aplikasi ini sama sekali. Setiap fotografer
  // membuka jalur yang sama dan melihat proyeknya sendiri, karena datanya
  // disaring per `user_id` oleh Row Level Security di Supabase. Kata "admin"
  // menyiratkan ada peran istimewa yang sebenarnya tidak pernah ada.
  //
  // /admin tetap dilayani sebagai jalur lama supaya tautan dan bookmark yang
  // sudah beredar — termasuk tombol "Buka Dashboard" di aplikasi desktop —
  // tidak mati.
  const DASHBOARD_PATH = '/dashboard';
  const LEGACY_DASHBOARD_PATH = '/admin';

  const { pathname, search, navigasi } = useRoute();
  const isLegacyDashboardRoute = pathname === LEGACY_DASHBOARD_PATH || pathname.startsWith(LEGACY_DASHBOARD_PATH + '/');
  const isDashboardRoute = pathname === DASHBOARD_PATH || pathname.startsWith(DASHBOARD_PATH + '/');

  const token = new URLSearchParams(search).get('token');

  // Dashboard membuka galeri lewat tautan yang sama persis dengan yang dipegang
  // klien, jadi tanpa penanda ini "klien sudah membuka galeri" akan berbunyi
  // pada detik fotografer mengintip pekerjaannya sendiri. Diteruskan ke backend,
  // yang memakainya untuk tidak mencatat kunjungan ini.
  const isPreview = new URLSearchParams(search).get('preview') === '1';
  const galleryQuery = isPreview ? '?preview=1' : '';

  const isHome = pathname === '/';

  // Galeri klien tidak butuh autentikasi apa pun: tautannya sendiri yang jadi
  // kuncinya. Membedakannya di sini memungkinkan seluruh pustaka auth tidak
  // pernah diunduh pada jalur itu.
  //
  // Halaman hukum juga tidak, tapi keduanya sudah dilayani oleh cabang routing
  // yang berhenti lebih awal, jadi tidak perlu disebut lagi di sini.
  const galeriKlien = isHome && Boolean(token);
  const perluAuth = !galeriKlien;

  // Dicatat SELAMA render, bukan di dalam effect.
  //
  // Kaki galeri menautkan ke /privacy lewat <a href> biasa, yang memuat ulang
  // dokumen. Sebuah effect belum tentu sempat berjalan sebelum peramban
  // meninggalkan halaman kalau tautannya diketuk cepat, dan yang hilang bukan
  // kenyamanan: klien mendarat di halaman hukum tanpa jalan pulang ke
  // galerinya.
  //
  // Menuliskannya di sini aman karena sasarannya sessionStorage, bukan state
  // React — tidak ada render yang dipicu, jadi tidak ada putaran yang bisa
  // terjadi.
  if (galeriKlien) {
    ingatGaleri(token, isPreview);
  } else if (isDashboardRoute || isLegacyDashboardRoute) {
    // Fotografer yang berpindah ke dashboardnya sendiri tidak sedang menuju ke
    // mana pun lewat galeri. Membiarkan catatan lama berarti tombol kembali di
    // halaman hukum melemparnya ke galeri klien yang sudah lama ia tinggalkan.
    lupakanGaleri();
  }

  // ─── 1. Auth State ───────────────────────────────────────────
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  // Dimulai dari false pada galeri klien, bukan disetel belakangan di effect:
  // memulainya true berarti galeri menampilkan pemutar berputar dulu, lalu
  // sekali render lagi untuk mematikannya — dua render dan satu kedipan untuk
  // pemeriksaan yang memang tidak pernah dijalankan.
  const [isAuthChecking, setIsAuthChecking] = useState(perluAuth);

  // Tautan pemulihan password membawa sesi yang sah. Tanpa penanda terpisah,
  // routing di bawah menyimpulkan orangnya sudah login dan melemparnya ke
  // dashboard, sehingga layar penggantian password tidak pernah terlihat.
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(openedFromRecoveryLink);

  // ─── 2. Data State (from API) ────────────────────────────────
  const [project, setProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Null berarti daftarnya dibaca langsung dari Google Drive. Berisi nilai
  // berarti Drive tidak terbaca dan yang tampil adalah salinan database, yang
  // bisa tertinggal dari isi folder sebenarnya.
  const [photoSource, setPhotoSource] = useState(null);

  // ─── 3. UI State ─────────────────────────────────────────────
  // Tiga keadaan: mengikuti sistem (default), terang, gelap. Seluruh logikanya
  // — termasuk kapan boleh menulis ke localStorage — ada di lib/theme.js.
  const { choice: themeChoice, cycle: cycleTheme } = useTheme();

  const [selectedIds, setSelectedIds] = useState(new Set());

  // Draf harus dipulihkan LEBIH DULU sebelum boleh ditulis. Tanpa penanda ini,
  // effect penyimpan berjalan pada render pertama dengan pilihan yang masih
  // kosong dan langsung menimpa draf yang hendak dipulihkan -- persis kerja
  // yang ingin diselamatkan.
  const drafSudahDipulihkan = useRef(false);
  const [toasts, setToasts] = useState([]);
  const [previewState, setPreviewState] = useState({ index: null, direction: 0 });
  const [density, setDensity] = useDensity();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittedState, setIsSubmittedState] = useState(false);

  // Dialog yang berdiri di antara tombol kirim dan penguncian galeri. Lihat
  // SubmitConfirmModal untuk alasannya.
  const [konfirmasiKirim, setKonfirmasiKirim] = useState(false);

  // ─── 4. Hooks / Effects ──────────────────────────────────────

  // Rapikan URL tanpa memuat ulang halaman.
  //
  // Dua jalur menampilkan dashboard tapi tidak menuliskannya di bilah alamat:
  // `/admin` yang lama, dan `/` ketika orangnya sudah masuk. Keduanya dulu
  // diperbaiki dengan `window.location.replace`, yang berarti MEMBANGUN ULANG
  // SELURUH APLIKASI hanya untuk mengubah teks di bilah alamat.
  //
  // Dikerjakan di effect, bukan saat render: mengalihkan saat render membuang
  // satu render dan memperlihatkan satu kedipan layar kosong. Di sini layarnya
  // sudah tergambar lebih dulu, dan alamatnya menyusul pada frame yang sama.
  //
  // `ganti: true` supaya tombol kembali tidak memantulkan orangnya ke jalur
  // yang baru saja ditinggalkan.
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    const perluDirapikan =
      isLegacyDashboardRoute || (isHome && !token && !isPasswordRecovery);

    if (perluDirapikan) navigasi(DASHBOARD_PATH, { ganti: true });
  }, [isAdminAuthenticated, isLegacyDashboardRoute, isHome, token, isPasswordRecovery, navigasi]);

  // Ambil berkas dashboard lebih awal, selagi layar masuk terbuka.
  //
  // Setelah routing tidak lagi memuat ulang halaman, sisa jeda sesudah menekan
  // "Sign In" tinggal satu hal: berkas dashboard baru MULAI diunduh pada detik
  // tombolnya ditekan. Padahal orang menghabiskan beberapa detik mengetik email
  // dan password lebih dulu, dan selama itu jaringannya menganggur.
  //
  // Diminta di sini, berkasnya hampir selalu sudah ada di cache ketika
  // gilirannya tiba. Yang membukanya hanya orang yang memang sedang berada di
  // layar masuk, jadi klien galeri tidak ikut membayar apa pun.
  useEffect(() => {
    if (!perluAuth || isAdminAuthenticated) return;

    const ambil = () => { import('./components/AdminDashboard'); };
    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(ambil, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(ambil, 1500);
    return () => clearTimeout(t);
  }, [perluAuth, isAdminAuthenticated]);

  // Auth Session Checker.
  //
  // Klien galeri dilewati seluruhnya, dan itu bukan penghematan kecil:
  // supabase-js berukuran 49 KB terkompresi, dan sebelum ini ia diunduh oleh
  // SETIAP orang yang membuka magic link — orang yang tidak punya akun, tidak
  // pernah masuk, dan tidak akan pernah menyentuh satu pun fungsinya. Di
  // jaringan seluler itulah bagian terbesar dari jeda sebelum foto pertama
  // muncul.
  //
  // Diimpor secara dinamis, sehingga bundler menaruhnya di berkas terpisah yang
  // hanya diminta pada jalur yang benar-benar membutuhkannya.
  useEffect(() => {
    if (!perluAuth) return;

    let subscription;
    let dibatalkan = false;

    import('./lib/supabase').then(({ supabase }) => {
      // Komponennya bisa saja sudah dilepas sebelum modulnya tiba.
      if (dibatalkan) return;

      supabase.auth.getSession().then(({ data: { session } }) => {
        setIsAdminAuthenticated(!!session);
        setIsAuthChecking(false);
      });

      subscription = supabase.auth.onAuthStateChange((event, session) => {
        setIsAdminAuthenticated(!!session);
        if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      }).data.subscription;
    });

    return () => {
      dibatalkan = true;
      subscription?.unsubscribe();
    };
  }, [perluAuth]);

  // Idle Auto-Logout Timer (30 Menit)
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    let timeoutId;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        // Modulnya sudah pasti termuat di sini: effect ini hanya berjalan
        // ketika seseorang sudah login, dan yang menyatakan ia login adalah
        // modul yang sama.
        const { supabase } = await import('./lib/supabase');
        await supabase.auth.signOut();
        // Kembali ke layar masuk. signOut memicu onAuthStateChange, yang
        // mematikan penanda autentikasi, jadi jalur '/' menggambar layar masuk
        // dengan sendirinya — tanpa memuat ulang halaman.
        navigasi('/');
      }, 1800000); // 30 Menit
    };

    // Listeners aktivitas
    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('click', resetTimer);

    resetTimer(); // Mulai timer saat komponen dimuat

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('click', resetTimer);
    };
  }, [isAdminAuthenticated, navigasi]);

  // Fetch Gallery Data
  useEffect(() => {
    if (!token) {
      setError('This gallery link is invalid or incomplete.');
      setIsLoading(false);
      return;
    }

    const fetchGallery = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/p/${token}${galleryQuery}`);

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || `Gallery not found. (status ${res.status})`);
        }

        const data = await res.json();
        setProject(data.project);

        // Gallery Lock: Jika status sudah 'submitted', kunci UI
        if (data.project?.status === 'submitted') {
          setIsSubmittedState(true);
        }

        // Daftar foto diambil lewat magic link, bukan lewat ID folder Drive.
        // Backend yang menentukan pemilik galeri dan memakai kredensial Drive
        // miliknya; kalau Drive tidak terbaca, backend mengembalikan salinan
        // yang tersimpan di database dalam bentuk yang sama.
        try {
          const photosRes = await fetch(`${API_BASE}/api/p/${token}/photos`);
          if (!photosRes.ok) throw new Error(`status ${photosRes.status}`);
          const photosData = await photosRes.json();
          setPhotos(photosData.files || []);
          // Backend memberi tahu dari mana daftar ini berasal. Sampai sekarang
          // keterangan itu dibuang, dan akibatnya galeri yang jatuh ke salinan
          // database tampil sebagai deretan kotak kosong tanpa satu pun
          // petunjuk kenapa. Yang terlihat hanya "fotonya hilang".
          setPhotoSource(photosData.source === 'stored'
            ? { stored: true, reason: photosData.reason }
            : null);

          // Salinan yang sudah lawas disegarkan SESUDAH fotonya tergambar.
          //
          // Backend melayani galeri dari salinan database supaya klien tidak
          // menunggu Google membaca ribuan berkas. Ongkosnya: foto yang baru
          // ditambahkan ke folder belum tentu ada di salinan itu. Permintaan
          // kedua ini yang menutupnya — dan karena berangkat setelah layar
          // terisi, tidak ada yang menunggunya.
          //
          // Backend sendiri yang memutuskan `stale`, sehingga ambangnya hanya
          // ada di satu tempat, dan menolak menyegarkan lebih rapat dari satu
          // menit agar rute publik ini tidak bisa dipakai memanggil Drive
          // berulang kali atas nama fotografernya.
          if (photosData.stale) segarkanDiLatar();
        } catch (photosErr) {
          // Galeri tidak boleh mati hanya karena daftar foto gagal diambil:
          // salinannya ikut terkirim bersama data project. Bentuknya diselaraskan
          // di sini karena baris database memakai file_name dan thumbnail_url,
          // sedangkan galeri membaca name dan thumbnailLink.
          console.warn('Could not load the photo list; falling back to the stored copy:', photosErr);
          setPhotoSource({ stored: true, reason: 'photos_endpoint_failed' });
          setPhotos(
            (data.photos || []).map(p => ({
              id: p.id,
              name: p.file_name,
              thumbnailLink: p.thumbnail_url,
            }))
          );
        }
      } catch (err) {
        setError(err.message || 'Something went wrong while loading this gallery.');
      } finally {
        setIsLoading(false);
      }
    };

    // Menyegarkan daftar foto tanpa mengganggu pekerjaan yang sedang berjalan.
    //
    // Yang paling mudah rusak di sini adalah pilihan klien. Daftar dari Drive
    // memakai id berkas Google, sedangkan salinan database memakai id barisnya
    // sendiri — jadi menukar daftar begitu saja akan membuat setiap foto yang
    // sudah dipilih kehilangan tandanya.
    //
    // Karena itu daftarnya hanya ditukar kalau ISINYA memang berbeda, dan
    // pilihannya dipetakan ulang lewat nama berkas. Pada kunjungan biasa, di
    // mana folder tidak berubah, tidak ada satu pun yang diganti dan klien
    // tidak melihat apa-apa terjadi.
    const segarkanDiLatar = () => {
      const jalankan = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/p/${token}/photos?refresh=1`);
          if (!res.ok) return;
          const baru = (await res.json()).files || [];
          if (!baru.length) return;

          setPhotos((lama) => {
            const samaSaja =
              lama.length === baru.length &&
              lama.every((p, i) => p.name === baru[i].name);
            if (samaSaja) return lama;

            setSelectedIds((terpilih) => {
              const namaTerpilih = lama
                .filter((p) => terpilih.has(p.id))
                .map((p) => p.name);
              return petakanKeId(namaTerpilih, baru, project?.max_selections);
            });
            return baru;
          });
        } catch {
          // Galeri yang sedang tampil tetap benar. Penyegaran yang gagal tidak
          // punya apa pun untuk dilaporkan kepada klien.
        }
      };

      const idle = window.requestIdleCallback;
      if (idle) idle(jalankan, { timeout: 4000 });
      else setTimeout(jalankan, 1500);
    };

    fetchGallery();
  }, [token, galleryQuery, project?.max_selections]);

  // ─── Callbacks ───────────────────────────────────────────────
  const addToast = useCallback((message) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  // Pulihkan pilihan yang belum sempat dikirim.
  //
  // Dijalankan setelah daftar foto ada, karena draf disimpan sebagai nama
  // berkas dan baru bisa dipetakan kembali ke id ketika fotonya sudah dikenal.
  useEffect(() => {
    if (drafSudahDipulihkan.current) return;
    if (isLoading || !token || !photos.length) return;

    // Galeri yang sudah dikirim tidak lagi bisa diubah, jadi drafnya tidak ada
    // gunanya -- dan meninggalkannya berarti pilihan lama muncul kembali kalau
    // fotografer membuka ulang pemilihannya.
    if (isSubmittedState) {
      hapusDraf(token);
      drafSudahDipulihkan.current = true;
      return;
    }

    const nama = bacaDraf(token);
    if (nama.length) {
      const ids = petakanKeId(nama, photos, project?.max_selections);
      if (ids.size) {
        setSelectedIds(ids);
        addToast(`Restored ${ids.size} photo${ids.size === 1 ? '' : 's'} you picked earlier.`);
      }
    }
    drafSudahDipulihkan.current = true;
  }, [isLoading, token, photos, isSubmittedState, project?.max_selections, addToast]);

  // Ambil berkas layar pratinjau lebih awal, setelah galerinya siap.
  //
  // Tanpa ini, ketukan pertama pada tombol perbesar harus menunggu berkasnya
  // diunduh dulu — jeda yang justru muncul tepat pada tindakan yang seharusnya
  // terasa seketika. Diminta di sini, berkasnya sudah ada di cache jauh sebelum
  // ada yang menekannya.
  //
  // requestIdleCallback supaya permintaannya tidak berebut dengan gambar galeri
  // yang sedang dimuat; setTimeout untuk Safari, yang belum punya fungsi itu.
  useEffect(() => {
    if (isLoading || !photos.length) return;

    const ambil = () => { import('./components/PreviewModal'); };
    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(ambil, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(ambil, 1200);
    return () => clearTimeout(t);
  }, [isLoading, photos.length]);

  // Simpan setiap perubahan pilihan.
  //
  // Ditunda 300ms, tidak ditulis pada tiap klik. localStorage adalah tulisan
  // SINKRON di utas utama: menyimpan pada setiap ketukan berarti membangun peta
  // seluruh foto, menyusun daftar nama, dan men-serialisasi JSON di tengah
  // gerakan yang harus terasa seketika. Orang memilih foto secara beruntun,
  // jadi penundaan ini menggabungkan sederet ketukan jadi satu penulisan.
  //
  // Yang tidak dikorbankan: penyelamatan drafnya sendiri. 300ms jauh lebih
  // pendek daripada jeda mana pun antara memilih foto terakhir dan menutup tab,
  // dan pembersihnya menjalankan ulang penundaan pada setiap perubahan
  // berikutnya, bukan membatalkannya diam-diam.
  useEffect(() => {
    if (!drafSudahDipulihkan.current || !token || isSubmittedState) return;

    const tunda = setTimeout(() => {
      const perId = new Map(photos.map((p) => [p.id, p.name]));
      const nama = [...selectedIds].map((id) => perId.get(id)).filter(Boolean);
      simpanDraf(token, nama);
    }, 300);

    return () => clearTimeout(tunda);
  }, [selectedIds, photos, token, isSubmittedState]);

  const handleToggleSelect = useCallback((id) => {
    // Gallery Lock: Cegah interaksi jika sudah disubmit
    if (isSubmittedState) {
      addToast('This gallery is locked. Your selection has already been submitted.');
      return;
    }

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= project?.max_selections) {
          addToast(`You have reached the limit of ${project.max_selections} photos.`);
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  }, [project?.max_selections, addToast, isSubmittedState]);

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Build payload with file names so backend can INSERT into photos table
      const selectedPhotosPayload = photos
        .filter(p => selectedIds.has(p.id))
        .map(p => ({ drive_id: p.id, file_name: p.name }));

      const res = await fetch(`${API_BASE}/api/p/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_photos: selectedPhotosPayload }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Could not submit your selection. (status ${res.status})`);
      }

      // Drafnya sudah jadi kiriman sungguhan, jadi tidak ada lagi yang perlu
      // diselamatkan. Dibuang SEBELUM isSubmittedState disetel: effect penyimpan
      // berhenti bekerja begitu galerinya terkunci, jadi kalau urutannya
      // terbalik draf itu tertinggal di peramban klien untuk selamanya.
      hapusDraf(token);
      addToast('Your selection has been sent to your photographer.');
      setIsSubmittedState(true);
      // Ditutup hanya setelah berhasil. Kalau pengirimannya gagal, dialognya
      // tetap terbuka bersama tombolnya — orang yang baru saja menekan "Yes,
      // send" tidak perlu mencari lagi dari awal untuk mencoba ulang.
      setKonfirmasiKirim(false);
    } catch (err) {
      addToast(err.message || 'Something went wrong while submitting your selection.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, photos, addToast, isSubmitting, token]);

  // Membuka dan menutup pratinjau dibungkus View Transition, sehingga fotonya
  // benar-benar bergerak dan membesar dari petaknya di grid alih-alih hilang
  // lalu digantikan gambar lain yang memudar masuk. Perpindahan yang terlihat
  // itu yang memberi tahu foto mana yang sedang dibuka, dan setelah ditutup,
  // di baris mana tadi ia berada.
  const handleOpenPreview = useCallback((index) => {
    withViewTransition(() => setPreviewState({ index, direction: 0 }));
  }, []);

  const handleClosePreview = useCallback(() => {
    withViewTransition(() => setPreviewState({ index: null, direction: 0 }));
  }, []);

  const handleNextPreview = useCallback(() => {
    setPreviewState(prev => ({
      index: prev.index !== null ? (prev.index + 1) % photos.length : null,
      direction: 1
    }));
  }, [photos.length]);

  const handlePrevPreview = useCallback(() => {
    setPreviewState(prev => ({
      index: prev.index !== null ? (prev.index - 1 + photos.length) % photos.length : null,
      direction: -1
    }));
  }, [photos.length]);

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  CONDITIONAL RENDERING — Early Returns
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  // Dokumen hukum mendahului SEGALANYA, termasuk pemeriksaan sesi.
  //
  // Keduanya harus terbuka untuk siapa saja tanpa login — itu syarat verifikasi
  // OAuth Google, dan pengulasnya membuka tautannya langsung. Kalau routing ini
  // diletakkan setelah pemeriksaan sesi, yang pertama ia lihat adalah pemuat
  // yang berputar; kalau diletakkan setelah penjaga autentikasi, ia justru
  // dilempar ke layar masuk.
  if (pathname === PRIVACY_PATH || pathname === TERMS_PATH) {
    return (
      <Suspense fallback={<Memuat />}>
        <LegalPage
          doc={pathname === PRIVACY_PATH ? 'privacy' : 'terms'}
          themeChoice={themeChoice}
          cycleTheme={cycleTheme}
        />
      </Suspense>
    );
  }

  if (isAuthChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ash-50 dark:bg-ash-950">
        <Loader2 size={32} strokeWidth={1.75} className="text-ash-600 dark:text-ash-400 animate-spin" />
      </div>
    );
  }

  // Pemulihan password mendahului seluruh routing lain: sesi yang dibawa
  // tautan itu memang sah, tapi tujuannya bukan masuk ke dashboard.
  if (isPasswordRecovery) {
    return <Suspense fallback={<Memuat />}><AdminLogin themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={navigasi} /></Suspense>;
  }


  // Strict Auth Guard Routing
  if (isDashboardRoute || isLegacyDashboardRoute) {
    if (isAdminAuthenticated) {
      return (
        <Suspense fallback={<Memuat />}>
          <AdminDashboard themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={navigasi} />
        </Suspense>
      );
    } else {
      return <Suspense fallback={<Memuat />}><AdminLogin themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={navigasi} /></Suspense>;
    }
  }

  if (isHome) {
    if (token) {
      // Biarkan kosong agar proses berlanjut ke bawah (menampilkan galeri klien)
    } else if (isAdminAuthenticated) {
      // URL-nya dirapikan oleh effect di atas, bukan di sini: mengalihkan saat
      // render berarti satu render terbuang dan satu kedipan layar kosong.
      return (
        <Suspense fallback={<Memuat />}>
          <AdminDashboard themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={navigasi} />
        </Suspense>
      );
    } else {
      return <Suspense fallback={<Memuat />}><AdminLogin themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={navigasi} /></Suspense>;
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-ash-50 dark:bg-ash-950 transition-colors duration-tint">
        <Loader2 size={40} strokeWidth={1.75} className="text-ash-600 dark:text-ash-400 animate-spin mb-6" aria-hidden="true" />
        <p className="text-lg font-medium text-ash-600 dark:text-ash-300 tracking-wide">
          Loading gallery...
        </p>
        <p className="text-sm text-ash-500 dark:text-ash-500 mt-1">
          This will only take a moment
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-ash-50 dark:bg-ash-950 transition-colors duration-tint px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-danger-500/10 dark:bg-danger-500/20 flex items-center justify-center mb-6">
          <AlertTriangle size={32} strokeWidth={1.75} className="text-danger-500" />
        </div>
        <h1 className="text-xl font-semibold text-ash-800 dark:text-ash-100 mb-2">
          Could not load this gallery
        </h1>
        <p className="text-ash-600 dark:text-ash-400 max-w-md">
          {error}
        </p>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  MAIN RENDER — Data loaded successfully
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="min-h-screen bg-ash-50 dark:bg-ash-950 transition-colors duration-tint font-sans ">
      <Toast toasts={toasts} />

      <Header project={project} themeChoice={themeChoice} cycleTheme={cycleTheme} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28">
        {/* Judul dan keterangan dirapatkan. Sebelumnya bagian ini memakan
            200px tinggi layar untuk kalimat yang dibaca sekali, sementara yang
            dibutuhkan orangnya adalah melihat foto sebanyak mungkin. */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-semibold text-ash-900 dark:text-white tracking-tight">
              Choose your favourites
            </h2>
            <p className="text-ash-600 dark:text-ash-400 text-sm mt-1">
              Tap a photo to select it. Up to{' '}
              <strong className="text-ash-700 dark:text-ash-200">{project.max_selections}</strong>.
            </p>
          </div>
          <DensityPicker value={density} onChange={setDensity} />
        </div>

        {/* Galeri yang jatuh ke salinan database dulu tampil sebagai deretan
            kotak kosong tanpa penjelasan apa pun — yang terlihat cuma "fotonya
            hilang". Backend selalu mengirim tahu dari mana daftarnya berasal;
            sekarang keterangan itu dipakai. */}
        {photoSource?.stored && (
          <div
            role="status"
            className="mb-8 flex items-start gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-ash-800 dark:border-warning-400/20 dark:bg-warning-400/10 dark:text-ash-100"
          >
            <AlertTriangle size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warning-500 dark:text-warning-400" aria-hidden="true" />
            <span>
              Google Drive could not be read, so this list comes from a stored copy.
              It may be out of date, and some images may not appear. Contact your
              photographer if a photo is missing.
            </span>
          </div>
        )}

        <PhotoGrid
          photos={photos}
          selectedIds={selectedIds}
          onToggle={handleToggleSelect}
          onOpenPreview={handleOpenPreview}
          density={density}
          isLocked={isSubmittedState}
        />

        {/* Klien tidak pernah mendaftar dan tidak pernah menyetujui apa pun,
            tapi namanya, nomornya, dan pilihannya tetap tersimpan. Tautan ini
            satu-satunya tempat ia dapat mengetahuinya. */}
        <footer className="mt-16 text-center text-xs text-ash-500 dark:text-ash-500">
          <a
            href={PRIVACY_PATH}
            className="hover:text-ash-700 dark:hover:text-ash-300 underline underline-offset-4 decoration-ash-300 dark:decoration-ash-600 transition-colors"
          >
            Privacy Policy
          </a>
          <span className="mx-2 opacity-50">·</span>
          <a
            href={TERMS_PATH}
            className="hover:text-ash-700 dark:hover:text-ash-300 underline underline-offset-4 decoration-ash-300 dark:decoration-ash-600 transition-colors"
          >
            Terms
          </a>
        </footer>
      </main>

      {/* Tanpa fallback: modal ini menutupi seluruh layar, dan menyisipkan
          pemutar berputar seukuran layar sebelum ia siap justru mengedipkan
          galeri yang masih terlihat baik-baik saja di belakangnya. Berkasnya
          kecil, dan sudah diminta lebih awal saat galeri menganggur. */}
      <Suspense fallback={null}>
        <PreviewModal
          photos={photos}
          previewState={previewState}
          onClose={handleClosePreview}
          onNext={handleNextPreview}
          onPrev={handlePrevPreview}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          project={project}
        />
      </Suspense>

      <FloatingBar
        project={project}
        selectedCount={selectedIds.size}
        maxSelections={project.max_selections}
        // Tombolnya membuka dialog, bukan mengirim. Pengirimannya sendiri
        // dijalankan dari sana.
        onSubmit={() => setKonfirmasiKirim(true)}
        isSubmitting={isSubmitting}
        isSubmitted={isSubmittedState}
      />

      <SubmitConfirmModal
        open={konfirmasiKirim}
        selectedCount={selectedIds.size}
        maxSelections={project.max_selections}
        isSubmitting={isSubmitting}
        onConfirm={handleSubmit}
        onCancel={() => setKonfirmasiKirim(false)}
      />
    </div>
  );
}
