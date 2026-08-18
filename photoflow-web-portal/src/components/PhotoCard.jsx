import { memo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Maximize2, ImageOff } from 'lucide-react';
import { cn } from '../lib/utils';

const PhotoCard = ({
  photo, index, width, height, isSelected, isLocked, onToggle, onOpenPreview, onMeasure,
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [gagalMuat, setGagalMuat] = useState(false);
  const adaGambar = Boolean(photo.thumbnailLink) && !gagalMuat;
  const kurangiGerak = useReducedMotion();

  // Ukuran asli dilaporkan HANYA kalau Drive tidak mengirimkannya.
  //
  // Sebelumnya setiap gambar melaporkannya, termasuk yang ukurannya sudah
  // diketahui — nilainya dibuang oleh pemanggilnya, tapi perubahan state-nya
  // tetap terjadi dan tetap menyusun ulang seluruh tata letak. Pada galeri
  // besar itu ribuan penyusunan ulang untuk angka yang tidak dipakai sama
  // sekali.
  const perluDiukur = !photo.width || !photo.height;

  const tandaiTermuat = (el) => {
    setIsLoaded(true);
    if (perluDiukur) onMeasure?.(photo.id, el.naturalWidth, el.naturalHeight);
  };

  return (
    <motion.div
      // Lebar dan tinggi datang dari perhitungan baris, bukan dari kelas rasio
      // tetap. Itulah yang membuat foto tidak lagi dipotong.
      style={{ width, height }}
      // `layout` DIHAPUS, dan itu perbaikan performa, bukan penyederhanaan.
      //
      // Framer Motion mengukur posisi setiap elemen ber-`layout` pada setiap
      // commit -- satu reflow paksa atas seluruh galeri. Ongkos itu dibayar
      // juga pada klik memilih foto, padahal memilih foto tidak menggeser apa
      // pun; pada 55 foto itulah yang membuat setiap ketukan terasa tertinggal
      // sepersekian detik dari jarinya.
      //
      // Yang benar-benar hilang cuma sedikit: baris hanya menata ulang ketika
      // kerapatan diubah, dan di situ perpindahan seketika justru yang
      // diharapkan -- alat culling profesional pun menggantinya seketika.
      // Menyalakannya hanya pada saat itu tidak mungkin: kalau `layout` mati
      // pada render sebelumnya, Framer tidak punya posisi lama untuk
      // dianimasikan, jadi yang didapat tetap perpindahan seketika, hanya
      // ditambah kerumitan.
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      // Menekan menurunkan skala sedikit, seperti benda yang benar-benar
      // ditekan. Ini satu-satunya gerak pada kartu; membesarkannya saat kursor
      // lewat membuat seluruh baris bergeser, dan pergeseran tata letak di
      // bawah kursor adalah hal yang paling mengganggu ketika orang sedang
      // mengetuk-ngetuk memilih foto.
      whileTap={kurangiGerak || isLocked ? undefined : { scale: 0.97 }}
      onClick={() => onToggle(photo.id)}
      onDoubleClick={() => onOpenPreview(index)}
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-lg bg-ash-200 dark:bg-ash-800 select-none',
        'transition-shadow duration-feedback',
        isLocked ? 'cursor-default' : 'cursor-pointer',
        // Penanda terpilih: dua cincin, terang di dalam dan gelap di luar.
        // Yang ada di belakangnya foto, dan isinya bisa warna apa saja, jadi
        // warna tunggal bukan penanda yang bisa diandalkan. Pasangan
        // terang-gelap selalu terbaca di mana pun ia jatuh, dan karena itu sama
        // di kedua mode tema.
        isSelected
          ? 'shadow-[0_0_0_3px_#fff,0_0_0_6px_var(--color-ash-950)]'
          : 'shadow-sm hover:shadow-lg',
      )}
    >
      {adaGambar && !isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-ash-300 dark:bg-ash-800" />
      )}

      {adaGambar ? (
        <img
          src={photo.thumbnailLink}
          alt={photo.name || 'Gallery photo'}
          loading="lazy"
          // Pengurai gambar dijalankan di luar utas utama. Tanpa ini peramban
          // boleh mendekode gambar secara sinkron tepat sebelum menggambar, dan
          // pada galeri berisi puluhan foto itu tampak sebagai tersendat saat
          // menggulir -- bukan saat memuat.
          decoding="async"
          referrerPolicy="no-referrer"
          // Callback ref, bukan hanya onLoad.
          //
          // Dengan hanya baris yang terlihat yang digambar, kartu dipasang dan
          // dilepas terus-menerus selama menggulir. Gambar yang sudah ada di
          // cache tidak selalu memicu onLoad lagi saat dipasang ulang, dan
          // kalaupun memicu, ia terjadi setelah frame pertama — sehingga foto
          // yang sudah pernah dilihat berkedip abu-abu setiap kali kembali ke
          // layar. `complete` menjawabnya sebelum frame itu digambar.
          ref={(el) => {
            if (el?.complete && el.naturalWidth) tandaiTermuat(el);
          }}
          onLoad={(e) => tandaiTermuat(e.currentTarget)}
          onError={() => setGagalMuat(true)}
          // Nama transisi menghubungkan foto ini dengan gambar yang sama di
          // layar pratinjau, sehingga peramban dapat menganimasikan satu ke
          // yang lain alih-alih memudarkan keduanya. Lihat lib/viewTransition.
          style={{ viewTransitionName: `photo-${photo.id}` }}
          className={cn(
            'w-full h-full object-cover transition-opacity duration-enter',
            isLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
          <ImageOff size={20} strokeWidth={1.75} className="text-ash-500 dark:text-ash-400" aria-hidden="true" />
          <span className="text-[11px] leading-snug font-medium text-ash-600 dark:text-ash-400 break-all line-clamp-3">
            {photo.name || 'Preview unavailable'}
          </span>
        </div>
      )}

      {/* Tombol perbesar. Duduk di pojok, bukan di tengah kartu: di tengah ia
          menelan klik yang dimaksudkan untuk memilih, dan memilih adalah
          pekerjaan utama di layar ini.

          Dulu tombol ini `hidden md:grid`, sehingga di ponsel dan tablet ia
          tidak ada sama sekali. Satu-satunya jalan tersisa untuk membuka foto
          adalah ketukan ganda — dan ketukan ganda di sini justru memilih lalu
          membatalkan pilihan, karena setiap ketukan tunggal sudah menyalakan
          pemilihan. Akibatnya di layar sentuh foto memang TIDAK BISA dilihat
          besar sama sekali.

          Sekarang selalu ada. Di layar sentuh ia terlihat tetap; di layar
          berpenunjuk ia tetap muncul hanya saat kursor lewat, karena di sana
          kursornya sendiri yang menyatakan kartu mana yang sedang dituju.
          Pembedanya `(hover: hover)`, bukan lebar layar: tablet lebar tanpa
          tetikus akan lolos dari pemeriksaan lebar dan kembali kehilangan
          tombolnya. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenPreview(index);
        }}
        className="absolute bottom-2 right-2 z-20 grid h-9 w-9 place-items-center rounded-lg bg-ash-950/60 text-white backdrop-blur-sm transition-opacity duration-feedback [@media(hover:hover)]:h-8 [@media(hover:hover)]:w-8 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        title="View larger"
        aria-label={`View ${photo.name || 'photo'} larger`}
      >
        <Maximize2 size={15} strokeWidth={2} />
      </button>

      {/* Lencana centang. Foto TIDAK diredupkan saat terpilih: meredupkan
          justru menyulitkan pekerjaan yang sedang dilakukan orangnya, yaitu
          membandingkan foto satu sama lain. Cincin dan lencana sudah cukup. */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={kurangiGerak ? false : { scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={kurangiGerak ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 26 }}
            className="absolute top-2 left-2 z-30 grid h-6 w-6 place-items-center rounded-full bg-white text-ash-950 shadow-md shadow-black/30 pointer-events-none"
          >
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

/**
 * Di-memo karena grid ini dirender ulang setiap kali satu foto dipilih.
 *
 * Tanpa memo, mengetuk satu foto merender ulang SELURUH kartu di galeri —
 * pada 55 foto itu 55 komponen Framer Motion beserta AnimatePresence-nya, untuk
 * perubahan yang hanya menyentuh satu kartu. Dengan memo, yang dirender ulang
 * hanya kartu yang keadaannya benar-benar berubah.
 *
 * Semua prop-nya bernilai primitif atau berkelakuan stabil: `photo` berasal
 * dari daftar yang sama, dan `onToggle`, `onOpenPreview`, serta `onMeasure`
 * dibungkus useCallback di pemanggilnya. Perbandingan dangkal bawaan karena itu
 * sudah benar, dan pembanding khusus hanya akan jadi tempat baru untuk keliru.
 */
export default memo(PhotoCard);
