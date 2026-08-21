// Panggilan ke rute /api/admin.
//
// Seluruh rute di bawah dijaga RequireAdmin di backend, yang membalas 404 —
// bukan 403 — untuk siapa pun yang bukan administrator, termasuk saat
// ADMIN_USER_IDS belum disetel sama sekali. Itu disengaja: rute admin tidak
// perlu memberi tahu orang asing bahwa ia ada.
//
// Akibatnya bagi frontend: 404 di sini berarti "Anda bukan admin", bukan
// "endpoint-nya hilang". Halaman admin memakainya persis begitu.

import { API_BASE } from './api';

async function panggil(token, jalur, opsi = {}) {
  const res = await fetch(`${API_BASE}/api/admin${jalur}`, {
    ...opsi,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opsi.body ? { 'Content-Type': 'application/json' } : {}),
      ...opsi.headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}

/**
 * Memeriksa apakah pemanggil administrator.
 *
 * Memakai endpoint yang tidak mengubah apa pun. Sebelum ada /ping, satu-satunya
 * cara mengetahuinya adalah dengan mencoba membangkitkan kode dan melihat
 * apakah ditolak — mengubah keadaan hanya untuk memeriksa izin.
 */
export async function cekAdmin(token) {
  try {
    const { ok } = await panggil(token, '/ping');
    return ok;
  } catch {
    // Jaringan gagal bukan berarti bukan admin. Dijawab false supaya halaman
    // tidak terbuka setengah jalan; pemakainya bisa memuat ulang.
    return false;
  }
}

/** Kode tebus terbaru, beserta status pemakaiannya. */
export async function ambilKode(token) {
  const { ok, body } = await panggil(token, '/codes');
  return ok ? body?.codes ?? [] : null;
}

/** Membangkitkan sejumlah kode sekaligus. */
export async function buatKode(token, { plan, months, count, note }) {
  const { ok, body } = await panggil(token, '/codes', {
    method: 'POST',
    body: JSON.stringify({ plan, months, count, note }),
  });
  if (!ok) return { ok: false, error: body?.error || 'Could not generate the codes.' };
  return { ok: true, codes: body?.codes ?? [] };
}

/** Menyetel paket seorang user langsung, tanpa lewat kode. */
export async function setelLangganan(token, { user_id, plan, months }) {
  const { ok, body } = await panggil(token, '/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ user_id, plan, months }),
  });
  if (!ok) return { ok: false, error: body?.error || 'Could not set the subscription.' };
  return { ok: true, status: body };
}
