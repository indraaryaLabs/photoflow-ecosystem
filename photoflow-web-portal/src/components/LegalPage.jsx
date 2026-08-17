import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';

import BrandMark from './BrandMark';
import ThemeToggle from './ThemeToggle';
import {
  CONTACT_EMAIL,
  CONTACT_FALLBACK_URL,
  EFFECTIVE_DATE,
  PRIVACY_PATH,
  TERMS_PATH,
} from '../lib/legal';

/**
 * Kebijakan privasi dan ketentuan layanan.
 *
 * Dua alasan halaman ini ada, dan yang kedua adalah yang mendesak:
 *
 * 1. Aplikasi ini menyimpan email, nomor telepon klien orang lain, dan sebuah
 *    refresh token Google. Menyimpan semua itu tanpa satu pun halaman yang
 *    mengatakan apa yang disimpan dan bagaimana menghapusnya bukan kelalaian
 *    kecil.
 * 2. Scope `drive.readonly` termasuk scope terbatas milik Google. Selama
 *    aplikasinya belum diverifikasi, layar persetujuan menampilkan peringatan
 *    "Google hasn't verified this app" dan sebagian akun menolaknya sama
 *    sekali. Verifikasi itu MENSYARATKAN kebijakan privasi yang dapat dibuka
 *    publik di domain yang sama, memuat pernyataan Limited Use, dan menyebut
 *    dengan tepat data Google apa yang diambil serta untuk apa. Tanpa halaman
 *    ini, pengajuannya ditolak sebelum ditinjau.
 *
 * Isinya ditulis dari apa yang benar-benar dilakukan kode, bukan dari templat.
 * Kebijakan yang menjanjikan hal yang tidak dikerjakan aplikasinya — atau
 * mendiamkan yang dikerjakan — lebih buruk daripada tidak ada.
 */
export default function LegalPage({ doc, themeChoice, cycleTheme }) {
  const isPrivacy = doc === 'privacy';
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';

  // Judul tab diperbarui karena satu-satunya judul di dokumen ini ditulis di
  // index.html: "PhotoFlow — Client Portal". Yang menyimpan tautan kebijakan
  // privasi ke bookmark — dan pengulas Google termasuk — akan mendapat bookmark
  // yang tidak menyebut kebijakan apa pun.
  useEffect(() => {
    const sebelumnya = document.title;
    document.title = `${title} — PhotoFlow`;
    return () => { document.title = sebelumnya; };
  }, [title]);

  return (
    <div className="min-h-screen bg-ash-50 dark:bg-ash-950 transition-colors duration-tint font-sans">
      <header className="sticky top-0 z-10 border-b border-ash-200/70 bg-ash-50/85 backdrop-blur dark:border-white/5 dark:bg-ash-950/85">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3 sm:px-8">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-ash-900 dark:text-white"
          >
            <BrandMark size={22} title="PhotoFlow" />
            <span className="text-sm font-semibold tracking-tight">PhotoFlow</span>
          </a>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle choice={themeChoice} onCycle={cycleTheme} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-10 sm:px-8">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-ash-600 hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100 transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={1.75} aria-hidden="true" />
          Back to PhotoFlow
        </a>

        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-ash-900 dark:text-white">
          {title}
        </h1>
        <p className="mt-2 text-sm text-ash-500 dark:text-ash-500">
          Effective {EFFECTIVE_DATE}
        </p>

        <div className="mt-10">{isPrivacy ? <Privacy /> : <Terms />}</div>

        <nav className="mt-16 border-t border-ash-200 pt-6 text-sm dark:border-white/10">
          <a
            href={isPrivacy ? TERMS_PATH : PRIVACY_PATH}
            className="text-ash-600 underline underline-offset-4 hover:text-ash-900 dark:text-ash-400 dark:hover:text-ash-100 transition-colors"
          >
            {isPrivacy ? 'Read the Terms of Service' : 'Read the Privacy Policy'}
          </a>
        </nav>
      </main>
    </div>
  );
}

// ── Potongan tipografi ────────────────────────────────────────────────
//
// Repo ini tidak memasang @tailwindcss/typography, dan memasangnya hanya untuk
// dua halaman statis berarti menambah dependensi yang harus ikut diperbarui
// selamanya. Empat komponen kecil di bawah ini cukup, dan membuat jarak antar
// bagian ditentukan di satu tempat alih-alih diketik ulang di tiap heading.

function Section({ heading, children }) {
  return (
    <section className="mb-9">
      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ash-900 dark:text-white">
        {heading}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-ash-700 dark:text-ash-300">
        {children}
      </div>
    </section>
  );
}

function List({ children }) {
  return (
    <ul className="ml-1 space-y-2 border-l border-ash-200 pl-4 dark:border-white/10">
      {children}
    </ul>
  );
}

function Term({ label, children }) {
  return (
    <li>
      <strong className="font-medium text-ash-900 dark:text-ash-100">{label}</strong>{' '}
      — {children}
    </li>
  );
}

function Contact() {
  if (CONTACT_EMAIL) {
    return (
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="underline underline-offset-4 hover:text-ash-900 dark:hover:text-ash-100"
      >
        {CONTACT_EMAIL}
      </a>
    );
  }
  return (
    <a
      href={CONTACT_FALLBACK_URL}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-4 hover:text-ash-900 dark:hover:text-ash-100"
    >
      the project issue tracker on GitHub
    </a>
  );
}

// ── Kebijakan privasi ─────────────────────────────────────────────────

function Privacy() {
  return (
    <>
      <Section heading="Who this policy covers">
        <p>
          PhotoFlow is a photo-selection tool for photographers. Two different
          people use it, and it treats them differently:
        </p>
        <List>
          <Term label="Photographers">
            create an account, connect a Google Drive folder, and share a
            gallery link with a client.
          </Term>
          <Term label="Clients">
            open that link and pick their favourite photos. Clients never create
            an account and are never asked to sign in.
          </Term>
        </List>
      </Section>

      <Section heading="What we collect">
        <List>
          <Term label="Account details">
            your email address and a password. Both are handled by Supabase
            Auth; the password is stored only as a hash and is never visible to
            PhotoFlow.
          </Term>
          <Term label="Project details you enter">
            project name, client name, the number of photos a client may pick,
            the Google Drive folder link, and — if you choose to fill them in —
            your WhatsApp number and your client&rsquo;s WhatsApp number.
          </Term>
          <Term label="Google Drive data">
            described separately in the next section.
          </Term>
          <Term label="Selection activity">
            which photos a client picked, and the date and time they submitted.
          </Term>
          <Term label="Technical data">
            the IP address of requests to gallery links, used only to count
            failed attempts and block link-guessing. Counters are kept per
            address and per time window, not as a log of your browsing.
          </Term>
          <Term label="Local browser storage">
            your light or dark theme preference, your gallery layout density,
            and an unsent draft of a client&rsquo;s picks so a closed tab does
            not lose their work. This data stays in the browser and is never
            sent to us.
          </Term>
        </List>
        <p>
          PhotoFlow uses no advertising trackers, no analytics scripts, and no
          third-party cookies.
        </p>
      </Section>

      <Section heading="Google user data">
        <p>
          Connecting Google Drive is optional and is always started by you. When
          you connect it, PhotoFlow requests one scope:
        </p>
        <List>
          <Term label="https://www.googleapis.com/auth/drive.readonly">
            read-only access to your Google Drive.
          </Term>
        </List>
        <p>
          <strong className="font-medium text-ash-900 dark:text-ash-100">
            What we read.
          </strong>{' '}
          Only files inside the folder you point a project at, and only their
          metadata: file name, file ID, thumbnail link, MIME type, and image
          dimensions. PhotoFlow does not download, copy, or store your original
          photo files, and it does not browse folders you have not linked to a
          project.
        </p>
        <p>
          <strong className="font-medium text-ash-900 dark:text-ash-100">
            What we store.
          </strong>{' '}
          A Google refresh token, so your galleries keep working after you close
          the browser, plus the file names and thumbnail links of the linked
          folder as a fallback copy — that copy is what a client sees if Google
          Drive is unreachable when they open the gallery.
        </p>
        <p>
          <strong className="font-medium text-ash-900 dark:text-ash-100">
            Why read-only.
          </strong>{' '}
          PhotoFlow never writes to, renames, moves, or deletes anything in your
          Drive. The permission it asks for makes that impossible, not merely
          unlikely.
        </p>
        <p>
          <strong className="font-medium text-ash-900 dark:text-ash-100">
            Limited Use.
          </strong>{' '}
          PhotoFlow&rsquo;s use and transfer of information received from Google
          APIs to any other app will adhere to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-ash-900 dark:hover:text-ash-100"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is never
          sold, never used for advertising, and never used to train any machine
          learning or AI model.
        </p>
        <p>
          <strong className="font-medium text-ash-900 dark:text-ash-100">
            Disconnecting.
          </strong>{' '}
          You can revoke PhotoFlow&rsquo;s access at any time from your{' '}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4 hover:text-ash-900 dark:hover:text-ash-100"
          >
            Google Account permissions page
          </a>
          . Doing so stops all Drive access immediately. Ask us to delete the
          stored refresh token as well, and it is removed from the database.
        </p>
      </Section>

      <Section heading="How we use it">
        <List>
          <Term label="To show a gallery">
            the linked folder&rsquo;s file list is turned into the grid your
            client sees.
          </Term>
          <Term label="To record a selection">
            the file names your client picks are saved so you can find the
            matching RAW files afterwards.
          </Term>
          <Term label="To notify you">
            if email notifications are configured, PhotoFlow emails you once,
            at the address on your account, when a client submits their picks.
          </Term>
          <Term label="To keep galleries from being guessed">
            IP-based counting of failed gallery-link lookups.
          </Term>
        </List>
        <p>
          That is the entire list. Your data is not profiled, resold, or used to
          train models.
        </p>
      </Section>

      <Section heading="Who else processes it">
        <p>
          PhotoFlow does not sell or rent personal data. It runs on a small
          number of service providers, each of which processes data only to
          provide their service:
        </p>
        <List>
          <Term label="Supabase">database hosting and authentication.</Term>
          <Term label="Vercel">application hosting and request routing.</Term>
          <Term label="Google">
            the Drive API, only for accounts that connect it.
          </Term>
          <Term label="Resend">
            delivery of the notification email, only when notifications are
            configured.
          </Term>
        </List>
        <p>
          Data may also be disclosed where the law requires it. If that ever
          happens, we will tell you unless we are legally barred from doing so.
        </p>
      </Section>

      <Section heading="Your clients' data">
        <p>
          When you enter a client&rsquo;s name and WhatsApp number, you decide
          what is collected and why — PhotoFlow only stores it on your behalf.
          Please make sure your client is comfortable with that before you enter
          it. Deleting a project deletes their details along with it.
        </p>
      </Section>

      <Section heading="How long we keep it">
        <List>
          <Term label="Projects, photo lists, and selections">
            until you delete the project. Deletion is immediate and permanent —
            there is no recycle bin.
          </Term>
          <Term label="Your account and Drive token">
            until you ask us to delete your account.
          </Term>
          <Term label="Rate-limit counters">
            a matter of hours; old windows are discarded.
          </Term>
        </List>
        <p>
          To delete your account and everything attached to it, contact{' '}
          <Contact />. Requests are actioned within 30 days, and usually the
          same week.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          All traffic runs over HTTPS. Database rows are separated per account
          by PostgreSQL row-level security, so one photographer&rsquo;s query
          cannot reach another&rsquo;s projects. Gallery links use random tokens
          long enough not to be guessed, and repeated failed lookups from one
          address are throttled.
        </p>
        <p>
          No system is perfectly secure. Anyone who has your gallery link can
          open that gallery — treat it like a door key, and ask for a new link
          if one leaks. PhotoFlow can reissue a gallery link at any time, which
          immediately kills the old one.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          PhotoFlow is a tool for working photographers and is not directed at
          children under 13. We do not knowingly collect their data.
        </p>
      </Section>

      <Section heading="Changes to this policy">
        <p>
          If this policy changes in a way that affects what we collect or how we
          use it, the effective date at the top changes and account holders are
          emailed before the change takes effect.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions, corrections, or deletion requests: <Contact />.
        </p>
      </Section>
    </>
  );
}

// ── Ketentuan layanan ─────────────────────────────────────────────────

function Terms() {
  return (
    <>
      <Section heading="Agreement">
        <p>
          By creating a PhotoFlow account or opening a PhotoFlow gallery link,
          you agree to these terms. If you do not agree, do not use the service.
        </p>
      </Section>

      <Section heading="What PhotoFlow does">
        <p>
          PhotoFlow turns a Google Drive folder of proofs into a link you can
          send a client, and records which photos that client picks. It is a
          coordination tool. It is not backup, not storage, and not a delivery
          platform — your photographs stay in your own Google Drive the entire
          time.
        </p>
      </Section>

      <Section heading="Your account">
        <p>
          You are responsible for keeping your password and your gallery links
          confidential. Anyone holding a gallery link can view that gallery and
          submit a selection, by design — that is what lets clients take part
          without an account. Tell us promptly if you believe an account has
          been accessed by someone else.
        </p>
        <p>One person, one account. Do not share account credentials.</p>
      </Section>

      <Section heading="Your content, and your clients">
        <p>
          Your photographs remain yours. PhotoFlow claims no licence over them
          and never copies them out of your Drive.
        </p>
        <p>
          When you enter client details, you confirm you are entitled to do so
          and that you are responsible for how those details are handled towards
          your client. PhotoFlow processes them on your instruction.
        </p>
      </Section>

      <Section heading="Acceptable use">
        <p>You agree not to use PhotoFlow to:</p>
        <List>
          <li>share unlawful material, or material you have no right to share;</li>
          <li>
            guess, scrape, or enumerate gallery links belonging to other
            accounts;
          </li>
          <li>
            place automated load on the service beyond ordinary use, or attempt
            to circumvent rate limits;
          </li>
          <li>probe, scan, or interfere with the service or its providers.</li>
        </List>
      </Section>

      <Section heading="Google Drive">
        <p>
          Connecting Google Drive is optional and read-only. Your use of Google
          Drive itself remains governed by your agreement with Google, and
          Google may change or withdraw its API at any time. If it does,
          galleries fall back to the stored file list and may be out of date
          until the connection is restored.
        </p>
      </Section>

      <Section heading="Availability">
        <p>
          PhotoFlow is currently offered free of charge and without a service
          level agreement. It runs on free infrastructure tiers, which means it
          can be slow, briefly unavailable, or subject to provider limits. Do
          not treat it as the only record of a client&rsquo;s selection for work
          you cannot afford to redo — export the list once you receive it.
        </p>
        <p>
          Features may change or be removed. Where a change removes something
          you rely on, we will give notice by email where we reasonably can.
        </p>
      </Section>

      <Section heading="No warranty">
        <p>
          PhotoFlow is provided &ldquo;as is&rdquo;, without warranties of any
          kind, express or implied, including fitness for a particular purpose
          and uninterrupted availability.
        </p>
      </Section>

      <Section heading="Limitation of liability">
        <p>
          To the fullest extent permitted by law, PhotoFlow and its operator are
          not liable for lost work, lost profit, lost data, or any indirect or
          consequential loss arising from use of the service. Because the
          service is provided free of charge, total liability for any claim is
          limited to the amount you have paid for it, which is zero.
        </p>
        <p>
          Nothing in these terms excludes liability that cannot lawfully be
          excluded.
        </p>
      </Section>

      <Section heading="Ending the agreement">
        <p>
          You may stop using PhotoFlow and request deletion of your account at
          any time. We may suspend or close an account that breaches the
          acceptable-use section above, or where required by law; except in
          cases of abuse, we will tell you first and give you a chance to export
          your data.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          These terms are governed by the laws of the Republic of Indonesia.
        </p>
      </Section>

      <Section heading="Changes to these terms">
        <p>
          Updated terms take effect on the date shown at the top of this page.
          Continuing to use PhotoFlow after that date means you accept them.
        </p>
      </Section>

      <Section heading="Contact">
        <p>
          Questions about these terms: <Contact />.
        </p>
      </Section>
    </>
  );
}
