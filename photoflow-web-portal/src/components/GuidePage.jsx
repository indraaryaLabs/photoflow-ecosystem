// Panduan singkat.
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
        Quick guide
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ash-600 dark:text-ash-400">
        From signing up to your client submitting their picks. About five
        minutes, once — the next gallery takes two.
      </p>

      <Sorotan>
        The single most common cause of failure: the Google Drive folder must
        be shared as{' '}
        <strong className="font-semibold">Anyone with the link</strong>. Left on{' '}
        <em>Restricted</em>, the gallery opens but stays empty — with no error
        message to explain why.
      </Sorotan>

      <Langkah nomor={1} judul="Prepare a folder in Google Drive">
        <p>
          Put the proofs from one shoot in a single folder. Right-click it
          &rarr; <strong>Share</strong> &rarr; change <em>General access</em>{' '}
          from <em>Restricted</em> to{' '}
          <strong>Anyone with the link</strong>, role <em>Viewer</em>.
        </p>
        <p>
          Copy the link. It looks like{' '}
          <code className="rounded bg-ash-100 px-1.5 py-0.5 text-[13px] dark:bg-white/10">
            drive.google.com/drive/folders/1AbC...
          </code>
        </p>
        <p className="text-ash-500 dark:text-ash-500">
          The folder may belong to any Google account, not necessarily the one
          you signed up with. PhotoFlow never signs in to your Google account.
        </p>
      </Langkah>

      <Langkah nomor={2} judul="Create an account">
        <p>
          Sign up with an email and a password. No Google consent screen, and
          no &ldquo;this app isn&rsquo;t verified&rdquo; warning.
        </p>
      </Langkah>

      <Langkah nomor={3} judul="Create a project">
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
      </Langkah>

      <Langkah nomor={4} judul="Send the link to your client">
        <p>
          Every project has one link. Copy it and send it over WhatsApp. Your
          client needs no account and installs nothing — they open it and pick.
        </p>
        <p>
          Want to see it through their eyes first? Use <strong>Preview</strong>.
          A preview visit is not recorded as a client visit.
        </p>
      </Langkah>

      <Langkah nomor={5} judul="Your client picks, then submits">
        <p>
          They tick photos up to the limit you set, then press submit. A
          confirmation dialog comes first, because submitting locks the gallery
          and they cannot change it themselves afterwards.
        </p>
        <p>
          If they pressed it by mistake, you can reopen the selection from the
          dashboard. Within the first 24 hours that costs no quota.
        </p>
      </Langkah>

      <Langkah nomor={6} judul="Collect the list">
        <p>
          You get an email notification. In the dashboard, use{' '}
          <strong>Copy list</strong> — the file names your client chose, ready
          to paste into Lightroom&rsquo;s filename filter.
        </p>
      </Langkah>

      <section className="mt-12 border-t border-ash-200 pt-8 dark:border-white/10">
        <h2 className="text-xl font-semibold tracking-tight text-ash-900 dark:text-white">
          When something is not right
        </h2>
        <dl className="mt-5 space-y-4">
          {[
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
          See pricing and what each plan allows
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
