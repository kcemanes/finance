/**
 * What the last read of each range handed back, for as long as the page is open.
 *
 * The views are tabs, and a tab that is left is unmounted: its hook loses its
 * rows, and its next mount starts in `loading` again. So coming back to a view
 * you were looking at a moment ago means watching "Loading…" while a read that
 * has nothing new to say finishes. Seeding a hook's first state from here
 * removes that flash — the rows are on screen in the first frame, and the read
 * that runs anyway either confirms them or replaces them.
 *
 * That makes this stale-while-revalidate, and the stale half is only safe
 * because of who else writes to the store: every mutation in ./store ends in
 * `notifyChanged`, both hooks subscribe to it, and every re-read overwrites the
 * entry it was seeded from. Nothing changes the store without a re-read
 * following, so an entry can be at most one read behind — and only for the
 * moment between a mount and that read resolving.
 *
 * Entries are keyed by everything their read depends on, the account id
 * included, so two accounts in one browser cannot see each other's rows.
 * ./store's `clearLocalData` empties this as well: sign-out wipes the database
 * these are copies of, and a copy that outlived its source would be the one
 * thing here no re-read can correct.
 */

const entries = new Map<string, unknown>()

/** The last rows read for `key`, or undefined if this page never read it. */
export function cachedRead<T>(key: string): T | undefined {
  return entries.get(key) as T | undefined
}

export function rememberRead<T>(key: string, rows: T): void {
  entries.set(key, rows)
}

export function forgetReads(): void {
  entries.clear()
}
