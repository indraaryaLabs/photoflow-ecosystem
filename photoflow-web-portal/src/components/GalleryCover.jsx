/**
 * Pita sampul di kepala galeri klien.
 *
 * Layar pertama yang dilihat klien sampai sekarang: sebaris judul, sebaris
 * keterangan, lalu petak-petak abu yang belum selesai memuat. Tidak ada apa pun
 * di situ yang menyatakan siapa yang mengerjakan fotonya, dan tidak ada apa pun
 * yang terlihat seperti pekerjaan fotografi.
 *
 * Fotonya diambil dari galeri itu sendiri — foto pertamanya — jadi tidak ada
 * yang perlu diunggah, dipilih, atau disimpan di mana pun. Foto yang sama
 * muncul lagi sebagai petak pertama di bawahnya, dan itu memang bentuknya di
 * galeri-galeri sejenis: sampul yang berasal dari isinya, bukan gambar hiasan
 * yang tidak berhubungan.
 *
 * Tingginya ditahan 144-192px. Bagian judul di halaman ini pernah memakan 200px
 * untuk kalimat yang dibaca sekali, dan ruang itu sengaja dikembalikan ke foto;
 * sampul yang tumbuh melewati ukuran ini akan mengambilnya lagi untuk hal yang
 * sama.
 */
export default function GalleryCover({ photo, projectName, studioName }) {
  if (!photo?.thumbnailLink) return null;

  return (
    <div className="relative mb-6 h-36 overflow-hidden rounded-2xl bg-ash-200 sm:h-48 dark:bg-ash-900">
      <img
        src={photo.thumbnailLink}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
      />

      {/* Kain gelap dari bawah, bukan lapisan rata di seluruh gambar. Teksnya
          hanya duduk di bagian bawah, dan menggelapkan seluruh foto untuk itu
          berarti meredupkan pekerjaan yang justru hendak dipamerkan. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
        {studioName && (
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/75">
            {studioName}
          </p>
        )}
        <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight text-white sm:text-2xl">
          {projectName}
        </h1>
      </div>
    </div>
  );
}
