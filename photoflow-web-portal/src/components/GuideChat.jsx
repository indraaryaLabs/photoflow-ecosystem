// Sambutan berbentuk percakapan di pojok dashboard.
//
// Muncul sendiri sekali saja, untuk akun yang belum punya satu pun project, dan
// bisa dipanggil ulang lewat tombol tanda tanya di header. Aturan itu bukan
// kehati-hatian berlebihan: popup yang muncul sendiri adalah pola yang paling
// sering dibenci orang, dan yang membuatnya ditoleransi cuma tiga hal — sekali
// seumur akun, tidak memblokir apa pun, dan hilang dalam satu klik. Ketiganya
// dipenuhi di sini.
//
// SENGAJA BUKAN MODAL. Sambutan yang menutupi layar menghalangi tombol yang
// justru sedang disuruhnya tekan, dan orang yang sudah tahu mau apa harus
// menyingkirkannya lebih dulu sebelum boleh bekerja.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

import BrandMark from './BrandMark';
import { GUIDE_PATH } from '../lib/pricing';

// Tiga gelembung, dan yang di tengah adalah alasan seluruh komponen ini ada.
// Folder yang masih Restricted menghasilkan galeri kosong TANPA pesan galat —
// satu-satunya kegagalan di aplikasi ini yang tidak menjelaskan dirinya sendiri.
const BUBBLES = [
  'Welcome to PhotoFlow. One thing worth knowing before your first gallery.',
  'Your Google Drive folder has to be shared as "Anyone with the link". If it stays Restricted, the gallery opens completely empty — and nothing on screen explains why.',
  'That is the whole trick. Ready when you are.',
];

// Jeda antar gelembung. Totalnya sekitar lima detik sampai tombolnya muncul —
// cukup untuk dibaca, cukup pendek untuk tidak terasa menahan orang.
const JEDA = [0, 1800, 3600];
const JEDA_TOMBOL = 5000;

export default function GuideChat({ onClose, onDismiss }) {
  // Peramban yang diminta mengurangi gerak tidak boleh disuguhi animasi
  // bertahap: seluruh isinya ditampilkan sekaligus. CSS global sudah memangkas
  // durasi animasi, tapi tidak bisa menyentuh setTimeout — pentahapan ini harus
  // dimatikan di sini.
  const kurangiGerak = useMemo(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }, []);

  const [tampil, setTampil] = useState(kurangiGerak ? BUBBLES.length : 0);
  const [tombolTampil, setTombolTampil] = useState(kurangiGerak);
  const panelRef = useRef(null);

  useEffect(() => {
    if (kurangiGerak) return undefined;

    const timer = JEDA.map((ms, i) => setTimeout(() => setTampil(i + 1), ms));
    timer.push(setTimeout(() => setTombolTampil(true), JEDA_TOMBOL));
    return () => timer.forEach(clearTimeout);
  }, [kurangiGerak]);

  // Escape menutup. Sambutan yang hanya bisa ditutup dengan mengarahkan tetikus
  // ke sebuah X kecil adalah sambutan yang menahan orang.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const selesai = tampil >= BUBBLES.length;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Getting started"
      // z-40, di bawah modal yang memakai z-50: kalau sesuatu yang sungguh
      // menuntut jawaban terbuka, ia harus berada di atas sambutan ini.
      className="fixed bottom-4 right-4 z-40 w-[calc(100vw-2rem)] max-w-sm sm:bottom-6 sm:right-6"
    >
      <div className="animate-slide-up-fade overflow-hidden rounded-2xl border border-ash-200 bg-white shadow-2xl dark:border-white/10 dark:bg-ash-900">
        <div className="flex items-center gap-2.5 border-b border-ash-200 px-4 py-3 dark:border-white/10">
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-ash-200 bg-ash-100 text-ash-700 dark:border-white/10 dark:bg-white/5 dark:text-ash-200">
            <BrandMark size={16} />
          </div>
          <p className="text-sm font-semibold tracking-tight text-ash-900 dark:text-white">
            Getting started
          </p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close"
            className="ml-auto rounded-lg p-1.5 text-ash-500 transition-colors hover:bg-ash-100 hover:text-ash-800 dark:hover:bg-white/5 dark:hover:text-ash-200"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className="space-y-2.5 px-4 py-4">
          {BUBBLES.slice(0, tampil).map((teks, i) => (
            <p
              key={teks}
              className="animate-slide-up-fade rounded-2xl rounded-tl-md bg-ash-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-ash-800 dark:bg-white/[0.06] dark:text-ash-200"
              // Gelembung yang baru muncul dibacakan pembaca layar; yang sudah
              // ada tidak diulang.
              aria-live={i === tampil - 1 ? 'polite' : 'off'}
            >
              {teks}
            </p>
          ))}

          {!selesai && <Mengetik />}
        </div>

        {tombolTampil && (
          <div className="flex animate-slide-up-fade gap-2 border-t border-ash-200 px-4 py-3 dark:border-white/10">
            <a
              href={GUIDE_PATH}
              onClick={onClose}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ash-800 px-3.5 py-2.5 text-[13px] font-semibold text-white transition-colors duration-tint hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
            >
              Read the guide
              <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-xl border border-ash-200 px-3.5 py-2.5 text-[13px] font-semibold text-ash-700 transition-colors duration-tint hover:bg-ash-100 dark:border-white/10 dark:text-ash-300 dark:hover:bg-white/5"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Tiga titik berdenyut, penanda masih ada yang menyusul. */
function Mengetik() {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-2xl rounded-tl-md bg-ash-100 px-3.5 py-3 dark:bg-white/[0.06]"
      aria-hidden="true"
    >
      {[0, 150, 300].map((tunda) => (
        <span
          key={tunda}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-ash-400 dark:bg-ash-500"
          style={{ animationDelay: `${tunda}ms` }}
        />
      ))}
    </div>
  );
}
