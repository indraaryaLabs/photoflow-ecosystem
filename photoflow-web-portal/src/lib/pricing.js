// Daftar harga dan isi tiap paket.
//
// Satu-satunya tempat angka ini ditulis. Harga muncul di halaman harga, di
// panduan, dan cepat atau lambat di bahan iklan — angka yang diketik ulang di
// tiap tempat adalah angka yang suatu hari berbeda di salah satunya, dan yang
// berbeda soal harga tidak pernah dimaafkan pembeli.
//
// Batas galerinya HARUS sama dengan kuotaBulanan di
// photoflow-backend/models/billing.go. Backend yang menegakkan, halaman ini
// hanya menjanjikan; janji yang lebih besar dari penegakannya menghasilkan
// keluhan, yang lebih kecil menghasilkan pembeli yang merasa tertipu.

export const PRICING_PATH = '/harga';
export const GUIDE_PATH = '/panduan';

/**
 * Nomor WhatsApp penjualan, dalam format 62xxxxxxxxxx.
 *
 * Dibaca dari environment, tidak pernah ditulis di sini. Nomor pribadi tidak
 * boleh masuk ke repo publik: begitu ter-commit ia ada selamanya di riwayat
 * git, dan diambil pemanen nomor dalam hitungan hari.
 *
 * Kosong berarti tombolnya tidak digambar sama sekali — lebih baik tidak ada
 * tombol daripada tombol yang membuka percakapan ke nomor yang tidak ada.
 */
export const SALES_WHATSAPP = import.meta.env.VITE_SALES_WHATSAPP || '';

/** Tautan WhatsApp dengan pesan pembuka yang sudah terisi. */
export function tautanWhatsApp(paket) {
  if (!SALES_WHATSAPP) return '';
  const pesan = paket
    ? `Halo, saya mau berlangganan PhotoFlow paket ${paket}.`
    : 'Halo, saya mau tanya tentang PhotoFlow.';
  return `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(pesan)}`;
}

/** Rp 99.000 — titik sebagai pemisah ribuan, seperti kebiasaan di Indonesia. */
export function rupiah(angka) {
  return `Rp ${angka.toLocaleString('id-ID')}`;
}

/**
 * Harga per bulan, dibulatkan.
 *
 * Ditampilkan di samping harga paketnya karena itu angka yang benar-benar
 * dibandingkan orang. "Rp 179.000" terdengar besar sampai terbaca sebagai
 * Rp 30.000 sebulan — kira-kira sepersepuluh dari satu pemotretan wisuda.
 */
export function perBulan(harga, bulan) {
  return rupiah(Math.round(harga / bulan / 1000) * 1000);
}

export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Untuk mencoba, dan untuk yang sebulan cuma sekali dua kali.',
    galleries: 3,
    prices: null,
    features: [
      '3 galeri per bulan',
      'Foto tetap di Google Drive Anda',
      'Klien memilih tanpa perlu akun',
      'Daftar pilihan siap tempel ke Lightroom',
    ],
    // Disebut sebagai batasan, bukan disembunyikan. Orang yang baru tahu
    // setelah kliennya melihat merek orang lain di galerinya akan marah, dan
    // ia benar.
    limits: ['Galeri memakai merek PhotoFlow, bukan nama studio Anda'],
  },
  {
    id: 'freelance',
    name: 'Freelance',
    tagline: 'Untuk yang jalan 2-3 klien seminggu.',
    galleries: 20,
    popular: true,
    prices: [
      { months: 3, amount: 99000 },
      { months: 6, amount: 179000 },
    ],
    features: [
      '20 galeri per bulan',
      'Nama studio Anda di galeri klien, bukan PhotoFlow',
      'Semua yang ada di paket Free',
    ],
    limits: [],
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'Untuk vendor dan agensi yang mengerjakan banyak acara sekaligus.',
    galleries: -1,
    prices: [
      { months: 3, amount: 249000 },
      { months: 6, amount: 449000 },
    ],
    features: [
      'Galeri tanpa batas',
      'Nama studio Anda di galeri klien',
      'Semua yang ada di paket Freelance',
    ],
    limits: [],
  },
];

/**
 * Promo perintis.
 *
 * Bentuknya bulan tambahan, bukan potongan harga, dan itu disengaja. Diskon
 * persen menurunkan harga yang diingat pembeli, sehingga perpanjangan pertama
 * terasa seperti kenaikan harga — penyebab churn yang paling mudah dihindari.
 * Bulan tambahan memberi nilai yang sama tanpa menyentuh harga daftar.
 *
 * Habis berarti habis. Kelangkaan yang ternyata tidak langka mengajari orang
 * bahwa batas waktu Anda tidak berarti apa-apa.
 */
export const PROMO = {
  slots: 10,
  name: 'Perintis',
  bonuses: [
    { pay: 3, get: 5 },
    { pay: 6, get: 9 },
  ],
};
