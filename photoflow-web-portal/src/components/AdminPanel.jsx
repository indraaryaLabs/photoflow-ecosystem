// Halaman operator: membangkitkan kode tebus dan menyetel paket langsung.
//
// Sampai sekarang keduanya hanya bisa lewat curl, yang berarti mengaktifkan
// pelanggan menuntut terminal dan token JWT yang disalin dari DevTools —
// pekerjaan yang harus dikerjakan pada jam berapa pun uang masuk.
//
// Berbahasa Inggris tanpa sakelar bahasa. Yang membukanya satu orang, dan
// bahasanya sudah pasti.

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, RefreshCw } from 'lucide-react';

import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';
import { supabase } from '../lib/supabase';
import { ambilKode, buatKode, cekAdmin, setelLangganan } from '../lib/admin';
import { PLANS } from '../lib/pricing';
import { namaPaket } from '../lib/subscription';

/** Paket yang boleh dijual. Gratis bukan sesuatu yang dibangkitkan kodenya. */
const PAKET_BERBAYAR = PLANS.filter((p) => p.id !== 'free');

export default function AdminPanel({ themeChoice, cycleTheme, onNavigate }) {
  const [token, setToken] = useState(null);
  // null = belum diketahui. Dibedakan dari false supaya layar "bukan admin"
  // tidak berkedip lebih dulu selama pemeriksaannya masih berjalan.
  const [isAdmin, setIsAdmin] = useState(null);

  useEffect(() => {
    let batal = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data?.session?.access_token ?? null;
      if (!t) {
        if (!batal) setIsAdmin(false);
        return;
      }
      const boleh = await cekAdmin(t);
      if (batal) return;
      setToken(t);
      setIsAdmin(boleh);
    })();
    return () => {
      batal = true;
    };
  }, []);

  if (isAdmin === null) {
    return (
      <Rangka themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={onNavigate}>
        <div className="flex justify-center py-20">
          <Loader2 size={24} strokeWidth={1.75} className="animate-spin text-ash-500" />
        </div>
      </Rangka>
    );
  }

  if (!isAdmin) {
    // Kalimatnya sengaja tidak mengonfirmasi bahwa halaman ini ada bagi yang
    // bukan admin — sejalan dengan backend yang membalas 404, bukan 403.
    return (
      <Rangka themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={onNavigate}>
        <div className="py-20 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-ash-900 dark:text-white">
            Not found
          </h1>
          <p className="mt-2 text-sm text-ash-600 dark:text-ash-400">
            There is nothing at this address for your account.
          </p>
        </div>
      </Rangka>
    );
  }

  return (
    <Rangka themeChoice={themeChoice} cycleTheme={cycleTheme} onNavigate={onNavigate}>
      <h1 className="text-2xl font-semibold tracking-tight text-ash-900 dark:text-white">
        Operator
      </h1>
      <p className="mt-2 text-sm text-ash-600 dark:text-ash-400">
        Generate redemption codes after a transfer lands, or set someone&rsquo;s
        plan directly.
      </p>

      <BuatKode token={token} />
      <SetelLangsung token={token} />
      <DaftarKode token={token} />
    </Rangka>
  );
}

function Rangka({ themeChoice, cycleTheme, onNavigate, children }) {
  return (
    <div className="min-h-screen bg-ash-50 font-sans transition-colors duration-tint dark:bg-ash-950">
      <header className="sticky top-0 z-10 border-b border-ash-200/70 bg-ash-50/85 backdrop-blur dark:border-white/5 dark:bg-ash-950/85">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 sm:px-8">
          <span className="inline-flex items-center gap-2 text-ash-900 dark:text-white">
            <BrandMark size={22} title="PhotoFlow" />
            <span className="text-sm font-semibold tracking-tight">PhotoFlow</span>
          </span>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8 sm:px-8">
        <button
          type="button"
          onClick={() => onNavigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-sm text-ash-600 transition-colors hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100"
        >
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
          Back to dashboard
        </button>

        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

function Kartu({ judul, keterangan, children }) {
  return (
    <section className="mt-8 rounded-2xl border border-ash-200 bg-white p-6 dark:border-white/10 dark:bg-white/[0.03]">
      <h2 className="text-base font-semibold tracking-tight text-ash-900 dark:text-white">
        {judul}
      </h2>
      {keterangan && (
        <p className="mt-1 text-sm text-ash-600 dark:text-ash-400">{keterangan}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

const kelasInput =
  'w-full rounded-xl border border-ash-200 bg-ash-50 px-3.5 py-2.5 text-sm outline-none focus:border-ash-500 dark:border-white/10 dark:bg-black/20 dark:focus:border-ash-400';

const kelasLabel =
  'mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-ash-500';

const kelasTombol =
  'rounded-xl bg-ash-800 px-4 py-2.5 text-sm font-semibold text-white transition-colors duration-tint hover:bg-ash-900 disabled:opacity-50 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white';

function BuatKode({ token }) {
  const [plan, setPlan] = useState(PAKET_BERBAYAR[0]?.id ?? 'freelance');
  const [months, setMonths] = useState(3);
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const [hasil, setHasil] = useState([]);

  const kirim = async (e) => {
    e.preventDefault();
    setSibuk(true);
    setGalat('');
    const r = await buatKode(token, {
      plan,
      months: Number(months),
      count: Number(count),
      note: note.trim(),
    });
    setSibuk(false);
    if (!r.ok) {
      setGalat(r.error);
      return;
    }
    setHasil(r.codes);
  };

  return (
    <Kartu
      judul="Generate codes"
      keterangan="The buyer redeems one of these in their own dashboard, so activation does not need you online."
    >
      <form onSubmit={kirim} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={kelasLabel} htmlFor="gen-plan">
            Plan
          </label>
          <select
            id="gen-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className={kelasInput}
          >
            {PAKET_BERBAYAR.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={kelasLabel} htmlFor="gen-months">
            Months granted
          </label>
          <input
            id="gen-months"
            type="number"
            min="1"
            max="36"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className={kelasInput}
          />
          {/* Promo dinyatakan di sini, bukan sebagai potongan harga: "bayar 6
              bulan aktif 9 bulan" adalah kode dengan months = 9. */}
          <p className="mt-1 text-xs text-ash-500">
            For the founding promo, enter the months the buyer gets, not the
            months they paid for.
          </p>
        </div>

        <div>
          <label className={kelasLabel} htmlFor="gen-count">
            How many codes
          </label>
          <input
            id="gen-count"
            type="number"
            min="1"
            max="200"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className={kelasInput}
          />
        </div>

        <div>
          <label className={kelasLabel} htmlFor="gen-note">
            Note (private)
          </label>
          <input
            id="gen-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Buyer name, transfer ref, promo batch"
            className={kelasInput}
          />
        </div>

        <div className="sm:col-span-2">
          <button type="submit" disabled={sibuk} className={kelasTombol}>
            {sibuk ? 'Generating...' : 'Generate'}
          </button>
          {galat && <p className="mt-2 text-sm text-danger-600 dark:text-danger-400">{galat}</p>}
        </div>
      </form>

      {hasil.length > 0 && <KodeBaru codes={hasil} />}
    </Kartu>
  );
}

// Kode yang baru dibangkitkan ditampilkan sekali dan harus bisa disalin
// seluruhnya sekaligus: menyalin satu per satu dari daftar 20 kode adalah cara
// tercepat kehilangan satu di antaranya.
function KodeBaru({ codes }) {
  const [disalin, setDisalin] = useState(false);

  const salin = useCallback(() => {
    const teks = codes.join('\n');
    // Fallback textarea, bukan navigator.clipboard: berkas lain di aplikasi ini
    // sudah memakai cara yang sama karena Clipboard API gagal diam-diam di
    // sebagian konteks.
    const ta = document.createElement('textarea');
    ta.value = teks;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      setDisalin(true);
      setTimeout(() => setDisalin(false), 2000);
    } finally {
      document.body.removeChild(ta);
    }
  }, [codes]);

  return (
    <div className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-400/30 dark:bg-emerald-400/10">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          {codes.length} code{codes.length === 1 ? '' : 's'} generated
        </p>
        <button
          type="button"
          onClick={salin}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 dark:border-emerald-400/30 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
        >
          {disalin ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={2} />}
          {disalin ? 'Copied' : 'Copy all'}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-sm text-emerald-900 dark:text-emerald-100">
        {codes.join('\n')}
      </pre>
    </div>
  );
}

function SetelLangsung({ token }) {
  const [userId, setUserId] = useState('');
  const [plan, setPlan] = useState(PAKET_BERBAYAR[0]?.id ?? 'freelance');
  const [months, setMonths] = useState(3);
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState('');
  const [kabar, setKabar] = useState('');

  const kirim = async (e) => {
    e.preventDefault();
    setSibuk(true);
    setGalat('');
    setKabar('');
    const r = await setelLangganan(token, {
      user_id: userId.trim(),
      plan,
      months: Number(months),
    });
    setSibuk(false);
    if (!r.ok) {
      setGalat(r.error);
      return;
    }
    const sampai = r.status?.expires_at
      ? new Date(r.status.expires_at).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : 'an updated date';
    setKabar(`Set to ${r.status?.plan ?? plan}, active until ${sampai}.`);
  };

  return (
    <Kartu
      judul="Set a plan directly"
      keterangan="Skips the code entirely. Use it when someone has paid but cannot redeem, and for fixing a mistake. Renewals extend from the existing expiry date, so nobody loses paid time."
    >
      <form onSubmit={kirim} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={kelasLabel} htmlFor="set-user">
            User ID
          </label>
          <input
            id="set-user"
            type="text"
            required
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Supabase Auth UUID, not an email address"
            className={`${kelasInput} font-mono`}
          />
        </div>

        <div>
          <label className={kelasLabel} htmlFor="set-plan">
            Plan
          </label>
          <select
            id="set-plan"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className={kelasInput}
          >
            {PAKET_BERBAYAR.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={kelasLabel} htmlFor="set-months">
            Months
          </label>
          <input
            id="set-months"
            type="number"
            min="1"
            max="36"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
            className={kelasInput}
          />
        </div>

        <div className="sm:col-span-2">
          <button type="submit" disabled={sibuk} className={kelasTombol}>
            {sibuk ? 'Saving...' : 'Set plan'}
          </button>
          {galat && <p className="mt-2 text-sm text-danger-600 dark:text-danger-400">{galat}</p>}
          {kabar && (
            <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{kabar}</p>
          )}
        </div>
      </form>
    </Kartu>
  );
}

function DaftarKode({ token }) {
  const [kode, setKode] = useState(null);
  const [sibuk, setSibuk] = useState(false);

  const muat = useCallback(async () => {
    setSibuk(true);
    const hasil = await ambilKode(token);
    setSibuk(false);
    setKode(hasil ?? []);
  }, [token]);

  // Pemuatan pertama tidak memanggil muat(): fungsi itu menyetel state secara
  // sinkron, dan menjalankannya langsung di dalam effect berarti render pertama
  // memicu setState sebelum sempat selesai. Di sini hanya hasil yang ditunggu
  // yang masuk ke state, dengan penanda batal supaya balasan yang datang
  // setelah komponen dilepas tidak menulis apa pun.
  useEffect(() => {
    let batal = false;
    (async () => {
      const hasil = await ambilKode(token);
      if (!batal) setKode(hasil ?? []);
    })();
    return () => {
      batal = true;
    };
  }, [token]);

  const belumTerpakai = kode?.filter((k) => !k.used_at).length ?? 0;

  return (
    <Kartu
      judul="Recent codes"
      keterangan="The last 100 generated, newest first. This is how you find a code again after the tab is closed."
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ash-600 dark:text-ash-400">
          {kode === null
            ? 'Loading...'
            : `${belumTerpakai} unused of ${kode.length} shown`}
        </p>
        <button
          type="button"
          onClick={muat}
          disabled={sibuk}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ash-200 px-2.5 py-1.5 text-xs font-semibold text-ash-700 transition-colors hover:bg-ash-100 disabled:opacity-50 dark:border-white/10 dark:text-ash-300 dark:hover:bg-white/5"
        >
          <RefreshCw size={14} strokeWidth={2} className={sibuk ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {kode !== null && kode.length === 0 && (
        <p className="text-sm text-ash-500">No codes generated yet.</p>
      )}

      {kode !== null && kode.length > 0 && (
        // Tabel lebar menggulung di dalam wadahnya sendiri. Halaman yang ikut
        // menggulung ke samping merusak seluruh tata letak di layar sempit.
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-ash-200 text-[11px] uppercase tracking-wider text-ash-500 dark:border-white/10">
                <th className="pb-2 pr-3 font-medium">Code</th>
                <th className="pb-2 pr-3 font-medium">Plan</th>
                <th className="pb-2 pr-3 font-medium">Months</th>
                <th className="pb-2 pr-3 font-medium">Status</th>
                <th className="pb-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {kode.map((k) => (
                <tr
                  key={k.code}
                  className="border-b border-ash-100 last:border-0 dark:border-white/5"
                >
                  <td className="py-2 pr-3 font-mono text-[13px] text-ash-900 dark:text-ash-100">
                    {k.code}
                  </td>
                  {/* Nama tampilan, bukan id mentah. Kolom yang menulis
                      "freelance" di sebelah dropdown yang menulis "Pro"
                      membuat keduanya terbaca sebagai dua hal berbeda. */}
                  <td className="py-2 pr-3 text-ash-700 dark:text-ash-300">
                    {namaPaket(k.plan)}
                  </td>
                  <td className="py-2 pr-3 text-ash-700 dark:text-ash-300">{k.months}</td>
                  <td className="py-2 pr-3">
                    {k.used_at ? (
                      <span className="text-ash-500 dark:text-ash-500">Used</span>
                    ) : (
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">
                        Unused
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-ash-600 dark:text-ash-400">{k.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Kartu>
  );
}
