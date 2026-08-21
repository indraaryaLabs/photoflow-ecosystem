// Navigasi tiga halaman publik: masuk, harga, panduan.
//
// Satu komponen, bukan tiga salinan. Sebelumnya layar masuk menyimpan nav-nya
// sendiri sementara /pricing dan /guide memakai punya PageShell, dan keduanya
// menyimpang: yang satu menyembunyikan tautan di bawah breakpoint sm dan
// menggantinya dengan baris kaki, yang lain tidak. Hasilnya persis yang
// dikeluhkan — di ponsel tautannya kembali ke tempat lamanya.
//
// Yang membuat nav ini muat di layar 320px tanpa menyembunyikan apa pun:
// kata "PhotoFlow" yang disembunyikan, bukan tautannya. Lambangnya sudah
// cukup mengenali halaman, sedangkan tautan yang hilang berarti fitur yang
// hilang.

import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';
import LangToggle from './LangToggle';
import { GUIDE_PATH, PRICING_PATH } from '../lib/pricing';

export default function PublicNav({
  themeChoice,
  cycleTheme,
  lang,
  onSelectLang,
  t,
  // Tombol masuk dilewati pada layar masuk itu sendiri: tombol yang menunjuk
  // ke halaman yang sedang dibuka hanya membuat orang mengira ada tempat lain
  // yang belum ia lihat.
  showSignIn = true,
}) {
  const tautan = 'font-medium text-ash-600 transition-colors hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100';

  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <a href="/" className="inline-flex shrink-0 items-center gap-2 text-ash-900 dark:text-white">
        <BrandMark size={22} title="PhotoFlow" />
        <span className="hidden text-sm font-semibold tracking-tight sm:inline">
          PhotoFlow
        </span>
      </a>

      <nav className="flex items-center gap-3 text-[13px] sm:gap-4 sm:text-sm">
        <a href={PRICING_PATH} className={tautan}>
          {t({ en: 'Pricing', id: 'Harga' })}
        </a>
        <a href={GUIDE_PATH} className={tautan}>
          {t({ en: 'Guide', id: 'Panduan' })}
        </a>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <LangToggle lang={lang} onSelect={onSelectLang} />
        <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />

        {showSignIn && (
          <a
            href="/"
            className="ml-0.5 rounded-xl bg-ash-800 px-3 py-2 text-[13px] font-semibold text-white transition-colors duration-tint hover:bg-ash-900 sm:px-3.5 sm:text-sm dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            {t({ en: 'Sign in', id: 'Masuk' })}
          </a>
        )}
      </div>
    </div>
  );
}
