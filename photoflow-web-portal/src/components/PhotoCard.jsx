import { useState } from 'react';
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

  return (
    <motion.div
      // Lebar dan tinggi datang dari perhitungan baris, bukan dari kelas rasio
      // tetap. Itulah yang membuat foto tidak lagi dipotong.
      style={{ width, height }}
      layout={kurangiGerak ? false : 'position'}
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
          referrerPolicy="no-referrer"
          onLoad={(e) => {
            setIsLoaded(true);
            onMeasure?.(photo.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
          }}
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
          pekerjaan utama di layar ini. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpenPreview(index);
        }}
        className="absolute bottom-2 right-2 z-20 hidden md:grid h-8 w-8 place-items-center rounded-lg bg-ash-950/55 text-white opacity-0 backdrop-blur-sm transition-opacity duration-feedback group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        title="View larger"
        aria-label={`View ${photo.name || 'photo'} larger`}
      >
        <Maximize2 size={14} strokeWidth={2} />
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

export default PhotoCard;
