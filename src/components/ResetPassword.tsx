import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { navigate } from '../lib/router'
import Link from './Link'
import ThemeToggle from './ThemeToggle'

const LABEL = 'mt-2 text-sm font-semibold text-ink'
const FIELD = 'input text-base px-3 py-2.5'

type Status = 'checking' | 'ready' | 'invalid'

/**
 * Where the emailed reset link lands.
 *
 * Supabase reads the recovery token from the URL as the client starts up and
 * turns it into an ordinary session, so by the time this renders the user is
 * already signed in. All that is left is to set the new password. With no
 * session, the link was expired, already used, or opened by hand.
 */
function ResetPassword() {
  const [status, setStatus] = useState<Status>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Resolves only after the client has finished reading the URL.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setStatus(data.session ? 'ready' : 'invalid')
      })
      .catch(() => {
        if (!cancelled) setStatus('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    if (!navigator.onLine) {
      setError("You're offline. Connect to the internet to set a new password.")
      return
    }

    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (error) {
      setError(error.message)
    } else {
      navigate('/app', { replace: true })
    }
  }

  if (status === 'checking') {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        Loading…
      </div>
    )
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

      {status === 'invalid' ? (
        <div className="flex w-full max-w-[380px] flex-col gap-2 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
          <h1 className="text-[1.6rem]/tight font-semibold text-ink">
            Link expired
          </h1>
          <p className="mb-4 text-sm text-muted">
            This reset link is invalid or has already been used. Request a new
            one from the sign-in page.
          </p>
          <Link href="/login" className="btn-primary px-4 py-2.5 text-base">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="flex w-full max-w-[380px] flex-col gap-2 rounded-xl border border-line bg-surface p-8 shadow-card"
          onSubmit={handleSubmit}
        >
          <h1 className="text-center text-[1.6rem]/tight font-semibold text-ink">
            Set a new password
          </h1>
          <p className="mb-4 text-center text-sm text-muted">
            Choose a password you haven't used here before.
          </p>

          <label htmlFor="new-password" className={LABEL}>
            New password
          </label>
          <input
            id="new-password"
            type="password"
            className={FIELD}
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />

          <label htmlFor="confirm-password" className={LABEL}>
            Confirm password
          </label>
          <input
            id="confirm-password"
            type="password"
            className={FIELD}
            autoComplete="new-password"
            required
            minLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
          />

          {error && (
            <p className="msg msg-error mt-3 text-center" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary mt-5 px-4 py-2.5 text-base"
            disabled={busy}
          >
            {busy ? 'Working…' : 'Update password'}
          </button>
        </form>
      )}
    </div>
  )
}

export default ResetPassword
