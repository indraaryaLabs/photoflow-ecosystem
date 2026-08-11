import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Eye, ImageOff } from 'lucide-react';
import { cn } from '../lib/utils';

const PhotoCard = ({ photo, index, isSelected, onToggle, onOpenPreview }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  // Sebagian baris foto memang tidak punya thumbnail — misalnya yang lahir dari
  // proses submit, yang hanya membawa nama berkas. Sebelumnya kartunya tetap
  // merender <img> dengan src kosong, dan hasilnya kotak abu tanpa keterangan
  // yang tidak dapat dibedakan dari gambar yang gagal dimuat. Sekarang keadaan
  // itu ditampilkan apa adanya, lengkap dengan nama berkasnya, supaya foto tetap
  // bisa dikenali dan dipilih.
  const [gagalMuat, setGagalMuat] = useState(false);
  const adaGambar = Boolean(photo.thumbnailLink) && !gagalMuat;

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
      }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onToggle(photo.id)}
      onDoubleClick={() => onOpenPreview(index)}
      className={cn(
        "group relative cursor-pointer rounded-2xl overflow-hidden aspect-[2/3] bg-ash-200 dark:bg-ash-800 select-none shadow-sm hover:shadow-xl transition-all duration-300",
        // Penanda terpilih: dua cincin, terang di dalam dan gelap di luar.
        //
        // Dulu ini satu cincin indigo. Warna tunggal bukan penanda yang bisa
        // diandalkan di sini, karena yang ada di belakangnya adalah foto —
        // isinya bisa warna apa saja. Cincin indigo hilang di atas foto senja,
        // dan hampir tak terlihat di atas foto yang memang kebiruan.
        //
        // Pasangan terang-gelap selalu terbaca, di mana pun ia jatuh. Di atas
        // foto gelap, cincin putih yang menonjol. Di atas foto terang, cincin
        // putih memang menyatu, tapi cincin gelap di sebelah luarnya yang
        // memisahkan. Hal yang sama berlaku terhadap latar halaman: cincin
        // gelap terlihat di mode terang, cincin putih terlihat di mode gelap.
        // Karena itu keduanya sama di kedua mode — tidak ada yang perlu
        // ditukar.
        isSelected &&
          "shadow-[0_0_0_3px_#fff,0_0_0_6px_var(--color-ash-950)] dark:shadow-[0_0_0_3px_#fff,0_0_0_6px_var(--color-ash-950)]"
      )}
    >
      {adaGambar && !isLoaded && (
        <div className="absolute inset-0 animate-pulse bg-ash-300 dark:bg-ash-800" />
      )}

      {adaGambar ? (
        <img
          src={photo.thumbnailLink}
          alt={photo.name || 'Foto galeri'}
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoaded(true)}
          onError={() => setGagalMuat(true)}
          className={cn(
            "w-full h-full object-cover transition-opacity duration-500",
            isLoaded ? "opacity-100" : "opacity-0"
          )}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center bg-ash-200 dark:bg-ash-800">
          <ImageOff size={22} strokeWidth={1.75} className="text-ash-500 dark:text-ash-400" aria-hidden="true" />
          <span className="text-[11px] leading-snug font-medium text-ash-600 dark:text-ash-400 break-all line-clamp-3">
            {photo.name || 'Pratinjau tidak tersedia'}
          </span>
        </div>
      )}

      {/* Hover Overlay Gelap */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 z-10" />

      {/* Tombol Preview (Mata) - Desktop Hover */}
      <div className="absolute inset-0 hidden md:flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenPreview(index);
          }}
          className="p-4 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-md text-white shadow-xl border border-white/20 transition-transform hover:scale-110 pointer-events-auto active:scale-95"
          title="Lihat Detail"
        >
          <Eye size={24} strokeWidth={1.75} />
        </button>
      </div>

      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Kerudung netral, bukan semburat warna. Fungsinya meredupkan foto
            // sedikit supaya lencana centang di atasnya menonjol; memberi warna
            // pada foto orang lain bukan tugas antarmuka ini.
            className="absolute inset-0 bg-ash-950/30 z-10 pointer-events-none"
          />
        )}
      </AnimatePresence>

      {/* Area Checkmark Visual */}
      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            // Dibalik: isi putih, ikon gelap. Di atas foto sembarang, putih
            // pekat adalah satu-satunya isian yang selalu menang.
            className="absolute top-3 right-3 bg-white text-ash-950 rounded-full p-1.5 shadow-lg shadow-black/25 z-30 pointer-events-none"
          >
            <Check size={16} strokeWidth={2.25} aria-hidden="true" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default PhotoCard;
