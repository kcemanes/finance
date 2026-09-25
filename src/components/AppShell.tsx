import { useEffect } from 'react'
import Dashboard from './Dashboard'
import Login from './Login'
import ResetPassword from './ResetPassword'
import { useSession } from '../hooks/useSession'
import { navigate } from '../lib/router'

/**
 * Everything behind /login and /app: the Supabase-backed session check, and
 * the guard between the two. Lazy-loaded from App.tsx so the public landing
 * page never pays for Supabase, IndexedDB, or the dashboard's own modules.
 */
function AppShell({
  pathname,
}: {
  pathname: '/login' | '/app' | '/reset-password'
}) {
  const { account, loading } = useSession()

  useEffect(() => {
    // The reset link signs the user in, so the usual "signed in means /app"
    // rule would whisk them away before they could set a new password.
    if (loading || pathname === '/reset-password') return
    if (pathname === '/app' && !account) navigate('/login', { replace: true })
    if (pathname === '/login' && account) navigate('/app', { replace: true })
  }, [pathname, account, loading])

  if (pathname === '/reset-password') return <ResetPassword />

  // Either the session is still resolving, or a redirect above is about to
  // fire — both render the same holding state rather than a flash of the
  // wrong screen.
  if (loading || (pathname === '/app') !== Boolean(account)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        Loading…
      </div>
    )
  }

  return account ? <Dashboard account={account} /> : <Login />
}

export default AppShell
