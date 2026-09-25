import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Landing from './components/Landing'
import RouteErrorBoundary from './components/RouteErrorBoundary'
import UpdatePrompt from './components/UpdatePrompt'
import { navigate, usePathname } from './lib/router'
import {
  CurrencyContext,
  formatMoneyCompactIn,
  formatMoneyIn,
  storeCurrency,
  storedCurrency,
} from './lib/currency'
import type { CurrencyCode } from './lib/currency'
import {
  ThemeContext,
  applyTheme,
  storeTheme,
  storedTheme,
  systemTheme,
  watchSystemTheme,
} from './lib/theme'
import type { ThemeChoice } from './lib/theme'

// Everything behind /login and /app — Supabase, the session hook, the
// dashboard — in one chunk that a visit to / never has to download.
const AppShell = lazy(() => import('./components/AppShell'))

const KNOWN_PATHS = new Set(['/', '/login', '/app', '/reset-password'])

function App() {
  const pathname = usePathname()
  const [currency, setCurrency] = useState(storedCurrency)
  const [theme, setTheme] = useState(storedTheme)
  const [system, setSystem] = useState(systemTheme)

  // Only matters while the choice is `system`, but tracking it unconditionally
  // keeps `resolved` correct the moment the user switches back to it.
  useEffect(() => watchSystemTheme(setSystem), [])

  const resolved = theme === 'system' ? system : theme

  // index.html already stamped this before the first paint; re-applying covers
  // a later change, and a first load where storage was unreadable.
  useEffect(() => applyTheme(resolved), [resolved])

  const currencyValue = useMemo(
    () => ({
      currency,
      setCurrency: (code: CurrencyCode) => {
        storeCurrency(code)
        setCurrency(code)
      },
      formatMoney: (amount: number) => formatMoneyIn(currency, amount),
      formatMoneyCompact: (amount: number) =>
        formatMoneyCompactIn(currency, amount),
    }),
    [currency],
  )

  const themeValue = useMemo(() => {
    const choose = (choice: ThemeChoice) => {
      storeTheme(choice)
      setTheme(choice)
    }

    return {
      theme,
      resolved,
      setTheme: choose,
      // Reads off `resolved`, so the first click always moves away from what
      // is on screen rather than from the `system` placeholder.
      toggleTheme: () => choose(resolved === 'dark' ? 'light' : 'dark'),
    }
  }, [theme, resolved])

  // An unknown path (or one left over from before this routing existed)
  // lands on the public landing page rather than a dead end.
  useEffect(() => {
    if (!KNOWN_PATHS.has(pathname)) navigate('/', { replace: true })
  }, [pathname])

  return (
    <ThemeContext.Provider value={themeValue}>
      <CurrencyContext.Provider value={currencyValue}>
        {pathname === '/login' ||
        pathname === '/app' ||
        pathname === '/reset-password' ? (
          <RouteErrorBoundary>
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center p-8 text-center">
                  Loading…
                </div>
              }
            >
              <AppShell pathname={pathname} />
            </Suspense>
          </RouteErrorBoundary>
        ) : (
          <Landing />
        )}
        <UpdatePrompt />
      </CurrencyContext.Provider>
    </ThemeContext.Provider>
  )
}

export default App
