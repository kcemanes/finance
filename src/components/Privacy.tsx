import Link from './Link'
import ThemeToggle from './ThemeToggle'

// Where data and deletion requests go. Shown publicly on the page, and the
// same address Google's consent screen points people to.
const CONTACT_EMAIL = 'senamec@gmail.com'

const EFFECTIVE = 'October 8, 2026'

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: 'What is collected',
    body: [
      'Your email address, and a password if you sign up with one. Passwords are stored hashed by our authentication provider and are never visible to us.',
      'If you sign in with Google, your name, email address and profile picture as Google shares them. Nothing else is requested from your Google account — no contacts, files, mail or calendar.',
      'The finance records you choose to enter: expense categories, expenses, income sources, incomes, accounts and their balances.',
    ],
  },
  {
    title: 'How it is used',
    body: [
      'Only to run the app for you: signing you in, storing your records, and syncing them between your devices. There are no ads, no analytics or tracking scripts, and your data is never sold, shared or used to profile you.',
    ],
  },
  {
    title: 'Where it is stored',
    body: [
      'Your account and records are stored with Supabase, which provides the database and sign-in. Row Level Security in the database means each account can only read and write its own rows.',
      'So the app works offline, a copy of your records is kept in your browser (IndexedDB), along with a few preferences in local storage — theme, currency, and which account is signed in. Signing out deletes that copy from the device.',
      'The site itself is hosted on GitHub Pages, which, like any web host, may log basic request information such as IP addresses.',
    ],
  },
  {
    title: 'Your choices',
    body: [
      `You can edit or remove any record in the app at any time. To delete your account and everything stored with it, email ${CONTACT_EMAIL} from the address you signed up with, and it will be deleted within 30 days.`,
      "If you signed in with Google, you can also revoke the app's access at any time from your Google Account's security settings.",
    ],
  },
  {
    title: 'Changes',
    body: [
      'If this policy changes, the updated version will be posted on this page with a new effective date.',
    ],
  },
]

/**
 * The public privacy policy at `/privacy`, linked from Google's OAuth consent
 * screen. Like Landing, it pulls in nothing behind the session gate.
 */
function Privacy() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <Link href="/" className="text-lg font-semibold text-ink">
          Finance
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16 sm:px-8">
        <h1 className="text-3xl font-semibold text-ink">Privacy policy</h1>
        <p className="mt-2 text-sm text-muted">Effective {EFFECTIVE}</p>
        <p className="mt-6 text-base text-ink">
          Finance is a personal finance tracker. This page explains what it
          stores about you, why, and how to have it removed.
        </p>

        {SECTIONS.map((section) => (
          <section key={section.title} className="mt-8">
            <h2 className="text-lg font-semibold text-ink">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-3 text-base text-muted">
                {paragraph}
              </p>
            ))}
          </section>
        ))}

      </main>
    </div>
  )
}

export default Privacy
