import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import ThemeToggle from './ThemeToggle'

type Mode = 'signin' | 'signup'

const LABEL = 'mt-2 text-sm font-semibold text-ink'
// The sign-in form is the only full-width surface, so its controls run a
// step larger than the base .input size.
const FIELD = 'input text-base px-3 py-2.5'

function Login() {
  const [mode, setMode] = useState<Mode>('signin')
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

  function switchMode() {
    setMode((mode) => (mode === 'signin' ? 'signup' : 'signin'))
    setError(null)
    setNotice(null)
  }

  return (
    <div className="relative flex flex-1 items-center justify-center bg-linear-to-b from-accent-soft to-ground to-60% px-4 py-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <form
        className="flex w-full max-w-[380px] flex-col gap-2 rounded-xl border border-line bg-surface p-8 shadow-card"
        onSubmit={handleSubmit}
      >
        <h1 className="text-center text-[1.6rem]/tight font-semibold text-ink">
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </h1>
        <p className="mb-4 text-center text-sm text-muted">
          {mode === 'signin'
            ? 'Welcome back to your finances.'
            : 'Start tracking your finances.'}
        </p>

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

        <label htmlFor="password" className={LABEL}>
          Password
        </label>
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
          {busy
            ? 'Working…'
            : mode === 'signin'
              ? 'Sign in'
              : 'Sign up'}
        </button>

        <p className="mt-4 text-center text-sm">
          {mode === 'signin' ? "Don't have an account?" : 'Already have one?'}{' '}
          <button
            type="button"
            className="btn-link font-semibold text-accent-strong"
            onClick={switchMode}
          >
            {mode === 'signin' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </form>
    </div>
  )
}

export default Login
