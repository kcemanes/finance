/**
 * The remembered account, read and written with no dependency on Supabase.
 *
 * Split out of auth.ts so that surfaces which only need to answer "is anyone
 * signed in" — the landing page's CTA, for one — never pull in the Supabase
 * client to do it.
 */
export type Account = { id: string; email: string }

const STORAGE_KEY = 'budget.account'

export function storedAccount(): Account | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Account).id === 'string'
    ) {
      return parsed as Account
    }
  } catch {
    // Unreadable or not JSON: treat it as nobody, and let Supabase decide.
  }
  return null
}

export function storeAccount(account: Account) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(account))
  } catch {
    // Storage blocked. Sessions then last only as long as the tab, which is
    // the same deal the rest of the app's settings get.
  }
}

export function forgetAccount() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to undo.
  }
}
