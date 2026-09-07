/**
 * The aggregations behind the charts.
 *
 * Everything here is a pure function over rows the store has already handed
 * back, so it costs nothing to re-run on every render and works offline for
 * the same reason the rest of the app does: it never asks anyone anything.
 */
import { monthBounds } from './format'
import type { Category, Expense, Income, IncomeSource } from '../types'

/** One month of both directions, plus the net between them. */
export type MonthFlow = {
  key: string // YYYY-MM
  year: number
  month: number // 0-11, as Date uses
  expense: number
  income: number
  /** income - expense. Negative is a month that cost more than it earned. */
  net: number
  expenseCount: number
  incomeCount: number
}

/** A ranked slice of one direction — a category, or an income source. */
export type GroupTotal = {
  id: string
  name: string
  total: number
  count: number
  /** Fraction of the direction's grand total, 0-1. */
  share: number
}

/** An actual against the target it is measured by, if one is set. */
export type TargetRow = {
  id: string
  name: string
  actual: number
  target: number | null
}

function monthKey(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

/**
 * The inclusive day range covering `months` months and ending with the given
 * one, in the shape `listExpenses` wants.
 */
export function windowBounds(year: number, month: number, months: number) {
  // Month arithmetic through Date, so a window that reaches back past January
  // rolls the year rather than producing a negative month.
  const first = new Date(year, month - (months - 1), 1)
  return {
    from: monthBounds(first.getFullYear(), first.getMonth()).from,
    to: monthBounds(year, month).to,
  }
}

/**
 * One entry per month in the window, oldest first, carrying both directions.
 *
 * Months with nothing in them are kept as zeroes on purpose: a gap is part of
 * the trend, and dropping the row would silently compress the axis.
 */
export function monthlyFlow(
  expenses: Expense[],
  incomes: Income[],
  year: number,
  month: number,
  months: number,
): MonthFlow[] {
  const buckets = new Map<string, MonthFlow>()

  for (let back = months - 1; back >= 0; back--) {
    const at = new Date(year, month - back, 1)
    const key = monthKey(at.getFullYear(), at.getMonth())
    buckets.set(key, {
      key,
      year: at.getFullYear(),
      month: at.getMonth(),
      expense: 0,
      income: 0,
      net: 0,
      expenseCount: 0,
      incomeCount: 0,
    })
  }

  for (const expense of expenses) {
    // spent_on is YYYY-MM-DD, so its first seven characters are the key.
    const bucket = buckets.get(expense.spent_on.slice(0, 7))
    // Anything outside the window belongs to a range the caller did not ask
    // for; ignoring it keeps the totals and the axis in agreement.
    if (!bucket) continue
    bucket.expense += expense.amount
    bucket.expenseCount += 1
  }

  for (const income of incomes) {
    const bucket = buckets.get(income.received_on.slice(0, 7))
    if (!bucket) continue
    bucket.income += income.amount
    bucket.incomeCount += 1
  }

  for (const bucket of buckets.values()) bucket.net = bucket.income - bucket.expense

  return [...buckets.values()]
}

/**
 * Ranks parents by what flowed through them, largest first.
 *
 * `rows` has already been reduced to (parent id, amount) pairs, which is the
 * only thing the two directions disagree about.
 */
function rank(
  rows: { id: string; amount: number }[],
  names: Map<string, string>,
  unnamed: string,
): GroupTotal[] {
  const buckets = new Map<string, GroupTotal>()

  for (const row of rows) {
    let bucket = buckets.get(row.id)
    if (!bucket) {
      // A parent deleted on another device can still have rows here.
      bucket = { id: row.id, name: names.get(row.id) ?? unnamed, total: 0, count: 0, share: 0 }
      buckets.set(row.id, bucket)
    }
    bucket.total += row.amount
    bucket.count += 1
  }

  const ranked = [...buckets.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  )

  const grand = ranked.reduce((sum, row) => sum + row.total, 0)
  if (grand > 0) for (const row of ranked) row.share = row.total / grand

  return ranked
}

/** Categories that were actually spent on, largest first. */
export function categoryTotals(
  expenses: Expense[],
  categories: Category[],
): GroupTotal[] {
  return rank(
    expenses.map((e) => ({ id: e.category_id, amount: e.amount })),
    new Map(categories.map((c) => [c.id, c.name])),
    'Uncategorised',
  )
}

/** Income sources that actually paid, largest first. */
export function sourceTotals(
  incomes: Income[],
  sources: IncomeSource[],
): GroupTotal[] {
  return rank(
    incomes.map((i) => ({ id: i.source_id, amount: i.amount })),
    new Map(sources.map((s) => [s.id, s.name])),
    'Unattributed',
  )
}

/**
 * Actuals joined to their targets, largest first.
 *
 * A parent with no target is kept as long as something flowed through it —
 * the bar is still worth seeing. One with a target is kept even at zero,
 * because a target that was missed entirely is the most useful row on screen.
 */
function targets(
  rows: { id: string; amount: number }[],
  parents: { id: string; name: string; target: number | null }[],
): TargetRow[] {
  const actuals = new Map<string, number>()
  for (const row of rows) actuals.set(row.id, (actuals.get(row.id) ?? 0) + row.amount)

  return parents
    .map((parent) => ({
      id: parent.id,
      name: parent.name,
      actual: actuals.get(parent.id) ?? 0,
      target: parent.target,
    }))
    .filter((row) => row.actual > 0 || row.target !== null)
    .sort((a, b) => b.actual - a.actual)
}

export function categoryTargets(
  expenses: Expense[],
  categories: Category[],
): TargetRow[] {
  return targets(
    expenses.map((e) => ({ id: e.category_id, amount: e.amount })),
    categories.map((c) => ({ id: c.id, name: c.name, target: c.monthly_budget })),
  )
}

export function sourceTargets(
  incomes: Income[],
  sources: IncomeSource[],
): TargetRow[] {
  return targets(
    incomes.map((i) => ({ id: i.source_id, amount: i.amount })),
    sources.map((s) => ({ id: s.id, name: s.name, target: s.expected_monthly })),
  )
}

const LADDER = [1, 2, 2.5, 5, 10]

/** The roundest step at or above `rough`. */
function niceStep(rough: number) {
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  return (LADDER.find((s) => rough <= s * magnitude) ?? 10) * magnitude
}

/**
 * The top of an axis that clears `peak` and splits into `divisions` round
 * ticks.
 *
 * The tick step is what gets rounded, not the top: rounding the top first
 * gives clean ends and ugly middles ($10K in four steps of $2,500), and can
 * leave the tallest column at a third of the plot for want of a nicer number
 * to stop at.
 */
export function axisMax(peak: number, divisions: number) {
  if (peak <= 0) return 0
  return niceStep(peak / divisions) * divisions
}

/**
 * A diverging axis: round ticks spanning `min`..`max`, always including zero.
 *
 * The step is rounded rather than the ends, for the same reason as `axisMax`.
 * The consequence that matters here is a different one, though: both ends
 * come out as multiples of the step, so **zero always lands exactly on a
 * gridline**. A zero line floating between ticks would misreport which
 * columns sit below it, which is the one thing a net chart exists to show.
 *
 * The range can end up wider than `divisions` steps when it has to reach in
 * both directions. That is the honest outcome; the alternative is clipping a
 * column.
 */
export function axisBounds(min: number, max: number, divisions: number) {
  // Zero has to be inside the range, or there is no baseline to diverge from.
  const low = Math.min(min, 0)
  const high = Math.max(max, 0)
  // Only reachable when every value is exactly zero, since one end is clamped.
  if (low === high) return { low: 0, high: 0, ticks: [0] }

  const step = niceStep((high - low) / divisions)
  const from = Math.floor(low / step) * step
  const to = Math.ceil(high / step) * step

  // Multiplied out from `from` rather than accumulated, so rounding error
  // cannot drift the zero tick off the line it is supposed to sit on.
  const count = Math.round((to - from) / step)
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) ticks.push(from + i * step)

  return { low: from, high: to, ticks }
}
