/**
 * Just enough client-side routing for a handful of static paths (/, /login,
 * /app, /reset-password).
 * A dependency was not worth it for a switch this small — see App.tsx.
 *
 * `pushState`/`replaceState` do not fire `popstate`, so every navigation that
 * goes through `navigate()` also dispatches a same-tab `locationchange` event
 * for `usePathname` to pick up.
 */
import { useSyncExternalStore } from 'react'

const LOCATION_CHANGE = 'locationchange'

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener(LOCATION_CHANGE, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(LOCATION_CHANGE, onChange)
  }
}

function getPathname() {
  return window.location.pathname
}

export function usePathname() {
  return useSyncExternalStore(subscribe, getPathname)
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  const current = window.location.pathname + window.location.search
  if (current === path && !options.replace) return

  if (options.replace) {
    window.history.replaceState(null, '', path)
  } else {
    window.history.pushState(null, '', path)
  }
  window.dispatchEvent(new Event(LOCATION_CHANGE))
}
