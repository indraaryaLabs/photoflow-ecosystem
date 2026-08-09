/**
 * Deteksi tautan pemulihan password — ditangkap saat modul ini dimuat.
 *
 * Supabase mengembalikan pemiliknya ke aplikasi dengan token pemulihan di
 * fragment URL: `#access_token=...&type=recovery`. Bersamaan dengan itu
 * supabase-js membuat sesi yang sah, sehingga tanpa penanda terpisah aplikasi
 * menyimpulkan orangnya sudah login dan langsung melemparnya ke dashboard —
 * layar penggantian password tidak pernah muncul.
 *
 * Waktu pembacaannya penting. supabase-js menghapus fragment itu dari URL
 * segera setelah memprosesnya, dan pemrosesan itu terjadi saat klien dibuat.
 * Karena `lib/supabase.js` mengimpor berkas ini sebelum memanggil
 * `createClient`, urutan modul menjamin nilai di bawah dibaca selagi fragment
 * masih ada.
 *
 * Event `PASSWORD_RECOVERY` sendiri tidak cukup dijadikan satu-satunya sumber:
 * ia dipancarkan selama inisialisasi klien, yang bisa selesai sebelum komponen
 * sempat memasang listener-nya.
 */
function detect() {
  if (typeof window === 'undefined') return false;
  const fragment = window.location.hash.replace(/^#/, '');
  if (!fragment) return false;
  return new URLSearchParams(fragment).get('type') === 'recovery';
}

export const openedFromRecoveryLink = detect();

/**
 * Buang fragment dari URL tanpa memuat ulang halaman, supaya me-refresh
 * halaman tidak mengulang alur yang sudah selesai.
 */
export function clearUrlFragment() {
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
}
