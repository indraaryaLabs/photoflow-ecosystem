// Alamat backend PhotoFlow.
//
// Sebelumnya nilai ini ditulis langsung di App.jsx dan AdminDashboard.jsx.
// Selain harus diubah di dua tempat, akibatnya `npm run dev` selalu memukul
// backend produksi — tidak ada cara menjalankan frontend terhadap backend lokal
// tanpa mengubah kode.
//
// Nilai default sengaja tetap menunjuk produksi supaya repo ini bisa di-clone
// lalu langsung dijalankan tanpa menyiapkan apa pun. Untuk mengarahkannya ke
// tempat lain, isi VITE_API_BASE di .env.
const DEFAULT_API_BASE = 'https://photoflow-backend.vercel.app';

export const API_BASE = (import.meta.env.VITE_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');

/** Bentuk URL lengkap ke sebuah endpoint backend. */
export function apiUrl(path) {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}
