import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, User, ArrowRight, Loader2, Phone, LogOut, LayoutDashboard, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openedFromRecoveryLink, clearUrlFragment } from '../lib/recovery';
import BrandMark from './BrandMark';
import PublicNav from './PublicNav';
import { PRIVACY_PATH, TERMS_PATH } from '../lib/legal';
import { useLang } from '../lib/lang';

/**
 * Terjemahkan error Supabase Auth jadi kalimat yang benar untuk user.
 *
 * Pemetaan ini pernah salah dengan cara yang merugikan: setiap kegagalan
 * dilaporkan sebagai "Email atau password salah". Kegagalan jaringan pun ikut
 * kena, sehingga seseorang yang koneksinya putus diberi tahu bahwa
 * passwordnya salah — lalu menggantinya, padahal tidak ada yang salah dengan
 * password itu. Kesalahan jaringan tidak membawa status HTTP, dan itulah
 * pembedanya.
 *
 * Yang TIDAK dibedakan, sengaja: email tidak terdaftar versus password salah.
 * Supabase memang membedakan keduanya, tapi meneruskan perbedaan itu ke layar
 * berarti memberi tahu siapa pun yang mencoba, akun mana yang ada di sistem.
 */
function describeAuthError(error) {
  if (!error?.status || error.name === 'AuthRetryableFetchError') {
    return 'Could not reach the server. Check your internet connection.';
  }
  if (error.code === 'email_not_confirmed') {
    return 'Your email is not confirmed yet. Open the confirmation link we sent you first.';
  }
  if (error.status === 400 || error.status === 401) {
    return 'Incorrect email or password.';
  }
  if (error.status === 422) {
    return error.message || 'The details you entered are not valid.';
  }
  if (error.status === 429) {
    return 'Too many attempts. Please try again in a few minutes.';
  }
  return 'The server is having trouble. Please try again shortly.';
}

export default function AdminLogin({ themeChoice, cycleTheme, onNavigate }) {
  const { lang, setLang, t } = useLang();
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Pesan untuk user. Sebelumnya seluruh kegagalan di layar ini dilaporkan
  // lewat alert(), padahal sisa aplikasi memakai toast dan pesan inline —
  // dan alert() memblokir halaman sampai ditutup.
  const [feedback, setFeedback] = useState(null);

  // State untuk menyimpan sesi login
  const [session, setSession] = useState(null);

  // Mode pemulihan password. Supabase mengirim tautan yang membawa token
  // pemulihan kembali ke aplikasi ini; tanpa penanganan khusus, pemiliknya
  // hanya akan masuk ke dashboard dan tidak pernah sampai ke layar penggantian
  // password.
  const [isRecovery, setIsRecovery] = useState(openedFromRecoveryLink);
  const [newPassword, setNewPassword] = useState('');

  // Mengecek apakah user sudah login saat komponen dimuat
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
        setFeedback(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // State untuk form (ditambah whatsapp)
  const [formData, setFormData] = useState({ name: '', email: '', password: '', whatsapp: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setFeedback(null);

    if (isLoginMode) {
      const { error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password
      });
      if (error) {
        setFeedback({ type: 'error', message: describeAuthError(error) });
      } else {
        // Perpindahan sisi klien, bukan muat ulang halaman.
        //
        // `window.location.href` di sini membuang seluruh aplikasi yang baru
        // saja selesai dibangun lalu membangunnya lagi dari nol — tepat pada
        // saat sesinya sudah ada di tangan dan dashboard-nya sudah bisa
        // digambar. Yang terlihat orangnya adalah layar putih beberapa detik
        // sesudah menekan tombol yang seharusnya menyelesaikan pekerjaan.
        // `ganti` supaya '/' tidak tertinggal di riwayat: tombol kembali dari
        // dashboard tidak boleh memantulkan orang yang sudah masuk kembali ke
        // formulir masuk.
        onNavigate('/dashboard', { ganti: true });
      }
    } else {
      // Validasi nomor WhatsApp sebelum registrasi
      const wa = formData.whatsapp || '';
      if (!wa.startsWith('62') || wa.length < 10 || wa.length > 15 || !/^\d+$/.test(wa)) {
        setFeedback({
          type: 'error',
          message: 'That WhatsApp number is not valid. Start with 62 and use 10–15 digits.'
        });
        setIsLoading(false);
        return;
      }

      const { error } = await supabase.auth.signUp({
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
        setFeedback({ type: 'error', message: describeAuthError(error) });
      } else {
        // Baris di tabel profiles dibuat trigger handle_new_user() di sisi
        // Supabase. Frontend sempat melakukan upsert sendiri di sini, dan
        // kolom yang dikirimnya tidak semuanya ada — hasilnya dibuang diam-diam
        // (FINDINGS.md F-17). Sekarang penulisannya dibiarkan pada trigger.
        setFeedback({
          type: 'success',
          message: 'Account created. Check your email for the confirmation link, then sign in.'
        });
        setIsLoginMode(true);
      }
    }

    setIsLoading(false);
  };

  // Kirim tautan pemulihan password ke email yang sedang diisi.
  const handleForgotPassword = async () => {
    const email = formData.email.trim();
    if (!email) {
      setFeedback({ type: 'error', message: 'Enter your email address first, then choose "Forgot password".' });
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });

    // Keberhasilan dilaporkan sama untuk email yang terdaftar maupun tidak.
    // Membedakan keduanya berarti memberi tahu siapa pun yang mencoba, akun
    // mana yang ada di sistem ini.
    if (error) {
      setFeedback({ type: 'error', message: describeAuthError(error) });
    } else {
      setFeedback({
        type: 'success',
        message: `If ${email} is registered, a reset link is on its way to that address.`
      });
    }
    setIsLoading(false);
  };

  // Simpan password baru setelah user membuka tautan pemulihan.
  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setFeedback({ type: 'error', message: 'Your new password must be at least 6 characters.' });
      return;
    }

    setIsLoading(true);
    setFeedback(null);

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setFeedback({ type: 'error', message: describeAuthError(error) });
      setIsLoading(false);
      return;
    }

    setNewPassword('');
    setIsRecovery(false);
    // Token pemulihan dibuang dari URL supaya me-refresh halaman tidak
    // mengulang alur yang sudah selesai.
    clearUrlFragment();
    // Tautan pemulihan membawa serta sesi yang sah. Membuangnya memaksa
    // password baru itu benar-benar dipakai sekali sebelum masuk.
    await supabase.auth.signOut();
    setFeedback({ type: 'success', message: 'Password updated. You can sign in now.' });
    setIsLoading(false);
  };

  // Fungsi Logout
  const handleLogout = async () => {
    setIsLoading(true);
    const { error } = await supabase.auth.signOut();
    if (error) setFeedback({ type: 'error', message: describeAuthError(error) });
    setFormData({ name: '', email: '', password: '', whatsapp: '' });
    setIsLoading(false);
  };

  const toggleMode = () => {
    setIsLoginMode(prev => !prev);
    setFeedback(null);
    setFormData({ name: '', email: '', password: '', whatsapp: '' }); // Reset form
  };

  return (
    <div>
      <div className="relative min-h-screen w-full flex items-center justify-center bg-ash-50 dark:bg-ash-950 text-ash-900 dark:text-ash-100 overflow-hidden font-sans transition-colors duration-tint">

        {/* --- HEADER ---
            Navigasinya sama persis dengan /pricing dan /guide karena memang
            komponen yang sama. Sebelumnya layar ini punya salinannya sendiri,
            dan salinan itu menyembunyikan tautannya di bawah breakpoint sm —
            sehingga di ponsel Harga dan Panduan kembali terkubur di kaki
            halaman, tempat yang justru sedang diperbaiki. */}
        <header className="absolute inset-x-0 top-0 z-50 px-5 py-5 sm:px-8">
          <PublicNav
            themeChoice={themeChoice}
            cycleTheme={cycleTheme}
            lang={lang}
            onSelectLang={setLang}
            t={t}
            showSignIn={false}
          />
        </header>

        {/* --- BACKGROUND EFFECTS --- */}
        <div className="absolute inset-0 z-0 bg-[linear-gradient(to_right,#0000000a_1px,transparent_1px),linear-gradient(to_bottom,#0000000a_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] transition-colors duration-tint"></div>

        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.15, 0.3, 0.15] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-ash-400/30 dark:bg-white/[0.06] blur-[120px] pointer-events-none"
        />
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.1, 0.2, 0.1] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
          className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full bg-ash-300/30 dark:bg-white/[0.04] blur-[150px] pointer-events-none"
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
          <div className="relative backdrop-blur-2xl bg-white/60 dark:bg-ash-900/40 border border-ash-200/80 dark:border-white/[0.08] p-8 rounded-3xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.08)] dark:shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)] overflow-hidden transition-colors duration-tint">

            <div className="absolute inset-0 rounded-3xl ring-1 ring-inset ring-white/50 dark:ring-white/[0.02] pointer-events-none transition-colors duration-tint"></div>

            {/* --- HEADER --- */}
            <div className="flex flex-col items-center mb-8 text-center">
              <motion.div
                whileHover={{ scale: 1.05, rotate: 5 }}
                className="w-12 h-12 rounded-xl bg-ash-800 dark:bg-ash-100 flex items-center justify-center mb-5 shadow-sm border border-ash-700 dark:border-white/10"
              >
                {/* Kotaknya ikut terbalik di mode gelap (pekat jadi terang),
                    jadi lambangnya harus ikut terbalik juga. */}
                <BrandMark size={26} className="text-white dark:text-ash-950" title="PhotoFlow" />
              </motion.div>

              <div className="h-[60px] relative w-full flex flex-col items-center justify-center">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={isRecovery ? "recovery" : (session ? "loggedin" : (isLoginMode ? "login" : "register"))}
                    initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                    transition={{ duration: 0.3 }}
                    className="absolute flex flex-col items-center w-full"
                  >
                    <h1 className="mb-1.5 font-display text-3xl font-semibold tracking-tight text-ash-900 transition-colors duration-tint dark:text-white">
                      {isRecovery
                        ? t({ en: 'Set a new password', id: 'Setel kata sandi baru' })
                        : session
                          ? t({ en: "You're signed in", id: 'Anda sudah masuk' })
                          : isLoginMode
                            ? t({ en: 'Welcome back', id: 'Selamat datang kembali' })
                            : t({ en: 'Create an account', id: 'Buat akun' })}
                    </h1>
                    <p className="text-sm text-ash-600 dark:text-ash-400 font-medium transition-colors duration-tint">
                      {isRecovery
                        ? t({
                            en: 'Choose a new password for your account.',
                            id: 'Pilih kata sandi baru untuk akun Anda.',
                          })
                        : session
                          ? session.user.email
                          : isLoginMode
                            // Bukan "PhotoFlow Admin": tidak ada peran
                            // administrator di sini, dan jalurnya pun sudah
                            // bukan /admin lagi. Kalimatnya menyebut pekerjaan
                            // yang sebenarnya dilakukan di balik layar ini.
                            ? t({
                                en: 'Sign in to manage your client galleries.',
                                id: 'Masuk untuk mengelola galeri klien Anda.',
                              })
                            : t({
                                en: 'Create an account to start sharing galleries with your clients.',
                                id: 'Buat akun untuk mulai membagikan galeri ke klien Anda.',
                              })}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            {/* --- PESAN UNTUK USER --- */}
            <AnimatePresence>
              {feedback && (
                <motion.div
                  initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                  animate={{ opacity: 1, height: "auto", marginBottom: 20 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <div
                    role="status"
                    aria-live="polite"
                    className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
                      feedback.type === 'error'
                        ? 'border-danger-200 bg-danger-50 text-danger-700 dark:border-danger-500/20 dark:bg-danger-500/10 dark:text-danger-300'
                        : 'border-success-200 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300'
                    }`}
                  >
                    {feedback.type === 'error'
                      ? <AlertCircle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
                      : <CheckCircle2 size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />}
                    <span>{feedback.message}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* --- CONDITIONAL RENDER: PEMULIHAN / SUDAH LOGIN / BELUM LOGIN --- */}
            {isRecovery ? (
              /* SET PASSWORD BARU — dicapai lewat tautan pemulihan dari email */
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="relative group">
                  <InputField
                    icon={KeyRound}
                    type={showPassword ? "text" : "password"}
                    placeholder={t({ en: 'New password (at least 6 characters)', id: 'Kata sandi baru (minimal 6 karakter)' })}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-ash-500 dark:text-ash-500 hover:text-ash-600 dark:hover:text-ash-300 transition-colors rounded-md focus:outline-none focus:ring-2 focus:ring-ash-400 dark:focus:ring-ash-500"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
                  </button>
                </div>

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  disabled={isLoading}
                  className="relative w-full py-3.5 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm shadow-sm transition-all duration-feedback disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center justify-center gap-2">
                    {isLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : <span>{t({ en: 'Save new password', id: 'Simpan kata sandi baru' })}</span>}
                  </div>
                </motion.button>
              </form>
            ) : session ? (
              /* LOGGED IN VIEW */
              <div className="space-y-4">
                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => onNavigate('/dashboard', { ganti: true })}
                  className="relative w-full py-3.5 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm overflow-hidden group shadow-sm transition-all duration-feedback"
                >
                  <div className="flex items-center justify-center gap-2">
                    <LayoutDashboard className="w-4 h-4" />
                    <span>{t({ en: 'Go to Dashboard', id: 'Ke Dashboard' })}</span>
                  </div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.01 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleLogout}
                  disabled={isLoading}
                  className="relative w-full py-3.5 rounded-xl bg-ash-100 dark:bg-ash-800/50 text-ash-700 dark:text-ash-300 font-medium text-sm border border-ash-200 dark:border-white/10 hover:bg-ash-200 dark:hover:bg-ash-800 transition-all duration-feedback"
                >
                  <div className="flex items-center justify-center gap-2">
                    {isLoading ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" /> : <LogOut size={16} strokeWidth={1.75} />}
                    <span>{t({ en: 'Sign Out', id: 'Keluar' })}</span>
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
                          placeholder={t({ en: 'Full Name', id: 'Nama lengkap' })}
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          required={!isLoginMode}
                        />
                        {/* INPUT WHATSAPP BARU */}
                        <InputField
                          icon={Phone}
                          type="tel"
                          placeholder={t({ en: 'WhatsApp number (e.g. 62812...)', id: 'Nomor WhatsApp (mis. 62812...)' })}
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
                    placeholder={t({ en: 'Email address', id: 'Alamat email' })}
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    required
                  />

                  <div className="relative group">
                    <InputField
                      icon={Lock}
                      type={showPassword ? "text" : "password"}
                      placeholder={t({ en: 'Password', id: 'Kata sandi' })}
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-ash-500 dark:text-ash-500 hover:text-ash-600 dark:hover:text-ash-300 transition-colors rounded-md focus:outline-none focus:ring-2 focus:ring-ash-400 dark:focus:ring-ash-500"
                    >
                      {showPassword ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
                    </button>
                  </div>

                  {isLoginMode && (
                    <div className="flex justify-end pt-1">
                      {/* Dulu ini `<a href="#">` yang tidak mengerjakan apa pun.
                          Sekarang ia benar-benar mengirim tautan pemulihan ke
                          email yang sedang diisi di atas. */}
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={isLoading}
                        className="text-xs font-medium text-ash-600 dark:text-ash-400 hover:text-ash-900 dark:hover:text-white transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ash-400 dark:focus:ring-ash-500 rounded-sm"
                      >
                        {t({ en: 'Forgot password?', id: 'Lupa kata sandi?' })}
                      </button>
                    </div>
                  )}

                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    disabled={isLoading}
                    className="relative w-full py-3.5 mt-2 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm overflow-hidden group shadow-sm transition-all duration-feedback disabled:opacity-70 disabled:cursor-not-allowed"
                  >
                    <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-move ease-in-out pointer-events-none"></div>

                    <div className="flex items-center justify-center gap-2">
                      {isLoading ? (
                        <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
                      ) : (
                        <>
                          <span>{isLoginMode ? t({ en: 'Sign In', id: 'Masuk' }) : t({ en: 'Get Started', id: 'Mulai' })}</span>
                          <ArrowRight size={16} strokeWidth={1.75} className="opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                        </>
                      )}
                    </div>
                  </motion.button>
                </form>

                <div className="mt-8 text-center">
                  <p className="text-sm text-ash-600 dark:text-ash-400 transition-colors duration-tint">
                    {isLoginMode
                      ? t({ en: "Don't have an account? ", id: 'Belum punya akun? ' })
                      : t({ en: 'Already have an account? ', id: 'Sudah punya akun? ' })}
                    <button
                      onClick={toggleMode}
                      className="text-ash-900 dark:text-white font-medium hover:text-ash-900 dark:hover:text-white hover:underline underline-offset-4 decoration-ash-400 transition-all focus:outline-none focus:ring-2 focus:ring-ash-400 dark:focus:ring-ash-500 rounded-sm"
                    >
                      {isLoginMode ? t({ en: 'Sign up', id: 'Daftar' }) : t({ en: 'Sign in', id: 'Masuk' })}
                    </button>
                  </p>
                </div>
              </>
            )}

          </div>

          {/* Di sini dulu tertulis "Protected by reCAPTCHA and subject to the
              Privacy Policy and Terms of Service", dengan ketiganya menunjuk
              href="#". Tidak ada reCAPTCHA di aplikasi ini dan kedua dokumen
              itu tidak pernah ada, jadi seluruh barisnya dihapus.

              Sekarang dokumennya sungguh ada, jadi tautannya kembali — tanpa
              bagian reCAPTCHA-nya. Letaknya di layar masuk bukan sekadar rapi:
              verifikasi OAuth Google menuntut tautan kebijakan privasi terlihat
              dari halaman depan aplikasi, dan bagi orang yang belum masuk,
              inilah halaman depannya. */}
          <p className="mt-6 text-center text-xs text-ash-500 dark:text-ash-500">
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
              Terms of Service
            </a>
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
        <Icon className="h-4 w-4 text-ash-500 dark:text-ash-500 group-focus-within:text-ash-700 dark:group-focus-within:text-ash-200 transition-colors duration-tint" />
      </div>
      <input
        {...props}
        className="w-full pl-10 pr-4 py-3.5 bg-ash-50/50 dark:bg-white/[0.03] border border-ash-200 dark:border-white/[0.08] rounded-xl text-sm text-ash-900 dark:text-white placeholder:text-ash-500 dark:placeholder:text-ash-500 focus:outline-none focus:ring-2 focus:ring-ash-900/15 dark:focus:ring-white/15 focus:border-ash-400 dark:focus:border-ash-500 focus:bg-white dark:focus:bg-white/[0.05] shadow-sm dark:shadow-none transition-all duration-feedback"
      />
    </div>
  );
}