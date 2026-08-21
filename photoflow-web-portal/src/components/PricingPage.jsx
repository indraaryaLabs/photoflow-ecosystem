// Halaman harga.
//
// Bahasanya Inggris, sama seperti seluruh antarmuka aplikasi. Harganya tetap
// rupiah: mata uang mengikuti siapa yang membayar, bukan bahasa halamannya.

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
          PhotoFlow pricing
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ash-600 dark:text-ash-400">
          Send one link, your client picks their own photos, you get back a
          list of file names ready to paste into Lightroom. The photos never
          leave your Google Drive.
        </p>
      </div>

      {PROMO.slots > 0 && <Perintis />}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <KartuPaket key={plan.id} plan={plan} />
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-ash-500 dark:text-ash-500">
        Prices in Indonesian rupiah. No auto-renewal and no card on file — a
        plan simply stops on its date.
      </p>

      <CaraBerlangganan />
      <Pertanyaan />

      <div className="mt-14 border-t border-ash-200 pt-6 text-center text-sm dark:border-white/10">
        <a
          href={GUIDE_PATH}
          className="text-ash-600 underline underline-offset-4 transition-colors hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100"
        >
          Read the quick guide
        </a>
      </div>
    </PageShell>
  );
}

function Perintis() {
  return (
    <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-400/10">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        {PROMO.name} plan &middot; first {PROMO.slots} seats
      </p>
      <p className="mt-2 text-sm leading-relaxed text-amber-900 dark:text-amber-100">
        {PROMO.bonuses.map((b, i) => (
          <span key={b.pay}>
            {i === 0 ? 'Pay' : ', pay'} for {b.pay} months, get{' '}
            <strong className="font-semibold">{b.get} months</strong>
          </span>
        ))}
        . The bonus is extra months rather than a discount, so your next
        renewal does not feel like a price rise.
      </p>
      <p className="mt-2 text-xs text-amber-800/80 dark:text-amber-200/70">
        For the first {PROMO.slots} customers only. Once they are gone, they
        are gone.
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
          Most popular
        </span>
      )}

      <h2 className="text-lg font-semibold tracking-tight text-ash-900 dark:text-white">
        {plan.name}
      </h2>
      <p className="mt-1 text-sm text-ash-600 dark:text-ash-400">{plan.tagline}</p>

      <div className="mt-5 space-y-2">
        {gratis ? (
          <p className="text-2xl font-semibold tracking-tight text-ash-900 dark:text-white">
            Free
          </p>
        ) : (
          plan.prices.map((h) => (
            <div key={h.months} className="flex items-baseline justify-between gap-2">
              <span className="whitespace-nowrap text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
                {rupiah(h.amount)}
              </span>
              <span className="text-right text-xs leading-tight text-ash-600 dark:text-ash-400">
                {h.months} mo &middot; {perBulan(h.amount, h.months)}/mo
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
            Start free
          </a>
        ) : wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-ash-800 px-4 py-3 text-sm font-semibold text-white transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
          >
            <MessageCircle size={16} strokeWidth={2} aria-hidden="true" />
            Order on WhatsApp
          </a>
        ) : (
          // Nomor belum disetel. Tombol yang membuka percakapan ke nomor yang
          // tidak ada lebih merusak kepercayaan daripada tidak ada tombol.
          <p className="rounded-xl border border-dashed border-ash-300 px-4 py-3 text-center text-xs text-ash-500 dark:border-white/10">
            Contact us to subscribe.
          </p>
        )}
      </div>
    </div>
  );
}

function CaraBerlangganan() {
  const langkah = [
    ['Pick a plan', 'Tap the WhatsApp button on the plan you want.'],
    ['Transfer', 'We reply with the account number and the amount. Send the receipt.'],
    ['Get a code', 'We send a code shaped PF-XXXX-XXXX on the same WhatsApp chat.'],
    [
      'Redeem it',
      'In your dashboard, click the quota badge next to "New project", paste the code, press Redeem. The plan is active immediately.',
    ],
  ];

  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
        How to subscribe
      </h2>
      <p className="mt-2 text-sm text-ash-600 dark:text-ash-400">
        Activation runs on codes rather than on us being online, so you can
        redeem one at two in the morning without waiting for anybody.
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
      'Never. PhotoFlow reads the file list of your Drive folder; the photos stay in your Drive and load straight from Google into your client\u2019s browser.',
    ],
    [
      'Is there an uptime guarantee?',
      'No, and the terms of service say so. What you pay for is the monthly allowance and your studio name on client galleries. Always export the selection list once you receive it.',
    ],
  ];

  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
        Frequently asked
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
        More detail in the{' '}
        <a
          href={TERMS_PATH}
          className="underline underline-offset-4 hover:text-ash-700 dark:hover:text-ash-300"
        >
          terms of service
        </a>
        .
        {SALES_WHATSAPP && ' Anything else, just ask on WhatsApp.'}
      </p>
    </section>
  );
}
