import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Eye } from 'lucide-react';
import { cn } from '../lib/utils';

const PhotoCard = ({ photo, index, isSelected, onToggle, onOpenPreview }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } }
      }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onToggle(photo.id)}
      className={cn(
        "group relative cursor-pointer rounded-2xl overflow-hidden aspect-[2/3] bg-zinc-200 dark:bg-zinc-800 select-none shadow-sm hover:shadow-xl transition-all duration-300",
        isSelected && "ring-4 ring-indigo-500 ring-offset-2 ring-offset-zinc-50 dark:ring-offset-zinc-950 shadow-[0_0_25px_rgba(99,102,241,0.3)]"
      )}
    >
      {!isLoaded && <div className="absolute inset-0 animate-pulse bg-zinc-300 dark:bg-zinc-800" />}

      <img
        src={photo.thumbnail_url}
        alt="Gallery shot"
        loading="lazy"
        referrerPolicy="no-referrer"
        onLoad={() => setIsLoaded(true)}
        onError={() => setIsLoaded(true)}
        className={cn(
          "w-full h-full object-cover transition-opacity duration-500",
          isLoaded ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Hover Overlay Gelap */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 z-10" />

      {/* Tombol Preview (Mata) */}
      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
        <button
          onClick={(e) => {
            e.stopPropagation(); // Mencegah card tertrigger select
            onOpenPreview(index);
          }}
          className="p-3.5 rounded-full bg-white/20 hover:bg-white/40 backdrop-blur-md text-white shadow-xl border border-white/20 transition-transform hover:scale-110 pointer-events-auto active:scale-95"
          title="Lihat Detail"
        >
          <Eye className="w-6 h-6" />
        </button>
      </div>

      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-indigo-500/10 mix-blend-multiply dark:mix-blend-normal z-10 pointer-events-none"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSelected && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 20 }}
            className="absolute top-3 right-3 bg-indigo-500 text-white rounded-full p-1.5 shadow-lg shadow-indigo-500/40 z-30"
          >
            <Check size={16} strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default PhotoCard;
