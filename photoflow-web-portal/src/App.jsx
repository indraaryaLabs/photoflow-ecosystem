import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';

import Toast from './components/Toast';
import Header from './components/Header';
import PhotoGrid, { DensityPicker } from './components/PhotoGrid';
import { useDensity } from './lib/useDensity';
import PreviewModal from './components/PreviewModal';
import FloatingBar from './components/FloatingBar';
import AdminDashboard from './components/AdminDashboard';
import AdminLogin from './components/AdminLogin';
import LegalPage from './components/LegalPage';
import { PRIVACY_PATH, TERMS_PATH } from './lib/legal';
import { supabase } from './lib/supabase';
import { API_BASE } from './lib/api';
import { openedFromRecoveryLink } from './lib/recovery';
import { useTheme } from './lib/theme';
import { bacaDraf, simpanDraf, hapusDraf, petakanKeId } from './lib/selectionDraft';
import { withViewTransition } from './lib/viewTransition';

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

  const { pathname, search, hash } = window.location;
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

  // ─── 1. Auth State ───────────────────────────────────────────
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

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

  // ─── 4. Hooks / Effects ──────────────────────────────────────

  // Auth Session Checker
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAdminAuthenticated(!!session);
      setIsAuthChecking(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setIsAdminAuthenticated(!!session);
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Idle Auto-Logout Timer (30 Menit)
  useEffect(() => {
    if (!isAdminAuthenticated) return;

    let timeoutId;
    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(async () => {
        // Logout user dari Supabase. Modulnya sudah diimpor di atas berkas ini;
        // import dinamis di sini tidak memecah bundle apa pun, hanya membuat
        // bundler memperingatkan bahwa modul yang sama diminta dua cara.
        await supabase.auth.signOut();
        // Paksa kembali ke halaman root (login)
        window.location.href = '/';
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
  }, [isAdminAuthenticated]);

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

    fetchGallery();
  }, [token, galleryQuery]);

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
    } catch (err) {
      addToast(err.message || 'Something went wrong while submitting your selection.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, addToast, isSubmitting, token]);

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
      <LegalPage
        doc={pathname === PRIVACY_PATH ? 'privacy' : 'terms'}
        themeChoice={themeChoice}
        cycleTheme={cycleTheme}
      />
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
    return <AdminLogin themeChoice={themeChoice} cycleTheme={cycleTheme} />;
  }

  // Jalur lama /admin dialihkan, tidak dilayani. Kalau dilayani begitu saja,
  // dua jalur akan menampilkan halaman yang sama selamanya dan yang lama tidak
  // akan pernah hilang dari peredaran. `replace` dipakai supaya tombol kembali
  // tidak memantulkan orangnya ke jalur lama lagi.
  if (isLegacyDashboardRoute) {
    window.location.replace(DASHBOARD_PATH + search + hash);
    return null;
  }

  // Strict Auth Guard Routing
  if (isDashboardRoute) {
    if (isAdminAuthenticated) {
      return <AdminDashboard themeChoice={themeChoice} cycleTheme={cycleTheme} />;
    } else {
      return <AdminLogin themeChoice={themeChoice} cycleTheme={cycleTheme} />;
    }
  }

  if (isHome) {
    if (token) {
      // Biarkan kosong agar proses berlanjut ke bawah (menampilkan galeri klien)
    } else if (isAdminAuthenticated) {
      window.location.replace(DASHBOARD_PATH);
      return null;
    } else {
      return <AdminLogin themeChoice={themeChoice} cycleTheme={cycleTheme} />;
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

      <FloatingBar
        project={project}
        selectedCount={selectedIds.size}
        maxSelections={project.max_selections}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        isSubmitted={isSubmittedState}
      />
    </div>
  );
}
