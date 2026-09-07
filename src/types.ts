/**
 * The rows the UI reads. Money out is a category plus its expenses, money in
 * is a source plus its incomes; the two halves are deliberately separate
 * tables rather than one signed one, so `amount` is always positive and no
 * aggregation has to reason about direction.
 *
 * `created_at` is part of the public shape because the ledger sorts by it:
 * several entries on the same day should read in the order they were typed.
 */

export type Category = {
  id: string
  name: string
  monthly_budget: number | null
}

export type Expense = {
  id: string
  category_id: string
  spent_on: string // YYYY-MM-DD
  amount: number
  note: string | null
  created_at: string
}

/**
 * The mirror of Category. `expected_monthly` is a floor rather than the
 * ceiling `monthly_budget` is — see the note in supabase/schema.sql.
 */
export type IncomeSource = {
  id: string
  name: string
  expected_monthly: number | null
}

export type Income = {
  id: string
  source_id: string
  received_on: string // YYYY-MM-DD
  amount: number
  note: string | null
  created_at: string
}
