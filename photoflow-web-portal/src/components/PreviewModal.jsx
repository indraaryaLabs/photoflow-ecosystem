import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, CheckCircle2, X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn, swipeConfidenceThreshold, swipePower } from '../lib/utils';

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
  const [isImgLoaded, setIsImgLoaded] = useState(false);
  const [scale, setScale] = useState(1);
  const constraintsRef = useRef(null);
  
  // Touch pinch logic states
  const [pinchDist, setPinchDist] = useState(0);

  // Reset state tiap ganti foto
  useEffect(() => {
    setIsImgLoaded(false);
    setScale(1);
  }, [index]);

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

  if (!isVisible) return null;

  const currentPhoto = photos[index];
  const isSelected = selectedIds.has(currentPhoto.id);
  const highResUrl = currentPhoto.thumbnail_url.replace('&sz=w800', '&sz=w2000');

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

  const slideVariants = {
    enter: (direction) => ({ x: direction > 0 ? 500 : -500, opacity: 0, scale: 0.95 }),
    center: { zIndex: 1, x: 0, opacity: 1, scale: 1 },
    exit: (direction) => ({ zIndex: 0, x: direction < 0 ? 500 : -500, opacity: 0, scale: 0.95 })
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex flex-col touch-none"
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
          </div>
          
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/10 text-white transition-all hover:scale-105 active:scale-95 pointer-events-auto"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Swipe / Zoom Container */}
        <div className="relative flex-1 w-full h-full overflow-hidden" onClick={scale === 1 ? onClose : undefined}>
          <AnimatePresence initial={false} custom={direction} mode="wait">
            <motion.div
              key={index}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ x: { type: "spring", stiffness: 300, damping: 30 }, opacity: { duration: 0.2 } }}
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
                
                {/* Blur-up Placeholder */}
                {!isImgLoaded && (
                  <img 
                    src={currentPhoto.thumbnail_url} 
                    alt="placeholder"
                    referrerPolicy="no-referrer"
                    className="absolute max-h-[85vh] w-auto max-w-full object-contain blur-xl opacity-60 scale-105" 
                  />
                )}
                {!isImgLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center z-10">
                    <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
                  </div>
                )}

                <motion.img
                  src={highResUrl}
                  alt={`Preview ${index}`}
                  referrerPolicy="no-referrer"
                  onLoad={() => setIsImgLoaded(true)}
                  // Hanya bisa didrag/pan jika sedang di-zoom
                  drag={scale > 1}
                  dragConstraints={constraintsRef}
                  dragElastic={0.1}
                  animate={{ scale }}
                  transition={{ scale: { type: "spring", stiffness: 350, damping: 30 } }}
                  className={cn(
                    "relative max-h-[85vh] w-auto max-w-full object-contain rounded-xl select-none",
                    scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
                    isImgLoaded ? "opacity-100" : "opacity-0 transition-opacity duration-300",
                    isSelected && "ring-4 ring-indigo-500 ring-offset-4 ring-offset-black shadow-[0_0_40px_rgba(99,102,241,0.5)]"
                  )}
                  draggable="false"
                />

                <AnimatePresence>
                  {isSelected && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      className="absolute top-8 left-8 sm:top-12 sm:left-12 bg-indigo-500 text-white px-4 py-2 rounded-full font-semibold text-sm flex items-center gap-2 shadow-lg shadow-indigo-500/30 z-20 pointer-events-none"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Terpilih
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Nav Arrows */}
          <div 
            className="hidden sm:flex absolute inset-y-0 left-0 w-32 items-center justify-start p-6 cursor-pointer group pointer-events-auto z-40"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
          >
            <div className="p-3 rounded-full bg-black/20 group-hover:bg-white/20 backdrop-blur-md text-white border border-transparent group-hover:border-white/20 transition-all opacity-0 group-hover:opacity-100 -translate-x-4 group-hover:translate-x-0 shadow-lg">
              <ChevronLeft className="w-6 h-6" />
            </div>
          </div>
          <div 
            className="hidden sm:flex absolute inset-y-0 right-0 w-32 items-center justify-end p-6 cursor-pointer group pointer-events-auto z-40"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
          >
            <div className="p-3 rounded-full bg-black/20 group-hover:bg-white/20 backdrop-blur-md text-white border border-transparent group-hover:border-white/20 transition-all opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 shadow-lg">
              <ChevronRight className="w-6 h-6" />
            </div>
          </div>
        </div>

        {/* Bottom Gradient Overlay & Action Bar */}
        <div className="absolute bottom-0 inset-x-0 h-48 bg-gradient-to-t from-black/90 via-black/50 to-transparent pointer-events-none z-40" />
        
        <div className="absolute bottom-0 inset-x-0 z-50 p-6 pb-8 flex justify-center items-center gap-4 pointer-events-none">
          <button onClick={onPrev} className="sm:hidden p-4 rounded-full bg-white/10 text-white active:scale-95 transition-transform pointer-events-auto backdrop-blur-md">
            <ChevronLeft className="w-5 h-5" />
          </button>

          <button
            onClick={() => onToggleSelect(currentPhoto.id)}
            className={cn(
              "px-8 py-3.5 rounded-full font-semibold text-base flex items-center gap-2 transition-all active:scale-95 w-full max-w-[200px] justify-center shadow-xl pointer-events-auto",
              isSelected 
                ? "bg-white/10 text-white hover:bg-white/20 border border-white/20 backdrop-blur-md" 
                : "bg-indigo-500 text-white hover:bg-indigo-600 border border-indigo-500/50 shadow-indigo-500/30 hover:shadow-indigo-500/50"
            )}
          >
            {isSelected ? (
              <>
                <X className="w-5 h-5" />
                Batal Pilih
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                Pilih Foto
              </>
            )}
          </button>

          <button onClick={onNext} className="sm:hidden p-4 rounded-full bg-white/10 text-white active:scale-95 transition-transform pointer-events-auto backdrop-blur-md">
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default PreviewModal;
