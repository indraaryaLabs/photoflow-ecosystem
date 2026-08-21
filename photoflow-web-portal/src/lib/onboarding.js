// Penanda "sudah pernah melihat sambutan".
//
// Disimpan per user id, bukan satu penanda untuk seluruh peramban. Satu laptop
// dipakai dua akun bukan keadaan langka — fotografer yang membuat akun kedua
// untuk studionya, atau komputer bersama di kantor vendor. Penanda global akan
// membuat akun kedua tidak pernah melihat sambutannya sama sekali.

const AWALAN = 'photoflow.guide-seen:';

function kunci(userId) {
  return AWALAN + (userId || 'anon');
}

/**
 * Apakah sambutan sudah pernah ditutup akun ini.
 *
 * Gagal membaca dijawab true, bukan false. Mode privat sebagian peramban
 * melempar di sini, dan pada keadaan itu penanda "sudah ditutup" tidak akan
 * pernah bisa tersimpan — sehingga menjawab false berarti sambutannya muncul
 * lagi pada setiap pemuatan halaman, persis perilaku yang paling mengganggu.
 */
export function sudahLihatPanduan(userId) {
  try {
    return localStorage.getItem(kunci(userId)) === '1';
  } catch {
    return true;
  }
}

/** Menandai sambutan sudah ditutup, supaya tidak muncul sendiri lagi. */
export function tandaiLihatPanduan(userId) {
  try {
    localStorage.setItem(kunci(userId), '1');
  } catch {
    // Tidak bisa menyimpan berarti tidak bisa dijanjikan "sekali saja". Tidak
    // ada yang bisa dikerjakan di sini; menutupnya tetap bekerja untuk sesi
    // yang sedang berjalan.
  }
}
