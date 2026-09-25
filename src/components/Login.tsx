import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import Link from './Link'
import ThemeToggle from './ThemeToggle'

type Mode = 'signin' | 'signup' | 'forgot'

const LABEL = 'mt-2 text-sm font-semibold text-ink'
// The sign-in form is the only full-width surface, so its controls run a
// step larger than the base .input size.
const FIELD = 'input text-base px-3 py-2.5'

const TITLE: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Create account',
  forgot: 'Reset password',
}

const SUBTITLE: Record<Mode, string> = {
  signin: 'Welcome back to your finances.',
  signup: 'Start tracking your finances.',
  forgot: "Enter your email and we'll send you a link to set a new password.",
}

const SUBMIT: Record<Mode, string> = {
  signin: 'Sign in',
  signup: 'Sign up',
  forgot: 'Send reset link',
}

// Read once at mount: the landing page's "Create an account" button links
// here with `?mode=signup` so the form opens on the right side rather than
// always defaulting to sign-in.
function initialMode(): Mode {
  const requested = new URLSearchParams(window.location.search).get('mode')
  return requested === 'signup' ? 'signup' : 'signin'
}

function Login() {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    if (mode === 'forgot') {
      await sendResetLink()
      setBusy(false)
      return
    }

    const { data, error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
    } else if (mode === 'signup' && !data.session) {
      setNotice('Check your inbox to confirm your email address.')
    }

    setBusy(false)
  }

  async function sendResetLink() {
    if (!navigator.onLine) {
      setError("You're offline. Connect to the internet to reset your password.")
      return
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    // Supabase answers the same whether or not the address has an account,
    // and so does this message, so the form cannot be used to probe for
    // users. Only failures unrelated to the account (rate limits, network)
    // come back as errors.
    if (error) {
      setError(error.message)
    } else {
      setNotice(
        'If an account exists for that email, a reset link is on its way.',
      )
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center bg-linear-to-b from-accent-soft to-ground to-60% px-4 py-8">
      <div className="absolute top-4 left-4">
        <Link href="/" className="btn-link text-sm text-muted">
          ← Back to home
        </Link>
      </div>
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        className="flex w-full max-w-[380px] flex-col gap-2 rounded-xl border border-line bg-surface p-8 shadow-card"
        onSubmit={handleSubmit}
      >
        <h1 className="text-center text-[1.6rem]/tight font-semibold text-ink">
          {TITLE[mode]}
        </h1>
        <p className="mb-4 text-center text-sm text-muted">{SUBTITLE[mode]}</p>

        <label htmlFor="email" className={LABEL}>
          Email
        </label>
        <input
          id="email"
          type="email"
          className={FIELD}
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />

        {mode !== 'forgot' && (
          <>
            <div className="mt-2 flex items-baseline justify-between">
              <label
                htmlFor="password"
                className="text-sm font-semibold text-ink"
              >
                Password
              </label>
              {mode === 'signin' && (
                <button
                  type="button"
                  className="btn-link text-sm text-accent-strong"
                  onClick={() => switchMode('forgot')}
                >
                  Forgot password?
                </button>
              )}
            </div>
            <input
              id="password"
              type="password"
              className={FIELD}
              autoComplete={
                mode === 'signin' ? 'current-password' : 'new-password'
              }
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </>
        )}

        {error && (
          <p className="msg msg-error mt-3 text-center" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="msg msg-notice mt-3 text-center">{notice}</p>
        )}

        <button
          type="submit"
          className="btn-primary mt-5 px-4 py-2.5 text-base"
          disabled={busy}
        >
          {busy ? 'Working…' : SUBMIT[mode]}
        </button>

        <p className="mt-4 text-center text-sm">
          {mode === 'signin'
            ? "Don't have an account?"
            : mode === 'signup'
              ? 'Already have one?'
              : 'Remembered it?'}{' '}
          <button
            type="button"
            className="btn-link font-semibold text-accent-strong"
            onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  )
}

export default Login
