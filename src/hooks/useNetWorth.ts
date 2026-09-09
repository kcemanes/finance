import { useEffect, useState } from 'react'
import { listAccounts, listBalances } from '../lib/api'
import { cachedRead, rememberRead } from '../lib/cache'
import { subscribe } from '../lib/store'
import type { Account, Balance } from '../types'

/** Everything this hook's read produces, as it is held in ./lib/cache. */
type NetWorthRows = { accounts: Account[]; balances: Balance[] }

const key = (userId: string) => `networth:${userId}`

/**
 * The balance sheet half of the account: every account, and every reading ever
 * taken of one.
 *
 * The mirror of useFinanceData, minus its day range. Net worth is a running
 * series rather than a set of independent months — each point depends on every
 * reading before it, because an account that was not re-read keeps its last
 * value — so a window would have to be widened to the whole history to be
 * correct anyway. One row per account per month is a few hundred rows after a
 * decade, which is well inside what ./lib/db is built to filter in JavaScript.
 *
 * Same subscription as the other hook, for the same reason: a write from the
 * form or a sync landing rows from another device both change the store behind
 * the view's back. And the same seed from ./lib/cache, which matters more here
 * than there: Balances gates its whole render on `loading`, and the day range
 * it reads the ledger for is derived from what this hook returns, so a mount
 * that starts empty walks the view through two loading states rather than one.
 */
export function useNetWorth(userId: string) {
  // Read for the initial state only; every later value arrives from the effect
  // below, which is also the only thing that writes an entry back.
  const seed = cachedRead<NetWorthRows>(key(userId))

  const [accounts, setAccounts] = useState<Account[]>(seed?.accounts ?? [])
  const [balances, setBalances] = useState<Balance[]>(seed?.balances ?? [])
  const [loading, setLoading] = useState(seed === undefined)
  const [error, setError] = useState<string | null>(null)
  const [reloadAt, setReloadAt] = useState(0)

  useEffect(() => subscribe(() => setReloadAt((n) => n + 1)), [])

  useEffect(() => {
    let cancelled = false

    async function run() {
      try {
        const [owned, readings] = await Promise.all([
          listAccounts(userId),
          listBalances(userId),
        ])
        if (cancelled) return
        setAccounts(owned)
        setBalances(readings)
        setError(null)
        rememberRead<NetWorthRows>(key(userId), {
          accounts: owned,
          balances: readings,
        })
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : 'Could not load your accounts.',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [userId, reloadAt])

  return { accounts, balances, loading, error }
}
