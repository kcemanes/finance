/**
 * The aggregations behind the charts.
 *
 * Everything here is a pure function over rows the store has already handed
 * back, so it costs nothing to re-run on every render and works offline for
 * the same reason the rest of the app does: it never asks anyone anything.
 *
 * Two halves, in this order: the flow aggregations that the month and chart
 * views are built from, and — under the "Net worth" banner further down — the
 * balance-sheet ones. They share this file rather than splitting because the
 * last function in it needs both.
 */
import { monthBounds } from './format'
import type {
  Account,
  AccountKind,
  Balance,
  Category,
  Expense,
  Income,
  IncomeSource,
} from '../types'

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

// ---------------------------------------------------------------------------
// Net worth
//
// Everything above aggregates *flows* — money that crossed a line during a
// month. What follows aggregates the *stock* those flows move: what each
// account was worth at each month end, and what the whole balance sheet came
// to.
//
// The two meet in `reconcile`, which is the only thing here that could not be
// done with the balances alone, and the reason they are worth keeping in the
// same app as the ledger.
// ---------------------------------------------------------------------------

/**
 * The kinds an account can be, in the order a balance sheet lists them, with
 * the labels the UI shows and the one fact the arithmetic needs.
 *
 * Ordering lives here rather than in the store because it is a presentation
 * decision — the store sorts by name, as it does for every other parent — and
 * because this is already where "which kinds are subtracted" is decided.
 */
export const ACCOUNT_KINDS: {
  id: AccountKind
  label: string
  /** Subtracted from the total rather than added to it. */
  debt: boolean
}[] = [
  { id: 'bank', label: 'Bank accounts', debt: false },
  { id: 'investment', label: 'Investments', debt: false },
  { id: 'other_asset', label: 'Other assets', debt: false },
  { id: 'debt', label: 'Debt', debt: true },
]

const DEBT_KINDS = new Set(
  ACCOUNT_KINDS.filter((kind) => kind.debt).map((kind) => kind.id),
)

/** What one account was worth at one month end, and where the figure came from. */
export type Holding = {
  account_id: string
  amount: number
  /**
   * True when this is an earlier month's reading carried forward rather than
   * one taken for this month. See `netWorthSeries` for why that is the default
   * and not a gap.
   */
  carried: boolean
}

/** The whole balance sheet at one month end. */
export type NetWorthPoint = {
  key: string // YYYY-MM
  year: number
  month: number // 0-11, as Date uses
  assets: number
  debt: number
  /** assets - debt. */
  net: number
  holdings: Holding[]
  /** How many of the holdings were carried forward rather than read. */
  carried: number
}

/**
 * Net worth at every month end that was actually recorded, oldest first.
 *
 * Two rules do all the work, and both are the opposite of what a spreadsheet
 * of the same shape does by default.
 *
 * **A month with no readings is not a point.** The series stops at the last
 * month anyone wrote something down, rather than running on to the end of the
 * year at zero. A grid has a column for every month whether or not it was
 * filled in, so its chart plots the empty ones as zero and the line falls off
 * a cliff at today; there is no such column here, and nothing to fall off.
 *
 * **An account that was not re-read keeps its last known value.** Recording a
 * month means typing in the two or three accounts that moved, not all
 * thirteen — so treating a blank as zero would delete most of the balance
 * sheet every month. Carried figures are marked rather than hidden, and the
 * count is kept on the point, because the difference matters when reading the
 * chart: a month where everything was carried is last month redrawn, not news.
 *
 * An archived account is carried only as far as its final reading. That is
 * what stops closing an account from either dragging a stale figure forward
 * forever or rewriting the months it was genuinely part of.
 */
export function netWorthSeries(
  accounts: Account[],
  balances: Balance[],
): NetWorthPoint[] {
  const kinds = new Map(accounts.map((account) => [account.id, account.kind]))
  const isActive = new Map(
    accounts.map((account) => [account.id, account.is_active]),
  )

  // Readings grouped by the month they describe, and the last month each
  // account was read in.
  const readings = new Map<string, Balance[]>()
  const lastRead = new Map<string, string>()

  for (const balance of balances) {
    // as_of is YYYY-MM-DD and always a month end, so its first seven
    // characters are the month it belongs to.
    const key = balance.as_of.slice(0, 7)
    const month = readings.get(key)
    if (month) month.push(balance)
    else readings.set(key, [balance])

    const seen = lastRead.get(balance.account_id)
    if (!seen || key > seen) lastRead.set(balance.account_id, key)
  }

  // Ascending, which is what lets a single forward pass carry values along.
  const keys = [...readings.keys()].sort()

  const latest = new Map<string, number>()
  const points: NetWorthPoint[] = []

  for (const key of keys) {
    const fresh = new Set<string>()
    for (const balance of readings.get(key) ?? []) {
      latest.set(balance.account_id, balance.amount)
      fresh.add(balance.account_id)
    }

    const holdings: Holding[] = []
    let assets = 0
    let debt = 0

    for (const [id, amount] of latest) {
      const kind = kinds.get(id)
      // A reading with no account is not reachable through the app — the
      // foreign key is `on delete restrict` — but a pull that caught another
      // device mid-write could land one before its parent arrives.
      if (!kind) continue
      // Past the month an archived account was last a real place money sat.
      if (!isActive.get(id) && key > (lastRead.get(id) ?? key)) continue

      holdings.push({ account_id: id, amount, carried: !fresh.has(id) })
      if (DEBT_KINDS.has(kind)) debt += amount
      else assets += amount
    }

    const [year, month] = key.split('-').map(Number)
    points.push({
      key,
      year,
      month: month - 1,
      assets,
      debt,
      net: assets - debt,
      holdings,
      carried: holdings.filter((holding) => holding.carried).length,
    })
  }

  return points
}

/**
 * What moved net worth between one reading and the next, split into the part
 * the ledger accounts for and the part it does not.
 */
export type Reconciliation = {
  key: string // YYYY-MM of the later reading
  year: number
  month: number
  /** Net worth at this reading, less net worth at the previous one. */
  change: number
  /** Income less expenses over every month since that previous reading. */
  flow: number
  /** change - flow: what the ledger does not explain. */
  unexplained: number
  /** Months between the two readings. Usually 1, more if a month was skipped. */
  span: number
  /** False when the ledger was not loaded for every month in the span. */
  complete: boolean
}

/**
 * Joins the balance sheet to the ledger, month by month.
 *
 * This is the one figure neither half can produce alone. Net worth moved by
 * some amount; the ledger says how much of that was money arriving and
 * leaving; the remainder is everything else — market movement, interest, a
 * revaluation, and any spending that never got typed in. Naming it as a
 * remainder rather than as "returns" is deliberate: it is defined by what it
 * is not, and an unrecorded month of expenses lands in it too.
 *
 * A transfer between two of your own accounts correctly contributes nothing to
 * any of the three figures, which is the other reason to measure this way
 * rather than by summing transactions.
 */
export function reconcile(
  points: NetWorthPoint[],
  months: MonthFlow[],
): Reconciliation[] {
  const flows = new Map(months.map((month) => [month.key, month]))
  const rows: Reconciliation[] = []

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const point = points[index]

    // Every month after the previous reading, up to and including this one.
    // Stepping a Date rather than counting keeps a span that crosses a year
    // boundary honest.
    const span: string[] = []
    const cursor = new Date(previous.year, previous.month + 1, 1)
    for (;;) {
      const key = monthKey(cursor.getFullYear(), cursor.getMonth())
      if (key > point.key) break
      span.push(key)
      cursor.setMonth(cursor.getMonth() + 1)
    }

    let flow = 0
    let complete = true
    for (const key of span) {
      const month = flows.get(key)
      if (!month) {
        // The caller's window did not reach this far back. Better to say the
        // split is partial than to report a remainder built from a flow of
        // zero, which would read as an enormous unexplained gain.
        complete = false
        continue
      }
      flow += month.net
    }

    const change = point.net - previous.net
    rows.push({
      key: point.key,
      year: point.year,
      month: point.month,
      change,
      flow,
      unexplained: change - flow,
      span: span.length,
      complete,
    })
  }

  return rows
}
