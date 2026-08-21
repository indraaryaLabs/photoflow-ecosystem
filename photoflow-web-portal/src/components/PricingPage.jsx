// Halaman harga.
//
// Dwibahasa: Inggris bawaan, Indonesia lewat sakelar di kanan atas. Ini surface
// iklan, dibuka fotografer lokal yang tidak selalu membandingkan harga dalam
// bahasa Inggris. Harga tetap rupiah di kedua bahasa — mata uang mengikuti siapa
// yang membayar, bukan bahasa halamannya.
//
// Kalimat panjang disimpan sebagai { en, id } di objek COPY di bawah, dipilih
// lewat t(). Data paket yang berbahasa (tagline, fitur) datang dari lib/pricing
// dalam bentuk yang sama.

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
import { useLang } from '../lib/lang';

const COPY = {
  title: { en: 'PhotoFlow pricing', id: 'Harga PhotoFlow' },
  intro: {
    en: 'Send one link, your client picks their own photos, you get back a list of file names ready to paste into Lightroom. The photos never leave your Google Drive.',
    id: 'Kirim satu tautan, klien memilih fotonya sendiri, Anda terima daftar nama berkas yang siap ditempel ke Lightroom. Foto tidak pernah keluar dari Google Drive Anda.',
  },
  fine: {
    en: 'Prices in Indonesian rupiah. No auto-renewal and no card on file — a plan simply stops on its date.',
    id: 'Harga dalam rupiah. Tidak ada perpanjangan otomatis dan tidak ada kartu yang disimpan — paket berhenti sendiri pada tanggalnya.',
  },
  toGuide: { en: 'Read the quick guide', id: 'Lihat panduan singkat' },

  promoTag: {
    en: `${PROMO.name} plan · first ${PROMO.slots} seats`,
    id: `Paket ${PROMO.name} · ${PROMO.slots} slot pertama`,
  },
  promoTail: {
    en: '. The bonus is extra months rather than a discount, so your next renewal does not feel like a price rise.',
    id: '. Bonusnya berupa bulan tambahan, bukan potongan harga, jadi perpanjangan berikutnya tidak terasa naik.',
  },
  promoLimit: {
    en: `For the first ${PROMO.slots} customers only. Once they are gone, they are gone.`,
    id: `Berlaku untuk ${PROMO.slots} pelanggan pertama saja. Habis berarti habis.`,
  },

  popular: { en: 'Most popular', id: 'Paling banyak dipakai' },
  free: { en: 'Free', id: 'Gratis' },
  startFree: { en: 'Start free', id: 'Mulai gratis' },
  order: { en: 'Order on WhatsApp', id: 'Pesan lewat WhatsApp' },
  noNumber: { en: 'Contact us to subscribe.', id: 'Hubungi kami untuk berlangganan.' },

  howTitle: { en: 'How to subscribe', id: 'Cara berlangganan' },
  howIntro: {
    en: 'Activation runs on codes rather than on us being online, so you can redeem one at two in the morning without waiting for anybody.',
    id: 'Aktivasinya lewat kode, bukan lewat kami yang harus online. Kode bisa ditebus sendiri jam berapa pun.',
  },
  faqTitle: { en: 'Frequently asked', id: 'Pertanyaan yang sering muncul' },
  faqMore: { en: 'More detail in the ', id: 'Selengkapnya di ' },
  faqTerms: { en: 'terms of service', id: 'ketentuan layanan' },
  faqWa: {
    en: ' Anything else, just ask on WhatsApp.',
    id: ' Pertanyaan lain, tanya saja lewat WhatsApp.',
  },
};

const STEPS = {
  en: [
    ['Pick a plan', 'Tap the WhatsApp button on the plan you want.'],
    ['Transfer', 'We reply with the account number and the amount. Send the receipt.'],
    ['Get a code', 'We send a code shaped PF-XXXX-XXXX on the same WhatsApp chat.'],
    [
      'Redeem it',
      'In your dashboard, click the quota badge next to "New project", paste the code, press Redeem. The plan is active immediately.',
    ],
  ],
  id: [
    ['Pilih paketnya', 'Klik tombol WhatsApp di paket yang Anda mau.'],
    ['Transfer', 'Kami balas nomor rekening dan jumlahnya. Kirim buktinya.'],
    ['Terima kode', 'Kami kirim kode berbentuk PF-XXXX-XXXX lewat WhatsApp yang sama.'],
    [
      'Tebus kodenya',
      'Di dashboard, klik penanda kuota di samping tombol "New project", tempel kodenya, tekan Redeem. Paket aktif seketika.',
    ],
  ],
};

// Pertanyaan yang benar-benar menentukan orang jadi membeli atau tidak,
// termasuk yang jawabannya tidak enak. Halaman harga yang hanya memuat
// pertanyaan yang enak dijawab akan menerima yang tidak enak itu lewat WhatsApp,
// satu per satu, selamanya.
const FAQ = {
  en: [
    [
      'What counts as one gallery?',
      'Creating a project. Two other things also count: changing the Drive folder of a gallery a client has already opened, and reopening a selection more than 24 hours after it was submitted — both mean serving a new client. Fixing a link you pasted wrong before anyone opened it is free, and so is reopening within 24 hours when a client pressed send by mistake.',
    ],
    [
      'If I delete a project, do I get the gallery back?',
      'No. The counter only goes up, and it resets on the 1st. If deleting returned the slot, the limit would mean nothing: create, send, delete, repeat.',
    ],
    [
      'If my plan expires, do I lose my old projects?',
      'No. Projects and client selections stay exactly where they are. Only the monthly allowance and the studio-name branding change back.',
    ],
    [
      'If I renew early, do I lose the days I have left?',
      'No. A renewal is counted from your existing expiry date, not from the day you redeem the code.',
    ],
    [
      'Are my photos uploaded to your server?',
      'Never. PhotoFlow reads the file list of your Drive folder; the photos stay in your Drive and load straight from Google into your client’s browser.',
    ],
    [
      'Is there an uptime guarantee?',
      'No, and the terms of service say so. What you pay for is the monthly allowance and your studio name on client galleries. Always export the selection list once you receive it.',
    ],
  ],
  id: [
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
  ],
};

export default function PricingPage({ themeChoice, cycleTheme }) {
  const { lang, setLang, t } = useLang();

  return (
    <PageShell
      themeChoice={themeChoice}
      cycleTheme={cycleTheme}
      lang={lang}
      onSelectLang={setLang}
      lebar="max-w-5xl"
    >
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ash-900 dark:text-white sm:text-4xl">
          {t(COPY.title)}
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ash-600 dark:text-ash-400">
          {t(COPY.intro)}
        </p>
      </div>

      {PROMO.slots > 0 && <Perintis lang={lang} t={t} />}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <KartuPaket key={plan.id} plan={plan} lang={lang} t={t} />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-ash-500 dark:text-ash-500">{t(COPY.fine)}</p>

      <CaraBerlangganan lang={lang} t={t} />
      <Pertanyaan lang={lang} t={t} />

      <div className="mt-14 border-t border-ash-200 pt-6 text-center text-sm dark:border-white/10">
        <a
          href={GUIDE_PATH}
          className="text-ash-600 underline underline-offset-4 transition-colors hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100"
        >
          {t(COPY.toGuide)}
        </a>
      </div>
    </PageShell>
  );
}

function Perintis({ lang, t }) {
  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-400/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        {t(COPY.promoTag)}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
        {PROMO.bonuses.map((b, i) => (
          <FrasaBonus key={b.pay} lang={lang} i={i} b={b} />
        ))}
        {t(COPY.promoTail)}
      </p>
      <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">{t(COPY.promoLimit)}</p>
    </div>
  );
}

// "Pay for 3 months, get 5 months" / "Bayar 3 bulan aktif 5 bulan", dengan
// pemisah koma di depan mulai frasa kedua. Disatukan di sini supaya bentuk
// kalimatnya — yang berbeda antar bahasa — tidak berserak di JSX.
function FrasaBonus({ lang, i, b }) {
  const awal = i > 0 ? ', ' : '';
  if (lang === 'id') {
    return (
      <span>
        {awal}
        {i === 0 ? 'Bayar' : 'bayar'} {b.pay} bulan aktif{' '}
        <strong className="font-semibold">{b.get} bulan</strong>
      </span>
    );
  }
  return (
    <span>
      {awal}
      {i === 0 ? 'Pay' : 'pay'} for {b.pay} months, get{' '}
      <strong className="font-semibold">{b.get} months</strong>
    </span>
  );
}

function KartuPaket({ plan, lang, t }) {
  const gratis = plan.prices === null;
  const wa = tautanWhatsApp(plan.name);
  const fitur = t(plan.features);
  const batas = t(plan.limits);

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
          {t(COPY.popular)}
        </span>
      )}

      <h2 className="text-lg font-semibold tracking-tight text-ash-900 dark:text-white">
        {plan.name}
      </h2>
      <p className="mt-1 text-sm text-ash-600 dark:text-ash-400">{t(plan.tagline)}</p>

      <div className="mt-5 space-y-2">
        {gratis ? (
          <p className="text-2xl font-semibold tracking-tight text-ash-900 dark:text-white">
            {t(COPY.free)}
          </p>
        ) : (
          plan.prices.map((h) => (
            <div key={h.months} className="flex items-baseline justify-between gap-2">
              <span className="whitespace-nowrap text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
                {rupiah(h.amount)}
              </span>
              <span className="text-right text-xs leading-tight text-ash-600 dark:text-ash-400">
                {h.months} {lang === 'id' ? 'bln' : 'mo'} &middot; {perBulan(h.amount, h.months)}/
                {lang === 'id' ? 'bln' : 'mo'}
              </span>
            </div>
          ))
        )}
      </div>

      <ul className="mt-5 flex-1 space-y-2.5 border-t border-ash-200 pt-5 dark:border-white/10">
        {fitur.map((f) => (
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
        {batas.map((l) => (
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
            {t(COPY.startFree)}
          </a>
        ) : wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-ash-800 px-4 py-3 text-sm font-semibold text-white transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            <MessageCircle size={16} strokeWidth={2} aria-hidden="true" />
            {t(COPY.order)}
          </a>
        ) : (
          // Nomor belum disetel. Tombol yang membuka percakapan ke nomor yang
          // tidak ada lebih merusak kepercayaan daripada tidak ada tombol.
          <p className="rounded-xl border border-dashed border-ash-300 px-4 py-3 text-center text-xs text-ash-500 dark:border-white/10">
            {t(COPY.noNumber)}
          </p>
        )}
      </div>
    </div>
  );
}

function CaraBerlangganan({ lang, t }) {
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
        {t(COPY.howTitle)}
      </h2>
      <p className="mt-2 text-sm text-ash-600 dark:text-ash-400">{t(COPY.howIntro)}</p>

      <ol className="mt-6 space-y-4">
        {STEPS[lang].map(([judul, isi], i) => (
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

function Pertanyaan({ lang, t }) {
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
        {t(COPY.faqTitle)}
      </h2>

      <dl className="mt-6 space-y-5">
        {FAQ[lang].map(([q, a]) => (
          <div key={q} className="border-l border-ash-200 pl-4 dark:border-white/10">
            <dt className="text-sm font-semibold text-ash-900 dark:text-white">{q}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-ash-600 dark:text-ash-400">{a}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 text-xs text-ash-500 dark:text-ash-500">
        {t(COPY.faqMore)}
        <a
          href={TERMS_PATH}
          className="underline underline-offset-4 hover:text-ash-700 dark:hover:text-ash-300"
        >
          {t(COPY.faqTerms)}
        </a>
        .{SALES_WHATSAPP && t(COPY.faqWa)}
      </p>
    </section>
  );
}
