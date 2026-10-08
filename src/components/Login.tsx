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

// Google's four-colour "G", which its branding guidelines require unaltered
// on every sign-in button, in both themes.
function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
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

  async function signInWithGoogle() {
    if (!navigator.onLine) {
      setError("You're offline. Connect to the internet to sign in.")
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)

    // Leaves the page for Google's consent screen. Supabase brings the browser
    // back to /login with the session in the URL, picks it up on load, and
    // AppShell then moves a signed-in account on to /app.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/login` },
    })

    if (error) {
      setError(error.message)
      setBusy(false)
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

        {mode !== 'forgot' && (
          <>
            <div className="mt-3 flex items-center gap-3 text-sm text-muted">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <button
              type="button"
              className="btn-google mt-1 px-4 py-2.5 text-base"
              disabled={busy}
              onClick={signInWithGoogle}
            >
              <GoogleLogo />
              Continue with Google
            </button>
          </>
        )}

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
