import { useCallback, useEffect, useState } from 'react';

/**
 * Routing sisi klien.
 *
 * Sebelum ini setiap perpindahan halaman di dalam aplikasi adalah MUAT ULANG
 * PENUH: `window.location.href = '/dashboard'` sesudah masuk,
 * `window.location.replace('/dashboard')` dari halaman depan,
 * `window.location.href = '/'` sesudah keluar. Setiap satu di antaranya
 * membuang seluruh aplikasi yang sudah berjalan lalu membangunnya dari nol —
 * mengunduh ulang HTML, mengurai ulang JavaScript, menjalankan ulang
 * pemeriksaan sesi, mengambil ulang semua datanya.
 *
 * Untuk aplikasi satu halaman, itu membayar ongkos termahal dari sebuah
 * aplikasi banyak halaman sambil tidak mendapat satu pun keuntungannya. Yang
 * paling terasa adalah sesudah menekan "Sign In": sesinya sudah ada di tangan,
 * dashboard-nya sudah bisa digambar, tapi yang terjadi justru halaman putih
 * sampai seluruh aplikasi selesai dibangun ulang.
 *
 * Yang dibutuhkan aplikasi ini hanya lima jalur dan tidak ada parameter jalur
 * sama sekali, jadi memasang pustaka router berarti menambah satu dependensi
 * beserta pembaruannya untuk pekerjaan yang muat dalam tiga puluh baris.
 */

function bacaLokasi() {
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

export function useRoute() {
  const [lokasi, setLokasi] = useState(bacaLokasi);

  // Tombol maju dan mundur peramban. Tanpa pendengar ini, riwayat berubah
  // sementara yang tergambar tetap layar yang lama — kerusakan khas routing
  // sisi klien yang dikerjakan setengah jalan.
  useEffect(() => {
    const onPop = () => setLokasi(bacaLokasi());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /**
   * @param {string} tujuan  jalur lengkap, mis. '/dashboard'
   * @param {{ganti?: boolean}} opsi  `ganti` menimpa entri riwayat saat ini,
   *   dipakai untuk pengalihan supaya tombol kembali tidak memantulkan orangnya
   *   ke jalur yang baru saja ditinggalkan.
   */
  const navigasi = useCallback((tujuan, { ganti = false } = {}) => {
    const sekarang = window.location.pathname + window.location.search + window.location.hash;
    if (tujuan === sekarang) return;

    window.history[ganti ? 'replaceState' : 'pushState']({}, '', tujuan);
    setLokasi(bacaLokasi());
    // Peramban memulihkan posisi gulir sendiri hanya untuk navigasi yang
    // sungguhan; pushState tidak menyentuhnya, jadi halaman baru akan terbuka
    // di tengah-tengah posisi halaman sebelumnya.
    window.scrollTo(0, 0);
  }, []);

  return { ...lokasi, navigasi };
}
