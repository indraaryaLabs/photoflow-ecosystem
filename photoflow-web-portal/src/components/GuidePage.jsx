// Panduan singkat.
//
// Bahasanya Indonesia dengan alasan yang sama seperti halaman harga: yang
// membacanya orang yang belum punya akun. Lihat PricingPage.jsx.
//
// Isinya sengaja pendek dan berurutan sampai satu galeri pertama terkirim.
// Panduan yang menjelaskan seluruh fitur adalah panduan yang tidak dibaca
// sampai habis, dan yang paling menentukan orang bertahan atau pergi cuma satu:
// apakah galeri pertamanya berhasil sampai ke klien.

import { TriangleAlert } from 'lucide-react';

import PageShell from './PageShell';
import { PRICING_PATH } from '../lib/pricing';

export default function GuidePage({ themeChoice, cycleTheme }) {
  return (
    <PageShell themeChoice={themeChoice} cycleTheme={cycleTheme}>
      <h1 className="text-3xl font-semibold tracking-tight text-ash-900 dark:text-white">
        Panduan singkat
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ash-600 dark:text-ash-400">
        Dari mendaftar sampai klien mengirim pilihannya. Sekitar lima menit,
        sekali saja — galeri berikutnya cuma dua menit.
      </p>

      <Sorotan>
        Satu hal yang paling sering bikin gagal: folder Google Drive harus
        dibagikan sebagai <strong className="font-semibold">Anyone with the link</strong>.
        Kalau masih <em>Restricted</em>, galerinya terbuka tapi kosong — dan
        tidak ada pesan galat yang menjelaskan kenapa.
      </Sorotan>

      <Langkah nomor={1} judul="Siapkan folder di Google Drive">
        <p>
          Kumpulkan foto mentah hasil pemotretan dalam satu folder. Klik kanan
          folder itu &rarr; <strong>Share</strong> &rarr; ubah{' '}
          <em>General access</em> dari <em>Restricted</em> jadi{' '}
          <strong>Anyone with the link</strong>, peran <em>Viewer</em>.
        </p>
        <p>
          Salin tautannya. Bentuknya seperti{' '}
          <code className="rounded bg-ash-100 px-1.5 py-0.5 text-[13px] dark:bg-white/10">
            drive.google.com/drive/folders/1AbC...
          </code>
        </p>
        <p className="text-ash-500 dark:text-ash-500">
          Folder boleh milik akun Google mana pun, tidak harus akun yang Anda
          pakai mendaftar. PhotoFlow tidak pernah masuk ke akun Google Anda.
        </p>
      </Langkah>

      <Langkah nomor={2} judul="Buat akun">
        <p>
          Daftar dengan email dan kata sandi. Tidak ada langkah izin Google,
          tidak ada peringatan aplikasi belum terverifikasi.
        </p>
      </Langkah>

      <Langkah nomor={3} judul="Buat project">
        <p>
          Di dashboard, tekan <strong>New project</strong>. Isi nama project,
          nama klien, tautan folder tadi, jumlah maksimal foto yang boleh
          dipilih, dan nomor WhatsApp klien.
        </p>
        <p>
          Daftar fotonya ditarik dari Drive beberapa detik setelah project
          tersimpan. Kalau jumlah fotonya masih nol, tunggu sebentar atau tekan{' '}
          <strong>Resync</strong>.
        </p>
      </Langkah>

      <Langkah nomor={4} judul="Kirim tautannya ke klien">
        <p>
          Setiap project punya satu tautan. Salin, kirim lewat WhatsApp. Klien
          tidak perlu akun, tidak perlu memasang apa pun — cukup buka dan pilih.
        </p>
        <p>
          Mau melihat dulu seperti apa tampilannya di mata klien? Pakai{' '}
          <strong>Preview</strong>. Kunjungan pratinjau tidak dihitung sebagai
          kunjungan klien.
        </p>
      </Langkah>

      <Langkah nomor={5} judul="Klien memilih, lalu mengirim">
        <p>
          Klien menandai foto sampai batas yang Anda tetapkan, lalu menekan
          kirim. Ada dialog konfirmasi lebih dulu, karena kiriman mengunci
          galeri dan tidak bisa diubah sendiri sesudahnya.
        </p>
        <p>
          Kalau klien salah tekan, Anda bisa membukanya kembali dari dashboard.
          Dalam 24 jam pertama itu tidak memakai kuota.
        </p>
      </Langkah>

      <Langkah nomor={6} judul="Ambil daftarnya">
        <p>
          Anda dapat pemberitahuan email. Di dashboard, buka{' '}
          <strong>Copy list</strong> — isinya nama berkas yang dipilih klien,
          siap ditempel ke penyaring nama berkas di Lightroom.
        </p>
      </Langkah>

      <section className="mt-12 border-t border-ash-200 pt-8 dark:border-white/10">
        <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
          Kalau ada yang tidak beres
        </h2>
        <dl className="mt-5 space-y-4">
          {[
            [
              'Galeri terbuka tapi tidak ada fotonya',
              'Hampir selalu karena folder belum dibagikan "Anyone with the link". Betulkan di Drive, lalu tekan Resync di dashboard.',
            ],
            [
              'Foto baru tidak muncul di galeri',
              'Daftar foto adalah salinan isi folder saat terakhir dibaca. Tekan Resync setelah menambah atau menghapus foto di Drive.',
            ],
            [
              'Tautan galeri terkirim ke orang yang salah',
              'Terbitkan tautan baru dari dashboard. Tautan lama langsung mati, dan tindakan ini tidak memakai kuota.',
            ],
            [
              'Nama studio saya tidak muncul di galeri',
              'Nama studio hanya tampil pada paket berbayar. Galeri paket gratis memakai merek PhotoFlow.',
            ],
          ].map(([q, a]) => (
            <div key={q} className="border-l border-ash-200 pl-4 dark:border-white/10">
              <dt className="text-sm font-semibold text-ash-900 dark:text-white">{q}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-ash-600 dark:text-ash-400">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-14 border-t border-ash-200 pt-6 text-sm dark:border-white/10">
        <a
          href={PRICING_PATH}
          className="text-ash-600 underline underline-offset-4 transition-colors hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100"
        >
          Lihat harga dan batas tiap paket
        </a>
      </div>
    </PageShell>
  );
}

function Sorotan({ children }) {
  return (
    <div className="mt-8 flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-400/10">
      <TriangleAlert
        size={18}
        strokeWidth={2}
        className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-100">{children}</p>
    </div>
  );
}

function Langkah({ nomor, judul, children }) {
  return (
    <section className="mt-9 flex gap-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ash-200 text-sm font-semibold text-ash-700 dark:border-white/10 dark:text-ash-300">
        {nomor}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-ash-900 dark:text-white">
          {judul}
        </h2>
        <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ash-700 dark:text-ash-300">
          {children}
        </div>
      </div>
    </section>
  );
}
