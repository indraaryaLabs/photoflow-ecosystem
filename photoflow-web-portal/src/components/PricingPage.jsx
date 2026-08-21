// Halaman harga.
//
// Ditulis dalam bahasa Indonesia sementara antarmuka aplikasinya berbahasa
// Inggris, dan itu keputusan sadar, bukan kelalaian: halaman ini dibuka orang
// dari iklan, sebelum ia punya akun dan sebelum ia percaya apa pun. Fotografer
// lepas wisuda dan event lari di Indonesia tidak membandingkan harga dalam
// bahasa Inggris. Konsistensi bahasa di dalam aplikasi bisa diperbaiki
// kemudian; kalimat penjualan yang tidak dimengerti pembacanya tidak bisa
// diperbaiki oleh apa pun.

import { Check, Minus, MessageCircle } from 'lucide-react';

import PageShell from './PageShell';
import {
  GUIDE_PATH,
  PLANS,
  PROMO,
  SALES_WHATSAPP,
  perBulan,
  rupiah,
  tautanWhatsApp,
} from '../lib/pricing';
import { TERMS_PATH } from '../lib/legal';

export default function PricingPage({ themeChoice, cycleTheme }) {
  return (
    <PageShell themeChoice={themeChoice} cycleTheme={cycleTheme} lebar="max-w-5xl">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ash-900 dark:text-white sm:text-4xl">
          Harga PhotoFlow
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ash-600 dark:text-ash-400">
          Kirim satu tautan, klien memilih fotonya sendiri, Anda terima daftar
          nama berkas yang siap ditempel ke Lightroom. Foto tidak pernah keluar
          dari Google Drive Anda.
        </p>
      </div>

      {PROMO.slots > 0 && <Perintis />}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <KartuPaket key={plan.id} plan={plan} />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-ash-500 dark:text-ash-500">
        Harga dalam rupiah. Tidak ada perpanjangan otomatis dan tidak ada kartu
        yang disimpan — paket berhenti sendiri pada tanggalnya.
      </p>

      <CaraBerlangganan />
      <Pertanyaan />

      <div className="mt-14 border-t border-ash-200 pt-6 text-center text-sm dark:border-white/10">
        <a
          href={GUIDE_PATH}
          className="text-ash-600 underline underline-offset-4 transition-colors hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100"
        >
          Lihat panduan singkat
        </a>
      </div>
    </PageShell>
  );
}

function Perintis() {
  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-400/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        Paket {PROMO.name} &middot; {PROMO.slots} slot pertama
      </p>
      <p className="mt-2 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
        {PROMO.bonuses.map((b, i) => (
          <span key={b.pay}>
            {i > 0 && ', '}
            bayar {b.pay} bulan aktif <strong className="font-semibold">{b.get} bulan</strong>
          </span>
        ))}
        . Bonusnya berupa bulan tambahan, bukan potongan harga, jadi
        perpanjangan berikutnya tidak terasa naik.
      </p>
      <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">
        Berlaku untuk {PROMO.slots} pelanggan pertama saja. Habis berarti habis.
      </p>
    </div>
  );
}

function KartuPaket({ plan }) {
  const gratis = plan.prices === null;
  const wa = tautanWhatsApp(plan.name);

  return (
    <div
      className={`relative flex flex-col rounded-2xl border p-6 ${
        plan.popular
          ? 'border-ash-800 bg-white shadow-lg dark:border-ash-300 dark:bg-white/[0.06]'
          : 'border-ash-200 bg-white dark:border-white/10 dark:bg-white/[0.03]'
      }`}
    >
      {plan.popular && (
        <span className="absolute -top-2.5 left-6 rounded-full bg-ash-800 px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-ash-100 dark:text-ash-950">
          Paling banyak dipakai
        </span>
      )}

      <h2 className="text-lg font-semibold tracking-tight text-ash-900 dark:text-white">
        {plan.name}
      </h2>
      <p className="mt-1 text-sm text-ash-600 dark:text-ash-400">{plan.tagline}</p>

      <div className="mt-5 space-y-2">
        {gratis ? (
          <p className="text-2xl font-semibold tracking-tight text-ash-900 dark:text-white">
            Gratis
          </p>
        ) : (
          plan.prices.map((h) => (
            <div key={h.months} className="flex items-baseline justify-between gap-2">
              <span className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
                {rupiah(h.amount)}
              </span>
              <span className="text-xs text-ash-600 dark:text-ash-400">
                {h.months} bulan &middot; {perBulan(h.amount, h.months)}/bln
              </span>
            </div>
          ))
        )}
      </div>

      <ul className="mt-5 flex-1 space-y-2.5 border-t border-ash-200 pt-5 dark:border-white/10">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2.5 text-sm text-ash-700 dark:text-ash-300">
            <Check
              size={16}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-ash-500 dark:text-ash-400"
              aria-hidden="true"
            />
            <span>{f}</span>
          </li>
        ))}
        {plan.limits.map((l) => (
          <li key={l} className="flex gap-2.5 text-sm text-ash-500 dark:text-ash-500">
            <Minus size={16} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{l}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {gratis ? (
          <a
            href="/"
            className="block rounded-xl border border-ash-200 px-4 py-3 text-center text-sm font-semibold text-ash-800 transition-colors duration-tint hover:bg-ash-100 dark:border-white/10 dark:text-ash-200 dark:hover:bg-white/5"
          >
            Mulai gratis
          </a>
        ) : wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-ash-800 px-4 py-3 text-sm font-semibold text-white transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            <MessageCircle size={16} strokeWidth={2} aria-hidden="true" />
            Pesan lewat WhatsApp
          </a>
        ) : (
          // Nomor belum disetel. Tombol yang membuka percakapan ke nomor yang
          // tidak ada lebih merusak kepercayaan daripada tidak ada tombol.
          <p className="rounded-xl border border-dashed border-ash-300 px-4 py-3 text-center text-xs text-ash-500 dark:border-white/10">
            Hubungi kami untuk berlangganan.
          </p>
        )}
      </div>
    </div>
  );
}

function CaraBerlangganan() {
  const langkah = [
    ['Pilih paketnya', 'Klik tombol WhatsApp di paket yang Anda mau.'],
    ['Transfer', 'Kami balas nomor rekening dan jumlahnya. Kirim buktinya.'],
    [
      'Terima kode',
      'Kami kirim kode berbentuk PF-XXXX-XXXX lewat WhatsApp yang sama.',
    ],
    [
      'Tebus kodenya',
      'Di dashboard, klik penanda kuota di samping tombol "New project", tempel kodenya, tekan Redeem. Paket aktif seketika.',
    ],
  ];

  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
        Cara berlangganan
      </h2>
      <p className="mt-2 text-sm text-ash-600 dark:text-ash-400">
        Aktivasinya lewat kode, bukan lewat kami yang harus online. Kode bisa
        ditebus sendiri jam berapa pun.
      </p>

      <ol className="mt-6 space-y-4">
        {langkah.map(([judul, isi], i) => (
          <li key={judul} className="flex gap-4">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-ash-200 text-xs font-semibold text-ash-700 dark:border-white/10 dark:text-ash-300">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-semibold text-ash-900 dark:text-white">{judul}</p>
              <p className="mt-0.5 text-sm text-ash-600 dark:text-ash-400">{isi}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Pertanyaan() {
  // Yang ditulis di sini adalah pertanyaan yang benar-benar menentukan orang
  // jadi membeli atau tidak, termasuk yang jawabannya tidak enak. Halaman harga
  // yang hanya memuat pertanyaan yang enak dijawab akan menerima pertanyaan
  // yang tidak enak itu lewat WhatsApp, satu per satu, selamanya.
  const tanya = [
    [
      'Apa yang dihitung sebagai satu galeri?',
      'Membuat project baru. Selain itu ada dua: mengganti folder Drive pada galeri yang sudah pernah dibuka klien, dan membuka kembali pemilihan lebih dari 24 jam setelah dikirim — keduanya berarti melayani klien baru. Membetulkan tautan yang salah tempel sebelum klien membukanya tidak dihitung, begitu juga membuka kembali dalam 24 jam saat klien salah tekan kirim.',
    ],
    [
      'Kalau project saya hapus, kuotanya kembali?',
      'Tidak. Penghitungnya hanya naik dan reset setiap tanggal 1. Kalau menghapus mengembalikan jatah, batasnya tidak berarti apa-apa.',
    ],
    [
      'Kalau paket saya habis, project lama hilang?',
      'Tidak. Project dan pilihan klien tetap ada. Yang berubah hanya jatah bulanan dan nama di galeri kembali jadi PhotoFlow.',
    ],
    [
      'Perpanjang lebih awal, sisa hari saya hangus?',
      'Tidak. Perpanjangan dihitung dari tanggal berakhir yang sudah ada, bukan dari hari Anda menebus kode.',
    ],
    [
      'Foto saya diunggah ke server Anda?',
      'Tidak pernah. PhotoFlow membaca daftar isi folder Drive Anda; fotonya tetap di Drive Anda dan dimuat langsung dari Google ke peramban klien.',
    ],
    [
      'Ada jaminan uptime?',
      'Tidak, dan itu tertulis di ketentuan layanan. Yang Anda bayar adalah jatah bulanan dan nama studio Anda di galeri klien. Selalu ekspor daftar pilihan begitu diterima.',
    ],
  ];

  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
        Pertanyaan yang sering muncul
      </h2>

      <dl className="mt-6 space-y-5">
        {tanya.map(([q, a]) => (
          <div key={q} className="border-l border-ash-200 pl-4 dark:border-white/10">
            <dt className="text-sm font-semibold text-ash-900 dark:text-white">{q}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ash-600 dark:text-ash-400">{a}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-xs text-ash-500 dark:text-ash-500">
        Selengkapnya di{' '}
        <a
          href={TERMS_PATH}
          className="underline underline-offset-4 hover:text-ash-700 dark:hover:text-ash-300"
        >
          ketentuan layanan
        </a>
        .
        {SALES_WHATSAPP && ' Pertanyaan lain, tanya saja lewat WhatsApp.'}
      </p>
    </section>
  );
}
