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

// ─── API Base URL ────────────────────────────────────────────────
const API_BASE = 'https://photoflow-backend.vercel.app';

export default function App() {
  // ─── Variables routing (No hook dependencies) ────────────────
  const isAdminRoute = window.location.pathname.startsWith('/admin');
  const token = new URLSearchParams(window.location.search).get('token');
  const isHome = window.location.pathname === '/';

  // ─── 1. Auth State ───────────────────────────────────────────
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // ─── 2. Data State (from API) ────────────────────────────────
  const [project, setProject] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // ─── 3. UI State ─────────────────────────────────────────────
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved !== null) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAdminAuthenticated(!!session);
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
        // Logout user dari Supabase
        const { supabase } = await import('./lib/supabase');
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
        const res = await fetch(`${API_BASE}/api/p/${token}`, {
          headers: { 'ngrok-skip-browser-warning': 'true' }
        });

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
          const photosRes = await fetch(`${API_BASE}/api/p/${token}/photos`, {
            headers: { 'ngrok-skip-browser-warning': 'true' }
          });
          if (!photosRes.ok) throw new Error(`status ${photosRes.status}`);
          const photosData = await photosRes.json();
          setPhotos(photosData.files || []);
        } catch (photosErr) {
          // Galeri tidak boleh mati hanya karena daftar foto gagal diambil:
          // salinannya ikut terkirim bersama data project. Bentuknya diselaraskan
          // di sini karena baris database memakai file_name dan thumbnail_url,
          // sedangkan galeri membaca name dan thumbnailLink.
          console.warn('Gagal memuat daftar foto, memakai salinan tersimpan:', photosErr);
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

  // Dark mode sync
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  // Dark mode auto listener (real-time system pref)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      setIsDark(e.matches);
      if (e.matches) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };
    mediaQuery.addEventListener('change', handleChange);

    // Explicit runtime evaluation in case SSR/initial state missed it
    if (localStorage.getItem('theme') === null) {
      handleChange(mediaQuery);
    }

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // ─── Callbacks ───────────────────────────────────────────────
  const toggleTheme = useCallback(() => setIsDark(prev => !prev), []);

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
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
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
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    );
  }

  // Strict Auth Guard Routing
  if (isAdminRoute) {
    if (isAdminAuthenticated) {
      return <AdminDashboard isDark={isDark} toggleTheme={toggleTheme} />;
    } else {
      return <AdminLogin isDark={isDark} toggleTheme={toggleTheme} />;
    }
  }

  if (isHome) {
    if (token) {
      // Biarkan kosong agar proses berlanjut ke bawah (menampilkan galeri klien)
    } else if (isAdminAuthenticated) {
      window.location.replace('/admin');
      return null;
    } else {
      return <AdminLogin isDark={isDark} toggleTheme={toggleTheme} />;
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 transition-colors duration-300">
        <Loader2
          className="w-12 h-12 text-indigo-500 animate-spin mb-6"
          strokeWidth={2}
        />
        <p className="text-lg font-medium text-zinc-600 dark:text-zinc-300 tracking-wide">
          Memuat Galeri...
        </p>
        <p className="text-sm text-zinc-400 dark:text-zinc-500 mt-1">
          Mohon tunggu sebentar
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 transition-colors duration-300 px-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 dark:bg-red-500/20 flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" strokeWidth={2} />
        </div>
        <h1 className="text-xl font-semibold text-zinc-800 dark:text-zinc-100 mb-2">
          Gagal Memuat Galeri
        </h1>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-md">
          {error}
        </p>
      </div>
    );
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  MAIN RENDER — Data loaded successfully
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 transition-colors duration-300 font-sans selection:bg-indigo-500/30">
      <Toast toasts={toasts} />

      <Header project={project} isDark={isDark} toggleTheme={toggleTheme} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-28">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="text-2xl sm:text-3xl font-semibold text-zinc-900 dark:text-white tracking-tight">
            Pilih Foto Favorit
          </h2>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm sm:text-base max-w-2xl">
            Klik gambar untuk memilih, atau tekan ikon <strong>👁 (Mata)</strong> untuk melihat resolusi tinggi secara utuh.
            Maksimal <strong className="text-zinc-700 dark:text-zinc-200">{project.max_selections}</strong> foto.
          </p>
        </div>

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
