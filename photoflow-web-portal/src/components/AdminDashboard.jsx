import React, { useState, useEffect } from 'react';
import {
  Copy, Check, Plus, FolderOpen, Link as LinkIcon, Clock,
  CheckCircle2, Loader2, MoreVertical, Edit, Trash2, X, AlertOctagon,
  LogOut, MessageCircle
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';

// --- STYLES & ANIMATIONS ---
const globalStyles = `
  @keyframes slideInRight {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideUpFade {
    from { transform: translateY(10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .animate-slide-up-fade {
    animation: slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .animate-toast {
    animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .skeleton-shimmer {
    background: linear-gradient(90deg, transparent 25%, rgba(255,255,255,0.08) 50%, transparent 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .light .skeleton-shimmer, :not(.dark) .skeleton-shimmer {
    background: linear-gradient(90deg, transparent 25%, rgba(0,0,0,0.04) 50%, transparent 75%);
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
  }
  /* Custom Scrollbar for premium feel */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #52525b; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #71717a; }
`;

export default function AdminDashboard({ themeChoice, cycleTheme }) {
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
  const [actionLoading, setActionLoading] = useState(false);

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
      window.location.href = '/';
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

    showToast('Sesi berakhir. Silakan login kembali.', 'error');
    await supabase.auth.signOut();
    setTimeout(() => { window.location.href = '/'; }, 1000);
    return null;
  };

  // --- API INTEGRATION ---
  const fetchProjects = async () => {
    try {
      setIsLoading(true);
      const token = await getAccessToken();
      if (!token) return; // Guard: skip fetch if no session

      const sendRequest = (accessToken) => fetch(`${API_BASE}/api/projects`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      const checkedRes = await handleApiResponse(await sendRequest(token), sendRequest);
      if (!checkedRes) return;

      if (!checkedRes.ok) throw new Error('Gagal memuat data project');
      const data = await checkedRes.json();
      setProjects(data || []);
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 'error');
      } else {
        showToast(err.message, 'error');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

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
      if (!checkedRes.ok) throw new Error('Gagal menghapus project');

      showToast("Project berhasil dihapus!");
      setDeletingProject(null);
      fetchProjects();
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('Server tidak merespon. Coba lagi nanti.', 'error');
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
      showToast('Nomor WhatsApp tidak valid. Pastikan nomor benar (min. 10 angka).', 'error');
      return;
    }

    setActionLoading(true);
    try {
      const token = await getAccessToken();
      if (!token) return;

      const { data: { user } } = await supabase.auth.getUser();
      const adminWa = user?.user_metadata?.whatsapp || '';

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

      if (!checkedRes.ok) {
        const errorData = await checkedRes.json().catch(() => null);
        throw new Error(errorData?.error || 'Gagal mengupdate project');
      }
      showToast("Project berhasil diupdate!");
      setEditingProject(null);
      fetchProjects();
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('Server tidak merespon. Coba lagi nanti.', 'error');
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
      showToast('Nomor WhatsApp tidak valid. Pastikan nomor benar (min. 10 angka).', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const token = await getAccessToken();
      if (!token) return;

      const { data: { user } } = await supabase.auth.getUser();
      const adminWa = user?.user_metadata?.whatsapp || '';

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

      if (!checkedRes.ok) {
        const errorData = await checkedRes.json().catch(() => null);
        throw new Error(errorData?.error || errorData?.message || 'Gagal membuat project');
      }

      await fetchProjects();
      setFormData({ projectName: '', clientName: '', maxSelection: 50, driveLink: '', clientWa: '' });
      showToast("Project berhasil dibuat!");
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        showToast('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 'error');
      } else {
        showToast(err.message || "Terjadi kesalahan", 'error');
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
      showToast("Magic link berhasil disalin!");
    } catch (err) {
      console.error('Failed to copy', err);
      showToast("Gagal menyalin link", 'error');
    }
    document.body.removeChild(textArea);
  };

  const handleLogout = async () => {
    // Bersihkan state lokal sebelum logout
    setProjects([]);
    setFormData({ projectName: '', clientName: '', maxSelection: 50, driveLink: '', clientWa: '' });
    setEditingProject(null);
    setDeletingProject(null);

    await supabase.auth.signOut();
    window.location.href = '/';
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen transition-colors duration-500">
      <style>{globalStyles}</style>

      {/* MAIN LAYOUT */}
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-indigo-500/30">

        {/* HEADER (Sticky, Glassmorphism) */}
        <header className="sticky top-0 z-40 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-xl border-b border-zinc-200 dark:border-white/10 transition-colors duration-300">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200">
                <BrandMark size={20} />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight leading-tight">PhotoFlow Workspace</h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium tracking-wide">PROJECT DASHBOARD</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />

              <button
                onClick={handleLogout}
                className="p-2.5 rounded-full bg-zinc-100 dark:bg-white/5 border border-transparent dark:border-white/5 hover:bg-red-50 dark:hover:bg-red-500/10 text-zinc-600 dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-all duration-300 hover:scale-105 active:scale-95"
                title="Logout"
              >
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        </header>

        {/* CONTENT GRID */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

            {/* LEFT PANEL: FORM */}
            <div className="col-span-1">
              <div className="sticky top-28">
                <div className="mb-6">
                  <h2 className="text-xl font-semibold tracking-tight">New Project</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Create a new gallery selection for your client.</p>
                </div>

                <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm dark:shadow-[0_0_15px_rgba(168,85,247,0.15)] rounded-2xl p-6 transition-all duration-300 relative overflow-hidden group">
                  {/* Subtle Background Glow */}
                  <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all duration-500 pointer-events-none hidden dark:block"></div>

                  <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
                    {/* Input: Project Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Project Name</label>
                      <input
                        type="text"
                        required
                        value={formData.projectName}
                        onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                        placeholder="e.g. Engagement Session, Maternity"
                        className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl px-4 py-3 text-sm transition-all duration-300 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                      />
                    </div>

                    {/* Input: Client Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Client Name</label>
                      <input
                        type="text"
                        required
                        value={formData.clientName}
                        onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
                        placeholder="e.g. The Hartleys"
                        className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl px-4 py-3 text-sm transition-all duration-300 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                      />
                    </div>

                    {/* Input: Max Selections & Client WhatsApp (Grid 2 kolom) */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Max Selections</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            value={formData.maxSelection}
                            onChange={(e) => setFormData({ ...formData, maxSelection: parseInt(e.target.value) })}
                            className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl pl-4 pr-16 py-3 text-sm transition-all duration-300 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-medium">
                            Photos
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Client WhatsApp</label>
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
                          className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl px-4 py-3 text-sm transition-all duration-300 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Input: Drive Link */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Google Drive Link</label>
                      <div className="relative">
                        <LinkIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                        <input
                          type="url"
                          required
                          value={formData.driveLink}
                          onChange={(e) => setFormData({ ...formData, driveLink: e.target.value })}
                          placeholder="https://drive.google.com/..."
                          className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl pl-10 pr-4 py-3 text-sm transition-all duration-300 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                        />
                      </div>
                    </div>

                    {/* Submit Button */}
                    <button
                      type="submit"
                      disabled={!formData.clientName || isSubmitting}
                      className="w-full mt-2 flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white rounded-xl px-4 py-3.5 text-sm font-semibold shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-indigo-500/25"
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
                </div>
              </div>
            </div>

            {/* RIGHT PANEL: LIST */}
            <div className="col-span-1 lg:col-span-2">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight">Client Projects</h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage and track your gallery delivery status.</p>
                </div>

                <div className="text-sm font-medium px-3 py-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-full text-zinc-600 dark:text-zinc-300">
                  {projects.length} Active
                </div>
              </div>

              {isLoading ? (
                <div className="space-y-4 animate-slide-up-fade">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-white dark:bg-white/[0.03] border border-zinc-200 dark:border-white/10 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4">
                        <div className="hidden sm:block w-10 h-10 rounded-full bg-zinc-100 dark:bg-white/5 skeleton-shimmer" />
                        <div className="space-y-2">
                          <div className="h-4 w-40 rounded-lg bg-zinc-200 dark:bg-white/10 skeleton-shimmer" />
                          <div className="h-3 w-28 rounded-lg bg-zinc-100 dark:bg-white/5 skeleton-shimmer" />
                          <div className="h-3 w-48 rounded-lg bg-zinc-100 dark:bg-white/5 skeleton-shimmer" />
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-7 w-28 rounded-full bg-zinc-100 dark:bg-white/5 skeleton-shimmer" />
                        <div className="h-8 w-8 rounded-xl bg-zinc-100 dark:bg-white/5 skeleton-shimmer" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : projects.length === 0 ? (
                // Empty State
                <div className="bg-white/50 dark:bg-white/[0.02] border border-dashed border-zinc-300 dark:border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-center animate-slide-up-fade">
                  <div className="w-16 h-16 bg-zinc-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <FolderOpen size={32} strokeWidth={1.75} className="text-zinc-400" />
                  </div>
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-white">No projects yet</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2 max-w-sm">Create your first project on the left panel to start sharing galleries with your clients.</p>
                </div>
              ) : (
                // List State
                <div className="space-y-4">
                  {projects.map((project, index) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      index={index}
                      onCopy={() => handleCopyLink(project.magic_link_token)}
                      onWhatsApp={() => {
                        const url = `${window.location.origin}/?token=${project.magic_link_token}`;
                        const text = `Halo Kak ${project.client_name},\nBerikut adalah link galeri foto untuk project *${project.project_name}*.\n\nSilakan klik link di bawah ini untuk mulai memilih foto (Maksimal ${project.max_selections} foto):\n${url}\n\nTerima kasih atas kepercayaannya.`;
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
        </main>

        {/* CUSTOM EDIT MODAL */}
        {editingProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-md relative">
              <button type="button" onClick={() => setEditingProject(null)} className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors">
                <X size={20} strokeWidth={1.75} />
              </button>
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2"><Edit size={20} strokeWidth={1.75} className="text-indigo-500" /> Edit Project</h2>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Project Name</label>
                  <input type="text" required value={editingProject.project_name || ''} onChange={e => setEditingProject({ ...editingProject, project_name: e.target.value })} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Client Name</label>
                  <input type="text" required value={editingProject.client_name} onChange={e => setEditingProject({ ...editingProject, client_name: e.target.value })} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Max Selections</label>
                    <input type="number" min="1" required value={editingProject.max_selections} onChange={e => setEditingProject({ ...editingProject, max_selections: e.target.value })} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Client WhatsApp</label>
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
                      className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Google Drive Link</label>
                  <input type="url" required value={editingProject.drive_folder_url} onChange={e => setEditingProject({ ...editingProject, drive_folder_url: e.target.value })} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setEditingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
                  <button type="submit" disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
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
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-sm text-center relative">
              <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 flex items-center justify-center mb-4 text-red-500">
                <AlertOctagon size={24} strokeWidth={1.75} />
              </div>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Delete Project?</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Are you sure you want to delete <strong className="text-zinc-800 dark:text-zinc-300">{deletingProject.client_name}</strong>? This action cannot be undone and will remove all associated photos.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeletingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
                <button onClick={handleDelete} disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium text-sm shadow-lg shadow-red-500/25 transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                  {actionLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : "Yes, Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TOAST NOTIFICATION */}
        {toast && (
          <div className="fixed bottom-6 right-6 lg:bottom-8 lg:right-8 z-50 animate-toast">
            <div className="bg-zinc-900/90 dark:bg-zinc-800/90 backdrop-blur-xl border border-zinc-800 dark:border-white/10 shadow-2xl rounded-2xl px-5 py-3.5 flex items-center gap-3 text-white">
              {toast.type === 'success' ? (
                <div className="bg-emerald-500/20 text-emerald-400 rounded-full p-1">
                  <CheckCircle2 size={16} strokeWidth={1.75} />
                </div>
              ) : (
                <div className="bg-red-500/20 text-red-500 rounded-full p-1">
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

function ProjectCard({ project, index, onCopy, onWhatsApp, onEdit, onDelete }) {
  const [copied, setCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const handleCopyClick = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isPending = project.status === 'pending';

  return (
    <div
      className={`group relative bg-white dark:bg-white/[0.03] backdrop-blur-md border border-zinc-200 dark:border-white/10 rounded-2xl p-5 hover:shadow-xl dark:hover:shadow-2xl hover:bg-zinc-50 dark:hover:bg-white/[0.05] hover:border-zinc-300 dark:hover:border-white/20 transition-all duration-300 animate-slide-up-fade flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${isMenuOpen ? 'z-50' : 'z-0 hover:z-10'}`}
      style={{ animationDelay: `${index * 0.05}s` }}
    >
      {/* Card Info */}
      <div className="flex items-start sm:items-center gap-4">
        {/* Status Icon Indicator */}
        <div className="hidden sm:flex mt-1 sm:mt-0 items-center justify-center w-10 h-10 rounded-full bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/5 group-hover:scale-110 transition-transform duration-300">
          <FolderOpen className={`w-5 h-5 ${isPending ? 'text-amber-500' : 'text-emerald-500'}`} />
        </div>

        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
            {project.project_name || "Untitled Project"}
          </h3>
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mt-0.5">
            {project.client_name}
          </p>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Clock size={14} strokeWidth={1.75} />
              {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span className="w-1 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"></span>
            <span>{project.max_selections} Photos</span>
          </div>
        </div>
      </div>

      {/* Card Actions & Badges */}
      <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 border-zinc-100 dark:border-white/5 pt-4 sm:pt-0">

        {/* Status Badge */}
        <div className={`px-3 py-1.5 rounded-full border text-xs font-medium flex items-center gap-1.5 shadow-sm
          ${isPending
            ? 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20 shadow-amber-500/5 dark:shadow-amber-500/10'
            : 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 shadow-emerald-500/5 dark:shadow-emerald-500/10'
          }
        `}>
          <span className={`w-1.5 h-1.5 rounded-full ${isPending ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
          {isPending ? 'Pending Selection' : 'Submitted'}
        </div>

        {/* Copy Action */}
        <button
          onClick={handleCopyClick}
          className="p-2 rounded-xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-200 dark:hover:border-white/20 hover:bg-indigo-50 dark:hover:bg-white/10 transition-all duration-200 active:scale-90 group/btn"
          title="Copy Magic Link"
        >
          {copied ? (
            <Check size={16} strokeWidth={1.75} className="text-emerald-500" />
          ) : (
            <Copy size={16} strokeWidth={1.75} className="group-hover/btn:scale-110 transition-transform" />
          )}
        </button>

        {/* WhatsApp Action */}
        <button
          onClick={onWhatsApp}
          className="p-2 rounded-xl border border-zinc-200 dark:border-white/5 bg-white dark:bg-white/5 text-zinc-600 dark:text-zinc-400 hover:text-emerald-500 dark:hover:text-emerald-400 hover:border-emerald-200 dark:hover:border-emerald-500/20 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all duration-200 active:scale-90 group/wa"
          title="Send via WhatsApp"
        >
          <MessageCircle size={16} strokeWidth={1.75} className="group-hover/wa:scale-110 transition-transform" />
        </button>

        {/* Kebab Action */}
        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <MoreVertical size={16} strokeWidth={1.75} />
          </button>

          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)}></div>
              <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-20 animate-slide-up-fade origin-top-right">
                <button onClick={() => { setIsMenuOpen(false); onEdit(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center gap-2">
                  <Edit size={14} strokeWidth={1.75} /> Edit
                </button>
                <button onClick={() => { setIsMenuOpen(false); onDelete(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2">
                  <Trash2 size={14} strokeWidth={1.75} /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
