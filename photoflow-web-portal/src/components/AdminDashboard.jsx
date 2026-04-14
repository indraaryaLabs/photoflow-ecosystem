import React, { useState, useEffect } from 'react';
import { 
  Camera, Sun, Moon, Copy, Check, Plus, 
  FolderOpen, Link as LinkIcon, Clock, ChevronRight, 
  LayoutDashboard, CheckCircle2, Sparkles, Loader2, Download,
  MoreVertical, Edit, Trash2, X, AlertOctagon
} from 'lucide-react';

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
  .animate-slide-up-fade {
    animation: slideUpFade 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .animate-toast {
    animation: slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  /* Custom Scrollbar for premium feel */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #52525b; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #71717a; }
`;

export default function AdminDashboard() {
  // --- STATE MANAGEMENT ---
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [projects, setProjects] = useState([]);

  const [formData, setFormData] = useState({
    clientName: '',
    maxSelection: 50,
    driveLink: ''
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [deletingProject, setDeletingProject] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  // --- API INTEGRATION ---
  const fetchProjects = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('http://localhost:3000/api/projects', {
        headers: {
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!res.ok) throw new Error('Gagal memuat data');
      const data = await res.json();
      setProjects(data || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  // --- HANDLERS ---
  const showToast = (message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async () => {
    if (!deletingProject) return;
    setActionLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/api/projects/${deletingProject.id}`, {
        method: 'DELETE',
        headers: { 'ngrok-skip-browser-warning': 'true' }
      });
      if (!res.ok) throw new Error('Gagal menghapus project');
      showToast("Project berhasil dihapus!");
      setDeletingProject(null);
      fetchProjects();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    if (!editingProject) return;
    setActionLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/api/projects/${editingProject.id}`, {
        method: 'PUT',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          client_name: editingProject.client_name,
          max_selections: parseInt(editingProject.max_selections),
          drive_folder_url: editingProject.drive_folder_url
        })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || 'Gagal mengupdate project');
      }
      showToast("Project berhasil diupdate!");
      setEditingProject(null);
      fetchProjects();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.clientName) return;

    setIsSubmitting(true);
    
    try {
      const res = await fetch('http://localhost:3000/api/projects', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify({
          client_name: formData.clientName,
          max_selections: parseInt(formData.maxSelection),
          drive_folder_url: formData.driveLink
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || errorData?.message || 'Gagal membuat project');
      }

      await fetchProjects();
      setFormData({ clientName: '', maxSelection: 50, driveLink: '' });
      showToast("Project successfully created!");
    } catch (err) {
      showToast(err.message || "Terjadi kesalahan", 'error');
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
      showToast("Magic link copied to clipboard!");
    } catch (err) {
      console.error('Failed to copy', err);
      showToast("Gagal menyalin link", 'error');
    }
    document.body.removeChild(textArea);
  };

  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  // --- RENDER ---
  return (
    <div className={`${isDarkMode ? 'dark' : ''} min-h-screen transition-colors duration-500`}>
      <style>{globalStyles}</style>
      
      {/* MAIN LAYOUT */}
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans selection:bg-indigo-500/30">
        
        {/* HEADER (Sticky, Glassmorphism) */}
        <header className="sticky top-0 z-40 bg-white/70 dark:bg-zinc-950/70 backdrop-blur-xl border-b border-zinc-200 dark:border-white/10 transition-colors duration-300">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-tr from-indigo-500 to-violet-500 p-2 rounded-xl shadow-lg shadow-indigo-500/20">
                <Camera className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-semibold tracking-tight leading-tight">PhotoFlow Workspace</h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium tracking-wide">ADMIN DASHBOARD</p>
              </div>
            </div>
            
            <button 
              onClick={toggleTheme}
              className="p-2.5 rounded-full bg-zinc-100 dark:bg-white/5 border border-transparent dark:border-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-600 dark:text-zinc-400 transition-all duration-300 hover:scale-105 active:scale-95"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {/* CONTENT GRID */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* LEFT PANEL: FORM */}
            <div className="col-span-1">
              <div className="sticky top-28">
                <div className="mb-6">
                  <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-500" />
                    New Project
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Create a new gallery selection for your client.</p>
                </div>

                <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-2xl border border-zinc-200 dark:border-white/10 shadow-sm dark:shadow-2xl rounded-2xl p-6 transition-all duration-300 relative overflow-hidden group">
                  {/* Subtle Background Glow */}
                  <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-all duration-500 pointer-events-none hidden dark:block"></div>

                  <form onSubmit={handleSubmit} className="space-y-5 relative z-10">
                    {/* Input: Client Name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Client Name</label>
                      <input 
                        type="text" 
                        required
                        value={formData.clientName}
                        onChange={(e) => setFormData({...formData, clientName: e.target.value})}
                        placeholder="e.g. Prewedding Rina & Anton"
                        className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl px-4 py-3 text-sm transition-all duration-300 outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-600"
                      />
                    </div>

                    {/* Input: Max Selections */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Max Selections</label>
                      <div className="relative">
                        <input 
                          type="number" 
                          min="1"
                          value={formData.maxSelection}
                          onChange={(e) => setFormData({...formData, maxSelection: parseInt(e.target.value)})}
                          className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 dark:focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 dark:focus:ring-indigo-500/20 rounded-xl px-4 py-3 text-sm transition-all duration-300 outline-none"
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-zinc-400 font-medium">
                          Photos
                        </div>
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
                          onChange={(e) => setFormData({...formData, driveLink: e.target.value})}
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
                          <Plus className="w-4 h-4" />
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
                  <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                    <LayoutDashboard className="w-5 h-5 text-zinc-400" />
                    Client Projects
                  </h2>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">Manage and track your gallery delivery status.</p>
                </div>
                
                <div className="text-sm font-medium px-3 py-1 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded-full text-zinc-600 dark:text-zinc-300">
                  {projects.length} Active
                </div>
              </div>

              {isLoading ? (
                <div className="bg-white/50 dark:bg-white/[0.02] border border-dashed border-zinc-300 dark:border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-center animate-slide-up-fade">
                  <Loader2 className="w-8 h-8 text-zinc-400 animate-spin mb-4" />
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading projects...</p>
                </div>
              ) : projects.length === 0 ? (
                // Empty State
                <div className="bg-white/50 dark:bg-white/[0.02] border border-dashed border-zinc-300 dark:border-white/10 rounded-2xl p-12 flex flex-col items-center justify-center text-center animate-slide-up-fade">
                  <div className="w-16 h-16 bg-zinc-100 dark:bg-white/5 rounded-full flex items-center justify-center mb-4">
                    <FolderOpen className="w-8 h-8 text-zinc-400" />
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
                      onEdit={() => setEditingProject({...project, drive_folder_url: project.drive_folder_url})}
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
                <X className="w-5 h-5" />
              </button>
              <h2 className="text-xl font-semibold mb-6 flex items-center gap-2"><Edit className="w-5 h-5 text-indigo-500" /> Edit Project</h2>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Client Name</label>
                  <input type="text" required value={editingProject.client_name} onChange={e => setEditingProject({...editingProject, client_name: e.target.value})} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Max Selections</label>
                  <input type="number" min="1" required value={editingProject.max_selections} onChange={e => setEditingProject({...editingProject, max_selections: e.target.value})} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">Google Drive Link</label>
                  <input type="url" required value={editingProject.drive_folder_url} onChange={e => setEditingProject({...editingProject, drive_folder_url: e.target.value})} className="w-full bg-zinc-50 dark:bg-black/20 border border-zinc-200 dark:border-white/10 focus:border-indigo-500 rounded-xl px-4 py-3 text-sm outline-none" />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setEditingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
                  <button type="submit" disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium text-sm shadow-lg shadow-indigo-500/25 transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                    {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save Changes"}
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
                <AlertOctagon className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Delete Project?</h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6">Are you sure you want to delete <strong className="text-zinc-800 dark:text-zinc-300">{deletingProject.client_name}</strong>? This action cannot be undone and will remove all associated photos.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeletingProject(null)} className="flex-1 px-4 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">Cancel</button>
                <button onClick={handleDelete} disabled={actionLoading} className="flex-1 px-4 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium text-sm shadow-lg shadow-red-500/25 transition-colors disabled:opacity-50 flex justify-center items-center gap-2">
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Yes, Delete"}
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
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              ) : (
                <div className="bg-red-500/20 text-red-500 rounded-full p-1">
                  <CheckCircle2 className="w-4 h-4" />
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

function ProjectCard({ project, index, onCopy, onEdit, onDelete }) {
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
            {project.client_name}
          </h3>
          <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
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
            <Check className="w-4 h-4 text-emerald-500" />
          ) : (
            <Copy className="w-4 h-4 group-hover/btn:scale-110 transition-transform" />
          )}
        </button>
        
        {/* Kebab Action */}
        <div className="relative">
          <button 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-2 rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/10 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          
          {isMenuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setIsMenuOpen(false)}></div>
              <div className="absolute right-0 top-full mt-2 w-36 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-20 animate-slide-up-fade origin-top-right">
                <button onClick={() => { setIsMenuOpen(false); onEdit(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 flex items-center gap-2">
                  <Edit className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => { setIsMenuOpen(false); onDelete(); }} className="w-full px-4 py-2.5 text-left text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
