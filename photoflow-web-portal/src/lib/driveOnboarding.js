/**
 * Penanda "sudah pernah ditawari menghubungkan Google Drive".
 *
 * Dipakai untuk membawa fotografer baru langsung ke layar persetujuan Google
 * begitu ia pertama kali masuk, tanpa harus mencari tombolnya sendiri.
 *
 * Penandanya wajib ada, bukan kemewahan. Tanpa itu, orang yang menekan "Batal"
 * di layar Google akan dilempar ke sana lagi setiap kali membuka dashboard —
 * terkurung dalam lingkaran yang tidak bisa ia keluari.
 *
 * Karena itu penandanya dipasang SEBELUM berpindah ke Google, bukan sesudah
 * kembali: yang perlu diingat adalah "sudah pernah ditawari", dan itu benar
 * baik ketika tawarannya diterima maupun ditolak.
 *
 * Disimpan per user id, bukan satu penanda global, supaya dua akun yang dipakai
 * bergantian di satu peramban tidak saling menghapus jatah tawarannya.
 *
 * localStorage memang hanya berlaku di satu peramban. Kalau seseorang pindah
 * peramban ia akan ditawari sekali lagi, dan itu dapat diterima: hasilnya
 * paling buruk adalah satu tawaran ekstra, bukan kehilangan apa pun. Menyimpan
 * ini di database akan lebih tepat, tapi menuntut kolom dan endpoint baru untuk
 * masalah yang akibatnya sekecil itu.
 */

const AWALAN = 'photoflow.drive-prompted.';

export function sudahDitawari(userId) {
  if (!userId) return true; // Tanpa identitas, jangan tawarkan apa pun.
  try {
    return localStorage.getItem(AWALAN + userId) === '1';
  } catch {
    // localStorage bisa melempar di mode privat sebagian peramban. Anggap
    // sudah pernah ditawari: gagal dengan tidak melakukan apa-apa jauh lebih
    // baik daripada berisiko mengulang pengalihan tanpa henti.
    return true;
  }
}

export function tandaiSudahDitawari(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(AWALAN + userId, '1');
  } catch {
    // Tidak bisa menyimpan berarti tidak bisa menjamin ini hanya sekali.
    // Pemanggilnya sudah menangani itu lewat sudahDitawari() di atas.
  }
}
