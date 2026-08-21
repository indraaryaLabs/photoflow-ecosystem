// Panduan singkat.
//
// Dwibahasa, sama seperti halaman harga: Inggris bawaan, Indonesia lewat sakelar
// di kanan atas. Isinya sengaja pendek dan berurutan sampai satu galeri pertama
// terkirim — yang paling menentukan orang bertahan atau pergi cuma satu: apakah
// galeri pertamanya berhasil sampai ke klien.

import { TriangleAlert } from 'lucide-react';

import PageShell from './PageShell';
import { PRICING_PATH } from '../lib/pricing';
import { useLang } from '../lib/lang';

const COPY = {
  title: { en: 'Quick guide', id: 'Panduan singkat' },
  intro: {
    en: 'From signing up to your client submitting their picks. About five minutes, once — the next gallery takes two.',
    id: 'Dari mendaftar sampai klien mengirim pilihannya. Sekitar lima menit, sekali saja — galeri berikutnya cuma dua menit.',
  },
  troubleTitle: { en: 'When something is not right', id: 'Kalau ada yang tidak beres' },
  toPricing: {
    en: 'See pricing and what each plan allows',
    id: 'Lihat harga dan batas tiap paket',
  },
};

// Sorotan diletakkan lebih dulu karena satu kesalahan ini yang paling sering
// membuat galeri kosong, dan tidak ada pesan galat yang menjelaskannya.
const HIGHLIGHT = {
  en: (
    <>
      The single most common cause of failure: the Google Drive folder must be
      shared as <strong className="font-semibold">Anyone with the link</strong>.
      Left on <em>Restricted</em>, the gallery opens but stays empty — with no
      error message to explain why.
    </>
  ),
  id: (
    <>
      Satu hal yang paling sering bikin gagal: folder Google Drive harus
      dibagikan sebagai{' '}
      <strong className="font-semibold">Anyone with the link</strong>. Kalau
      masih <em>Restricted</em>, galerinya terbuka tapi kosong — dan tidak ada
      pesan galat yang menjelaskan kenapa.
    </>
  ),
};

const STEPS = {
  en: [
    {
      judul: 'Prepare a folder in Google Drive',
      isi: (
        <>
          <p>
            Put the proofs from one shoot in a single folder. Right-click it
            &rarr; <strong>Share</strong> &rarr; change <em>General access</em>{' '}
            from <em>Restricted</em> to{' '}
            <strong>Anyone with the link</strong>, role <em>Viewer</em>.
          </p>
          <p>
            Copy the link. It looks like{' '}
            <code className="break-all rounded bg-ash-100 px-1.5 py-0.5 text-[13px] dark:bg-white/10">
              drive.google.com/drive/folders/1AbC...
            </code>
          </p>
          <p className="text-ash-500 dark:text-ash-500">
            The folder may belong to any Google account, not necessarily the one
            you signed up with. PhotoFlow never signs in to your Google account.
          </p>
        </>
      ),
    },
    {
      judul: 'Create an account',
      isi: (
        <p>
          Sign up with an email and a password. No Google consent screen, and no
          &ldquo;this app isn&rsquo;t verified&rdquo; warning.
        </p>
      ),
    },
    {
      judul: 'Create a project',
      isi: (
        <>
          <p>
            In the dashboard, press <strong>New project</strong>. Fill in the
            project name, the client name, the folder link from step 1, how many
            photos the client may pick, and their WhatsApp number.
          </p>
          <p>
            The photo list is pulled from Drive a few seconds after the project
            is saved. If the count is still zero, wait a moment or press{' '}
            <strong>Resync</strong>.
          </p>
        </>
      ),
    },
    {
      judul: 'Send the link to your client',
      isi: (
        <>
          <p>
            Every project has one link. Copy it and send it over WhatsApp. Your
            client needs no account and installs nothing — they open it and pick.
          </p>
          <p>
            Want to see it through their eyes first? Use <strong>Preview</strong>.
            A preview visit is not recorded as a client visit.
          </p>
        </>
      ),
    },
    {
      judul: 'Your client picks, then submits',
      isi: (
        <>
          <p>
            They tick photos up to the limit you set, then press submit. A
            confirmation dialog comes first, because submitting locks the gallery
            and they cannot change it themselves afterwards.
          </p>
          <p>
            If they pressed it by mistake, you can reopen the selection from the
            dashboard. Within the first 24 hours that costs no quota.
          </p>
        </>
      ),
    },
    {
      judul: 'Collect the list',
      isi: (
        <p>
          You get an email notification. In the dashboard, use{' '}
          <strong>Copy list</strong> — the file names your client chose, ready to
          paste into Lightroom&rsquo;s filename filter.
        </p>
      ),
    },
  ],
  id: [
    {
      judul: 'Siapkan folder di Google Drive',
      isi: (
        <>
          <p>
            Kumpulkan foto mentah hasil pemotretan dalam satu folder. Klik kanan
            folder itu &rarr; <strong>Share</strong> &rarr; ubah{' '}
            <em>General access</em> dari <em>Restricted</em> jadi{' '}
            <strong>Anyone with the link</strong>, peran <em>Viewer</em>.
          </p>
          <p>
            Salin tautannya. Bentuknya seperti{' '}
            <code className="break-all rounded bg-ash-100 px-1.5 py-0.5 text-[13px] dark:bg-white/10">
              drive.google.com/drive/folders/1AbC...
            </code>
          </p>
          <p className="text-ash-500 dark:text-ash-500">
            Folder boleh milik akun Google mana pun, tidak harus akun yang Anda
            pakai mendaftar. PhotoFlow tidak pernah masuk ke akun Google Anda.
          </p>
        </>
      ),
    },
    {
      judul: 'Buat akun',
      isi: (
        <p>
          Daftar dengan email dan kata sandi. Tidak ada langkah izin Google,
          tidak ada peringatan aplikasi belum terverifikasi.
        </p>
      ),
    },
    {
      judul: 'Buat project',
      isi: (
        <>
          <p>
            Di dashboard, tekan <strong>New project</strong>. Isi nama project,
            nama klien, tautan folder tadi, jumlah maksimal foto yang boleh
            dipilih, dan nomor WhatsApp klien.
          </p>
          <p>
            Daftar fotonya ditarik dari Drive beberapa detik setelah project
            tersimpan. Kalau jumlah fotonya masih nol, tunggu sebentar atau
            tekan <strong>Resync</strong>.
          </p>
        </>
      ),
    },
    {
      judul: 'Kirim tautannya ke klien',
      isi: (
        <>
          <p>
            Setiap project punya satu tautan. Salin, kirim lewat WhatsApp. Klien
            tidak perlu akun, tidak perlu memasang apa pun — cukup buka dan
            pilih.
          </p>
          <p>
            Mau melihat dulu seperti apa tampilannya di mata klien? Pakai{' '}
            <strong>Preview</strong>. Kunjungan pratinjau tidak dihitung sebagai
            kunjungan klien.
          </p>
        </>
      ),
    },
    {
      judul: 'Klien memilih, lalu mengirim',
      isi: (
        <>
          <p>
            Klien menandai foto sampai batas yang Anda tetapkan, lalu menekan
            kirim. Ada dialog konfirmasi lebih dulu, karena kiriman mengunci
            galeri dan tidak bisa diubah sendiri sesudahnya.
          </p>
          <p>
            Kalau klien salah tekan, Anda bisa membukanya kembali dari dashboard.
            Dalam 24 jam pertama itu tidak memakai kuota.
          </p>
        </>
      ),
    },
    {
      judul: 'Ambil daftarnya',
      isi: (
        <p>
          Anda dapat pemberitahuan email. Di dashboard, buka{' '}
          <strong>Copy list</strong> — isinya nama berkas yang dipilih klien,
          siap ditempel ke penyaring nama berkas di Lightroom.
        </p>
      ),
    },
  ],
};

const TROUBLE = {
  en: [
    [
      'The gallery opens but shows no photos',
      'Almost always the folder is not shared as "Anyone with the link". Fix it in Drive, then press Resync in the dashboard.',
    ],
    [
      'New photos are missing from the gallery',
      'The photo list is a copy of the folder as it was last read. Press Resync after adding or removing photos in Drive.',
    ],
    [
      'The gallery link went to the wrong person',
      'Issue a new link from the dashboard. The old one dies immediately, and this costs no quota.',
    ],
    [
      'My studio name is not showing on the gallery',
      'The studio name appears on paid plans only. Free-plan galleries carry PhotoFlow branding.',
    ],
  ],
  id: [
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
  ],
};

export default function GuidePage({ themeChoice, cycleTheme }) {
  const { lang, setLang, t } = useLang();

  return (
    <PageShell
      themeChoice={themeChoice}
      cycleTheme={cycleTheme}
      lang={lang}
      onSelectLang={setLang}
      t={t}
    >
      <h1 className="font-display text-4xl font-semibold tracking-tight text-ash-900 dark:text-white">
        {t(COPY.title)}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ash-600 dark:text-ash-400">
        {t(COPY.intro)}
      </p>

      <Sorotan>{HIGHLIGHT[lang]}</Sorotan>

      {STEPS[lang].map((s, i) => (
        <Langkah key={s.judul} nomor={i + 1} judul={s.judul}>
          {s.isi}
        </Langkah>
      ))}

      <section className="mt-12 border-t border-ash-200 pt-8 dark:border-white/10">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ash-900 dark:text-white">
          {t(COPY.troubleTitle)}
        </h2>
        <dl className="mt-5 space-y-4">
          {TROUBLE[lang].map(([q, a]) => (
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
          {t(COPY.toPricing)}
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
        <h2 className="font-display text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
          {judul}
        </h2>
        <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-ash-700 dark:text-ash-300">
          {children}
        </div>
      </div>
    </section>
  );
}
