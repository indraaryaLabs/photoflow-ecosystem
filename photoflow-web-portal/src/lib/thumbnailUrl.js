/**
 * Menyesuaikan ukuran gambar yang diminta dari Google.
 *
 * Alamat thumbnail Drive membawa ukurannya di dalam alamat itu sendiri —
 * `=s220`, `=s1000`, atau `&sz=w800` untuk bentuk yang lain. Menggantinya
 * berarti meminta ukuran berbeda tanpa panggilan API tambahan, tanpa
 * penyimpanan tambahan, dan tanpa apa pun yang perlu disiapkan lebih dulu.
 *
 * Sebelum ini backend menyimpan satu ukuran untuk semua keperluan: `=s1000`,
 * dipilih supaya layar pratinjau cukup tajam. Alamat yang sama lalu dipakai
 * untuk petak grid selebar 250-370px. Akibatnya galeri 2.000 foto memindahkan
 * sekitar 140 MB — lebih besar daripada yang sanggup ditahan cache peramban,
 * sehingga menggulir jauh lalu kembali ke atas berarti mengunduh ulang dari
 * nol. Pada `=s400` jumlahnya sekitar 26 MB dan seluruhnya muat.
 *
 * Ukurannya ditentukan DI SINI, bukan di backend, dan itu disengaja: baris yang
 * sudah tersimpan di database masih membawa `=s1000`, dan galeri yang ada harus
 * ikut membaik tanpa menunggu sinkronisasi ulang.
 */

/** Sisi terpanjang yang diminta untuk satu petak grid. */
export const UKURAN_GRID = 400;

/** Dua kali lipatnya, untuk layar ber-DPR tinggi. */
export const UKURAN_GRID_2X = 800;

/**
 * Sisi terpanjang untuk layar pratinjau.
 *
 * 1600, bukan 2000: pada layar laptop 1440px yang fotonya dibatasi 85vh,
 * 1600 sudah melampaui yang dapat ditampilkan bahkan pada DPR 2 — sementara
 * berkasnya sekitar sepertiga lebih kecil.
 */
export const UKURAN_PRATINJAU = 1600;

/**
 * @param {string} url alamat thumbnail dari Drive
 * @param {number} px  sisi terpanjang yang diinginkan
 */
export function ubahUkuran(url, px) {
  if (!url) return url;

  // Bentuk lh3.googleusercontent.com/...=s1000 — kadang berakhiran "-c" yang
  // menandakan pemotongan tengah, dan akhiran itu harus dipertahankan.
  if (/=s\d+/.test(url)) return url.replace(/=s\d+(-c)?/, `=s${px}$1`);

  // Bentuk drive.google.com/thumbnail?id=...&sz=w800
  if (/[?&]sz=w\d+/.test(url)) return url.replace(/([?&]sz=w)\d+/, `$1${px}`);

  // Bentuk yang tidak dikenali dibiarkan apa adanya. Menebak-nebak di sini
  // berisiko menghasilkan alamat yang tidak dapat dimuat sama sekali, dan
  // gambar yang terlalu besar masih jauh lebih baik daripada gambar yang hilang.
  return url;
}

/** `srcset` untuk petak grid, supaya peramban sendiri yang memilih. */
export function srcsetGrid(url) {
  if (!url) return undefined;
  const satu = ubahUkuran(url, UKURAN_GRID);
  const dua = ubahUkuran(url, UKURAN_GRID_2X);
  // Alamat yang tidak dikenali menghasilkan dua nilai yang sama; srcset
  // berisi dua entri identik membingungkan peramban tanpa memberi apa pun.
  if (satu === dua) return undefined;
  return `${satu} 1x, ${dua} 2x`;
}
