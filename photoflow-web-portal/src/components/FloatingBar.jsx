import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Loader2, MessageCircle } from 'lucide-react';
import { cn } from '../lib/utils';

const FloatingBar = ({ project, selectedCount, maxSelections, onSubmit, isSubmitting, isSubmitted }) => {
  const isVisible = selectedCount > 0;
  const progress = (selectedCount / maxSelections) * 100;
  const isFull = selectedCount === maxSelections;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0, filter: "blur(10px)" }}
          animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
          exit={{ y: 100, opacity: 0, filter: "blur(10px)" }}
          transition={{ type: "spring", stiffness: 350, damping: 25 }}
          className="fixed bottom-4 sm:bottom-6 inset-x-0 z-50 flex justify-center px-4 pb-[env(safe-area-inset-bottom)] pointer-events-none"
        >
          {/* CONTAINER: Glassmorphism Blur (Bukan Tombol) */}
          <div className="bg-white/60 dark:bg-ash-900/60 backdrop-blur-xl border border-white/40 dark:border-white/10 p-2 pl-5 sm:pl-6 rounded-full shadow-2xl flex items-center gap-3 sm:gap-6 w-full max-w-md relative overflow-hidden pointer-events-auto">
            
            {/* Progress Bar Background */}
            <div className="absolute bottom-0 left-0 h-1 bg-ash-200/50 dark:bg-ash-800/50 w-full" />
            
            {/* Progress Bar Fill Sync State */}
            <motion.div 
              className={cn(
                "absolute bottom-0 left-0 h-1",
                // Kuota penuh ditandai naiknya kepekatan, bukan berubahnya
                // warna. Bilah ini duduk di atas kaca buram yang tembus ke
                // halaman di belakangnya, jadi isian pekat lebih dapat
                // diandalkan daripada gradien bercahaya.
                isFull
                  ? "bg-ash-900 dark:bg-white"
                  : "bg-ash-500 dark:bg-ash-400"
              )}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />

            {/* Counter Section */}
            <div className="flex flex-col">
              <span className="text-ash-900 dark:text-white font-semibold text-sm tracking-tight flex items-center gap-1.5">
                <div className="relative flex items-center justify-center overflow-hidden h-5 w-4">
                  <AnimatePresence mode="popLayout">
                    <motion.span
                      key={selectedCount}
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -20, opacity: 0 }}
                      transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      className="absolute"
                    >
                      {selectedCount}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <span className="text-ash-600 dark:text-ash-400 font-normal">
                  / {maxSelections} selected
                </span>
              </span>
            </div>
            
            {/* BUTTON MAIN ACTION (Solid Color / Gradient) */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                if (isSubmitted) {
                  const clientName = project?.client_name || 'Client';
                  const projectName = project?.project_name || project?.client_name || 'Gallery';
                  const adminWa = project?.admin_whatsapp || '';
                  
                  const message = `Hello, this is ${clientName}. I have finished selecting the photos for the ${projectName} project.

All of my picks are submitted in PhotoFlow and ready for editing.

Thank you.`;
                  
                  const url = `https://wa.me/${adminWa}?text=${encodeURIComponent(message)}`;
                  window.open(url, '_blank');
                } else {
                  onSubmit();
                }
              }}
              disabled={isSubmitting && !isSubmitted}
              className={cn(
                "ml-auto transition-all duration-feedback px-5 sm:px-6 py-2.5 rounded-full font-semibold text-sm flex items-center justify-center gap-2 min-h-[44px]",
                isSubmitted
                  // Hijau WhatsApp dibiarkan apa adanya: itu warna merek mereka,
                  // penanda ke mana tombol ini membawa, bukan pilihan gaya kita.
                  ? "bg-[#25D366] hover:bg-[#1DA851] text-white"
                  : isSubmitting
                    ? "bg-ash-400 dark:bg-ash-600 text-white cursor-not-allowed opacity-70"
                    : isFull
                      ? "bg-ash-900 text-white dark:bg-white dark:text-ash-950 scale-105 mr-1"
                      : "bg-ash-800 text-white hover:bg-ash-900 dark:bg-ash-100 dark:text-ash-950 dark:hover:bg-white"
              )}
            >
              <AnimatePresence mode="wait">
                <motion.span
                  key={isSubmitted ? "whatsapp" : isSubmitting ? "submitting" : isFull ? "ready" : "progress"}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center gap-2"
                >
                  {isSubmitted ? (
                    <>
                      <span>Confirm on WhatsApp</span>
                      <MessageCircle size={16} strokeWidth={1.75} />
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
                      <span>Submitting…</span>
                    </>
                  ) : isFull ? (
                    <>
                      <span>Ready to submit</span>
                      <span className="text-lg leading-none">🚀</span>
                    </>
                  ) : (
                    <>
                      <span className="hidden sm:inline">Submit selection</span>
                      <span className="sm:hidden">Submit</span>
                      <CheckCircle2 size={16} strokeWidth={1.75} />
                    </>
                  )}
                </motion.span>
              </AnimatePresence>
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FloatingBar;
