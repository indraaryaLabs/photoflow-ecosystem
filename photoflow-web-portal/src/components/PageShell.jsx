// Rangka halaman publik: harga dan panduan.
//
// Keduanya dibuka orang yang BELUM punya akun, seringkali dari iklan. Yang
// harus ada di layar sejak detik pertama cuma dua: nama yang meyakinkan bahwa
// ia tidak salah alamat, dan jalan masuk. Sisanya isi halaman.
//
// Navigasinya datang dari PublicNav, yang dipakai layar masuk juga — supaya
// ketiga halaman publik tidak dapat menyimpang satu sama lain di ukuran layar
// mana pun.
//
// LegalPage punya rangkanya sendiri dan sengaja tidak disatukan ke sini:
// tautan kembalinya menghitung jalan pulang klien ke galerinya, yang tidak
// berlaku di halaman mana pun selain dokumen hukum.

import PublicNav from './PublicNav';

export default function PageShell({
  themeChoice,
  cycleTheme,
  lang,
  onSelectLang,
  t,
  lebar = 'max-w-3xl',
  children,
}) {
  return (
    <div className="min-h-screen bg-ash-50 font-sans transition-colors duration-tint dark:bg-ash-950">
      <header className="sticky top-0 z-10 border-b border-ash-200/70 bg-ash-50/85 backdrop-blur dark:border-white/5 dark:bg-ash-950/85">
        <div className={`mx-auto ${lebar} px-5 py-3 sm:px-8`}>
          <PublicNav
            themeChoice={themeChoice}
            cycleTheme={cycleTheme}
            lang={lang}
            onSelectLang={onSelectLang}
            t={t}
          />
        </div>
      </header>

      <main className={`mx-auto ${lebar} px-5 pb-24 pt-10 sm:px-8`}>{children}</main>
    </div>
  );
}
