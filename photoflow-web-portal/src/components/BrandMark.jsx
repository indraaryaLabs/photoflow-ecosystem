import { useId } from 'react';

/**
 * Lambang PhotoFlow: huruf "P" yang dipotong sebuah garis diagonal.
 *
 * Dua hal yang membuatnya tidak seperti logo bawaan pustaka ikon:
 *
 * 1. Guratannya berujung siku (`square`), bukan bulat. Ikon Lucide dan
 *    sejenisnya hampir selalu berujung bulat — memakai ujung siku di sini
 *    cukup untuk membedakan lambang dari ikon-ikon di sekitarnya, tanpa
 *    terlihat asing.
 * 2. Celah antara garis diagonal dan badan "P" dibuat dengan `<mask>`
 *    sungguhan, bukan dengan menimpa garis memakai warna latar. Menimpa
 *    warna latar hanya berhasil kalau latarnya benar-benar warna itu; di
 *    sini lambangnya dipakai di atas kartu terang, di atas kotak abu
 *    tembus pandang, dan di atas kotak pekat di layar masuk. Mask bekerja
 *    di semuanya karena yang dihapus adalah pikselnya, bukan ditutupi.
 *
 * Warnanya selalu `currentColor`, jadi pewarnaan diatur oleh kelas Tailwind
 * pada elemen pembungkusnya — sama seperti ikon lain di aplikasi ini.
 */
export default function BrandMark({ size = 24, className, title }) {
  // useId supaya beberapa lambang di satu halaman tidak saling merebut id
  // mask yang sama. Id yang dihasilkan React mengandung ":" — sah di
  // dokumen HTML, tapi harus dirujuk lewat url(#...) apa adanya, jadi
  // tanda titik dua itu dibuang agar aman dipakai di selector mana pun.
  const maskId = `brandmark-${useId().replace(/:/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      className={className}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
        {/* Putih = terlihat, hitam = terhapus. */}
        <rect width="32" height="32" fill="white" />
        <path d="M4 21.5 20.5 5" stroke="black" strokeWidth="4.5" />
      </mask>

      {/* Badan huruf: tiang kiri, lalu mangkuk setengah lingkaran. */}
      <path
        d="M9 26V6h9a6.5 6.5 0 0 1 0 13H9"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="square"
        mask={`url(#${maskId})`}
      />

      {/* Garis diagonal, digambar setelah celahnya dibuat. */}
      <path d="M4 21.5 20.5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
    </svg>
  );
}
