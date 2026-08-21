import { useCallback, useEffect, useState } from 'react';

/**
 * Pilihan bahasa untuk halaman publik.
 *
 * Cakupannya SENGAJA sempit: halaman harga, panduan, dan layar masuk — surface
 * yang dilihat orang dari iklan, sebelum ia punya akun. Dashboard dan dokumen
 * hukum tetap satu bahasa; menerjemahkan ribuan string di baliknya adalah
 * pekerjaan lain, dan sakelar yang mengubah setengah aplikasi lebih
 * membingungkan daripada tidak ada sakelar.
 *
 * Bawaannya Inggris, sama seperti seluruh aplikasi. Yang tersimpan hanya kalau
 * orang MEMILIH Indonesia; selama belum memilih, tidak ada nilai di
 * localStorage dan bahasanya Inggris. Polanya sama seperti tema: localStorage
 * hanya ditulis oleh tindakan yang disengaja.
 */

export const STORAGE_KEY = 'lang';

/** Bahasa yang didukung. Menambah satu di sini tidak cukup — tiap kamus COPY
 *  di halaman harus punya kuncinya juga. */
export const LANGS = ['en', 'id'];

export const LANG_LABEL = { en: 'EN', id: 'ID' };

/** Bahasa tersimpan, atau 'en' kalau belum pernah memilih atau nilainya rusak. */
export function readLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(saved) ? saved : 'en';
  } catch {
    // localStorage melempar di mode privat sebagian peramban. Bukan alasan
    // menggagalkan render — anggap belum memilih.
    return 'en';
  }
}

/**
 * Hook bahasa untuk komponen halaman publik.
 *
 * Mengembalikan bahasa yang berlaku (`lang`), penyetel (`setLang`), dan
 * `t(kamus)` yang memilih cabang bahasa dari objek `{ en, id }`.
 */
export function useLang() {
  const [lang, setLangState] = useState(readLang);

  // Perubahan dari tab lain pada situs yang sama. Dua tab terbuka bersamaan
  // tidak boleh menampilkan bahasa berbeda sampai salah satunya dimuat ulang.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === STORAGE_KEY) setLangState(readLang());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLang = useCallback((next) => {
    if (!LANGS.includes(next)) return;
    setLangState(next);
    try {
      // Inggris adalah bawaan, jadi memilihnya berarti MENGHAPUS nilai, bukan
      // menuliskannya. Dengan begitu "belum memilih" dan "memilih Inggris"
      // tidak dapat dibedakan — dan memang tidak perlu.
      if (next === 'en') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Tidak bisa menyimpan bukan alasan mengabaikan pilihannya untuk sesi ini.
    }
  }, []);

  /**
   * Memilih cabang bahasa dari sebuah kamus.
   *
   * Jatuh ke Inggris kalau cabang bahasa yang diminta tidak ada, sehingga kunci
   * yang lupa diterjemahkan tetap tampil terbaca alih-alih kosong.
   */
  const t = useCallback((kamus) => (kamus?.[lang] ?? kamus?.en ?? ''), [lang]);

  return { lang, setLang, t };
}
