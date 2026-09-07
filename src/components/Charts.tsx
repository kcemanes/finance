import { useMemo, useState } from 'react'
import MonthlyChart from './MonthlyChart'
import NetChart from './NetChart'
import RankedBars from './RankedBars'
import {
  categoryTotals,
  monthlyFlow,
  sourceTotals,
  windowBounds,
} from '../lib/analytics'
import { useCurrency } from '../lib/currency'
import { formatMonth, formatMonthAbbr, formatShare } from '../lib/format'
import { useBudgetData } from '../hooks/useBudgetData'

const now = new Date()

/**
 * The window always ends with the current month, which is why this view does
 * not follow the month stepper: a trend that stops halfway through history
 * because the reader was browsing March is a trap, not a feature.
 */
const RANGES = [3, 6, 12] as const

const TH =
  'border-b border-line px-2.5 py-2 text-left text-xs font-semibold uppercase tracking-[0.06em] text-muted'
const TD = 'border-b border-line px-2.5 py-2 text-ink'
const TD_NUM = 'border-b border-line px-2.5 py-2 text-right tabular-nums'

const STAT = 'text-xs font-semibold uppercase tracking-[0.06em] text-muted'
const FIGURE = 'text-3xl font-semibold tracking-[-0.5px]'

function Charts({ userId }: { userId: string }) {
  const { formatMoney } = useCurrency()
  const [range, setRange] = useState<(typeof RANGES)[number]>(6)

  const year = now.getFullYear()
  const month = now.getMonth()

  const bounds = useMemo(
    () => windowBounds(year, month, range),
    [year, month, range],
  )

  const { categories, expenses, sources, incomes, loading, error } =
    useBudgetData(userId, bounds.from, bounds.to)

  const months = useMemo(
    () => monthlyFlow(expenses, incomes, year, month, range),
    [expenses, incomes, year, month, range],
  )
  const byCategory = useMemo(
    () => categoryTotals(expenses, categories),
    [expenses, categories],
  )
  const bySource = useMemo(
    () => sourceTotals(incomes, sources),
    [incomes, sources],
  )

  const spent = months.reduce((sum, entry) => sum + entry.expense, 0)
  const earned = months.reduce((sum, entry) => sum + entry.income, 0)
  const net = earned - spent

  // An account that has never recorded income sees exactly the view it saw
  // before any of this existed: one series, one hero figure, two figures. A
  // net chart would only restate the spending chart upside down, and a
  // by-source chart would be empty.
  const hasIncome = earned > 0

  const first = months[0]
  const rangeLabel = `${formatMonthAbbr(first.year, first.month)} – ${formatMonthAbbr(year, month)}`

  return (
    <>
      {/* One filter row, above everything it scopes. */}
      <div className="my-6 flex items-center gap-2 text-sm">
        <span className="text-muted">Last</span>
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            className="btn-toggle"
            aria-pressed={option === range}
            onClick={() => setRange(option)}
          >
            {option} months
          </button>
        ))}
      </div>

      {error && (
        <p className="msg msg-error my-4" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="my-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          {hasIncome ? (
            <section className="my-8">
              <div className="flex flex-wrap justify-center gap-x-12 gap-y-5 text-center">
                <div>
                  <h2 className={STAT}>In</h2>
                  <p className={`${FIGURE} text-income-strong`}>
                    {formatMoney(earned)}
                  </p>
                </div>
                <div>
                  <h2 className={STAT}>Out</h2>
                  <p className={`${FIGURE} text-ink`}>{formatMoney(spent)}</p>
                </div>
                <div>
                  <h2 className={STAT}>Net</h2>
                  <p
                    className={`${FIGURE} ${
                      net < 0 ? 'text-overspend-strong' : 'text-income-strong'
                    }`}
                  >
                    {net < 0 ? '−' : '+'}
                    {formatMoney(Math.abs(net))}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-center text-xs text-muted">
                {rangeLabel} · {net < 0 ? 'losing' : 'keeping'}{' '}
                {formatMoney(Math.abs(net) / range)} a month on average
              </p>
            </section>
          ) : (
            <section className="my-8 text-center">
              <h2 className="text-base font-medium text-muted">
                Spent in the last {range} months
              </h2>
              {/* The hero figure: proportional digits, not tabular — equal-width
                  digits read loose at this size. */}
              <p className="text-5xl font-semibold tracking-[-1px] text-ink">
                {formatMoney(spent)}
              </p>
              <p className="mt-1.5 text-xs text-muted">
                {rangeLabel} · {formatMoney(spent / range)} a month on average
              </p>
            </section>
          )}

          {spent === 0 && earned === 0 ? (
            <p className="my-12 text-center text-muted">
              Nothing recorded in this range yet. Add an expense or an income
              and the charts will fill in.
            </p>
          ) : (
            <>
              <section className="my-10">
                <h3 className="text-sm font-semibold text-ink">By month</h3>
                <p className="mb-3 text-xs text-muted">
                  {hasIncome
                    ? `Money in and money out each month, ${rangeLabel}.`
                    : `Total spent each month, ${rangeLabel}.`}
                </p>
                <MonthlyChart
                  months={months}
                  withIncome={hasIncome}
                  label={
                    hasIncome
                      ? `Money in and money out each month, ${rangeLabel}`
                      : `Total spent each month, ${rangeLabel}`
                  }
                />
                <details className="mt-3">
                  <summary className="btn-link cursor-pointer text-muted">
                    Show as table
                  </summary>
                  <table className="mt-2 w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>
                          Month
                        </th>
                        {hasIncome && (
                          <th scope="col" className={`${TH} text-right`}>
                            In
                          </th>
                        )}
                        <th scope="col" className={`${TH} text-right`}>
                          {hasIncome ? 'Out' : 'Expenses'}
                        </th>
                        <th scope="col" className={`${TH} text-right`}>
                          {hasIncome ? 'Net' : 'Total'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {months.map((entry) => (
                        <tr key={entry.key}>
                          <td className={TD}>
                            {formatMonth(entry.year, entry.month)}
                          </td>
                          {hasIncome && (
                            <td className={`${TD_NUM} text-income-strong`}>
                              {formatMoney(entry.income)}
                            </td>
                          )}
                          <td className={`${TD_NUM} text-ink`}>
                            {hasIncome
                              ? formatMoney(entry.expense)
                              : entry.expenseCount}
                          </td>
                          <td
                            className={`${TD_NUM} ${
                              hasIncome && entry.net < 0
                                ? 'text-overspend-strong'
                                : 'text-ink'
                            }`}
                          >
                            {hasIncome
                              ? `${entry.net < 0 ? '−' : '+'}${formatMoney(Math.abs(entry.net))}`
                              : formatMoney(entry.expense)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </section>

              {hasIncome && (
                <section className="my-10">
                  <h3 className="text-sm font-semibold text-ink">
                    Net by month
                  </h3>
                  <p className="mb-3 text-xs text-muted">
                    What was left after spending, {rangeLabel}. Above the line
                    is a month you kept money; below it, one that cost more
                    than came in. Every figure is also the Net column of the
                    table above.
                  </p>
                  <NetChart
                    months={months}
                    label={`Net kept or lost each month, ${rangeLabel}`}
                  />
                </section>
              )}

              {spent > 0 && (
                <section className="my-10">
                  <h3 className="text-sm font-semibold text-ink">
                    By category
                  </h3>
                  <p className="mb-3 text-xs text-muted">
                    Where the {formatMoney(spent)} went, {rangeLabel}.
                  </p>
                  <RankedBars
                    groups={byCategory}
                    tone="expense"
                    label={`Total spent per category, ${rangeLabel}`}
                  />
                  <details className="mt-3">
                    <summary className="btn-link cursor-pointer text-muted">
                      Show as table
                    </summary>
                    <table className="mt-2 w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th scope="col" className={TH}>
                            Category
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Expenses
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Share
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {byCategory.map((entry) => (
                          <tr key={entry.id}>
                            <td className={TD}>{entry.name}</td>
                            <td className={`${TD_NUM} text-ink`}>
                              {entry.count}
                            </td>
                            <td className={`${TD_NUM} text-ink`}>
                              {formatShare(entry.share)}
                            </td>
                            <td className={`${TD_NUM} text-ink`}>
                              {formatMoney(entry.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </section>
              )}

              {hasIncome && (
                <section className="my-10">
                  <h3 className="text-sm font-semibold text-ink">By source</h3>
                  <p className="mb-3 text-xs text-muted">
                    Where the {formatMoney(earned)} came from, {rangeLabel}.
                  </p>
                  <RankedBars
                    groups={bySource}
                    tone="income"
                    label={`Total received per source, ${rangeLabel}`}
                  />
                  <details className="mt-3">
                    <summary className="btn-link cursor-pointer text-muted">
                      Show as table
                    </summary>
                    <table className="mt-2 w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th scope="col" className={TH}>
                            Source
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Payments
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Share
                          </th>
                          <th scope="col" className={`${TH} text-right`}>
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {bySource.map((entry) => (
                          <tr key={entry.id}>
                            <td className={TD}>{entry.name}</td>
                            <td className={`${TD_NUM} text-ink`}>
                              {entry.count}
                            </td>
                            <td className={`${TD_NUM} text-ink`}>
                              {formatShare(entry.share)}
                            </td>
                            <td className={`${TD_NUM} text-ink`}>
                              {formatMoney(entry.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

export default Charts
