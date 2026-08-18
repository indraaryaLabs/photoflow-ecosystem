import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CheckCircle2, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn, swipeConfidenceThreshold, swipePower } from '../lib/utils';
import { ubahUkuran, UKURAN_GRID, UKURAN_PRATINJAU } from '../lib/thumbnailUrl';

/** Alamat versi resolusi tinggi sebuah foto. */
function resolusiTinggi(photo) {
  return ubahUkuran(photo.thumbnailLink || photo.thumbnail_url || '', UKURAN_PRATINJAU);
}

/**
 * Alamat yang SAMA PERSIS dengan yang dipakai grid.
 *
 * Harus sama persis, kalau tidak lapisan dasarnya bukan gambar dari cache
 * melainkan unduhan baru — dan seluruh gunanya, yaitu tampil seketika, hilang.
 */
function versiGrid(photo) {
  return ubahUkuran(photo.thumbnailLink || photo.thumbnail_url || '', UKURAN_GRID);
}

const PreviewModal = ({
  photos, 
  previewState, 
  onClose, 
  onNext, 
  onPrev, 
  selectedIds, 
  onToggleSelect, 
  project 
}) => {
  const { index, direction } = previewState;
  const isVisible = index !== null;
  // Foto KEBERAPA yang sudah selesai dimuat, bukan sekadar "sudah/belum".
  //
  // Dengan begitu berpindah foto tidak menuntut penyetelan ulang sama sekali:
  // nilainya tidak lagi cocok dengan index yang baru, jadi keadaan "belum
  // dimuat" muncul dengan sendirinya.
  const [loadedIndex, setLoadedIndex] = useState(null);
  const isImgLoaded = loadedIndex === index;

  // Sama untuk thumbnail-nya, dan alasannya sama: menyimpan "sudah/belum" akan
  // menuntut penyetelan ulang tiap kali foto berganti.
  const [thumbLoadedIndex, setThumbLoadedIndex] = useState(null);
  const isThumbLoaded = thumbLoadedIndex === index;

  const [scale, setScale] = useState(1);
  const constraintsRef = useRef(null);

  // Touch pinch logic states
  const [pinchDist, setPinchDist] = useState(0);

  // Zoom disetel ulang saat foto berganti, dan itu dilakukan SAAT RENDER,
  // bukan di dalam effect.
  //
  // Versi lama memakai useEffect: React merender foto baru dengan zoom lama
  // lebih dulu, menampilkannya, lalu effect berjalan dan memicu render kedua.
  // Foto berikutnya sempat berkedip dalam keadaan ter-zoom. Pola di bawah ini
  // yang dianjurkan React untuk menyesuaikan state ketika prop berubah — tidak
  // ada render yang terlanjur terlihat.
  const [indexSebelumnya, setIndexSebelumnya] = useState(index);
  if (indexSebelumnya !== index) {
    setIndexSebelumnya(index);
    setScale(1);
  }

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isVisible) return;
      if (e.key === 'Escape') onClose();
      if (scale === 1) { // Hanya navigasi keyboard jika tidak di-zoom
        if (e.key === 'ArrowRight') onNext();
        if (e.key === 'ArrowLeft') onPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose, onNext, onPrev, scale]);

  useEffect(() => {
    if (isVisible) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; };
  }, [isVisible]);

  // Muat dulu foto sebelum dan sesudahnya.
  //
  // Ini sebab utama jeda saat berpindah foto. Alamat resolusi tingginya
  // berbeda dari alamat thumbnail di grid, jadi setiap kali tombol berikutnya
  // ditekan peramban memulai unduhan yang sama sekali baru ke Google — dan yang
  // terlihat orangnya adalah layar hitam dengan pemutar berputar.
  //
  // Orang membuka pratinjau untuk MEMBANDINGKAN foto, jadi tetangganya hampir
  // pasti dibuka berikutnya. Diminta lebih awal, gambarnya sudah ada di cache
  // peramban ketika gilirannya tiba, dan perpindahannya tidak lagi menunggu
  // jaringan sama sekali.
  useEffect(() => {
    if (!isVisible) return;

    // Objek Image dibuang begitu effect ini dibersihkan, tapi unduhannya sudah
    // masuk cache HTTP peramban — itu yang dipakai <img> berikutnya.
    const gambar = [index - 1, index + 1]
      .filter((i) => i >= 0 && i < photos.length)
      .map((i) => {
        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.src = resolusiTinggi(photos[i]);
        return img;
      });

    return () => gambar.forEach((img) => { img.src = ''; });
  }, [isVisible, index, photos]);

  if (!isVisible) return null;

  const currentPhoto = photos[index];
  const isSelected = selectedIds.has(currentPhoto.id);
  const thumbUrl = versiGrid(currentPhoto);
  const highResUrl = resolusiTinggi(currentPhoto);

  // Zoom Handlers
  const handleWheel = (e) => {
    setScale((prev) => Math.min(Math.max(1, prev - e.deltaY * 0.005), 3));
  };

  const handleDoubleClick = () => {
    setScale((prev) => (prev > 1 ? 1 : 2.5)); // Toggle max/min zoom
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setPinchDist(dist);
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = dist - pinchDist;
      setScale((prev) => Math.min(Math.max(1, prev + delta * 0.01), 3));
      setPinchDist(dist);
    }
  };

  // Jarak gesernya 64px, bukan 500px.
  //
  // Pada 500px fotonya terbang masuk dari luar layar, dan karena pegasnya harus
  // menempuh jarak itu, perpindahan terasa jauh dan lamban — persis keluhan
  // "kayak jauh". Yang perlu disampaikan sebuah geseran hanya ARAH, bukan
  // jarak; 64px sudah cukup untuk itu, dan tiba jauh lebih cepat.
  const GESER = 64;
  const slideVariants = {
    enter: (direction) => ({ x: direction > 0 ? GESER : -GESER, opacity: 0 }),
    center: { zIndex: 1, x: 0, opacity: 1 },
    exit: (direction) => ({ zIndex: 0, x: direction < 0 ? GESER : -GESER, opacity: 0 }),
  };

  // Tween pendek, bukan pegas. Pegas dengan stiffness 300/damping 30 punya ekor
  // panjang: gerakannya secara teknis selesai jauh setelah mata menganggapnya
  // selesai. Untuk perpindahan yang dilakukan berulang-ulang puluhan kali,
  // ekor itulah yang menumpuk jadi rasa lambat.
  const slideTransition = {
    x: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
    opacity: { duration: 0.14 },
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        // backdrop-blur-xl DIHAPUS. Latarnya hitam 95% — apa pun di belakangnya
        // sudah tidak terlihat, jadi blurnya tidak pernah tampak sama sekali.
        // Yang tersisa cuma ongkosnya: satu lapisan blur GPU seluas layar yang
        // digambar ulang pada setiap frame animasi geser.
        className="fixed inset-0 z-[100] bg-black/95 flex flex-col touch-none"
      >
        <div className="absolute top-0 inset-x-0 z-50 flex items-center justify-between p-4 sm:p-6 bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
          <div className="flex items-center gap-3 pointer-events-auto">
            <div className="px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/10 shadow-lg">
              <span className="text-white text-sm font-medium tracking-tight">
                {project.client_name}
              </span>
            </div>
            <span className="text-white/50 text-sm font-medium">
              {index + 1} / {photos.length}
            </span>

            {/* Penanda "Terpilih" duduk di baris ini, bukan melayang di pojok
                kiri atas foto. Di posisi lamanya (top-8 left-8) ia jatuh tepat
                di belakang bilah header, yang ber-z-50 sementara lencananya
                z-20 — jadi tulisannya tertutup separuh. Menaikkan z-index-nya
                saja hanya menukar siapa yang menutupi siapa; keduanya memang
                berebut petak yang sama. Di sini ia sebaris dengan nomor foto,
                yang juga keterangan tentang foto yang sedang dibuka. */}
            <AnimatePresence>
              {isSelected && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white text-ash-950 text-xs font-semibold shadow-lg shadow-black/30"
                >
                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden="true" />
                  Selected
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all hover:scale-105 active:scale-95 pointer-events-auto"
          >
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        {/* Swipe / Zoom Container */}
        <div className="relative flex-1 w-full h-full overflow-hidden" onClick={scale === 1 ? onClose : undefined}>
          {/* mode="wait" DIHAPUS.
              Dengannya, foto berikutnya baru dipasang setelah foto sebelumnya
              selesai keluar — jadi permintaan gambarnya pun baru dimulai
              setelah animasi keluar habis. Ratusan milidetik terbuang sebelum
              satu byte pun diminta, dan yang terlihat orangnya adalah layar
              hitam. Tanpa mode="wait" keduanya bersilangan, dan gambar baru
              mulai dimuat pada milidetik pertama. */}
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={index}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={slideTransition}
              // Disable drag slider jika gambar sedang dizoom!
              drag={scale === 1 ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={1}
              onDragEnd={(e, { offset, velocity }) => {
                if (scale > 1) return;
                const swipe = swipePower(offset.x, velocity.x);
                if (swipe < -swipeConfidenceThreshold) onNext();
                else if (swipe > swipeConfidenceThreshold) onPrev();
              }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {/* Constraints Area untuk Pan Image */}
              <div 
                ref={constraintsRef} 
                className="relative w-full h-full flex items-center justify-center touch-none overflow-hidden"
                onWheel={handleWheel}
                onDoubleClick={handleDoubleClick}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onClick={(e) => e.stopPropagation()} // Prevent close on image click
              >
                
                {/* Lapisan dasar: thumbnail yang SAMA dengan yang dipakai grid.
                    Gambar itu sudah ada di cache peramban sejak galeri dimuat,
                    jadi ia tergambar pada frame pertama — tanpa jaringan, tanpa
                    jeda. Fotonya langsung terlihat, hanya belum tajam, dan versi
                    tajamnya memudar masuk di atasnya begitu tiba.

                    Sebelumnya tempat ini diisi pemutar berputar di atas layar
                    hitam. Padahal gambar yang bisa ditampilkan seketika sudah
                    ada di tangan sejak awal.

                    Blurnya `blur-md`, bukan `blur-xl`: yang sedang ditutupi
                    hanya selisih ketajaman antara thumbnail dan resolusi
                    penuh, bukan gambar yang sama sekali belum ada. Dan `scale`
                    dilepas — membesarkan gambar buram membuat fotonya tampak
                    melompat sedikit tepat saat versi tajamnya muncul. */}
                <img
                  src={thumbUrl}
                  alt=""
                  aria-hidden="true"
                  referrerPolicy="no-referrer"
                  onLoad={() => setThumbLoadedIndex(index)}
                  className={cn(
                    'absolute max-h-[85vh] w-auto max-w-full object-contain rounded-xl',
                    isImgLoaded ? 'opacity-0' : 'opacity-100 blur-md',
                  )}
                />

                {/* Pemutar berputar hanya kalau thumbnail-nya pun belum ada —
                    keadaan yang sekarang jarang, dan satu-satunya keadaan yang
                    benar-benar tidak punya apa pun untuk ditampilkan. */}
                {!isImgLoaded && !isThumbLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 size={32} strokeWidth={1.75} className="text-white/50 animate-spin" />
                  </div>
                )}

                <motion.img
                  src={highResUrl}
                  alt={currentPhoto.name || `Photo ${index + 1} of ${photos.length}`}
                  referrerPolicy="no-referrer"
                  onLoad={() => setLoadedIndex(index)}
                  // Nama yang sama dengan foto di grid. Itu yang membuat
                  // peramban menganimasikan satu ke yang lain.
                  style={{ viewTransitionName: `photo-${currentPhoto.id}` }}
                  // Hanya bisa didrag/pan jika sedang di-zoom
                  drag={scale > 1}
                  dragConstraints={constraintsRef}
                  dragElastic={0.1}
                  animate={{ scale }}
                  transition={{ scale: { type: "spring", stiffness: 350, damping: 30 } }}
                  className={cn(
                    "relative max-h-[85vh] w-auto max-w-full object-contain rounded-xl select-none",
                    scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
                    isImgLoaded ? "opacity-100" : "opacity-0 transition-opacity duration-enter",
                    // Latar layar ini selalu hitam, jadi celah hitam di antara
                    // foto dan cincin sudah cukup memisahkan keduanya bahkan
                    // ketika fotonya terang.
                    isSelected && "ring-4 ring-white ring-offset-4 ring-offset-black"
                  )}
                  draggable="false"
                />

              </div>
            </motion.div>
          </AnimatePresence>

          {/* Nav Arrows */}
          <div 
            className="hidden sm:flex absolute inset-y-0 left-0 w-32 items-center justify-start p-6 cursor-pointer group pointer-events-auto z-40"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
          >
            <div className="p-3 rounded-full bg-black/20 group-hover:bg-white/20 backdrop-blur-md text-white border border-transparent group-hover:border-white/20 transition-all opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 shadow-lg">
              <ChevronLeft size={24} strokeWidth={1.75} />
            </div>
          </div>
          <div 
            className="hidden sm:flex absolute inset-y-0 right-0 w-32 items-center justify-end p-6 cursor-pointer group pointer-events-auto z-40"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
          >
            <div className="p-3 rounded-full bg-black/20 group-hover:bg-white/20 backdrop-blur-md text-white border border-transparent group-hover:border-white/20 transition-all opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 shadow-lg">
              <ChevronRight size={24} strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* Bottom Gradient Overlay & Action Bar */}
        <div className="absolute bottom-0 inset-x-0 h-48 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none z-40" />
        
        <div className="absolute bottom-0 inset-x-0 z-50 p-6 pb-8 flex justify-center items-center gap-4 pointer-events-none">
          <button onClick={onPrev} className="sm:hidden p-4 rounded-full bg-white/10 text-white active:scale-95 transition-transform pointer-events-auto backdrop-blur-md">
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>

          <button
            onClick={() => onToggleSelect(currentPhoto.id)}
            className={cn(
              // max-w dinaikkan dari 200px dan padding diturunkan: pada 200px
              // "Select photo" terbungkus jadi dua baris, dan tombol utama
              // setinggi dua baris di tengah bawah layar terlihat seperti
              // kesalahan tata letak. `whitespace-nowrap` menjaga agar
              // terjemahan yang lebih panjang pun tidak mengulanginya.
              "px-6 py-3.5 rounded-full font-semibold text-base flex items-center gap-2 transition-all active:scale-95 w-full max-w-[230px] justify-center whitespace-nowrap shadow-xl pointer-events-auto",
              isSelected 
                ? "bg-white/10 text-white hover:bg-white/20 border border-white/20 backdrop-blur-md" 
                : "bg-white text-ash-950 hover:bg-ash-100 border border-white/20 shadow-black/40"
            )}
          >
            {isSelected ? (
              <>
                <X size={20} strokeWidth={1.75} />
                Deselect
              </>
            ) : (
              <>
                <Check size={20} strokeWidth={1.75} />
                Select photo
              </>
            )}
          </button>

          <button onClick={onNext} className="sm:hidden p-4 rounded-full bg-white/10 text-white active:scale-95 transition-transform pointer-events-auto backdrop-blur-md">
            <ChevronRight size={20} strokeWidth={1.75} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PreviewModal;
