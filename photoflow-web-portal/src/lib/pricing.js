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

export const PRICING_PATH = '/pricing';
export const GUIDE_PATH = '/guide';

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
  // Pesan pembukanya berbahasa Indonesia meski halamannya berbahasa Inggris,
  // dan itu bukan kelalaian: yang membaca pesan ini bukan pengunjung melainkan
  // Anda, di WhatsApp, dalam percakapan yang akan berlanjut dalam bahasa
  // Indonesia.
  const pesan = paket
    ? `Halo, saya mau berlangganan PhotoFlow paket ${paket}.`
    : 'Halo, saya mau tanya tentang PhotoFlow.';
  return `https://wa.me/${SALES_WHATSAPP}?text=${encodeURIComponent(pesan)}`;
}

/**
 * Rp 99.000 — titik sebagai pemisah ribuan, seperti kebiasaan di Indonesia.
 *
 * Mata uangnya tetap rupiah walau halamannya berbahasa Inggris. Yang membayar
 * membayar dalam rupiah; menampilkan angka lain hanya menambah satu langkah
 * konversi yang harus dikerjakan pembaca dan satu peluang salah paham.
 */
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
    // id TIDAK sama dengan name. Yang tersimpan di database dan diterima API
    // adalah id; nama boleh berganti tanpa menyentuh satu pun baris langganan
    // yang sudah terjual.
    id: 'free',
    name: 'Solo',
    tagline: 'For trying it out, and for a shoot or two a month.',
    galleries: 3,
    prices: null,
    features: [
      '3 galleries per month',
      'Photos stay in your own Google Drive',
      'Clients pick without an account',
      'Selection list ready to paste into Lightroom',
    ],
    // Disebut sebagai batasan, bukan disembunyikan. Orang yang baru tahu
    // setelah kliennya melihat merek orang lain di galerinya akan marah, dan
    // ia benar.
    limits: ['Galleries carry PhotoFlow branding, not your studio name'],
  },
  {
    id: 'freelance',
    name: 'Pro',
    tagline: 'For 2-3 clients a week.',
    galleries: 20,
    popular: true,
    prices: [
      { months: 3, amount: 99000 },
      { months: 6, amount: 179000 },
    ],
    features: [
      '20 galleries per month',
      'Your studio name on client galleries, not PhotoFlow',
      'Everything in Solo',
    ],
    limits: [],
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'For vendors and agencies running several events at once.',
    galleries: -1,
    prices: [
      { months: 3, amount: 249000 },
      { months: 6, amount: 449000 },
    ],
    features: [
      'Unlimited galleries',
      'Your studio name on client galleries',
      'Everything in Pro',
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
  name: 'Founding',
  bonuses: [
    { pay: 3, get: 5 },
    { pay: 6, get: 9 },
  ],
};
