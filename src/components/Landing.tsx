import InstallButton from './InstallButton'
import Link from './Link'
import ThemeToggle from './ThemeToggle'
import { storedAccount } from '../lib/account-storage'

const FEATURES = [
  {
    title: 'Log expenses in seconds',
    body: 'Pick a category, type an amount, done. Built for the ten times a day you actually reach for it.',
  },
  {
    title: 'Works with no connection',
    body: 'Every entry is saved to the device first and synced when you are back online — a flight or a dead zone never loses a row.',
  },
  {
    title: 'See where the month went',
    body: 'Budgets per category, income against spend, and a running net worth — read at a glance, not dug for.',
  },
]

/**
 * The public route at `/`. Deliberately shallow: no Supabase, no session
 * hook, no IndexedDB — just localStorage's cached hint of whether someone is
 * signed in, so the CTA can say the useful thing without the page waiting on
 * a network round trip to draw it.
 */
function Landing() {
  const signedIn = storedAccount() !== null
  const ctaHref = signedIn ? '/app' : '/login'
  const ctaLabel = signedIn ? 'Go to Dashboard' : 'Log In'

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <span className="text-lg font-semibold text-ink">Finance</span>
        <div className="flex items-center gap-2">
          <InstallButton />
          <ThemeToggle />
        </div>
      </header>

      <section className="flex flex-col items-center px-4 pt-10 pb-16 text-center sm:pt-16">
        <h1 className="max-w-2xl text-3xl font-semibold text-ink sm:text-5xl">
          Know where your money went — even offline.
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted sm:text-lg">
          Log expenses by category, set a monthly budget, and see where the
          month went. Finance is a fast, installable app that keeps working
          with no signal at all.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={ctaHref} className="btn-primary px-6 py-2.5 text-base">
            {ctaLabel}
          </Link>
          {!signedIn && (
            <Link
              href="/login?mode=signup"
              className="btn-quiet px-6 py-2.5 text-base"
            >
              Create an account
            </Link>
          )}
        </div>
      </section>

      <section className="grid gap-4 px-4 pb-16 sm:mx-auto sm:max-w-4xl sm:grid-cols-3 sm:gap-6 sm:px-8">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-line bg-surface p-6 shadow-card"
          >
            <h2 className="text-base font-semibold text-ink">
              {feature.title}
            </h2>
            <p className="mt-2 text-sm text-muted">{feature.body}</p>
          </div>
        ))}
      </section>

      <footer className="mt-auto flex items-center justify-center px-4 py-6 text-sm text-muted">
        <Link href="/login" className="btn-link">
          Already have an account? Log in
        </Link>
      </footer>
    </div>
  )
}

export default Landing
