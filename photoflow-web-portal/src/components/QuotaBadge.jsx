// Penanda kuota di kepala daftar project.
//
// Ada karena batas kuota sekarang ditegakkan backend, dan sebuah batas yang
// tidak terlihat sampai ia menghalangi bukan batas melainkan jebakan. Angkanya
// harus terbaca sebelum seseorang menekan "New project" di depan kliennya.

import { CircleAlert, Infinity as InfinityIcon } from 'lucide-react';

import {
  TANPA_BATAS,
  namaPaket,
  perluDiperingatkan,
  ringkasKuota,
  tanggalBerakhir,
} from '../lib/subscription';

export default function QuotaBadge({ sub, onOpen }) {
  // Belum terbaca berarti tidak digambar sama sekali. Menampilkan "0 of 0"
  // sementara datanya dalam perjalanan lebih buruk daripada ruang kosong:
  // angkanya salah, dan orang mempercayai angka.
  if (!sub) return null;

  const tanpaBatas = sub.quota === TANPA_BATAS;
  const peringatan = perluDiperingatkan(sub);
  const berakhir = tanggalBerakhir(sub);

  const warna = peringatan
    ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200 dark:hover:bg-amber-400/20'
    : 'border-ash-200 bg-white text-ash-700 hover:bg-ash-100 dark:border-white/10 dark:bg-white/[0.03] dark:text-ash-300 dark:hover:bg-white/[0.07]';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-tint ${warna}`}
      title={
        sub.active && berakhir
          ? `${namaPaket(sub.plan)} plan, active until ${berakhir}`
          : 'Free plan'
      }
    >
      {peringatan ? (
        <CircleAlert size={14} strokeWidth={2} aria-hidden="true" />
      ) : tanpaBatas ? (
        <InfinityIcon size={14} strokeWidth={2} aria-hidden="true" />
      ) : null}

      {/* tabular-nums supaya lebar penandanya tidak berubah saat angkanya
          naik. Tanpa itu "1 of 3" dan "2 of 3" punya lebar berbeda, dan
          tombol di sebelahnya bergeser setiap kali galeri dibuat. */}
      <span className="tabular-nums">
        {namaPaket(sub.plan)} &middot; {ringkasKuota(sub)}
      </span>
    </button>
  );
}
