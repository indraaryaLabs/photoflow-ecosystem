/**
 * Bungkus perubahan state supaya peramban menganimasikan perpindahannya.
 *
 * View Transitions API mengambil potret layar sebelum dan sesudah, mencocokkan
 * elemen yang memakai `view-transition-name` yang sama, lalu menganimasikan
 * satu ke yang lain. Untuk galeri ini artinya foto di dalam grid benar-benar
 * BERGERAK dan MEMBESAR menjadi layar pratinjau, bukan hilang lalu digantikan
 * gambar lain yang memudar masuk.
 *
 * Perbedaannya bukan hiasan: pratinjau yang muncul begitu saja menuntut orang
 * mencari sendiri foto mana yang sedang dibuka, dan setelah menutupnya, di
 * baris mana tadi ia berada. Perpindahan yang terlihat menjawab keduanya tanpa
 * satu kata pun.
 *
 * Dukungan peramban belum merata. Yang belum mendukung menjalankan perubahannya
 * langsung, tanpa animasi dan tanpa error — jadi tidak ada yang perlu
 * dinonaktifkan atau dideteksi di sisi pemanggil.
 */

/**
 * @param {() => void} ubah  perubahan state yang hendak dianimasikan
 */
export function withViewTransition(ubah) {
  // Dua penjaga, dan keduanya perlu.
  //
  // Yang pertama peramban yang belum mendukung. Yang kedua orang yang mematikan
  // animasi di sistemnya: View Transitions tidak menghormati
  // prefers-reduced-motion dengan sendirinya, dan animasi bawaannya adalah
  // silang-pudar seluruh layar — persis jenis gerakan besar yang ingin
  // dihindari orang yang menyetel preferensi itu.
  const kurangiGerak = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (typeof document.startViewTransition !== 'function' || kurangiGerak) {
    ubah();
    return;
  }

  document.startViewTransition(ubah);
}
