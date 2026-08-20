// Jalur dan tanggal dokumen hukum.
//
// Dipisah dari komponennya karena tiga tempat berbeda perlu tahu jalurnya —
// routing di App, tautan di layar masuk, dan tautan di kaki galeri klien — dan
// jalur yang diketik ulang di tiap tempat adalah jalur yang cepat atau lambat
// berbeda di salah satunya.
export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';

// Tanggal berlaku. Ditulis satu kali dan dipakai kedua dokumen supaya keduanya
// tidak pernah mengaku berlaku sejak tanggal yang berbeda.
export const EFFECTIVE_DATE = '20 August 2026';

// Alamat kontak.
//
// Wajib ada sebelum aplikasi ini diajukan ke verifikasi OAuth Google: pengulas
// mereka membaca kebijakan privasi dan mencari cara menghubungi pemiliknya.
//
// Dibaca dari environment, bukan ditulis di sini, karena alamat pribadi tidak
// boleh masuk ke repo. Selama belum disetel, dokumen mengarahkan orang ke
// halaman issue repositori — kanal yang sungguh-sungguh terbaca, bukan alamat
// karangan yang memantulkan setiap email yang dikirim ke sana.
export const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || '';
export const CONTACT_FALLBACK_URL =
  'https://github.com/indraaryaLabs/photoflow-ecosystem/issues';

// ── Jalan kembali dari halaman hukum ke galeri klien ─────────────────
//
// Tautan "Back to PhotoFlow" dulu menunjuk "/" secara mati. Untuk fotografer
// itu benar; untuk KLIEN itu jalan buntu. Klien membuka galerinya lewat magic
// link, tidak punya akun, dan tidak punya apa pun di "/" — ia mendarat di layar
// masuk yang tak bisa dilewatinya, dan satu-satunya jalan pulang adalah mencari
// ulang tautan yang dikirim fotografernya lewat WhatsApp.
//
// Tokennya sengaja TIDAK dibawa di URL halaman hukum. Halaman itu menautkan ke
// situs luar, dan URL yang memuat token akan ikut terkirim sebagai Referer.
// Tautan luarnya memang sudah ber-rel="noreferrer", tapi bertumpu pada satu
// atribut yang harus diingat setiap kali tautan baru ditambahkan bukan cara
// menjaga kunci galeri. sessionStorage tidak pernah ikut dalam permintaan
// jaringan mana pun.

const KUNCI_GALERI = 'photoflow.gallery-return';

// Token magic link 16 byte heksadesimal. Pola ini dipakai sebagai penjaga saat
// MEMBACA, bukan hanya saat menulis: nilai yang tersimpan hanya boleh berubah
// menjadi jalur relatif satu bentuk itu saja, sehingga tidak ada isi
// sessionStorage — dari mana pun asalnya — yang bisa mengubah tautan ini jadi
// pengalihan ke situs lain.
const POLA_TOKEN = /^[A-Za-z0-9_-]{1,128}$/;

// Penanda pratinjau ikut disimpan, dan itu bukan kelengkapan kosmetik.
// Fotografer mengintip galerinya sendiri lewat ?token=x&preview=1, dan flag
// itulah yang membuat kunjungannya tidak dicatat sebagai kunjungan klien.
// Tombol kembali yang membuangnya akan menandai first_viewed_at atas nama klien
// yang belum membuka apa pun — dashboard lalu berhenti menampilkan "Link not
// opened yet" untuk galeri yang memang belum pernah dibuka.
const AKHIRAN_PRATINJAU = ':preview';

/** Catat galeri yang sedang dibuka, supaya halaman hukum tahu jalan pulangnya. */
export function ingatGaleri(token, pratinjau = false) {
  if (!token || !POLA_TOKEN.test(token)) return;
  try {
    sessionStorage.setItem(KUNCI_GALERI, pratinjau ? token + AKHIRAN_PRATINJAU : token);
  } catch {
    // Mode privat sebagian peramban melempar di sini. Tautannya cuma kembali
    // menunjuk "/", persis seperti sebelumnya — tidak ada yang rusak.
  }
}

/** Lupakan galerinya. Dipakai saat fotografer masuk lewat dashboard. */
export function lupakanGaleri() {
  try {
    sessionStorage.removeItem(KUNCI_GALERI);
  } catch {
    // Tidak bisa menghapus berarti tidak ada yang perlu dijamin di sini.
  }
}

/**
 * Alamat tujuan tombol kembali di halaman hukum.
 *
 * Selalu jalur relatif berawalan "/", tidak pernah alamat absolut, sehingga
 * tidak dapat menjadi pengalihan terbuka.
 */
export function alamatKembali() {
  try {
    const tersimpan = sessionStorage.getItem(KUNCI_GALERI);
    if (!tersimpan) return '/';

    const pratinjau = tersimpan.endsWith(AKHIRAN_PRATINJAU);
    const token = pratinjau
      ? tersimpan.slice(0, -AKHIRAN_PRATINJAU.length)
      : tersimpan;

    // Pemeriksaan terjadi di sini, saat DIBACA, bukan hanya saat ditulis.
    if (!POLA_TOKEN.test(token)) return '/';
    return pratinjau ? `/?token=${token}&preview=1` : `/?token=${token}`;
  } catch {
    return '/';
  }
}
