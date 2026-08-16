import { useEffect, useState } from 'react';
import { Check, Copy, Loader2, X, AlertTriangle, Grid2x2, List, ImageOff } from 'lucide-react';
import {
  buildLightroomList,
  namesWithSpaces,
  MODE_BASENAME,
  MODE_ORIGINAL,
  MODE_REPLACE,
  RAW_EXTENSIONS,
} from '../lib/lightroomList';

/**
 * Daftar nama berkas pilihan klien, siap ditempel ke penyaring Lightroom.
 *
 * Ini jalan terpendek dari "klien sudah memilih" ke "foto pilihannya tersorot
 * di Lightroom", dan ia tidak menyentuh satu berkas pun. Aplikasi desktop
 * mengerjakan hal yang lebih ambisius — menyalin RAW-nya ke folder baru — tapi
 * itu menuntut pemasangan, menuntut arsipnya ada di komputer yang sama, dan
 * menyalin berkas berukuran gigabyte. Layar ini bekerja dari peramban mana pun,
 * termasuk tablet, beberapa detik setelah pemberitahuan masuk.
 */
export default function SelectionListModal({ project, onClose, onFetch, onToast }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [names, setNames] = useState([]);
  const [fotoTerpilih, setFotoTerpilih] = useState([]);
  // Dua cara melihat pilihan yang sama. 'grid' untuk memeriksa dengan mata,
  // 'list' untuk disalin ke Lightroom. Bawaannya grid: memeriksa lebih dulu,
  // menyalin sesudahnya.
  const [tampilan, setTampilan] = useState('grid');
  const [mode, setMode] = useState(MODE_BASENAME);
  const [extension, setExtension] = useState('CR3');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dibatalkan = false;
    onFetch(project.id)
      .then((data) => {
        if (dibatalkan) return;
        setNames(data.file_names || []);
        setFotoTerpilih(data.photos || []);
        setLoading(false);
      })
      .catch((err) => {
        if (dibatalkan) return;
        setError(err.message || 'Could not read the selection.');
        setLoading(false);
      });
    return () => { dibatalkan = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = buildLightroomList(names, { mode, extension });
  const berspasi = namesWithSpaces(names);

  const handleCopy = () => {
    // Cara yang sama dengan penyalinan magic link: execCommand tetap bekerja
    // di konteks yang tidak memberi izin clipboard modern.
    const area = document.createElement('textarea');
    area.value = list;
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onToast?.(`${names.length} filename${names.length === 1 ? '' : 's'} copied.`);
    } catch {
      onToast?.('Could not copy the list.', 'error');
    }
    document.body.removeChild(area);
  };

  const pilihan = [
    { id: MODE_BASENAME, label: 'Without extension', hint: 'Matches your RAW files' },
    { id: MODE_ORIGINAL, label: 'As uploaded', hint: 'Keeps .jpg' },
    { id: MODE_REPLACE, label: 'Replace extension', hint: 'Pick the format below' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-slide-up-fade">
      <div className="bg-white dark:bg-ash-900 border border-ash-200 dark:border-white/10 shadow-2xl rounded-2xl p-6 w-full max-w-lg relative">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-ash-500 hover:text-ash-600 dark:hover:text-ash-200 transition-colors"
          aria-label="Close"
        >
          <X size={20} strokeWidth={1.75} />
        </button>

        <h2 className="text-xl font-semibold text-ash-900 dark:text-ash-100">
          {tampilan === 'grid' ? "Your client's picks" : 'Filenames for Lightroom'}
        </h2>
        <p className="text-sm text-ash-600 dark:text-ash-400 mt-1">
          {project.client_name}
          {project.project_name ? ` · ${project.project_name}` : ''}
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-10 justify-center text-ash-600 dark:text-ash-400">
            <Loader2 size={18} strokeWidth={1.75} className="animate-spin" />
            <span className="text-sm">Loading the selection…</span>
          </div>
        ) : error ? (
          <p className="py-10 text-center text-sm text-danger-600 dark:text-danger-400">{error}</p>
        ) : names.length === 0 ? (
          <p className="py-10 text-center text-sm text-ash-600 dark:text-ash-400">
            This client has not selected any photos yet.
          </p>
        ) : (
          <>
            {/* Memeriksa dengan mata dan menyalin ke Lightroom adalah dua
                pekerjaan berbeda atas data yang sama. Grid didahulukan: sebelum
                ini satu-satunya cara fotografer tahu foto MANA yang dipilih
                adalah membuka Drive dan mencocokkan nama satu per satu. */}
            <div className="mt-5 flex gap-1 p-1 rounded-xl bg-ash-100 dark:bg-white/5 w-fit" role="tablist" aria-label="View">
              {[
                { id: 'grid', label: 'Photos', Icon: Grid2x2 },
                { id: 'list', label: 'Filenames', Icon: List },
              ].map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tampilan === id}
                  onClick={() => setTampilan(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    tampilan === id
                      ? 'bg-white text-ash-900 shadow-sm dark:bg-ash-800 dark:text-ash-100'
                      : 'text-ash-600 hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-200'
                  }`}
                >
                  <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            {tampilan === 'grid' ? (
              <>
                <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-[46vh] overflow-y-auto pr-1">
                  {fotoTerpilih.map((foto) => (
                    <figure key={foto.id} className="relative aspect-square rounded-lg overflow-hidden bg-ash-200 dark:bg-ash-800 group/f">
                      {foto.thumbnailLink ? (
                        <img
                          src={foto.thumbnailLink}
                          alt={foto.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full grid place-items-center">
                          <ImageOff size={16} strokeWidth={1.75} className="text-ash-500" aria-hidden="true" />
                        </div>
                      )}
                      {/* Nama berkasnya yang menghubungkan foto ini ke RAW di
                          komputer, jadi harus bisa dibaca — bukan hanya jadi
                          teks alternatif. */}
                      <figcaption className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[9px] leading-tight font-mono text-white bg-black/60 opacity-0 group-hover/f:opacity-100 transition-opacity truncate">
                        {foto.name}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                <p className="mt-3 text-xs text-ash-600 dark:text-ash-400">
                  {names.length} photo{names.length === 1 ? '' : 's'} selected.
                  {fotoTerpilih.some((f) => !f.thumbnailLink) && ' Some thumbnails are unavailable.'}
                </p>
              </>
            ) : (
            <>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filename format">
              {pilihan.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setMode(p.id)}
                  title={p.hint}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    mode === p.id
                      ? 'bg-ash-800 text-white border-ash-800 dark:bg-ash-100 dark:text-ash-950 dark:border-ash-100'
                      : 'bg-white text-ash-600 border-ash-200 hover:bg-ash-100 dark:bg-white/5 dark:text-ash-400 dark:border-white/10 dark:hover:bg-white/10'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {mode === MODE_REPLACE && (
              <select
                value={extension}
                onChange={(e) => setExtension(e.target.value)}
                aria-label="RAW extension"
                className="mt-3 bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-ash-500 dark:focus:border-ash-400"
              >
                {RAW_EXTENSIONS.map((ext) => (
                  <option key={ext} value={ext}>.{ext}</option>
                ))}
              </select>
            )}

            <textarea
              readOnly
              value={list}
              rows={5}
              aria-label="Filename list"
              className="mt-4 w-full bg-ash-50 dark:bg-black/20 border border-ash-200 dark:border-white/10 rounded-xl px-4 py-3 text-xs font-mono leading-relaxed text-ash-800 dark:text-ash-200 outline-none resize-none"
            />

            <p className="mt-2 text-xs text-ash-600 dark:text-ash-400">
              {names.length} photo{names.length === 1 ? '' : 's'} selected. In Lightroom Classic:{' '}
              <span className="font-medium text-ash-800 dark:text-ash-200">
                Library Filter → Text → Filename → Contains
              </span>
              , then paste.
            </p>

            {berspasi.length > 0 && (
              <div
                role="status"
                className="mt-3 flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2.5 dark:border-warning-400/20 dark:bg-warning-400/10"
              >
                <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-warning-500 dark:text-warning-400" aria-hidden="true" />
                <p className="text-xs text-ash-700 dark:text-ash-300">
                  {berspasi.length} filename{berspasi.length === 1 ? ' contains' : 's contain'} a space.
                  Lightroom splits the filter on spaces, so {berspasi.length === 1 ? 'it' : 'they'} will
                  match more photos than intended.
                </p>
              </div>
            )}

            </>
            )}

            <button
              type="button"
              onClick={handleCopy}
              disabled={tampilan === 'grid'}
              hidden={tampilan === 'grid'}
              className="mt-5 w-full px-4 py-3 rounded-xl bg-ash-800 hover:bg-ash-900 text-white dark:bg-ash-100 dark:hover:bg-white dark:text-ash-950 font-medium text-sm shadow-sm transition-colors flex justify-center items-center gap-2"
            >
              {copied
                ? <><Check size={16} strokeWidth={1.75} /> Copied</>
                : <><Copy size={16} strokeWidth={1.75} /> Copy list</>}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
