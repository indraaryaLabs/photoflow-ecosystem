/**
 * Salinan daftar project terakhir, disimpan di peramban.
 *
 * Dashboard selalu dibuka dengan rangka abu-abu lebih dulu, lalu menunggu satu
 * perjalanan jaringan sebelum ada isinya. Perjalanan itu tidak bisa
 * dihilangkan — datanya memang ada di server — tapi MENUNGGUNYA bisa. Daftar
 * yang sama hampir selalu muncul lagi persis seperti terakhir kali dilihat,
 * jadi menampilkannya seketika lalu memperbaruinya di belakang layar membuat
 * dashboard terasa langsung ada, tanpa satu pun kebohongan yang bertahan lebih
 * dari sekejap.
 *
 * Ini pola stale-while-revalidate, dan batasnya ditanggung secara sadar: yang
 * tampil pada frame pertama bisa saja tertinggal beberapa detik. Untuk daftar
 * project milik sendiri, itu jauh lebih baik daripada layar kosong.
 *
 * Disimpan PER PENGGUNA. Tanpa itu, satu perangkat yang dipakai dua akun akan
 * memperlihatkan project orang lain sekejap sebelum dibetulkan — sekejap yang
 * tetap saja kebocoran.
 */

const AWALAN = 'photoflow.projects.';

// Umur maksimum salinan. Lebih tua dari ini, layar rangka lebih jujur daripada
// daftar yang mungkin sudah tidak menyerupai kenyataan sama sekali.
const UMUR_MAKS = 24 * 60 * 60 * 1000;

function kunci(userId) {
  return AWALAN + userId;
}

export function bacaCache(userId) {
  if (!userId) return null;
  try {
    const mentah = window.localStorage.getItem(kunci(userId));
    if (!mentah) return null;

    const { pada, data } = JSON.parse(mentah);
    if (!Array.isArray(data) || Date.now() - pada > UMUR_MAKS) return null;
    return data;
  } catch {
    return null;
  }
}

export function tulisCache(userId, projects) {
  if (!userId || !Array.isArray(projects)) return;
  try {
    window.localStorage.setItem(
      kunci(userId),
      JSON.stringify({ pada: Date.now(), data: projects }),
    );
  } catch {
    // Penyimpanan penuh atau diblokir. Dashboard tetap bekerja penuh; yang
    // hilang hanya kecepatan tampil pada kunjungan berikutnya.
  }
}

/** Dipanggil saat keluar: salinan project tidak boleh tertinggal untuk akun lain. */
export function hapusCache(userId) {
  if (!userId) return;
  try {
    window.localStorage.removeItem(kunci(userId));
  } catch {
    // Tidak ada yang bisa dikerjakan, dan tidak ada yang rusak karenanya.
  }
}
