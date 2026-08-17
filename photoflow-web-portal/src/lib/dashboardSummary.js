/**
 * Ringkasan sekumpulan project untuk baris statistik di dashboard.
 *
 * Dihitung di peramban dari daftar yang sudah diambil, bukan lewat endpoint
 * baru. Jumlah project seorang fotografer lepas dihitung dengan puluhan, bukan
 * ribuan; menambah satu perjalanan jaringan untuk empat angka yang datanya
 * sudah ada di tangan hanya memperlambat halaman yang hendak dibuat terasa
 * lebih hidup.
 *
 * Fungsi murni dan terpisah dari komponennya supaya aturannya dapat dibaca
 * tanpa menelusuri JSX -- terutama aturan "menunggu ditinjau", yang bergantung
 * pada penanda lokal dan mudah salah dibaca kalau tersebar di dalam render.
 */

/** Berapa lama sejak `iso`, dalam bentuk sesingkat mungkin: "4h", "3d", "2w". */
export function durasiSingkat(iso) {
  if (!iso) return '';
  const waktu = new Date(iso);
  if (Number.isNaN(waktu.getTime())) return '';

  const menit = (Date.now() - waktu.getTime()) / 60000;
  if (menit < 1) return 'just now';
  if (menit < 60) return `${Math.floor(menit)}m`;
  if (menit < 1440) return `${Math.floor(menit / 60)}h`;
  if (menit < 10080) return `${Math.floor(menit / 1440)}d`;
  return `${Math.floor(menit / 10080)}w`;
}

/**
 * @param {Array} projects daftar project dari API
 * @param {Object} dilihat peta project_id -> submitted_at yang sudah dibuka
 */
export function ringkasProject(projects, dilihat = {}) {
  let perluDitinjau = 0;
  let menunggu = 0;
  let belumDibuka = 0;
  let fotoTerpilih = 0;
  let tertua = null;

  for (const p of projects) {
    const sudahKirim = Boolean(p.submitted_at);

    if (sudahKirim) {
      // Sama persis dengan aturan lencana "New" di kartu. Kalau keduanya
      // berbeda, angka di atas akan mengaku ada yang perlu ditinjau sementara
      // tidak satu pun kartu di bawahnya bertanda.
      if (dilihat[p.id] !== p.submitted_at) perluDitinjau++;
      fotoTerpilih += p.photo_count ?? 0;
      continue;
    }

    menunggu++;
    // Dihitung terpisah karena dua project yang sama-sama "menunggu" menuntut
    // tindakan yang berlawanan: yang tautannya belum pernah dibuka perlu
    // dikirim ulang, yang sudah dibuka perlu ditagih.
    if (!p.first_viewed_at) belumDibuka++;

    // Yang dicari project terbuka yang PALING LAMA menganggur -- itu yang
    // kliennya perlu ditagih. Karena itu tanggal terkecil, bukan terbesar.
    const dibuat = p.created_at ? new Date(p.created_at).getTime() : NaN;
    if (!Number.isNaN(dibuat) && (tertua === null || dibuat < tertua)) {
      tertua = dibuat;
    }
  }

  return {
    perluDitinjau,
    menunggu,
    belumDibuka,
    fotoTerpilih,
    tungguTerlama: tertua === null ? '' : durasiSingkat(new Date(tertua).toISOString()),
  };
}
