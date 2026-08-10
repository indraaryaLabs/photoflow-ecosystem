import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Pengaturan terang/gelap.
 *
 * Ada tiga keadaan, bukan dua: `system`, `light`, dan `dark`. Yang membedakan
 * `system` dari keduanya adalah **tidak adanya nilai tersimpan** — bukan sebuah
 * nilai bernama "system". Selama tidak ada yang tersimpan, aplikasi mengikuti
 * preferensi sistem operasi, termasuk saat preferensi itu berubah di tengah
 * halaman terbuka.
 *
 * Versi sebelumnya hanya punya dua keadaan dan menyimpan pilihannya pada setiap
 * render pertama: nilai awal dibaca dari preferensi sistem, lalu sebuah effect
 * langsung menuliskannya ke localStorage. Akibatnya preferensi sistem hanya
 * dihormati satu kali seumur hidup pemasangan — sejak kunjungan kedua, nilai
 * tersimpan itu selalu menang, padahal pemiliknya tidak pernah memilih apa pun.
 * Mengganti tema di OS setelah itu tidak berpengaruh sama sekali.
 *
 * Karena itu aturannya sekarang: localStorage **hanya** ditulis oleh tindakan
 * pengguna yang disengaja.
 */

export const STORAGE_KEY = 'theme';

/** Urutan saat tombol ditekan. Kembali ke `system` supaya keadaan itu bisa diraih lagi. */
const CYCLE = ['system', 'light', 'dark'];

const query = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** Pilihan yang tersimpan, atau 'system' kalau belum pernah memilih. */
export function readChoice() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    // localStorage bisa melempar di mode privat sebagian browser. Bukan alasan
    // untuk menggagalkan render — anggap saja belum pernah memilih.
    return 'system';
  }
}

/**
 * Terapkan tema ke elemen `html`.
 *
 * Satu-satunya tempat kelas `dark` disetel. Sebelumnya ada tiga: App menyetel
 * `documentElement`, sedangkan AdminLogin dan AdminDashboard membungkus dirinya
 * dengan `<div className={isDark ? 'dark' : ''}>` — dua mekanisme yang bisa
 * berselisih, dan yang kedua tidak pernah mewarnai `body` di belakangnya.
 *
 * `color-scheme` ikut disetel supaya scrollbar, kotak isian, dan menu bawaan
 * browser mengikuti tema yang sama.
 */
export function applyResolved(resolved) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

// ── Preferensi sistem sebagai sumber di luar React ──────────
//
// Dibaca lewat useSyncExternalStore, bukan useState + useEffect. Bedanya bukan
// gaya: menyalin nilai dari luar ke dalam state berarti render pertama memakai
// nilai lama, lalu sebuah effect memicu render kedua untuk membetulkannya.
// useSyncExternalStore membaca nilainya saat render, jadi tidak pernah ada
// render yang salah, dan tidak ada setState di dalam effect.

function subscribeSystem(onChange) {
  const mq = query();
  if (!mq) return () => {};
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

const systemPrefersDark = () => query()?.matches ?? false;

// Saat dirender di server tidak ada preferensi yang bisa dibaca; terang adalah
// tebakan yang aman dan sepadan dengan skrip di index.html.
const systemPrefersDarkOnServer = () => false;

/**
 * Hook tema untuk komponen.
 *
 * Mengembalikan pilihan mentah (`choice`) untuk menggambar tombol, tema yang
 * berlaku (`resolved`) untuk hal-hal yang perlu tahu gelap atau terang, dan
 * `cycle` untuk tombolnya.
 */
export function useTheme() {
  const [choice, setChoice] = useState(readChoice);
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    systemPrefersDark,
    systemPrefersDarkOnServer,
  );

  // Dihitung saat render, bukan disimpan. Tidak ada keadaan kedua yang bisa
  // menyimpang dari `choice`.
  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  // Menyentuh DOM dan localStorage memang pekerjaan effect: keduanya di luar
  // React.
  useEffect(() => {
    applyResolved(resolved);
    try {
      if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Tidak bisa menyimpan bukan alasan untuk tidak menerapkan temanya.
    }
  }, [choice, resolved]);

  // Perubahan dari tab lain pada situs yang sama. Tanpa ini, dua tab yang
  // terbuka bersamaan bisa menampilkan tema berbeda sampai salah satunya
  // dimuat ulang.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setChoice(readChoice());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const cycle = useCallback(() => {
    setChoice((current) => CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]);
  }, []);

  return { choice, resolved, isDark: resolved === 'dark', cycle, setChoice };
}

/** Label tombol, dipakai sebagai `title` dan `aria-label`. */
export function themeLabel(choice) {
  if (choice === 'light') return 'Tema: terang. Klik untuk gelap.';
  if (choice === 'dark') return 'Tema: gelap. Klik untuk mengikuti sistem.';
  return 'Tema: mengikuti sistem. Klik untuk terang.';
}
