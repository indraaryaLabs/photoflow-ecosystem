import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, User, ArrowRight, Loader2, Aperture, Sun, Moon, Phone, LogOut, LayoutDashboard } from 'lucide-react';
import { supabase } from '../lib/supabase';
// Jika Anda menggunakan React Router, uncomment baris di bawah ini:
// import { useNavigate } from 'react-router-dom';

export default function AdminLogin({ isDark, toggleTheme }) {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // State untuk menyimpan sesi login
  const [session, setSession] = useState(null);

  // Mengecek apakah user sudah login saat komponen dimuat
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // State untuk form (ditambah whatsapp)
  const [formData, setFormData] = useState({ name: '', email: '', password: '', whatsapp: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    if (isLoginMode) {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password
      });
      if (error) {
        alert("Login failed: " + error.message);
      } else {
        window.location.href = '/admin';
      }
    } else {
      // Validasi nomor WhatsApp sebelum registrasi
      const wa = formData.whatsapp || '';
      if (!wa.startsWith('62') || wa.length < 10 || wa.length > 15 || !/^\d+$/.test(wa)) {
        alert('Nomor WhatsApp tidak valid. Gunakan format yang benar.');
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.name,
            whatsapp: formData.whatsapp // Simpan WA di metadata user
          }
        }
      });

      if (error) {
        alert("Register failed: " + error.message);
      } else {
        // Opsional: Insert langsung ke tabel profiles jika Anda sudah membuatnya di Supabase
        if (data?.user) {
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: formData.name,
            whatsapp: formData.whatsapp,
            email: formData.email
          });
        }

        alert("Registrasi berhasil! Silakan cek email Anda atau langsung Sign In.");
        setIsLoginMode(true);
      }
    }

    setIsLoading(false);
  };

  // Fungsi Logout
  const handleLogout = async () => {
    setIsLoading(true);
    const { error } = await supabase.auth.signOut();
    if (error) alert("Error logging out: " + error.message);
    setFormData({ name: '', email: '', password: '', whatsapp: '' });
    setIsLoading(false);
  };

  const toggleMode = () => {
    setIsLoginMode(prev => !prev);
    setFormData({ name: '', email: '', password: '', whatsapp: '' }); // Reset form
  };

  return (
    <div className={isDark ? 'dark' : ''}>
      <div className="relative min-h-screen w-full flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden font-sans selection:bg-indigo-500/30 transition-colors duration-500">

        {/* --- THEME TOGGLE BUTTON --- */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleTheme}
          className="absolute top-6 right-6 z-50 p-2.5 rounded-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border border-zinc-200 dark:border-white/10 shadow-sm text-zinc-500 dark:text-zinc-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
        >
          {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
        </motion.button>

        {/* --- BACKGROUND EFFECTS --- */}
        <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#0000000a_1px,transparent_1px),linear-gradient(to_bottom,#0000000a_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] transition-colors duration-500"></div>

        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.15, 0.3, 0.15] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-indigo-500/30 dark:bg-indigo-600/20 blur-[120px] pointer-events-none"
        />
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-violet-500/30 dark:bg-violet-600/20 blur-[150px] pointer-events-none"
        />

        <div
          className="absolute inset-0 z-0 opacity-[0.03] dark:opacity-[0.04] pointer-events-none mix-blend-overlay"
          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
        ></div>

        {/* --- MAIN CONTAINER --- */}
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", bounce: 0.3, duration: 0.8 }}
          className="relative z-10 w-full max-w-[420px] px-6 py-12 md:p-0"
        >
          {/* Glass Panel */}
          <div className="relative backdrop-blur-2xl bg-white/60 dark:bg-zinc-900/40 border border-zinc-200/80 dark:border-white/[0.08] p-8 rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.08)] dark:shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)] shadow-indigo-500/5 dark:shadow-indigo-500/10 overflow-hidden transition-colors duration-500">

            <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/50 dark:ring-white/[0.02] pointer-events-none transition-colors duration-500"></div>

            {/* --- HEADER --- */}
            <div className="flex flex-col items-center mb-8 text-center">
              <motion.div
                whileHover={{ scale: 1.05, rotate: 5 }}
                className="w-12 h-12 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center mb-5 shadow-lg shadow-indigo-500/25 border border-indigo-400/20 dark:border-white/10"
              >
                <Aperture className="w-6 h-6 text-white" />
              </motion.div>

              <div className="h-[60px] relative w-full flex flex-col items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={session ? "loggedin" : (isLoginMode ? "login" : "register")}
                    initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                    transition={{ duration: 0.3 }}
                    className="absolute flex flex-col items-center w-full"
                  >
                    <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white mb-1.5 transition-colors duration-500">
                      {session ? "You're signed in" : (isLoginMode ? "Welcome back" : "Create an account")}
                    </h1>
                    <p className="text-sm text-zinc-500 dark:text-zinc-400 font-medium transition-colors duration-500">
                      {session
                        ? session.user.email
                        : (isLoginMode
                          ? "Enter your details to access PhotoFlow Admin."
                          : "Start managing your gallery like a pro.")}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* --- CONDITIONAL RENDER: IF LOGGED IN VS LOGGED OUT --- */}
            {session ? (
              /* LOGGED IN VIEW */
              <div className="space-y-4">
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => window.location.href = '/admin'}
                  className="relative w-full py-3.5 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium text-sm overflow-hidden group shadow-[0_4px_20px_-5px_rgba(99,102,241,0.4)] hover:shadow-[0_4px_25px_-5px_rgba(99,102,241,0.6)] transition-all duration-300 border border-indigo-400/20"
                >
                  <div className="flex items-center justify-center gap-2">
                    <LayoutDashboard className="w-4 h-4" />
                    <span>Go to Dashboard</span>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleLogout}
                  disabled={isLoading}
                  className="relative w-full py-3.5 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 text-zinc-700 dark:text-zinc-300 font-medium text-sm border border-zinc-200 dark:border-white/10 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-all duration-300"
                >
                  <div className="flex items-center justify-center gap-2">
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                    <span>Sign Out</span>
                  </div>
                </motion.button>
              </div>
            ) : (
              /* LOGGED OUT VIEW (FORM) */
              <>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <AnimatePresence initial={false}>
                    {!isLoginMode && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                        animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
                        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden space-y-4"
                      >
                        <InputField
                          icon={User}
                          type="text"
                          placeholder="Full Name"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required={!isLoginMode}
                        />
                        {/* INPUT WHATSAPP BARU */}
                        <InputField
                          icon={Phone}
                          type="tel"
                          placeholder="WhatsApp (Contoh: 62812...)"
                          value={formData.whatsapp}
                          onChange={(e) => {
                            let val = e.target.value;
                            if (val.startsWith('0')) {
                              val = '62' + val.substring(1);
                            } else if (val.startsWith('+62')) {
                              val = '62' + val.substring(3);
                            }
                            val = val.replace(/[^\d+]/g, '');
                            setFormData({ ...formData, whatsapp: val });
                          }}
                          required={!isLoginMode}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <InputField
                    icon={Mail}
                    type="email"
                    placeholder="Email address"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />

                  <div className="relative group">
                    <InputField
                      icon={Lock}
                      type={showPassword ? "text" : "password"}
                      placeholder="Password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {isLoginMode && (
                    <div className="flex justify-end pt-1">
                      <a href="#" className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors">
                        Forgot password?
                      </a>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isLoading}
                    className="relative w-full py-3.5 mt-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 text-white font-medium text-sm overflow-hidden group shadow-[0_4px_20px_-5px_rgba(99,102,241,0.4)] hover:shadow-[0_4px_25px_-5px_rgba(99,102,241,0.6)] transition-all duration-300 disabled:opacity-70 disabled:cursor-not-allowed border border-indigo-400/20"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-700 ease-in-out pointer-events-none"></div>

                    <div className="flex items-center justify-center gap-2">
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <span>{isLoginMode ? "Sign In" : "Get Started"}</span>
                          <ArrowRight className="w-4 h-4 opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                        </>
                      )}
                    </div>
                  </motion.button>
                </form>

                <div className="mt-8 text-center">
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 transition-colors duration-500">
                    {isLoginMode ? "Don't have an account? " : "Already have an account? "}
                    <button
                      onClick={toggleMode}
                      className="text-zinc-900 dark:text-white font-medium hover:text-indigo-500 dark:hover:text-indigo-400 hover:underline underline-offset-4 decoration-indigo-500/30 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-sm"
                    >
                      {isLoginMode ? "Sign up" : "Sign in"}
                    </button>
                  </p>
                </div>
              </>
            )}

          </div>

          <p className="text-center text-xs text-zinc-500 dark:text-zinc-600 mt-6 font-medium transition-colors duration-500">
            Protected by reCAPTCHA and subject to the <br className="hidden sm:block" />
            <a href="#" className="hover:text-zinc-800 dark:hover:text-zinc-400 transition-colors">Privacy Policy</a> and <a href="#" className="hover:text-zinc-800 dark:hover:text-zinc-400 transition-colors">Terms of Service</a>.
          </p>

        </motion.div>
      </div>
    </div>
  );
}

// --- Komponen Sub: Input Field ---
function InputField({ icon: Icon, ...props }) {
  return (
    <div className="relative group">
      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
        <Icon className="h-4 w-4 text-zinc-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300" />
      </div>
      <input
        {...props}
        className="w-full pl-10 pr-4 py-3.5 bg-zinc-50/50 dark:bg-white/[0.03] border border-zinc-200 dark:border-white/[0.08] rounded-xl text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500/50 focus:bg-white dark:focus:bg-white/[0.05] shadow-sm dark:shadow-none transition-all duration-300"
      />
    </div>
  );
}