/**
 * Susun foto jadi baris-baris setinggi seragam tanpa memotong satu pun.
 *
 * Galeri sebelumnya memaksa setiap foto ke petak `aspect-[2/3]` dan
 * `object-cover`. Artinya setiap foto lanskap dipotong menjadi potret, dan
 * setiap potret dipotong lebih sempit lagi. Untuk produk yang isinya karya
 * orang, itu kerusakan yang paling cepat disadari pemiliknya: komposisi yang
 * dia atur di kamera hilang sebelum kliennya sempat melihatnya.
 *
 * Cara yang dipakai Lightroom, Flickr, Google Photos, dan Pixieset adalah
 * "justified rows": tinggi tiap baris disesuaikan supaya total lebarnya persis
 * memenuhi wadah, sementara rasio tiap foto dipertahankan apa adanya.
 *
 * Rumusnya sederhana. Untuk foto dengan tinggi seragam h, lebar masing-masing
 * adalah rasio*h, jadi lebar total satu baris adalah h*Σrasio ditambah jarak
 * antarfoto. Menyamakan itu dengan lebar wadah memberi tinggi barisnya:
 *
 *     h = (lebarWadah - jarak*(n-1)) / Σrasio
 *
 * Foto ditumpuk ke dalam baris sampai tingginya turun melewati tinggi target,
 * lalu baris itu ditutup.
 */

/**
 * @param {Array<{aspect?: number}>} photos  rasio lebar/tinggi; 1 bila belum diketahui
 * @param {number} containerWidth  lebar wadah dalam piksel
 * @param {number} targetHeight    tinggi baris yang dituju
 * @param {number} gap             jarak antarfoto dalam piksel
 * @returns {Array<Array<{photo: object, width: number, height: number}>>}
 */
export function buildRows(photos, containerWidth, targetHeight, gap = 8) {
  if (!photos.length || containerWidth <= 0) return [];

  const rows = [];
  let baris = [];
  let jumlahRasio = 0;

  const tinggiBaris = (n, rasio) => (containerWidth - gap * (n - 1)) / rasio;

  const tutup = (isiBaris, rasioBaris, penuh) => {
    // Baris terakhir tidak boleh diregangkan memenuhi lebar wadah. Kalau
    // isinya cuma satu foto, meregangkannya berarti foto itu tampil raksasa
    // sendirian -- cacat khas galeri justified yang dikerjakan setengah jalan.
    const h = penuh
      ? tinggiBaris(isiBaris.length, rasioBaris)
      : Math.min(targetHeight, tinggiBaris(isiBaris.length, rasioBaris));

    const tinggi = Math.round(h);
    const petak = isiBaris.map((foto) => ({
      photo: foto,
      width: Math.round((foto.aspect || 1) * h),
      height: tinggi,
    }));

    // Sisa pembulatan dibebankan ke foto terakhir.
    //
    // Lebar dibulatkan satu per satu, dan lebar wadah hampir tidak pernah
    // bilangan bulat, jadi jumlahnya meleset satu-dua piksel dari lebar wadah.
    // Melesetnya kecil, tapi terlihat: tepi kanan tiap baris berhenti di
    // tempat yang sedikit berbeda, dan pada deretan baris itu terbaca sebagai
    // tepi yang bergetar.
    if (penuh && petak.length) {
      const terpakai = petak.reduce((n, k) => n + k.width, 0) + gap * (petak.length - 1);
      petak[petak.length - 1].width += Math.round(containerWidth) - terpakai;
    }

    rows.push(petak);
  };

  for (const foto of photos) {
    const rasio = foto.aspect || 1;
    baris.push(foto);
    jumlahRasio += rasio;

    if (tinggiBaris(baris.length, jumlahRasio) < targetHeight) {
      tutup(baris, jumlahRasio, true);
      baris = [];
      jumlahRasio = 0;
    }
  }

  if (baris.length) tutup(baris, jumlahRasio, false);
  return rows;
}

/** Tinggi baris menurut pilihan kerapatan. */
export const DENSITIES = {
  large: { label: 'Large', height: 380 },
  medium: { label: 'Medium', height: 260 },
  small: { label: 'Small', height: 170 },
};

export const DEFAULT_DENSITY = 'medium';
