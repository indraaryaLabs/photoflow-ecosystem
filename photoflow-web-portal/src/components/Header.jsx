import { Camera, Moon, Sun } from 'lucide-react';

const Header = ({ project, isDark, toggleTheme }) => (
  <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-white/70 dark:bg-zinc-950/70 border-b border-zinc-200 dark:border-zinc-800/50 transition-colors duration-300">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/20 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
          <Camera className="w-4 h-4" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-zinc-900 dark:text-white tracking-tight">PhotoFlow</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">{project.client_name}</p>
        </div>
      </div>
      <button
        onClick={toggleTheme}
        className="p-2 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-zinc-600 dark:text-zinc-300"
        aria-label="Toggle Theme"
      >
        {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
      </button>
    </div>
  </header>
);

export default Header;
