import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';

const Toast = ({ toasts }) => {
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[110] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex items-center gap-3 px-4 py-3 bg-ash-900 dark:bg-white text-white dark:text-ash-900 rounded-2xl shadow-2xl shadow-black/40 pointer-events-auto w-full"
          >
            <AlertCircle size={20} strokeWidth={1.75} className="text-warning-500 shrink-0" />
            <span className="text-sm font-medium tracking-tight">{toast.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default Toast;
