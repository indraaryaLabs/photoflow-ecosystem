/**
 * Menandai kiriman klien mana yang sudah pernah dibuka fotografer.
 *
 * Tidak ada pemberitahuan apa pun saat klien mengirim pilihannya: backend tidak
 * mengirim email, dan satu-satunya kabar bergantung pada klien menekan tombol
 * WhatsApp sesudahnya. Kalau ia lupa, fotografer tidak pernah tahu.
 *
 * Pemberitahuan sungguhan menuntut penyedia email, dan itu keputusan tersendiri
 * yang berbiaya. Yang bisa dikerjakan tanpa itu: membuat dashboard sendiri
 * mampu menunjukkan mana yang baru. Tanda "sudah saya lihat" disimpan di
 * peramban, bukan di database, karena itu catatan milik satu orang di satu
 * perangkat — bukan keadaan project.
 *
 * Nilai yang disimpan adalah waktu kiriman, bukan sekadar `true`. Kalau
 * fotografer membuka kembali pemilihan dan klien mengirim lagi, waktunya
 * berbeda dan kiriman kedua kembali ditandai baru.
 */

const KUNCI = 'photoflow.seen-submissions';

export function sudahDilihat() {
  try {
    const mentah = window.localStorage.getItem(KUNCI);
    if (!mentah) return {};
    const data = JSON.parse(mentah);
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

/** @returns {object} peta baru, untuk langsung dipakai sebagai state */
export function tandaiDilihat(projectId, submittedAt) {
  const peta = { ...sudahDilihat(), [projectId]: submittedAt ?? null };
  try {
    window.localStorage.setItem(KUNCI, JSON.stringify(peta));
  } catch {
    // Penyimpanan diblokir. Penandanya hilang saat halaman ditutup, dan itu
    // tidak merusak apa pun selain memunculkan lencana "New" sekali lagi.
  }
  return peta;
}

const AMBANG = [
  [60, 'just now', 0],
  [3600, 'minute', 60],
  [86400, 'hour', 3600],
  [604800, 'day', 86400],
];

/**
 * "just now" / "3 hours ago" / "2 days ago", atau tanggalnya kalau sudah lama.
 *
 * Sengaja tidak memakai Intl.RelativeTimeFormat: bentuknya di sini cuma empat,
 * dan aplikasi ini seluruhnya berbahasa Inggris — jadi pemuatan data lokal
 * tidak membeli apa pun.
 */
export function waktuRelatif(iso) {
  if (!iso) return '';
  const waktu = new Date(iso);
  if (Number.isNaN(waktu.getTime())) return '';

  const detik = (Date.now() - waktu.getTime()) / 1000;
  // Jam perangkat bisa mundur, dan "in -3 seconds" lebih membingungkan
  // daripada berguna.
  if (detik < 0) return 'just now';

  for (const [batas, satuan, pembagi] of AMBANG) {
    if (detik < batas) {
      if (!pembagi) return satuan;
      const n = Math.floor(detik / pembagi);
      return `${n} ${satuan}${n === 1 ? '' : 's'} ago`;
    }
  }
  return waktu.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
