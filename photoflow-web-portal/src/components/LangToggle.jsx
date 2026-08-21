// Sakelar bahasa EN/ID.
//
// Dibuat sebagai dua pilihan yang keduanya terlihat, bukan satu tombol yang
// berganti label saat ditekan. Dengan dua bahasa, menyembunyikan yang tidak
// aktif berarti orang harus menekannya lebih dulu untuk tahu pilihan itu ada;
// menampilkannya berdampingan membuat keduanya jadi tawaran, bukan tebakan.

import { LANGS, LANG_LABEL } from '../lib/lang';

export default function LangToggle({ lang, onSelect }) {
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-full border border-ash-200 bg-white p-0.5 text-xs font-semibold dark:border-white/10 dark:bg-white/[0.03]"
    >
      {LANGS.map((kode) => {
        const aktif = kode === lang;
        return (
          <button
            key={kode}
            type="button"
            onClick={() => onSelect(kode)}
            aria-pressed={aktif}
            className={`rounded-full px-2.5 py-1 transition-colors duration-tint ${
              aktif
                ? 'bg-ash-800 text-white dark:bg-ash-100 dark:text-ash-950'
                : 'text-ash-500 hover:text-ash-800 dark:text-ash-400 dark:hover:text-ash-200'
            }`}
          >
            {LANG_LABEL[kode]}
          </button>
        );
      })}
    </div>
  );
}
