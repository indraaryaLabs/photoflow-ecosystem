import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';

const Header = ({ project, themeChoice, cycleTheme }) => (
  <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-white/70 dark:bg-ash-950/70 border-b border-ash-200 dark:border-ash-800/50 transition-colors duration-tint">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl border border-ash-200 bg-ash-100 text-ash-700 dark:border-white/10 dark:bg-white/5 dark:text-ash-200 flex items-center justify-center">
          <BrandMark size={18} />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-ash-900 dark:text-white tracking-tight">PhotoFlow</h1>
          <p className="text-xs text-ash-600 dark:text-ash-400 font-medium">{project.client_name}</p>
        </div>
      </div>
      <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />
    </div>
  </header>
);

export default Header;
