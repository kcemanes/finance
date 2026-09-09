import { useEffect, useState } from 'react'
import {
  listCategories,
  listExpenses,
  listIncomeSources,
  listIncomes,
} from '../lib/api'
import { cachedRead, rememberRead } from '../lib/cache'
import { subscribe } from '../lib/store'
import type { Category, Expense, Income, IncomeSource } from '../types'

/** Everything one range's read produces, as it is held in ./lib/cache. */
type FinanceRows = {
  categories: Category[]
  expenses: Expense[]
  sources: IncomeSource[]
  incomes: Income[]
}

const key = (userId: string, from: string, to: string) =>
  `finance:${userId}:${from}:${to}`

/**
 * Both halves of the account — categories with expenses, income sources with
 * incomes — for one day range, kept current.
 *
 * The store changes from underneath: a write from a component, or a sync
 * landing rows from another device. One subscription re-reads for all four, so
 * a caller never threads a reload callback down through the tree.
 *
 * Every view gets all four lists even when it only draws one of them. The
 * reads are local and cheap for the same reason ./lib/db filters in
 * JavaScript rather than through indexes — a personal ledger is a few thousand
 * rows even after a decade — and a second hook for the other direction would
 * only be a second subscription saying the same thing.
 *
 * Reads are quick, so `loading` is only ever true for a range this page has
 * not read yet: a range it has comes back from ./lib/cache in the first frame
 * instead, which is what keeps a tab returned to from flashing "Loading…" over
 * rows it already had. A range change *within* one mount is unaffected either
 * way — it keeps the rows on screen until the new ones arrive, rather than
 * blanking the view.
 */
export function useFinanceData(userId: string, from: string, to: string) {
  // Read for the initial state only; every later value arrives from the effect
  // below, which is also the only thing that writes an entry back.
  const seed = cachedRead<FinanceRows>(key(userId, from, to))

  const [categories, setCategories] = useState<Category[]>(
    seed?.categories ?? [],
  )
  const [expenses, setExpenses] = useState<Expense[]>(seed?.expenses ?? [])
  const [sources, setSources] = useState<IncomeSource[]>(seed?.sources ?? [])
  const [incomes, setIncomes] = useState<Income[]>(seed?.incomes ?? [])
  const [loading, setLoading] = useState(seed === undefined)
  const [error, setError] = useState<string | null>(null)
  const [reloadAt, setReloadAt] = useState(0)

  useEffect(() => subscribe(() => setReloadAt((n) => n + 1)), [])

  useEffect(() => {
    // Guards against a slow response for a range the user already left.
    let cancelled = false

    async function run() {
      try {
        const [cats, spent, srcs, received] = await Promise.all([
          listCategories(userId),
          listExpenses(userId, from, to),
          listIncomeSources(userId),
          listIncomes(userId, from, to),
        ])
        if (cancelled) return
        setCategories(cats)
        setExpenses(spent)
        setSources(srcs)
        setIncomes(received)
        setError(null)
        rememberRead<FinanceRows>(key(userId, from, to), {
          categories: cats,
          expenses: spent,
          sources: srcs,
          incomes: received,
        })
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : 'Could not load your finances.',
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [userId, from, to, reloadAt])

  // The two setters are handed back so a component that has just created a
  // category or a source can show it without waiting for the re-read the
  // write will trigger anyway. They deliberately do not touch the cache: that
  // same re-read is what puts the new row in it, a moment later.
  return {
    categories,
    expenses,
    sources,
    incomes,
    loading,
    error,
    setCategories,
    setSources,
  }
}
