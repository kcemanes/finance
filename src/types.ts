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

/**
 * A place money sits: a bank account, an investment account, something owned
 * outright, or something owed.
 *
 * Not to be confused with the `Account` in ./lib/auth, which is the signed-in
 * *user*. That one is only ever held as the `account` prop; these are always a
 * list called `accounts`.
 *
 * `kind` is what carries direction — a debt holds a positive amount and is
 * subtracted because of what it is, not because of a sign. `is_active` is
 * archiving rather than deletion: an account that is closed keeps every
 * balance it ever held, because those are still part of what net worth was in
 * those months, and simply stops being asked about.
 *
 * `include_in_net_worth` is neither of those — the account still shows up
 * every month and still appears on the balance sheet, it is just left out of
 * the total. That is for things whose balance is real but not part of what
 * you could actually spend: an untouchable retirement account, or a car that
 * only ever depreciates.
 */
export type AccountKind = 'bank' | 'investment' | 'other_asset' | 'debt'

export type Account = {
  id: string
  name: string
  kind: AccountKind
  is_active: boolean
  include_in_net_worth: boolean
}

/**
 * What one account was worth at one month end.
 *
 * A snapshot, not a transaction: recording the same account and month twice
 * replaces the earlier reading rather than adding to it, which is why the
 * store looks for an existing row before it writes and the server takes these
 * as upserts. `as_of` is always the last day of its month.
 */
export type Balance = {
  id: string
  account_id: string
  as_of: string // YYYY-MM-DD, always a month end
  amount: number
  note: string | null
  created_at: string
}
