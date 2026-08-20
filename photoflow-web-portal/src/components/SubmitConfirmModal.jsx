import { useEffect, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';

/**
 * Konfirmasi sebelum pilihan dikirim ke fotografer.
 *
 * Sebelum ini tombol "Submit selection" langsung mengunci galeri. Tombol itu
 * melayang di atas grid foto, tepat di jalur ibu jari pada ponsel, dan berada
 * satu ketukan dari tindakan paling menentukan yang dilakukan klien sepanjang
 * hidup galerinya. Salah tekan berarti galeri terkunci di tengah pemilihan.
 *
 * Dua hal yang dijaga dialog ini, dan yang kedua lebih sering terjadi daripada
 * yang pertama:
 *
 *  1. Ketukan yang tidak disengaja.
 *  2. Pengiriman yang disengaja tapi terlalu dini — klien mengira sudah selesai
 *     padahal jatahnya masih tersisa belasan. Itu sebabnya sisa kuota disebut
 *     dengan angka, bukan sekadar "are you sure?".
 */
const SubmitConfirmModal = ({ open, selectedCount, maxSelections, isSubmitting, onConfirm, onCancel }) => {
  const tombolBatal = useRef(null);

  // Fokus jatuh ke BATAL, bukan ke kirim. Kalau fokusnya di tombol kirim,
  // satu ketukan Enter dari orang yang belum sempat membaca apa pun akan
  // meneruskan persis kecelakaan yang hendak dicegah dialog ini.
  useEffect(() => {
    if (open) tombolBatal.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      // Escape membatalkan, tapi tidak di tengah pengiriman: pada saat itu
      // permintaannya sudah terbang dan menutup dialog hanya menyembunyikan
      // apa yang sedang terjadi.
      if (e.key === 'Escape' && !isSubmitting) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isSubmitting, onCancel]);

  if (!open) return null;

  const sisa = maxSelections - selectedCount;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade"
      onClick={() => { if (!isSubmitting) onCancel(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="judul-konfirmasi-kirim"
        // Klik di dalam kartu tidak boleh menembus ke lapisan latar yang
        // menutup dialog.
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-sm text-center relative"
      >
        <div className="mx-auto w-12 h-12 rounded-full bg-ash-100 dark:bg-white/5 border border-ash-200 dark:border-white/10 flex items-center justify-center mb-4 text-ash-700 dark:text-ash-200">
          <Send size={22} strokeWidth={1.75} />
        </div>

        <h2 id="judul-konfirmasi-kirim" className="text-xl font-semibold text-ash-900 dark:text-ash-100 mb-2">
          Send {selectedCount} {selectedCount === 1 ? 'photo' : 'photos'}?
        </h2>

        <p className="text-sm text-ash-600 dark:text-ash-400 mb-4">
          Once sent, the gallery locks and you cannot add or remove photos yourself.
          {/* Sengaja tidak ditulis "cannot be undone". Fotografer punya tombol
              "Reopen selection" persis untuk keadaan ini, jadi kalimat itu akan
              menakuti orang dengan sesuatu yang tidak benar — dan yang paling
              menenangkan justru mengetahui jalan keluarnya ada. */}
          {' '}If you change your mind, ask your photographer to reopen it.
        </p>

        {/* Peringatan kuota hanya muncul ketika ia berarti sesuatu. Ditampilkan
            selalu, ia jadi hiasan yang dilewati mata. */}
        {sisa > 0 && (
          <p className="text-sm rounded-xl bg-ash-100 dark:bg-white/5 border border-ash-200 dark:border-white/10 px-4 py-3 mb-5 text-ash-700 dark:text-ash-300">
            You have picked <strong className="text-ash-900 dark:text-ash-100">{selectedCount} of {maxSelections}</strong>.
            You can still add <strong className="text-ash-900 dark:text-ash-100">{sisa} more</strong>.
          </p>
        )}

        <div className="flex gap-3">
          <button
            ref={tombolBatal}
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 px-4 py-3 rounded-xl border border-ash-200 dark:border-ash-700 font-medium text-sm hover:bg-ash-100 dark:hover:bg-ash-800 transition-colors disabled:opacity-50 min-h-[44px]"
          >
            Keep choosing
          </button>
          <button
            onClick={onConfirm}
            disabled={isSubmitting}
            className="flex-1 px-4 py-3 rounded-xl bg-ash-900 text-white dark:bg-white dark:text-ash-950 font-medium text-sm shadow-lg transition-colors disabled:opacity-50 flex justify-center items-center gap-2 min-h-[44px]"
          >
            {isSubmitting
              ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />
              : <>Yes, send</>}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SubmitConfirmModal;
