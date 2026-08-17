import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';

/**
 * Kepala galeri klien.
 *
 * Sampai sekarang tertulis "PhotoFlow" di sini — nama perkakasnya, bukan nama
 * orang yang mengerjakan fotonya. Bagi klien itu merek asing yang tidak pernah
 * ia dengar; bagi fotografer, satu-satunya halaman yang akan dibuka kliennya
 * dipinjamkan gratis kepada nama lain. Pesaing di kelas Pixieset dan Pic-Time
 * menjual persis kebalikannya: galeri yang tampak milik studionya.
 *
 * Nama studio hanya tampil kalau fotografer mengisinya. Kosong berarti kembali
 * ke "PhotoFlow", jadi fitur ini pilihan dan tidak menuntut siapa pun
 * menyiapkan apa-apa lebih dulu.
 *
 * Lambangnya tetap lambang PhotoFlow. Menggantinya menuntut unggahan berkas,
 * dan itu menuntut penyimpanan berkas yang belum ada di aplikasi ini. Lambang
 * netral di sebelah nama studio jauh lebih baik daripada nama studio yang
 * berdiri sendirian tanpa apa pun di kirinya.
 */
const Header = ({ project, themeChoice, cycleTheme }) => {
  const studio = project?.studio_name?.trim();

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-white/70 dark:bg-ash-950/70 border-b border-ash-200 dark:border-ash-800/50 transition-colors duration-tint">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-xl border border-ash-200 bg-ash-100 text-ash-700 dark:border-white/10 dark:bg-white/5 dark:text-ash-200 flex items-center justify-center">
            <BrandMark size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-ash-900 dark:text-white tracking-tight">
              {studio || 'PhotoFlow'}
            </h1>
            <p className="truncate text-xs text-ash-600 dark:text-ash-400 font-medium">
              {project.client_name}
            </p>
          </div>
        </div>
        <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />
      </div>
    </header>
  );
};

export default Header;
