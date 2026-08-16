import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import PhotoCard from './PhotoCard';
import { buildRows, DENSITIES, DEFAULT_DENSITY } from '../lib/justifiedRows';

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

  const tinggiTarget = DENSITIES[density]?.height ?? DENSITIES[DEFAULT_DENSITY].height;
  const rows = useMemo(
    () => buildRows(denganRasio, lebar, tinggiTarget, 8),
    [denganRasio, lebar, tinggiTarget],
  );

  const catatRasio = (id, w, h) => {
    if (!w || !h) return;
    setRasioTerukur((prev) => (prev[id] ? prev : { ...prev, [id]: w / h }));
  };

  return (
    <div ref={wadahRef} className="flex flex-col gap-2">
      {rows.map((baris, i) => (
        <div key={i} className="flex gap-2">
          {baris.map(({ photo, width, height }) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              index={denganRasio.findIndex((p) => p.id === photo.id)}
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
