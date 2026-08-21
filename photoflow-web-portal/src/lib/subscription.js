// Pembacaan keadaan langganan, dan penerjemahannya jadi kalimat.
//
// Dipisahkan dari komponen karena dipakai di dua tempat yang berjauhan: penanda
// kuota di kepala dashboard, dan dialog yang muncul ketika sebuah tindakan
// ditolak backend. Keduanya harus menyebut angka yang sama dengan kata yang
// sama; kalau tidak, orang mengira keduanya bicara tentang hal berbeda.

import { API_BASE } from './api';

/** Kuota tanpa batas, sesuai models.KuotaTakTerbatas di backend. */
export const TANPA_BATAS = -1;

// Nama yang DITAMPILKAN, terpisah dari id yang tersimpan di database.
//
// Kunci di kiri ('free', 'freelance', 'studio') adalah nilai kolom plan di
// tabel subscriptions dan nilai yang diterima /api/admin/subscriptions. Nilai
// itu TIDAK ikut berubah saat namanya diganti: baris langganan yang sudah
// terjual menyimpannya, dan mengganti id berarti setiap pelanggan lama
// tiba-tiba memegang paket yang tidak dikenal siapa pun — yang oleh
// KuotaBulanan diturunkan diam-diam ke kuota gratis.
export const NAMA_PAKET = {
  free: 'Solo',
  freelance: 'Pro',
  studio: 'Studio',
};

/** Nama paket yang layak dibaca, apa pun isi datanya. */
export function namaPaket(plan) {
  return NAMA_PAKET[plan] || 'Solo';
}

/**
 * Membaca keadaan langganan pemanggil.
 *
 * Mengembalikan null kalau gagal, bukan melempar. Penanda kuota adalah
 * keterangan tambahan di sudut layar — dashboard yang tidak bisa membacanya
 * harus tetap terbuka dan tetap bisa dipakai bekerja.
 */
export async function ambilLangganan(token) {
  try {
    const res = await fetch(`${API_BASE}/api/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Menebus kode langganan.
 *
 * Mengembalikan { ok, status, error } alih-alih melempar: pesan galat dari
 * backend sudah ditulis untuk dibaca orang ("Kode ini sudah pernah dipakai"),
 * dan menelannya jadi galat generik justru membuang keterangan terbaik yang
 * ada.
 */
export async function tebusKode(token, kode) {
  try {
    const res = await fetch(`${API_BASE}/api/subscription/redeem`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: kode }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, error: body?.error || 'That code could not be redeemed.' };
    }
    return { ok: true, status: body };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

/** "2 of 3 galleries" untuk paket berbatas, "4 galleries" untuk yang tidak. */
export function ringkasKuota(sub) {
  if (!sub) return '';
  if (sub.quota === TANPA_BATAS) {
    return `${sub.used} ${sub.used === 1 ? 'gallery' : 'galleries'} this month`;
  }
  return `${sub.used} of ${sub.quota} galleries this month`;
}

/**
 * Apakah sisanya sudah pantas diperingatkan.
 *
 * Satu galeri tersisa, bukan nol: peringatan yang baru muncul saat jatahnya
 * benar-benar habis datang tepat ketika sudah terlambat — biasanya di depan
 * klien yang sedang menunggu tautannya.
 */
export function perluDiperingatkan(sub) {
  if (!sub || sub.quota === TANPA_BATAS) return false;
  return typeof sub.remaining === 'number' && sub.remaining <= 1;
}

/** Tanggal berakhir dalam bentuk "21 Nov 2026". Kosong kalau tidak ada. */
export function tanggalBerakhir(sub) {
  if (!sub?.expires_at) return '';
  const d = new Date(sub.expires_at);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
