import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PhotoCard from './PhotoCard';
import { buildRows, DENSITIES, targetHeight } from '../lib/justifiedRows';

const GAP = 8;

// Berapa piksel di luar layar yang tetap digambar, di atas dan di bawah.
//
// Terlalu kecil, petak kosong sempat terlihat saat menggulir cepat. Terlalu
// besar, penghematannya hilang. Satu layar penuh ke tiap arah adalah titik
// tengah yang lazim dipakai galeri sejenis.
const LUAR_LAYAR = 800;

/** Indeks baris terakhir yang puncaknya masih di atas `y`. Pencarian biner. */
function cariBaris(offset, y) {
  let lo = 0;
  let hi = offset.length - 1;
  while (lo < hi) {
    const tengah = (lo + hi + 1) >> 1;
    if (offset[tengah] <= y) lo = tengah;
    else hi = tengah - 1;
  }
  return lo;
}

/**
 * Galeri klien, disusun sebagai baris setinggi seragam.
 *
 * Yang digantikan: grid empat kolom dengan setiap petak dipaksa ke rasio 2:3
 * dan `object-cover`. Setiap foto lanskap dipotong jadi potret, dan setiap
 * potret dipotong lebih sempit lagi. Pada produk yang isinya karya orang, itu
 * kerusakan yang paling cepat disadari pemiliknya.
 *
 * Rasio didapat dari tiga sumber, berurutan: ukuran yang dikirim Drive,
 * ukuran yang terbaca sendiri setelah gambarnya termuat, dan 3:2 sebagai
 * tebakan awal. Yang terakhir itu rasio sensor kamera paling umum, jadi
 * tebakan yang meleset pun hanya menggeser sedikit.
 *
 * HANYA baris yang terlihat yang digambar. Galeri 2.000 foto — ukuran yang
 * biasa untuk satu pemotretan — sebelumnya memasang 2.000 komponen sekaligus
 * beserta 2.000 elemen gambar, dan halaman itu butuh 16 detik sebelum foto
 * pertamanya muncul. Tingginya sudah diketahui sebelum digambar, jadi bilah
 * gulir tetap sepanjang seharusnya dan posisi gulir tidak pernah melompat.
 */
export default function PhotoGrid({ photos, selectedIds, onToggle, onOpenPreview, density, isLocked }) {
  const wadahRef = useRef(null);
  const [lebar, setLebar] = useState(0);

  // Rasio yang diukur sendiri, untuk foto yang ukurannya tidak dikirim Drive.
  const [rasioTerukur, setRasioTerukur] = useState({});

  // ResizeObserver, bukan event resize di window: yang menentukan tata letak
  // adalah lebar wadahnya, dan itu berubah juga ketika bilah sisi muncul atau
  // scrollbar hilang -- dua hal yang tidak memicu event resize sama sekali.
  useLayoutEffect(() => {
    const el = wadahRef.current;
    if (!el) return;

    const pengamat = new ResizeObserver(([entri]) => {
      setLebar(entri.contentRect.width);
    });
    pengamat.observe(el);
    setLebar(el.getBoundingClientRect().width);
    return () => pengamat.disconnect();
  }, []);

  const denganRasio = useMemo(() => photos.map((foto) => ({
    ...foto,
    aspect:
      (foto.width && foto.height ? foto.width / foto.height : null)
      ?? rasioTerukur[foto.id]
      ?? 1.5,
  })), [photos, rasioTerukur]);

  // Dihitung dari lebar wadah, bukan angka tetap. Lihat DENSITIES untuk
  // alasannya: tinggi tetap membuat ketiga pilihan kerapatan menghasilkan tata
  // letak yang sama di layar ponsel.
  const tinggiTarget = targetHeight(density, lebar);
  const rows = useMemo(
    () => buildRows(denganRasio, lebar, tinggiTarget, GAP),
    [denganRasio, lebar, tinggiTarget],
  );

  // Posisi puncak tiap baris, dan tinggi seluruh galeri.
  //
  // Dihitung di muka supaya wadahnya bisa diberi tinggi yang benar sejak awal.
  // Tanpa itu, memendekkan isi yang digambar akan memendekkan halaman, bilah
  // gulir melompat-lompat, dan menggulir cepat berakhir di tempat yang salah.
  const tataLetak = useMemo(() => {
    const offset = new Array(rows.length);
    let atas = 0;
    for (let i = 0; i < rows.length; i++) {
      offset[i] = atas;
      atas += (rows[i][0]?.height ?? 0) + GAP;
    }
    return { offset, tinggi: Math.max(0, atas - GAP) };
  }, [rows]);

  const [rentang, setRentang] = useState({ mulai: 0, akhir: 0 });

  // Dibaca oleh penangan gulir tanpa memasang ulang pendengarnya setiap kali
  // tata letaknya berubah. Diisi di layout effect, bukan saat render: menulis
  // ref selama render dilarang React, dan di sini tidak ada gunanya juga —
  // penangan gulir baru membacanya setelah commit.
  const tataLetakRef = useRef(tataLetak);

  const hitungRentang = useCallback(() => {
    const el = wadahRef.current;
    const { offset } = tataLetakRef.current;
    if (!el || offset.length === 0) return;

    // Jarak puncak galeri terhadap puncak layar. Negatif berarti galerinya
    // sudah tergulung melewati bagian atas.
    const atasGaleri = -el.getBoundingClientRect().top;
    const dari = atasGaleri - LUAR_LAYAR;
    const sampai = atasGaleri + window.innerHeight + LUAR_LAYAR;

    const mulai = cariBaris(offset, dari);
    const akhir = Math.min(offset.length, cariBaris(offset, sampai) + 2);

    // Hanya setel ketika rentangnya benar-benar berubah. Tanpa penjagaan ini
    // setiap event gulir memicu render, dan menggulir jadi berat justru karena
    // upaya membuatnya ringan.
    setRentang((prev) => (prev.mulai === mulai && prev.akhir === akhir ? prev : { mulai, akhir }));
  }, []);

  useEffect(() => {
    hitungRentang();
    window.addEventListener('scroll', hitungRentang, { passive: true });
    window.addEventListener('resize', hitungRentang);
    return () => {
      window.removeEventListener('scroll', hitungRentang);
      window.removeEventListener('resize', hitungRentang);
    };
  }, [hitungRentang]);

  // Tata letaknya berubah ketika kerapatan diubah, wadahnya melebar, atau
  // rasio yang tadinya ditebak akhirnya terukur. Rentangnya harus ikut dihitung
  // ulang sebelum frame berikutnya digambar, kalau tidak akan ada satu frame
  // berisi baris yang salah.
  useLayoutEffect(() => {
    tataLetakRef.current = tataLetak;
    hitungRentang();
  }, [tataLetak, hitungRentang]);

  // Nomor urut tiap foto, dihitung sekali.
  //
  // Sebelumnya `denganRasio.findIndex(...)` dipanggil di dalam render SETIAP
  // kartu, jadi ongkosnya kuadratik: 55 foto berarti 3.025 perbandingan, 500
  // foto berarti 250.000 -- dan seluruhnya diulang setiap kali satu foto
  // dipilih, karena berubahnya `selectedIds` membuat grid ini dirender ulang.
  const nomorUrut = useMemo(() => {
    const peta = new Map();
    denganRasio.forEach((p, i) => peta.set(p.id, i));
    return peta;
  }, [denganRasio]);

  // Rasio yang baru terukur dikumpulkan dulu, lalu disetel sekali per frame.
  //
  // Setiap gambar yang selesai dimuat dulu memicu satu perubahan state
  // tersendiri, dan setiap perubahan itu menghitung ulang SELURUH daftar rasio,
  // menyusun ulang SELURUH baris, lalu merender ulang grid-nya. Pada 2.000 foto
  // itu 2.000 kali pekerjaan sebesar 2.000 — dan itulah yang membekukan
  // halamannya, bukan jumlah fotonya sendiri.
  const tertunda = useRef(null);
  const catatRasio = useCallback((id, w, h) => {
    if (!w || !h) return;

    if (!tertunda.current) {
      tertunda.current = new Map();
      requestAnimationFrame(() => {
        const kumpulan = tertunda.current;
        tertunda.current = null;
        if (!kumpulan?.size) return;

        setRasioTerukur((prev) => {
          let berubah = false;
          const next = { ...prev };
          for (const [k, v] of kumpulan) {
            if (!next[k]) { next[k] = v; berubah = true; }
          }
          // Objek yang sama dikembalikan ketika tidak ada yang baru, sehingga
          // React melewati render-nya sama sekali.
          return berubah ? next : prev;
        });
      });
    }
    tertunda.current.set(id, w / h);
  }, []);

  const { mulai, akhir } = rentang;
  const terlihat = rows.slice(mulai, akhir);

  return (
    <div
      ref={wadahRef}
      className="relative"
      // Tinggi penuh dipasang di muka. Baris digambar pada posisi mutlaknya,
      // jadi jarak antarbaris sudah termasuk di dalam offset -- tidak ada
      // `gap` di sini yang bisa ikut terhitung dua kali.
      style={{ height: tataLetak.tinggi }}
    >
      {terlihat.map((baris, i) => (
        <div
          key={mulai + i}
          className="absolute inset-x-0 flex"
          style={{ top: tataLetak.offset[mulai + i], gap: GAP }}
        >
          {baris.map(({ photo, width, height }) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              index={nomorUrut.get(photo.id) ?? 0}
              width={width}
              height={height}
              isSelected={selectedIds.has(photo.id)}
              isLocked={isLocked}
              onToggle={onToggle}
              onOpenPreview={onOpenPreview}
              onMeasure={catatRasio}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Pemilih kerapatan.
 *
 * Setiap alat culling profesional punya ini, dan alasannya bukan selera:
 * memilih foto favorit dan memeriksa ketajaman adalah dua pekerjaan berbeda
 * yang menuntut ukuran berbeda.
 */
export function DensityPicker({ value, onChange }) {
  return (
    <div
      className="flex gap-1 p-1 rounded-xl bg-ash-100 dark:bg-white/5"
      role="radiogroup"
      aria-label="Photo size"
    >
      {Object.entries(DENSITIES).map(([id, { label }]) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors duration-tint ${
            value === id
              ? 'bg-white text-ash-900 shadow-sm dark:bg-ash-800 dark:text-ash-100'
              : 'text-ash-600 hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-200'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
