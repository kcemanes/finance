import { useEffect, useState } from 'react'
import {
  listCategories,
  listExpenses,
  listIncomeSources,
  listIncomes,
} from '../lib/api'
import { subscribe } from '../lib/store'
import type { Category, Expense, Income, IncomeSource } from '../types'

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
 * JavaScript rather than through indexes — a personal budget is a few thousand
 * rows even after a decade — and a second hook for the other direction would
 * only be a second subscription saying the same thing.
 *
 * Reads are quick, so `loading` is really only true for the very first read of
 * a range. A later range change keeps the previous rows on screen until the
 * new ones arrive rather than blanking the view.
 */
export function useBudgetData(userId: string, from: string, to: string) {
  const [categories, setCategories] = useState<Category[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [sources, setSources] = useState<IncomeSource[]>([])
  const [incomes, setIncomes] = useState<Income[]>([])
  const [loading, setLoading] = useState(true)
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
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : 'Could not load your budget.',
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
  // write will trigger anyway.
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
