// Satu dialog untuk dua jalan masuk: menekan penanda kuota, dan tertahan oleh
// batasnya.
//
// Dibuat satu, bukan dua, karena keterangan yang dibutuhkan sama persis di
// kedua keadaan — paket apa yang berlaku, berapa yang terpakai, dan bagaimana
// menambahnya. Dua dialog berbeda untuk isi yang sama hanya melahirkan dua
// tempat yang harus diperbaiki setiap kali angkanya berubah.

import { useState } from 'react';
import { X } from 'lucide-react';

import {
  TANPA_BATAS,
  namaPaket,
  ringkasKuota,
  tanggalBerakhir,
} from '../lib/subscription';
import { PRICING_PATH } from '../lib/pricing';

/**
 * Kalimat penolakan, disusun di sini alih-alih memakai `error` dari backend.
 *
 * Backend menulis pesannya dalam bahasa Indonesia sementara antarmuka ini
 * berbahasa Inggris. Yang dipakai dari balasan 402 adalah bagian yang tidak
 * berbahasa apa pun — `quota` dan `plan` — sehingga kalimatnya tetap satu
 * bahasa dan tetap benar kalau angkanya berubah.
 */
function kalimatTertahan(tindakan, kuota) {
  const jatah = `${kuota} galleries`;
  switch (tindakan) {
    case 'create':
      return `This month's ${jatah} are used up, so a new project cannot be created yet.`;
    case 'edit':
      return `This month's ${jatah} are used up. Changing the Drive folder of a gallery your client has already opened counts as a new gallery, so it needs a free slot.`;
    case 'reopen':
      return `This month's ${jatah} are used up. Reopening a selection this long after it was submitted counts as a new gallery, so it needs a free slot.`;
    default:
      return `This month's ${jatah} are used up.`;
  }
}

export default function PlanModal({ sub, blocked, onClose, onRedeem }) {
  const [kode, setKode] = useState('');
  const [menebus, setMenebus] = useState(false);
  const [galat, setGalat] = useState('');
  const [berhasil, setBerhasil] = useState('');

  const kirim = async (e) => {
    e.preventDefault();
    const bersih = kode.trim();
    if (!bersih) return;

    setMenebus(true);
    setGalat('');
    const hasil = await onRedeem(bersih);
    setMenebus(false);

    if (!hasil.ok) {
      setGalat(hasil.error);
      return;
    }
    setKode('');
    setBerhasil(
      hasil.status?.plan
        ? `${namaPaket(hasil.status.plan)} plan activated until ${tanggalBerakhir(hasil.status)}.`
        : 'Your code was redeemed.',
    );
  };

  const kuotaTertahan = blocked?.quota ?? sub?.quota ?? 0;
  const berakhir = tanggalBerakhir(sub);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-slide-up-fade">
      <div className="relative w-full max-w-md rounded-2xl border border-ash-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-ash-900">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 p-2 text-ash-500 transition-colors hover:text-ash-600 dark:hover:text-ash-200"
          aria-label="Close"
        >
          <X size={20} strokeWidth={1.75} />
        </button>

        <h2 className="mb-1 font-display text-2xl font-semibold tracking-tight">
          {blocked ? 'Out of galleries this month' : 'Your plan'}
        </h2>

        {blocked ? (
          <p className="mb-5 text-sm text-ash-600 dark:text-ash-400">
            {kalimatTertahan(blocked.action, kuotaTertahan)}
          </p>
        ) : (
          <p className="mb-5 text-sm text-ash-600 dark:text-ash-400">
            Every plan allows a number of galleries per calendar month. The
            count resets on the first of the month and does not carry over.
          </p>
        )}

        {sub && (
          <div className="mb-5 rounded-xl border border-ash-200 bg-ash-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold tracking-tight text-ash-900 dark:text-white">
                {namaPaket(sub.plan)}
              </span>
              <span className="text-xs font-medium text-ash-600 dark:text-ash-400">
                {ringkasKuota(sub)}
              </span>
            </div>

            {/* Batangnya digambar hanya untuk paket berbatas. Pada paket tanpa
                batas tidak ada yang bisa ditunjukkan sebuah batang, dan
                batang yang selalu penuh atau selalu kosong hanya
                membingungkan. */}
            {sub.quota !== TANPA_BATAS && (
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-ash-200 dark:bg-white/10">
                <div
                  className={`h-full rounded-full transition-all duration-tint ${
                    sub.remaining === 0 ? 'bg-amber-500' : 'bg-ash-700 dark:bg-ash-300'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round((sub.used / Math.max(1, sub.quota)) * 100))}%`,
                  }}
                />
              </div>
            )}

            <p className="mt-3 text-xs text-ash-600 dark:text-ash-400">
              {sub.active && berakhir
                ? `Active until ${berakhir}. Your projects and your clients' selections stay in place after that; only the monthly allowance and the studio name change back.`
                : 'On the free plan, galleries carry PhotoFlow branding instead of your studio name.'}
            </p>
          </div>
        )}

        {berhasil ? (
          <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
            {berhasil}
          </p>
        ) : (
          <form onSubmit={kirim} className="space-y-3">
            <label
              htmlFor="redeem-code"
              className="block text-[11px] font-medium uppercase tracking-wider text-ash-500"
            >
              Have a code?
            </label>
            <div className="flex gap-2">
              <input
                id="redeem-code"
                type="text"
                autoFocus={Boolean(blocked)}
                value={kode}
                // Diubah jadi huruf besar saat diketik, bukan hanya saat
                // dikirim. Kodenya memang huruf besar; membiarkan layar
                // menampilkan bentuk lain dari yang tersimpan membuat orang
                // mengira ia salah ketik.
                onChange={(e) => setKode(e.target.value.toUpperCase())}
                placeholder="PF-XXXX-XXXX"
                className="min-w-0 flex-1 rounded-xl border border-ash-200 bg-ash-50 px-4 py-3 font-mono text-sm tracking-wider outline-none focus:border-ash-500 dark:border-white/10 dark:bg-black/20 dark:focus:border-ash-400"
              />
              <button
                type="submit"
                disabled={menebus || !kode.trim()}
                className="shrink-0 rounded-xl bg-ash-800 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-colors duration-tint hover:bg-ash-900 disabled:opacity-50 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
              >
                {menebus ? 'Checking...' : 'Redeem'}
              </button>
            </div>

            {galat && (
              <p className="text-sm text-danger-600 dark:text-danger-400">{galat}</p>
            )}

            {/* Harga ditautkan dari sini, bukan dari header dashboard. Orang
                yang sedang memikirkan uang sudah berada di dialog ini —
                menaruh tautannya di tempat lain berarti ia harus mencarinya
                setelah menutup yang sedang dibacanya. */}
            <p className="text-xs text-ash-500 dark:text-ash-500">
              Codes are issued after payment.{' '}
              <a
                href={PRICING_PATH}
                className="underline underline-offset-4 hover:text-ash-700 dark:hover:text-ash-300"
              >
                See all plans and prices
              </a>
              .
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
