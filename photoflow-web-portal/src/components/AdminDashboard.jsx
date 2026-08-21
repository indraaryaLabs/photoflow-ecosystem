import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Copy, Check, Plus, FolderOpen, Link as LinkIcon, Clock,
  CheckCircle2, Loader2, MoreVertical, Edit, Trash2, X, AlertOctagon,
  LogOut, MessageCircle, ExternalLink, RotateCcw, AlertTriangle, RefreshCw, ListChecks, KeyRound, Settings, ShieldCheck
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';
import SelectionListModal from './SelectionListModal';
import { sudahDilihat, tandaiDilihat, waktuRelatif } from '../lib/submissions';
import { ringkasProject } from '../lib/dashboardSummary';
import { bacaCache, tulisCache, hapusCache } from '../lib/projectCache';
import { PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { ambilLangganan, tebusKode } from '../lib/subscription';
import { cekAdmin } from '../lib/admin';
import QuotaBadge from './QuotaBadge';
import PlanModal from './PlanModal';


/**
 * Nomor WhatsApp fotografer sendiri, dari metadata akunnya.
 *
 * getSession, BUKAN getUser. Keduanya mengembalikan user yang sama, tapi
 * getUser menembak jaringan ke Supabase sementara getSession membaca sesi yang
 * sudah tersimpan di peramban. Yang dicari cuma satu nomor di metadata — sudah
 * ada di tangan sejak orangnya masuk.
 *
 * Ongkosnya nyata dan terasa: satu perjalanan jaringan penuh disisipkan di
 * DEPAN pembuatan dan penyuntingan project, sebelum permintaan yang sebenarnya
 * dikirim. Itulah jeda yang muncul setiap kali "Create Project" ditekan, dan
 * seluruhnya untuk data yang tidak perlu diambil ulang.
 *
 * Berkas ini sudah memakai alasan yang sama saat membaca id pemakai; dua
 * pemanggilan ini terlewat.
 */
async function nomorWhatsAppSendiri() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.user_metadata?.whatsapp || '';
}

export default function AdminDashboard({ themeChoice, cycleTheme, onNavigate }) {
  // --- STATE MANAGEMENT ---
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const [projects, setProjects] = useState([]);

  const [formData, setFormData] = useState({
    projectName: '',
    clientName: '',
    maxSelection: 50,
    driveLink: '',
    clientWa: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [deletingProject, setDeletingProject] = useState(null);
  const [reopeningProject, setReopeningProject] = useState(null);
  const [listingProject, setListingProject] = useState(null);
  const [rotatingProject, setRotatingProject] = useState(null);
  const [formOpen, setFormOpen] = useState(false);

  // Nama studio yang dilihat klien di kepala galerinya, menggantikan
  // "PhotoFlow". Kosong berarti kembali ke bawaan.
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioName, setStudioName] = useState('');
  // Project yang kirimannya sudah pernah dibuka fotografer. Disimpan di
  // peramban, bukan di database: ini catatan "sudah saya lihat" milik satu
  // orang di satu perangkat, bukan keadaan project.
  const [dilihat, setDilihat] = useState(() => sudahDilihat());
  const [actionLoading, setActionLoading] = useState(false);

  // Menu titik tiga mana yang sedang terbuka — satu penanda untuk seluruh
  // daftar, bukan satu state per kartu. Lihat komentar di ProjectCard.
  const [openMenuId, setOpenMenuId] = useState(null);
  const closeMenu = useCallback(() => setOpenMenuId(null), []);

  // Dashboard web tidak lagi menyinggung Google Drive sama sekali: tidak ada
  // tombol menghubungkan, tidak ada spanduk, tidak ada keadaan koneksi yang
  // perlu dilacak.
  //
  // Semua itu pernah ada, dan pernah perlu. Ketika folder hanya dapat dibaca
  // lewat OAuth, fotografer yang mendaftar lewat web tidak punya jalan memberi
  // izin, dan setiap project yang ia buat kosong tanpa penjelasan.
  //
  // Yang menghapusnya bukan perubahan selera melainkan perubahan syarat.
  // Alamat thumbnail yang dipakai galeri sekarang dimuat peramban klien
  // LANGSUNG dari Google, tanpa kredensial apa pun — dan alamat itu hanya
  // dapat dimuat kalau berkasnya publik. Folder privat karena itu tidak
  // sekadar kurang didukung; ia tidak dapat ditampilkan kepada klien sama
  // sekali. Tidak ada yang tersisa untuk dijaga OAuth di sisi web.
  //
  // Yang dibayar selama tombol itu masih ada: consent screen PhotoFlow belum
  // diverifikasi Google, jadi setiap orang yang menekannya mendarat di layar
  // "Google hasn't verified this app" — untuk izin yang tidak dibutuhkan
  // siapa pun.

  // Identitas pemakai, dipakai sebagai kunci cache daftar project per akun.
  // null berarti belum diketahui.
  const [userId, setUserId] = useState(null);

  // Keadaan langganan, dan tindakan yang sedang tertahan olehnya.
  //
  // `tertahan` bukan sekadar penanda benar/salah: dialognya perlu tahu tindakan
  // MANA yang ditolak, karena "ganti folder terhitung galeri baru" adalah
  // keterangan yang tidak dapat ditebak sendiri oleh siapa pun.
  const [langganan, setLangganan] = useState(null);
  // Pintu ke /operator hanya digambar untuk yang memang admin. Bukan penjaga —
  // penjaganya di backend, yang membalas 404 — melainkan supaya fotografer
  // biasa tidak melihat tombol yang membawanya ke halaman kosong.
  const [bolehOperator, setBolehOperator] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [tertahan, setTertahan] = useState(null);

  // --- HELPERS ---
  const showToast = (message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  };

  // Centralized session getter — returns userId or redirects to login
  // Access token JWT yang dikirim ke backend sebagai Bearer. Backend
  // memverifikasi signature-nya ke JWKS Supabase dan mengambil user id dari
  // klaim `sub`, jadi identitas tidak lagi ditentukan oleh apa yang dikirim
  // browser.
  const getAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      // No valid session found, force logout and redirect
      await supabase.auth.signOut();
      onNavigate('/');
      return null;
    }
    return session.access_token;
  };

  // Centralized response handler — auto-redirects on 401.
  // Kalau backend menandai token sudah kedaluwarsa, sesi di-refresh sekali dan
  // request diulang; supabase-js biasanya sudah me-refresh sendiri, ini jaring
  // pengaman untuk token yang lewat batas tepat saat request terbang.
  const handleApiResponse = async (res, retry) => {
    if (res.status !== 401) return res;

    if (retry) {
      const body = await res.clone().json().catch(() => null);
      if (body?.code === 'token_expired') {
        const { data, error } = await supabase.auth.refreshSession();
        if (!error && data?.session?.access_token) {
          return handleApiResponse(await retry(data.session.access_token));
        }
      }
    }

    showToast('Your session has expired. Please sign in again.', 'error');
    await supabase.auth.signOut();
    setTimeout(() => onNavigate('/'), 1000);
    return null;
  };

  // --- API INTEGRATION ---
  const fetchProjects = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;

      // Salinan terakhir digambar SEBELUM permintaan berangkat.
      //
      // Tanpa ini dashboard selalu dibuka dengan rangka abu-abu lalu menunggu
      // satu perjalanan jaringan. Perjalanannya tidak bisa dihilangkan, tapi
      // menunggunya bisa: daftar yang sama hampir selalu muncul lagi persis
      // seperti terakhir dilihat. Rangkanya tetap dipakai untuk kunjungan
      // pertama, yang memang belum punya apa-apa untuk ditampilkan.
      const tersimpan = bacaCache(uid);
      if (tersimpan?.length) {
        setProjects(tersimpan);
        setIsLoading(false);
      } else {
        setIsLoading(true);
      }

      const token = await getAccessToken();
      if (!token) return; // Guard: skip fetch if no session

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;

      if (!checkedRes.ok) throw new Error('Could not load your projects.');
      const data = await checkedRes.json();
      setProjects(data || []);
      tulisCache(uid, data || []);
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('Could not reach the server. Check your internet connection.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Nama studio dibaca saat dashboard dimuat, bukan saat modalnya dibuka:
  // tombolnya perlu menunjukkan nama yang sedang berlaku tanpa menunggu
  // seseorang mengkliknya lebih dulu.
  const fetchStudioName = async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/api/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setStudioName(data.studio_name || '');
    } catch {
      // Diamkan. Nama studio adalah hiasan pada galeri klien; tidak
      // terbacanya bukan alasan menampilkan galat di dashboard.
    }
  };

  // Kuota dibaca saat dashboard dimuat dan setiap kali sesuatu memakainya.
  //
  // Angkanya tidak dihitung dari daftar project di layar. Menghapus project
  // tidak mengembalikan jatah, jadi jumlah kartu yang terlihat dan jumlah
  // galeri yang terpakai memang boleh berbeda — hanya backend yang tahu yang
  // kedua.
  const fetchLangganan = async () => {
    const token = await getAccessToken();
    if (!token) return;
    const status = await ambilLangganan(token);
    if (status) setLangganan(status);
  };

  /**
   * Menangani balasan 402 dari tindakan apa pun.
   *
   * Dijawab dengan dialog, bukan toast. Toast menghilang setelah tiga detik dan
   * membawa serta satu-satunya keterangan tentang mengapa tindakan tadi gagal —
   * pada penolakan yang menuntut keputusan (membayar, atau menunggu bulan
   * depan) itu tidak cukup.
   *
   * Mengembalikan true kalau balasannya memang penolakan kuota, sehingga
   * pemanggil tahu untuk berhenti tanpa melempar galat kedua.
   */
  const tanganiKuotaHabis = async (res, action) => {
    if (res.status !== 402) return false;
    const body = await res.clone().json().catch(() => null);
    if (body?.code !== 'quota_exceeded') return false;

    setTertahan({ action, quota: body.quota, plan: body.plan });
    setPlanOpen(true);
    fetchLangganan();
    return true;
  };

  const handleRedeem = async (kode) => {
    const token = await getAccessToken();
    if (!token) return { ok: false, error: 'Your session has expired.' };

    const hasil = await tebusKode(token, kode);
    if (hasil.ok && hasil.status) {
      setLangganan(hasil.status);
      // Penghalangnya hilang begitu paketnya aktif. Membiarkan pesan "out of
      // galleries" tetap terbaca di atas kabar bahwa paketnya baru saja aktif
      // adalah dua kalimat yang saling membantah.
      setTertahan(null);
      fetchStudioName();
    }
    return hasil;
  };

  const saveStudioName = async (nama) => {
    const token = await getAccessToken();
    if (!token) return false;

    const res = await fetch(`${API_BASE}/api/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ studio_name: nama }),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      showToast(body?.error || 'Could not save your studio name.', 'error');
      return false;
    }

    setStudioName(body?.studio_name ?? nama);
    showToast(
      body?.studio_name
        ? 'Your clients will see this name on their gallery.'
        : 'Studio name cleared. Galleries show "PhotoFlow" again.',
    );
    return true;
  };


  // Nama berkas yang dipilih klien. Dipakai layar "Filenames for Lightroom",
  // yang memuatnya sendiri saat dibuka — daftar ini bisa panjang, dan tidak ada
  // gunanya ikut ditarik pada setiap pemuatan dashboard.
  const fetchSelections = useCallback(async (projectId) => {
    const token = await getAccessToken();
    if (!token) throw new Error('Your session has expired.');

    const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects/${projectId}/selections`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
    if (!checkedRes) throw new Error('Your session has expired.');
    if (!checkedRes.ok) throw new Error("Could not read the client's selection.");
    return checkedRes.json();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRotateLink = async () => {
    if (!rotatingProject) return;
    setActionLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects/${rotatingProject.id}/rotate-link`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;
      if (!checkedRes.ok) throw new Error('Could not issue a new link.');

      showToast('New link issued. The old one no longer works.');
      setRotatingProject(null);
      fetchProjects();
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('The server did not respond. Please try again later.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleResync = async (project) => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects/${project.id}/resync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;

      const body = await checkedRes.json().catch(() => null);
      if (!checkedRes.ok) {
        // Backend masih membedakan "Drive belum terhubung" dari "folder tidak
        // terbaca", karena aplikasi desktop masih memakai OAuth. Bagi web
        // keduanya berujung pada satu tindakan yang sama: jadikan foldernya
        // publik. Menyebut OAuth di sini berarti menyarankan sesuatu yang tidak
        // punya tombolnya lagi.
        if (body?.code === 'drive_not_connected' || body?.code === 'drive_reconnect_required') {
          showToast('This folder could not be read. Open it in Google Drive, then set sharing to "Anyone with the link".', 'error');
          return;
        }
        throw new Error(body?.error || 'Could not re-sync the photos.');
      }

      await fetchProjects();
      const jumlah = body?.photos_found ?? 0;
      if (jumlah > 0) showToast(`${jumlah} photos pulled from Drive.`);
      else showToast('The folder was read, but no photos came back. Check that it is shared as "Anyone with the link".', 'error');
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('The server did not respond. Please try again later.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    }
  };

  useEffect(() => {
    fetchProjects();
    fetchStudioName();
    fetchLangganan();
    // getSession, bukan getUser: yang pertama membaca sesi yang sudah tersimpan
    // di peramban, yang kedua menembak jaringan ke Supabase. Yang dibutuhkan di
    // sini hanya id-nya, dan id itu sudah ada di tangan — menunggu satu
    // perjalanan jaringan untuk mendapatkannya hanya menunda langkah pertama
    // fotografer baru, dan gagal sama sekali kalau jaringannya sedang buruk.
    supabase.auth.getSession().then(({ data }) => setUserId(data?.session?.user?.id ?? null));
  }, []);

  useEffect(() => {
    let batal = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data?.session?.access_token;
      if (!t) return;
      const boleh = await cekAdmin(t);
      if (!batal) setBolehOperator(boleh);
    })();
    return () => {
      batal = true;
    };
  }, []);

  // Fotografer baru TIDAK lagi dibawa otomatis ke layar persetujuan Google.
  //
  // Dulu di sini ada effect yang melempar setiap akun baru ke Google pada
  // kedatangan pertamanya di dashboard, supaya ia tidak perlu mencari tombolnya
  // sendiri. Alasannya masuk akal ketika Drive hanya dapat dibaca lewat OAuth:
  // tanpa izin itu, project yang dibuatnya memang akan kosong.
  //
  // Sekarang folder yang dibagikan "Anyone with the link" dibaca lewat API key,
  // dan itu cara yang memang dipakai fotografer membagikan foldernya. Untuk
  // mereka OAuth tidak menambah apa pun — sementara consent screen PhotoFlow
  // belum diverifikasi Google, sehingga yang muncul adalah layar peringatan
  // "Google hasn't verified this app". Melemparkan orang ke sana tanpa diminta,
  // di detik pertama ia memakai aplikasinya, untuk izin yang tidak ia butuhkan,
  // adalah cara terburuk memulai.
  //
  // Yang menghubungkan Drive sekarang hanya yang benar-benar perlu: pemilik
  // folder privat. Mereka menemukan jalannya lewat spanduk di bawah, dan lewat
  // pesan yang muncul saat foldernya ternyata tidak terbaca.

  // --- HANDLERS ---
  const handleDelete = async () => {
    if (!deletingProject) return;
    setActionLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects/${deletingProject.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;
      if (!checkedRes.ok) throw new Error('Could not delete the project.');

      showToast('Project deleted.');
      setDeletingProject(null);

      // Kartunya dibuang dari daftar di layar, BUKAN dengan mengambil ulang
      // seluruh daftar dari server.
      //
      // fetchProjects() di sini berarti permintaan HTTP kedua beserta tiga
      // query-nya, hanya untuk mengetahui satu hal yang sudah pasti: baris yang
      // barusan dihapus memang sudah tidak ada. Sementara itu pemutar berputar
      // tetap berjalan dan kartunya masih terlihat di layar.
      setProjects((sebelumnya) => {
        const sesudah = sebelumnya.filter((p) => p.id !== deletingProject.id);
        // Salinan lokal ikut diperbarui, kalau tidak project yang sudah dihapus
        // akan muncul lagi sekejap pada kunjungan berikutnya.
        tulisCache(userId, sesudah);
        return sesudah;
      });
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('The server did not respond. Please try again later.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Kembalikan project yang sudah dikirim ke keadaan "pending".
  //
  // Sebelum ini, mengirim pilihan bersifat satu arah. Backend memang sengaja
  // menguncinya supaya dua klien yang menekan kirim bersamaan tidak saling
  // menimpa, tapi tidak ada satu pun jalan untuk membukanya kembali. Akibatnya
  // klien yang tidak sengaja menekan kirim membuat galerinya mati permanen,
  // dan satu-satunya perbaikan adalah membuka database langsung.
  const handleReopen = async () => {
    if (!reopeningProject) return;
    setActionLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects/${reopeningProject.id}/reopen`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;

      if (await tanganiKuotaHabis(checkedRes, 'reopen')) {
        setReopeningProject(null);
        return;
      }
      if (!checkedRes.ok) throw new Error('Could not reopen the selection.');

      showToast('Selection reopened.');
      setReopeningProject(null);
      fetchProjects();
      fetchLangganan();
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('The server did not respond. Please try again later.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editingProject) return;

    // Validasi nomor WhatsApp klien
    const editWa = editingProject.client_whatsapp || '';
    if (!editWa.startsWith('62') || editWa.length < 10 || editWa.length > 15 || !/^\d+$/.test(editWa)) {
      showToast('That WhatsApp number is not valid. Use at least 10 digits.', 'error');
      return;
    }

    setActionLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const adminWa = await nomorWhatsAppSendiri();

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects/${editingProject.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          project_name: editingProject.project_name,
          client_name: editingProject.client_name,
          max_selections: parseInt(editingProject.max_selections),
          drive_folder_url: editingProject.drive_folder_url,
          admin_whatsapp: adminWa,
          client_whatsapp: editingProject.client_whatsapp || ''
        })
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;

      if (await tanganiKuotaHabis(checkedRes, 'edit')) return;

      if (!checkedRes.ok) {
        const errorData = await checkedRes.json().catch(() => null);
        throw new Error(errorData?.error || 'Could not update the project.');
      }
      showToast('Project updated.');
      setEditingProject(null);
      fetchProjects();
      fetchLangganan();
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('The server did not respond. Please try again later.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.clientName || !formData.projectName) return;

    // Validasi nomor WhatsApp klien
    const clientWa = formData.clientWa || '';
    if (!clientWa.startsWith('62') || clientWa.length < 10 || clientWa.length > 15 || !/^\d+$/.test(clientWa)) {
      showToast('That WhatsApp number is not valid. Use at least 10 digits.', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const token = await getAccessToken();
      if (!token) return;

      const adminWa = await nomorWhatsAppSendiri();

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          project_name: formData.projectName,
          client_name: formData.clientName,
          max_selections: parseInt(formData.maxSelection),
          drive_folder_url: formData.driveLink,
          admin_whatsapp: adminWa,
          client_whatsapp: formData.clientWa
        })
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;

      if (await tanganiKuotaHabis(checkedRes, 'create')) return;

      if (!checkedRes.ok) {
        const errorData = await checkedRes.json().catch(() => null);
        throw new Error(errorData?.error || errorData?.message || 'Could not create the project.');
      }

      const body = await checkedRes.json().catch(() => null);
      const dibuat = body?.data;

      // Formulir ditutup SEKARANG, tidak menunggu foto ditarik.
      //
      // Menarik 2.000 berkas dari Drive memakan beberapa detik, dan sebelumnya
      // seluruh detik itu dihabiskan dengan formulir masih terbuka dan tombolnya
      // berputar — padahal project-nya sudah tersimpan sejak permintaan pertama
      // dibalas.
      setFormData({ projectName: '', clientName: '', maxSelection: 50, driveLink: '', clientWa: '' });
      setFormOpen(false);
      showToast('Project created. Pulling photos from Drive...');
      fetchLangganan();

      // Kartunya muncul seketika, dengan jumlah foto nol. Baris keterangannya
      // sudah menuliskan "No photos yet" untuk keadaan itu, jadi tidak ada yang
      // perlu ditambahkan supaya jujur.
      if (dibuat) {
        setProjects((sebelumnya) => [{ ...dibuat, photo_count: 0, previews: [] }, ...sebelumnya]);
      }

      // Penarikan fotonya jalan sendiri. Endpoint resync sudah menangani folder
      // yang tidak terbaca beserta pesannya, jadi tidak ada penanganan kedua di
      // sini — yang perlu ditambahkan cuma menyegarkan daftarnya setelah selesai.
      if (dibuat?.id) {
        handleResync(dibuat).finally(fetchProjects);
      } else {
        await fetchProjects();
      }
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('Could not reach the server. Check your internet connection.', 'error');
      } else {
        showToast(err.message || 'Something went wrong.', 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = (token) => {
    const url = `${window.location.origin}/?token=${token}`;

    // Fallback copy strategy as requested for iFrames
    const textArea = document.createElement("textarea");
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('Magic link copied to clipboard.');
    } catch (err) {
      console.error('Failed to copy', err);
      showToast('Could not copy the link.', 'error');
    }
    document.body.removeChild(textArea);
  };

  const handleLogout = async () => {
    // Bersihkan state lokal sebelum logout
    setProjects([]);
    setFormData({ projectName: '', clientName: '', maxSelection: 50, driveLink: '', clientWa: '' });
    setEditingProject(null);
    setDeletingProject(null);

    // Salinan daftar project dibuang bersama sesinya. Meninggalkannya berarti
    // orang berikutnya yang membuka peramban ini sempat melihat project milik
    // pemilik akun sebelumnya.
    hapusCache(userId);

    await supabase.auth.signOut();
    // Perpindahan sisi klien. signOut memicu onAuthStateChange di App, yang
    // mematikan penanda autentikasi, sehingga jalur '/' menggambar layar masuk
    // dengan sendirinya — tanpa membangun ulang seluruh aplikasi.
    onNavigate('/');
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen transition-colors duration-tint">

      {/* MAIN LAYOUT */}
      <div className="min-h-screen bg-ash-50 dark:bg-ash-950 text-ash-900 dark:text-ash-100 font-sans">

        {/* HEADER (Sticky, Glassmorphism) */}
        {/* backdrop-blur-md, bukan -xl: kepala melekat ini digambar ulang
            pada setiap frame penggulingan, selebar layar. Lihat
            Header.jsx untuk alasan lengkapnya. */}
        <header className="sticky top-0 z-40 bg-white/70 dark:bg-ash-950/70 backdrop-blur-md border-b border-ash-200 dark:border-white/10 transition-colors duration-tint">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-ash-200 bg-ash-100 text-ash-700 dark:border-white/10 dark:bg-white/5 dark:text-ash-200">
                <BrandMark size={20} />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight leading-tight">PhotoFlow Workspace</h1>
                <p className="text-xs text-ash-600 dark:text-ash-400 font-medium tracking-wide">PROJECT DASHBOARD</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {bolehOperator && (
                <button
                  onClick={() => onNavigate('/operator')}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ash-600 transition-colors hover:bg-ash-100 hover:text-ash-900 dark:text-ash-400 dark:hover:bg-white/5 dark:hover:text-ash-100"
                  title="Operator"
                  aria-label="Operator"
                >
                  <ShieldCheck size={18} strokeWidth={1.75} />
                </button>
              )}

              <button
                onClick={() => setStudioOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ash-600 transition-colors hover:bg-ash-100 hover:text-ash-900 dark:text-ash-400 dark:hover:bg-white/5 dark:hover:text-ash-100"
                title="Studio name"
                aria-label="Studio name"
              >
                <Settings size={18} strokeWidth={1.75} />
              </button>

              <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />

              <button
                onClick={handleLogout}
                className="p-2.5 rounded-full bg-ash-100 dark:bg-white/5 border border-transparent dark:border-white/5 hover:bg-danger-50 dark:hover:bg-danger-500/10 text-ash-600 dark:text-ash-400 hover:text-danger-500 dark:hover:text-danger-400 transition-all duration-feedback hover:scale-105 active:scale-95"
                title="Sign out"
              >
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </header>

        {/* CONTENT GRID */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">

          <div>
            <div>
              {/* Formulir pembuatan project dulu terbuka permanen di kolom
                  kiri, memakan sepertiga layar untuk tindakan yang dilakukan
                  seminggu sekali. Sekarang jadi tombol, dan ruangnya kembali
                  ke daftar project -- yang justru dibuka setiap hari. */}
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Client Projects</h2>
                  <p className="text-sm text-ash-600 dark:text-ash-400 mt-1">
                    {projects.length === 0
                      ? 'Nothing here yet.'
                      : `${projects.length} project${projects.length === 1 ? '' : 's'}.`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {/* Penanda kuota berdiri tepat di sebelah tombol yang
                      memakainya. Diletakkan di tempat lain, ia jadi angka yang
                      dibaca terpisah dari keputusan yang dipengaruhinya. */}
                  <QuotaBadge
                    sub={langganan}
                    onOpen={() => {
                      setTertahan(null);
                      setPlanOpen(true);
                    }}
                  />

                  <button
                    onClick={() => setFormOpen(true)}
                    className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-ash-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
                  >
                    <Plus size={16} strokeWidth={2} aria-hidden="true" />
                    New project
                  </button>
                </div>
              </div>

              {/* Baris ringkasan. Ada karena dashboard ini menjawab satu
                  pertanyaan lebih dulu daripada semua pertanyaan lain: "apa
                  yang perlu saya kerjakan sekarang?" Sebelum ini jawabannya
                  hanya bisa didapat dengan membaca seluruh kartu satu per satu
                  dan mengingat sendiri mana yang sudah dibuka.

                  Angkanya dihitung dari daftar yang sudah ada di tangan, jadi
                  baris ini tidak menambah satu pun permintaan jaringan. */}
              {!isLoading && projects.length > 0 && (
                <RingkasanBaris projects={projects} dilihat={dilihat} />
              )}

              {isLoading ? (
                <div className="space-y-4 animate-slide-up-fade">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white dark:bg-white/[0.03] border border-ash-200 dark:border-white/10 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="hidden sm:block w-10 h-10 rounded-full bg-ash-100 dark:bg-white/5 skeleton-shimmer" />
                        <div className="space-y-2">
                          <div className="h-4 w-40 rounded-lg bg-ash-200 dark:bg-white/10 skeleton-shimmer" />
                          <div className="h-3 w-28 rounded-lg bg-ash-100 dark:bg-white/5 skeleton-shimmer" />
                          <div className="h-3 w-48 rounded-lg bg-ash-100 dark:bg-white/5 skeleton-shimmer" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-28 rounded-full bg-ash-100 dark:bg-white/5 skeleton-shimmer" />
                        <div className="h-8 w-8 rounded-xl bg-ash-100 dark:bg-white/5 skeleton-shimmer" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                // Empty State
                //
                // Kalimatnya dulu menyuruh orang membuat project "on the left
                // panel". Panel kirinya sudah tidak ada sejak formulirnya jadi
                // panel geser -- petunjuk yang menunjuk ke tempat kosong lebih
                // menyesatkan daripada tidak ada petunjuk sama sekali.
                <div className="bg-white/50 dark:bg-white/[0.02] border border-dashed border-ash-300 dark:border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-center animate-slide-up-fade">
                  <div className="w-16 h-16 bg-ash-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <FolderOpen size={32} strokeWidth={1.75} className="text-ash-500" />
                  </div>
                  <h3 className="text-lg font-medium text-ash-900 dark:text-white">No projects yet</h3>
                  <p className="text-sm text-ash-600 dark:text-ash-400 mt-2 max-w-sm">
                    Point a project at a Google Drive folder and PhotoFlow turns it into a
                    link your client can pick from.
                  </p>
                  <button
                    onClick={() => setFormOpen(true)}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl bg-ash-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
                  >
                    <Plus size={16} strokeWidth={2} aria-hidden="true" />
                    Create your first project
                  </button>
                </div>
              ) : (
                // List State
                <div className="space-y-4">
                  {projects.map((project, index) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      index={index}
                      isMenuOpen={openMenuId === project.id}
                      onToggleMenu={() => setOpenMenuId((current) => (current === project.id ? null : project.id))}
                      onCloseMenu={closeMenu}
                      onCopy={() => handleCopyLink(project.magic_link_token)}
                      onOpenGallery={() => {
                        // preview=1 supaya kunjungan fotografer sendiri tidak
                        // tercatat sebagai "klien sudah membuka galeri".
                        window.open(`${window.location.origin}/?token=${project.magic_link_token}&preview=1`, '_blank', 'noopener');
                      }}
                      onReopen={() => setReopeningProject(project)}
                      onResync={() => handleResync(project)}
                      onCopyList={() => {
                        setListingProject(project);
                        // Membuka kirimannya berarti sudah dilihat.
                        setDilihat(tandaiDilihat(project.id, project.submitted_at));
                      }}
                      onRotateLink={() => setRotatingProject(project)}
                      isNew={Boolean(project.submitted_at) && dilihat[project.id] !== project.submitted_at}
                      onWhatsApp={() => {
                        const url = `${window.location.origin}/?token=${project.magic_link_token}`;
                        const text = `Hi ${project.client_name},\nHere is the photo gallery link for the *${project.project_name}* project.\n\nOpen the link below to start choosing your photos (up to ${project.max_selections}):\n${url}\n\nThank you.`;
                        window.open(`https://wa.me/${project.client_whatsapp}?text=${encodeURIComponent(text)}`, '_blank');
                      }}
                      onEdit={() => setEditingProject({ ...project, drive_folder_url: project.drive_folder_url, project_name: project.project_name })}
                      onDelete={() => setDeletingProject(project)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Tautan dokumen hukum juga hidup di sini, bukan hanya di layar
              masuk: sekali seseorang masuk, ia tidak pernah melihat layar itu
              lagi, dan halaman inilah satu-satunya tempat ia berada. */}
          <footer className="mt-16 border-t border-ash-200 pt-6 text-xs text-ash-500 dark:border-white/10 dark:text-ash-500">
            <a href={PRIVACY_PATH} className="hover:text-ash-700 dark:hover:text-ash-300 underline underline-offset-4 decoration-ash-300 dark:decoration-ash-600 transition-colors">
              Privacy Policy
            </a>
            <span className="mx-2 opacity-50">·</span>
            <a href={TERMS_PATH} className="hover:text-ash-700 dark:hover:text-ash-300 underline underline-offset-4 decoration-ash-300 dark:decoration-ash-600 transition-colors">
              Terms of Service
            </a>
          </footer>
        </main>

        {/* PANEL GESER: PROJECT BARU */}
        <AnimatePresence>
          {formOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                onClick={() => setFormOpen(false)}
                className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
              />
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="New project"
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                // Pegas, bukan durasi tetap: ini perpindahan di ruang, satu-satunya
                // jenis gerak yang pantas memakainya.
                transition={{ type: 'spring', stiffness: 380, damping: 40 }}
                className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-ash-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-ash-900"
              >
                <div className="mb-6 flex items-start justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight">New project</h2>
                    <p className="mt-1 text-sm text-ash-600 dark:text-ash-400">
                      Create a gallery for your client to pick from.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    aria-label="Close"
                    className="-mr-2 p-2 text-ash-500 transition-colors duration-tint hover:text-ash-900 dark:hover:text-ash-200"
                  >
                    <X size={20} strokeWidth={1.75} />
                  </button>
                </div>

                  <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
                    {/* Input: Project Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Project Name</label>
                      <input
                        type="text"
                        required
                        value={formData.projectName}
                        onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                        placeholder="e.g. Engagement Session, Maternity"
                        className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 focus:ring-4 focus:ring-ash-900/10 dark:focus:ring-white/10 rounded-xl px-4 py-3 text-sm transition-all duration-feedback outline-none placeholder:text-ash-500 dark:placeholder:text-ash-600"
                      />
                    </div>

                    {/* Input: Client Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Client Name</label>
                      <input
                        type="text"
                        required
                        value={formData.clientName}
                        onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                        placeholder="e.g. The Hartleys"
                        className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 focus:ring-4 focus:ring-ash-900/10 dark:focus:ring-white/10 rounded-xl px-4 py-3 text-sm transition-all duration-feedback outline-none placeholder:text-ash-500 dark:placeholder:text-ash-600"
                      />
                    </div>

                    {/* Input: Max Selections & Client WhatsApp (Grid 2 kolom) */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Max Selections</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            value={formData.maxSelection}
                            onChange={(e) => setFormData({ ...formData, maxSelection: parseInt(e.target.value) })}
                            className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 focus:ring-4 focus:ring-ash-900/10 dark:focus:ring-white/10 rounded-xl pl-4 pr-16 py-3 text-sm transition-all duration-feedback outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-ash-500 font-medium">
                            Photos
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Client WhatsApp</label>
                        <input
                          type="tel"
                          required
                          value={formData.clientWa}
                          onChange={(e) => {
                            let val = e.target.value;
                            if (val.startsWith('0')) {
                              val = '62' + val.substring(1);
                            } else if (val.startsWith('+62')) {
                              val = '62' + val.substring(3);
                            }
                            val = val.replace(/[^\d]/g, '');
                            setFormData({ ...formData, clientWa: val });
                          }}
                          placeholder="62812..."
                          className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 focus:ring-4 focus:ring-ash-900/10 dark:focus:ring-white/10 rounded-xl px-4 py-3 text-sm transition-all duration-feedback outline-none placeholder:text-ash-500 dark:placeholder:text-ash-600"
                        />
                      </div>
                    </div>

                    {/* Input: Drive Link */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Google Drive Link</label>
                      <div className="relative">
                        <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ash-500" />
                        <input
                          type="url"
                          required
                          value={formData.driveLink}
                          onChange={(e) => setFormData({ ...formData, driveLink: e.target.value })}
                          placeholder="https://drive.google.com/..."
                          aria-describedby="drive-link-hint"
                          className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 focus:ring-4 focus:ring-ash-900/10 dark:focus:ring-white/10 rounded-xl pl-10 pr-4 py-3 text-sm transition-all duration-feedback outline-none placeholder:text-ash-500 dark:placeholder:text-ash-600"
                        />
                      </div>
                      {/* Thumbnail foto dimuat langsung dari Drive oleh peramban
                          klien, yang tidak membawa kredensial siapa pun. Jadi
                          folder yang tidak dibagikan menghasilkan galeri berisi
                          kotak kosong -- dan sampai sekarang tidak ada satu pun
                          kalimat di layar ini yang menyebutkannya, sehingga
                          kegagalannya baru ketahuan setelah tautannya terkirim
                          ke klien. */}
                      <p id="drive-link-hint" className="text-xs text-ash-600 dark:text-ash-400 leading-relaxed">
                        Share the folder as{' '}
                        <span className="font-medium text-ash-800 dark:text-ash-200">Anyone with the link</span>{' '}
                        first. Your client&apos;s browser loads the photos straight from Drive, so a private
                        folder shows up as an empty gallery.
                      </p>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={!formData.clientName || isSubmitting}
                      className="w-full mt-2 flex items-center justify-center gap-2 bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 rounded-xl px-4 py-3.5 text-sm font-semibold shadow-sm hover:scale-[1.02] active:scale-[0.98] transition-all duration-feedback disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      {isSubmitting ? (
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                          <span>Creating...</span>
                        </div>
                      ) : (
                        <>
                          <Plus size={16} strokeWidth={1.75} />
                          <span>Create Project</span>
                        </>
                      )}
                    </button>
                  </form>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* PAKET DAN KUOTA */}
        {planOpen && (
          <PlanModal
            sub={langganan}
            blocked={tertahan}
            onClose={() => {
              setPlanOpen(false);
              setTertahan(null);
            }}
            onRedeem={handleRedeem}
          />
        )}

        {/* NAMA STUDIO */}
        {studioOpen && (
          <StudioNameModal
            initial={studioName}
            onClose={() => setStudioOpen(false)}
            onSave={saveStudioName}
          />
        )}

        {/* CUSTOM EDIT MODAL */}
        {editingProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade">
            <div className="bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-md relative">
              <button type="button" onClick={() => setEditingProject(null)} className="absolute top-4 right-4 p-2 text-ash-500 hover:text-ash-600 dark:hover:text-ash-200 transition-colors">
                <X size={20} strokeWidth={1.75} />
              </button>
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">Edit Project</h2>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Project Name</label>
                  <input type="text" required value={editingProject.project_name || ''} onChange={e => setEditingProject({ ...editingProject, project_name: e.target.value })} className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Client Name</label>
                  <input type="text" required value={editingProject.client_name} onChange={e => setEditingProject({ ...editingProject, client_name: e.target.value })} className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Max Selections</label>
                    <input type="number" min="1" required value={editingProject.max_selections} onChange={e => setEditingProject({ ...editingProject, max_selections: e.target.value })} className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 rounded-xl px-4 py-3 text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Client WhatsApp</label>
                    <input
                      type="tel"
                      required
                      value={editingProject.client_whatsapp || ''}
                      onChange={e => {
                        let val = e.target.value;
                        if (val.startsWith('0')) {
                          val = '62' + val.substring(1);
                        } else if (val.startsWith('+62')) {
                          val = '62' + val.substring(3);
                        }
                        val = val.replace(/[^\d]/g, '');
                        setEditingProject({ ...editingProject, client_whatsapp: val });
                      }}
                      placeholder="62812..."
                      className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-ash-500 dark:placeholder:text-ash-600"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-ash-600 dark:text-ash-300 uppercase tracking-wider">Google Drive Link</label>
                  <input type="url" required value={editingProject.drive_folder_url} onChange={e => setEditingProject({ ...editingProject, drive_folder_url: e.target.value })} className="w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 focus:border-ash-500 dark:focus:border-ash-400 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setEditingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-ash-200 dark:border-ash-700 font-medium text-sm hover:bg-ash-100 dark:hover:bg-ash-800 transition-colors">Cancel</button>
                  <button type="submit" disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm shadow-sm transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                    {actionLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* CUSTOM DELETE CONFIRMATION MODAL */}
        {deletingProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade">
            <div className="bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-sm text-center relative">
              <div className="mx-auto w-12 h-12 rounded-full bg-danger-100 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 flex items-center justify-center mb-4 text-danger-500">
                <AlertOctagon size={24} strokeWidth={1.75} />
              </div>
              <h2 className="text-xl font-semibold text-ash-900 dark:text-ash-100 mb-2">Delete Project?</h2>
              <p className="text-sm text-ash-600 dark:text-ash-400 mb-6">Are you sure you want to delete <strong className="text-ash-800 dark:text-ash-300">{deletingProject.client_name}</strong>? This action cannot be undone and will remove all associated photos.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeletingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-ash-200 dark:border-ash-700 font-medium text-sm hover:bg-ash-100 dark:hover:bg-ash-800 transition-colors">Cancel</button>
                <button onClick={handleDelete} disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-danger-500 hover:bg-danger-600 text-white font-medium text-sm shadow-lg shadow-danger-500/25 transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                  {actionLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* KONFIRMASI BUKA KEMBALI PEMILIHAN */}
        {reopeningProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade">
            <div className="bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-sm text-center relative">
              <div className="mx-auto w-12 h-12 rounded-full bg-ash-100 dark:bg-white/5 border border-ash-200 dark:border-white/10 flex items-center justify-center mb-4 text-ash-700 dark:text-ash-200">
                <RotateCcw size={24} strokeWidth={1.75} />
              </div>
              <h2 className="text-xl font-semibold text-ash-900 dark:text-ash-100 mb-2">Reopen selection?</h2>
              <p className="text-sm text-ash-600 dark:text-ash-400 mb-6">
                The gallery for <strong className="text-ash-800 dark:text-ash-300">{reopeningProject.client_name}</strong> becomes selectable again, and the saved picks are cleared. Use this when a client submitted by mistake.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setReopeningProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-ash-200 dark:border-ash-700 font-medium text-sm hover:bg-ash-100 dark:hover:bg-ash-800 transition-colors">Cancel</button>
                <button onClick={handleReopen} disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm shadow-sm transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                  {actionLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : "Yes, Reopen"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TERBITKAN ULANG MAGIC LINK */}
        {rotatingProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade">
            <div className="bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-sm text-center relative">
              <div className="mx-auto w-12 h-12 rounded-full bg-ash-100 dark:bg-white/5 border border-ash-200 dark:border-white/10 flex items-center justify-center mb-4 text-ash-700 dark:text-ash-200">
                <KeyRound size={24} strokeWidth={1.75} />
              </div>
              <h2 className="text-xl font-semibold text-ash-900 dark:text-ash-100 mb-2">Issue a new link?</h2>
              <p className="text-sm text-ash-600 dark:text-ash-400 mb-6">
                The link you already sent to <strong className="text-ash-800 dark:text-ash-300">{rotatingProject.client_name}</strong> stops
                working immediately, and you will need to send the new one. Photos already selected are kept.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setRotatingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-ash-200 dark:border-ash-700 font-medium text-sm hover:bg-ash-100 dark:hover:bg-ash-800 transition-colors">Cancel</button>
                <button onClick={handleRotateLink} disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm shadow-sm transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                  {actionLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : "Yes, issue new link"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DAFTAR NAMA BERKAS UNTUK LIGHTROOM */}
        {listingProject && (
          <SelectionListModal
            project={listingProject}
            onClose={() => setListingProject(null)}
            onFetch={fetchSelections}
            onToast={showToast}
          />
        )}

        {/* TOAST NOTIFICATION */}
        {toast && (
          <div className="fixed bottom-6 right-6 lg:bottom-8 lg:right-8 z-50 animate-toast">
            <div className="bg-ash-900/90 dark:bg-ash-800/90 backdrop-blur-xl border border-ash-800 dark:border-white/10 shadow-2xl rounded-2xl px-5 py-3.5 flex items-center gap-3 text-white">
              {toast.type === 'success' ? (
                <div className="bg-success-500/20 text-success-400 rounded-full p-1">
                  <CheckCircle2 size={16} strokeWidth={1.75} />
                </div>
              ) : (
                <div className="bg-danger-500/20 text-danger-500 rounded-full p-1">
                  <CheckCircle2 size={16} strokeWidth={1.75} />
                </div>
              )}
              <span className="text-sm font-medium tracking-wide">{toast.message}</span>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// --- SUB-COMPONENTS ---

/**
 * Satu baris proyek.
 *
 * `isMenuOpen` sengaja datang dari induk, bukan dari state lokal. Dulu tiap
 * kartu menyimpan sendiri, sehingga dua menu bisa terbuka bersamaan. Ketika
 * itu terjadi, kedua kartu sama-sama naik ke z-50 dan kartu yang urutannya
 * belakangan menang — menu kartu di atasnya terpotong separuh, dan pilihan
 * "Delete" hilang di baliknya. Dengan satu penanda di induk, hanya satu kartu
 * yang pernah terangkat, jadi tumpang tindih itu tidak mungkin terjadi lagi.
 */
/**
 * Menyetel nama studio yang dilihat klien di kepala galerinya.
 *
 * Nilainya disalin ke state lokal saat modal dibuka, bukan diikat langsung ke
 * state dashboard: mengetik lalu menutup tanpa menyimpan harus membuang
 * ketikannya, bukan diam-diam mengubah tampilan tombol di kepala halaman.
 */
function StudioNameModal({ initial, onClose, onSave }) {
  const [nilai, setNilai] = useState(initial);
  const [menyimpan, setMenyimpan] = useState(false);

  const kirim = async (e) => {
    e.preventDefault();
    setMenyimpan(true);
    const berhasil = await onSave(nilai.trim());
    setMenyimpan(false);
    if (berhasil) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-slide-up-fade">
      <div className="relative w-full max-w-md rounded-2xl border border-ash-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-ash-900">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-2 text-ash-500 transition-colors hover:text-ash-600 dark:hover:text-ash-200"
          aria-label="Close"
        >
          <X size={20} strokeWidth={1.75} />
        </button>

        <h2 className="mb-1 text-xl font-semibold tracking-tight">Studio name</h2>
        <p className="mb-5 text-sm text-ash-600 dark:text-ash-400">
          Shown at the top of every gallery your clients open, in place of
          &ldquo;PhotoFlow&rdquo;. Leave it empty to keep the default.
        </p>

        <form onSubmit={kirim} className="space-y-4">
          <input
            type="text"
            autoFocus
            maxLength={60}
            value={nilai}
            onChange={(e) => setNilai(e.target.value)}
            placeholder="e.g. Cahaya Studio"
            className="w-full rounded-xl border border-ash-200 bg-ash-50 px-4 py-3 text-sm outline-none focus:border-ash-500 dark:border-white/10 dark:bg-black/20 dark:focus:border-ash-400"
          />

          {/* Pratinjau, bukan sekadar keterangan. Yang diubah di sini tampil di
              halaman lain yang dibuka orang lain; tanpa melihat bentuknya,
              satu-satunya cara memastikan adalah mengirim tautan ke diri
              sendiri. */}
          <div className="rounded-xl border border-ash-200 bg-ash-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ash-500">
              Your client sees
            </p>
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-ash-200 bg-ash-100 text-ash-700 dark:border-white/10 dark:bg-white/5 dark:text-ash-200">
                <BrandMark size={18} />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold tracking-tight text-ash-900 dark:text-white">
                  {nilai.trim() || 'PhotoFlow'}
                </p>
                <p className="truncate text-xs font-medium text-ash-600 dark:text-ash-400">
                  Their name
                </p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={menyimpan}
            className="w-full rounded-xl bg-ash-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-tint hover:bg-ash-900 disabled:opacity-50 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            {menyimpan ? 'Saving...' : 'Save'}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Empat angka di atas daftar project.
 *
 * Yang ditampilkan dipilih menurut apakah angkanya menuntut tindakan, bukan
 * menurut apakah angkanya mudah dihitung. "Total project" mudah dihitung dan
 * tidak pernah menyuruh siapa pun mengerjakan apa pun; ia sudah tertulis di
 * bawah judul dan tidak perlu petak sendiri.
 */
function RingkasanBaris({ projects, dilihat }) {
  const { perluDitinjau, menunggu, belumDibuka, fotoTerpilih, tungguTerlama } =
    ringkasProject(projects, dilihat);

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Petak
        icon={ListChecks}
        label="Needs review"
        value={perluDitinjau}
        // Satu-satunya petak yang boleh menarik perhatian, dan hanya saat
        // isinya bukan nol. Empat petak yang semuanya menonjol sama saja
        // dengan tidak ada yang menonjol.
        highlight={perluDitinjau > 0}
      />
      <Petak
        icon={Clock}
        label="Waiting on clients"
        value={menunggu}
        hint={belumDibuka > 0 ? `${belumDibuka} never opened the link` : undefined}
      />
      <Petak icon={CheckCircle2} label="Photos picked" value={fotoTerpilih} />
      <Petak
        icon={AlertTriangle}
        label="Longest open"
        value={tungguTerlama || '—'}
        hint={tungguTerlama ? 'oldest project still waiting' : 'nothing is waiting'}
      />
    </div>
  );
}

function Petak({ icon: Icon, label, value, hint, highlight }) {
  return (
    <div
      className={`rounded-2xl border p-4 transition-colors duration-tint ${
        highlight
          ? 'border-ash-300 bg-ash-100/70 dark:border-white/20 dark:bg-white/[0.07]'
          : 'border-ash-200 bg-white dark:border-white/10 dark:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-center gap-1.5 text-ash-500 dark:text-ash-500">
        <Icon size={13} strokeWidth={1.75} aria-hidden="true" />
        <span className="text-xs font-medium truncate">{label}</span>
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-ash-900 tabular-nums dark:text-white">
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-[11px] text-ash-500 dark:text-ash-500 truncate">{hint}</p>
      )}
    </div>
  );
}

function ProjectCard({ project, index, isMenuOpen, onToggleMenu, onCloseMenu, onCopy, onOpenGallery, onWhatsApp, onEdit, onDelete, onReopen, onResync, onCopyList, onRotateLink, isNew }) {
  const [copied, setCopied] = useState(false);

  const handleCopyClick = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const menuRef = useRef(null);

  // Menutup menu: lewat Escape, atau lewat klik di luar menu.
  //
  // Klik-di-luar dulu ditangani oleh sehelai <div className="fixed inset-0">
  // yang membentang seluruh layar. Cara itu bekerja, tapi ia menelan kliknya:
  // menekan titik tiga kartu lain hanya menutup menu yang sedang terbuka dan
  // tidak pernah membuka yang baru, sehingga tombol itu terasa mati sampai
  // diklik kedua kalinya.
  //
  // Pendengar pointerdown di dokumen tidak menghalangi apa pun. Menu lama
  // tertutup, dan kliknya tetap sampai ke tombol yang dituju.
  useEffect(() => {
    if (!isMenuOpen) return;

    const onKey = (e) => { if (e.key === 'Escape') onCloseMenu(); };
    // Klik pada wadah ini sendiri dilewati, supaya tombolnya tetap bisa
    // dipakai untuk menutup menunya sendiri lewat onToggleMenu.
    const onPointerDown = (e) => {
      if (!menuRef.current?.contains(e.target)) onCloseMenu();
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [isMenuOpen, onCloseMenu]);

  const isPending = project.status === 'pending';
  const sudahDibuka = Boolean(project.first_viewed_at);
  const jumlahFoto = project.photo_count ?? 0;
  const pratinjau = project.previews || [];

  return (
    <div
      className={`group relative flex flex-col justify-between gap-4 rounded-2xl border border-ash-200 bg-white p-4 transition-[box-shadow,border-color] duration-feedback hover:border-ash-300 hover:shadow-lg sm:flex-row sm:items-center dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20 ${isMenuOpen ? 'z-50' : 'z-0 hover:z-10'}`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Strip pratinjau. Kartu ini dulu memuat ikon folder di aplikasi yang
          seluruh isinya fotografi -- tanda "template SaaS" yang paling cepat
          terbaca, sekaligus membuang cara tercepat mengenali sebuah project:
          melihat isinya. */}
      <div className="flex items-center gap-4 min-w-0">
        {pratinjau.length > 0 ? (
          <div className="hidden sm:flex shrink-0 -space-x-3">
            {pratinjau.map((url, i) => (
              <img
                key={url + i}
                src={url}
                alt=""
                aria-hidden="true"
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-12 w-12 rounded-lg object-cover ring-2 ring-white dark:ring-ash-950 bg-ash-200 dark:bg-ash-800"
                style={{ zIndex: pratinjau.length - i }}
              />
            ))}
          </div>
        ) : (
          <div className="hidden sm:grid shrink-0 h-12 w-12 place-items-center rounded-lg border border-dashed border-ash-300 dark:border-white/10 text-ash-500">
            <FolderOpen size={18} strokeWidth={1.75} aria-hidden="true" />
          </div>
        )}

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-ash-900 dark:text-ash-100 truncate">
              {project.project_name || 'Untitled Project'}
            </h3>
            {isNew && (
              <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-ash-900 text-white dark:bg-ash-100 dark:text-ash-950 text-[10px] font-bold uppercase tracking-wide">
                New
              </span>
            )}
          </div>
          <p className="text-sm text-ash-600 dark:text-ash-400 mt-0.5 truncate">
            {project.client_name}
          </p>
          {/* Satu baris keterangan, bukan tiga kolom bertitik pemisah.
              Statusnya ikut di sini alih-alih jadi lencana berwarna tersendiri:
              di kartu yang sudah memuat foto, lencana berwarna adalah unsur
              yang paling berisik dan paling sedikit isinya. */}
          <p className="text-xs text-ash-500 dark:text-ash-500 mt-1.5 truncate">
            {isPending ? (
              // Dua keadaan yang tampak sama dari luar menuntut tindakan yang
              // berlawanan. Belum pernah dibuka berarti masalahnya pengiriman:
              // kirim ulang. Sudah dibuka dan tetap sepi berarti masalahnya
              // orangnya: tagih.
              sudahDibuka ? (
                `Opened ${waktuRelatif(project.first_viewed_at) || 'earlier'}`
              ) : (
                <span className="font-medium text-warning-600 dark:text-warning-400">
                  Link not opened yet
                </span>
              )
            ) : (
              `Picks submitted ${waktuRelatif(project.submitted_at) || 'earlier'}`
            )}
            {' · '}
            <span className={jumlahFoto === 0 ? 'text-warning-600 dark:text-warning-400 font-medium' : undefined}>
              {jumlahFoto === 0 ? 'No photos yet' : `${jumlahFoto} photos`}
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t sm:border-t-0 border-ash-100 dark:border-white/5 pt-4 sm:pt-0">

        {/* SATU tindakan utama, dan isinya berubah menurut keadaan project.
            Sebelumnya ada empat tombol ikon sederajat berjajar; kalau semuanya
            sama bobotnya, tidak ada yang memberi tahu mana yang penting.
            Ketika klien belum memilih, yang dibutuhkan adalah mengirim
            tautannya; ketika sudah, yang dibutuhkan adalah melihat pilihannya. */}
        {isPending ? (
          <button
            onClick={onWhatsApp}
            className="inline-flex items-center gap-2 rounded-xl bg-ash-800 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            <MessageCircle size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden sm:inline">Send link</span>
          </button>
        ) : (
          <button
            onClick={onCopyList}
            className="inline-flex items-center gap-2 rounded-xl bg-ash-800 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            <ListChecks size={15} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden sm:inline">Review picks</span>
          </button>
        )}

        <button
          onClick={handleCopyClick}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ash-200 bg-white text-ash-600 transition-colors duration-tint hover:bg-ash-100 hover:text-ash-950 dark:border-white/10 dark:bg-white/5 dark:text-ash-400 dark:hover:bg-white/10 dark:hover:text-white"
          title="Copy gallery link"
          aria-label="Copy gallery link"
        >
          {copied
            ? <Check size={15} strokeWidth={2} className="text-success-500" />
            : <Copy size={15} strokeWidth={1.75} />}
        </button>

        <button
          onClick={onOpenGallery}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-ash-200 bg-white text-ash-600 transition-colors duration-tint hover:bg-ash-100 hover:text-ash-950 dark:border-white/10 dark:bg-white/5 dark:text-ash-400 dark:hover:bg-white/10 dark:hover:text-white"
          title="Open client gallery in a new tab"
          aria-label="Open client gallery in a new tab"
        >
          <ExternalLink size={15} strokeWidth={1.75} />
        </button>

        {/* Kebab Action */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={onToggleMenu}
            className="p-2 rounded-xl text-ash-500 hover:bg-ash-100 dark:hover:bg-white/10 hover:text-ash-700 dark:hover:text-ash-200 transition-colors"
            aria-label={`More actions for ${project.project_name || 'this project'}`}
            aria-expanded={isMenuOpen}
            aria-haspopup="menu"
          >
            <MoreVertical size={16} strokeWidth={1.75} />
          </button>

          {isMenuOpen && (
              <div role="menu" className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-20 animate-slide-up-fade origin-top-right">
                <button role="menuitem" onClick={() => { onCloseMenu(); onEdit(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-ash-700 dark:text-ash-300 hover:bg-ash-50 dark:hover:bg-white/5 flex items-center gap-2">
                  <Edit size={14} strokeWidth={1.75} /> Edit
                </button>
                <button role="menuitem" onClick={() => { onCloseMenu(); onResync(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-ash-700 dark:text-ash-300 hover:bg-ash-50 dark:hover:bg-white/5 flex items-center gap-2 whitespace-nowrap">
                  <RefreshCw size={14} strokeWidth={1.75} /> Re-sync from Drive
                </button>
                {/* Hanya muncul setelah klien mengirim pilihannya: sebelum itu
                    daftarnya kosong, dan menawarkan tindakan yang pasti tidak
                    membuahkan apa pun hanya membuang waktu orang. */}
                {!isPending && (
                  <button role="menuitem" onClick={() => { onCloseMenu(); onCopyList(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-ash-700 dark:text-ash-300 hover:bg-ash-50 dark:hover:bg-white/5 flex items-center gap-2 whitespace-nowrap">
                    <ListChecks size={14} strokeWidth={1.75} /> Filenames for Lightroom
                  </button>
                )}
                {!isPending && (
                  <button role="menuitem" onClick={() => { onCloseMenu(); onReopen(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-ash-700 dark:text-ash-300 hover:bg-ash-50 dark:hover:bg-white/5 flex items-center gap-2">
                    <RotateCcw size={14} strokeWidth={1.75} /> Reopen selection
                  </button>
                )}
                <button role="menuitem" onClick={() => { onCloseMenu(); onRotateLink(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-ash-700 dark:text-ash-300 hover:bg-ash-50 dark:hover:bg-white/5 flex items-center gap-2 whitespace-nowrap">
                  <KeyRound size={14} strokeWidth={1.75} /> Issue a new link
                </button>
                <button role="menuitem" onClick={() => { onCloseMenu(); onDelete(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/10 flex items-center gap-2">
                  <Trash2 size={14} strokeWidth={1.75} /> Delete
                </button>
              </div>
          )}
        </div>
      </div>
    </div>
  );
}
