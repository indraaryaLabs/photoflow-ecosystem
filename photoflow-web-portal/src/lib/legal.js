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
