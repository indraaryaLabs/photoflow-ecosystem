import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertTriangle } from 'lucide-react';

import Toast from './components/Toast';
import Header from './components/Header';
import PhotoCard from './components/PhotoCard';
import PreviewModal from './components/PreviewModal';
import FloatingBar from './components/FloatingBar';
import AdminDashboard from './components/AdminDashboard';
import AdminLogin from './components/AdminLogin';
import { supabase } from './lib/supabase';
import { API_BASE } from './lib/api';
import { openedFromRecoveryLink } from './lib/recovery';
import { useTheme } from './lib/theme';

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
  const [toasts, setToasts] = useState([]);
  const [previewState, setPreviewState] = useState({ index: null, direction: 0 });
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
      setError('Link galeri tidak valid atau hilang.');
      setIsLoading(false);
      return;
    }

    const fetchGallery = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/p/${token}`);

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.message || `Galeri tidak ditemukan. (status ${res.status})`);
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
          console.warn('Gagal memuat daftar foto, memakai salinan tersimpan:', photosErr);
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
        setError(err.message || 'Terjadi kesalahan saat memuat galeri.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchGallery();
  }, [token]);

  // ─── Callbacks ───────────────────────────────────────────────
  const addToast = useCallback((message) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const handleToggleSelect = useCallback((id) => {
    // Gallery Lock: Cegah interaksi jika sudah disubmit
    if (isSubmittedState) {
      addToast('Galeri telah dikunci karena pilihan sudah disubmit.');
      return;
    }

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= project?.max_selections) {
          addToast(`Batas maksimal tercapai (${project.max_selections} foto).`);
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
        throw new Error(body?.error || `Gagal mengirim pilihan. (status ${res.status})`);
      }

      addToast('Pilihan foto berhasil dikirim ke fotografer!');
      setIsSubmittedState(true);
    } catch (err) {
      addToast(err.message || 'Terjadi kesalahan saat mengirim pilihan.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIds, addToast, isSubmitting, token]);

  const handleOpenPreview = useCallback((index) => {
    setPreviewState({ index, direction: 0 });
  }, []);

  const handleClosePreview = useCallback(() => {
    setPreviewState({ index: null, direction: 0 });
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-ash-50 dark:bg-ash-950 transition-colors duration-300">
        <Loader2 size={40} strokeWidth={1.75} className="text-ash-600 dark:text-ash-400 animate-spin mb-6" aria-hidden="true" />
        <p className="text-lg font-medium text-ash-600 dark:text-ash-300 tracking-wide">
          Memuat Galeri...
        </p>
        <p className="text-sm text-ash-500 dark:text-ash-500 mt-1">
          Mohon tunggu sebentar
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-ash-50 dark:bg-ash-950 transition-colors duration-300 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-danger-500/10 dark:bg-danger-500/20 flex items-center justify-center mb-6">
          <AlertTriangle size={32} strokeWidth={1.75} className="text-danger-500" />
        </div>
        <h1 className="text-xl font-semibold text-ash-800 dark:text-ash-100 mb-2">
          Gagal Memuat Galeri
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
    <div className="min-h-screen bg-ash-50 dark:bg-ash-950 transition-colors duration-300 font-sans ">
      <Toast toasts={toasts} />

      <Header project={project} themeChoice={themeChoice} cycleTheme={cycleTheme} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="text-2xl sm:text-3xl font-semibold text-ash-900 dark:text-white tracking-tight">
            Pilih Foto Favorit
          </h2>
          <p className="text-ash-600 dark:text-ash-400 text-sm sm:text-base max-w-2xl">
            Klik gambar untuk memilih, atau tekan ikon <strong>👁 (Mata)</strong> untuk melihat resolusi tinggi secara utuh.
            Maksimal <strong className="text-ash-700 dark:text-ash-200">{project.max_selections}</strong> foto.
          </p>
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
              Google Drive sedang tidak dapat dibaca, jadi daftar ini diambil dari
              salinan tersimpan. Isinya bisa tertinggal dari folder aslinya, dan
              sebagian gambar mungkin tidak muncul. Hubungi fotografer Anda kalau
              ada foto yang hilang.
            </span>
          </div>
        )}

        <motion.div
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6"
          variants={{
            hidden: { opacity: 0 },
            show: {
              opacity: 1,
              transition: { staggerChildren: 0.05 }
            }
          }}
          initial="hidden"
          animate="show"
        >
          {photos.map((photo, index) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              index={index}
              isSelected={selectedIds.has(photo.id)}
              onToggle={handleToggleSelect}
              onOpenPreview={handleOpenPreview}
            />
          ))}
        </motion.div>
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
