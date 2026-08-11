import { Monitor, Moon, Sun } from 'lucide-react';
import { themeLabel } from '../lib/theme';
import { cn } from '../lib/utils';

/**
 * Tombol tema tiga keadaan: mengikuti sistem → terang → gelap → mengikuti sistem.
 *
 * Ikonnya menunjukkan **pilihan**, bukan tema yang sedang tampak. Itu perbedaan
 * yang penting: saat pilihannya "mengikuti sistem", yang perlu diketahui
 * pemiliknya bukan bahwa layarnya sedang gelap — ia sudah melihat itu —
 * melainkan bahwa aplikasi sedang menuruti sistemnya.
 *
 * Tombol tema dulu digambar terpisah di tiga tempat dengan ukuran ikon yang
 * berbeda-beda. Sekarang satu komponen, satu ukuran.
 */
export default function ThemeToggle({ choice, onCycle, className }) {
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  const label = themeLabel(choice);

  return (
    <button
      type="button"
      onClick={onCycle}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg',
        'text-ash-600 dark:text-ash-400',
        'hover:bg-ash-100 hover:text-ash-900',
        'dark:hover:bg-white/5 dark:hover:text-ash-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ash-400',
        'dark:focus-visible:ring-ash-500 transition-colors',
        className,
      )}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}
