// Rangka halaman publik: harga dan panduan.
//
// Keduanya dibuka orang yang BELUM punya akun, seringkali dari iklan. Yang
// harus ada di layar sejak detik pertama cuma dua: nama yang meyakinkan bahwa
// ia tidak salah alamat, dan jalan masuk. Sisanya isi halaman.
//
// LegalPage punya rangkanya sendiri dan sengaja tidak disatukan ke sini:
// tautan kembalinya menghitung jalan pulang klien ke galerinya, yang tidak
// berlaku di halaman mana pun selain dokumen hukum.

import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';
import LangToggle from './LangToggle';

export default function PageShell({
  themeChoice,
  cycleTheme,
  lang,
  onSelectLang,
  lebar = 'max-w-3xl',
  children,
}) {
  return (
    <div className="min-h-screen bg-ash-50 font-sans transition-colors duration-tint dark:bg-ash-950">
      <header className="sticky top-0 z-10 border-b border-ash-200/70 bg-ash-50/85 backdrop-blur dark:border-white/5 dark:bg-ash-950/85">
        <div className={`mx-auto flex ${lebar} items-center gap-3 px-5 py-3 sm:px-8`}>
          <a href="/" className="inline-flex items-center gap-2 text-ash-900 dark:text-white">
            <BrandMark size={22} title="PhotoFlow" />
            <span className="text-sm font-semibold tracking-tight">PhotoFlow</span>
          </a>

          <div className="ml-auto flex items-center gap-1.5">
            {onSelectLang && <LangToggle lang={lang} onSelect={onSelectLang} />}
            <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />
            <a
              href="/"
              className="ml-1 rounded-xl bg-ash-800 px-3.5 py-2 text-sm font-semibold text-white transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
            >
              {lang === 'id' ? 'Masuk' : 'Sign in'}
            </a>
          </div>
        </div>
      </header>

      <main className={`mx-auto ${lebar} px-5 pb-24 pt-10 sm:px-8`}>{children}</main>
    </div>
  );
}
