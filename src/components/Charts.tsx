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
import { useFinanceData } from '../hooks/useFinanceData'

const now = new Date()

/**
 * The window always ends with the current month, which is why this view does
 * not follow the month stepper: a trend that stops halfway through history
 * because the reader was browsing March is a trap, not a feature.
 */
const RANGES = [3, 6, 12, 24, 36] as const

/**
 * "6 months", "2 years". Past a year the month count stops being the unit
 * anyone thinks in — a button reading "36 months" looks like a typo.
 */
function rangeName(months: number) {
  if (months < 12) return `${months} months`
  const years = months / 12
  return years === 1 ? '1 year' : `${years} years`
}

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
    useFinanceData(userId, bounds.from, bounds.to)

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
  const spanName = rangeName(range)

  return (
    <>
      {/* One filter row, above everything it scopes. */}
      <div className="my-6 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Last</span>
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            className="btn-toggle"
            aria-pressed={option === range}
            onClick={() => setRange(option)}
          >
            {rangeName(option)}
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
              <div className="flex flex-wrap justify-center gap-x-12 gap-y-5 text-center max-sm:gap-x-6">
                <div>
                  <h2 className="stat-label">In</h2>
                  <p className="stat-figure-sm text-income-strong">
                    {formatMoney(earned)}
                  </p>
                </div>
                <div>
                  <h2 className="stat-label">Out</h2>
                  <p className="stat-figure-sm text-ink">{formatMoney(spent)}</p>
                </div>
                <div>
                  <h2 className="stat-label">Net</h2>
                  <p
                    className={`stat-figure-sm ${
                      net < 0 ? 'text-overspend-strong' : 'text-income-strong'
                    }`}
                  >
                    {net < 0 ? '−' : '+'}
                    {formatMoney(Math.abs(net))}
                  </p>
                </div>
              </div>
              <p className="stat-note mt-3 text-center">
                {rangeLabel} · {net < 0 ? 'losing' : 'keeping'}{' '}
                {formatMoney(Math.abs(net) / range)} a month on average
              </p>
            </section>
          ) : (
            <section className="my-8 text-center">
              <h2 className="stat-label">Spent in the last {spanName}</h2>
              <p className="stat-figure">{formatMoney(spent)}</p>
              <p className="stat-note">
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
                <h3 className="section-title">By month</h3>
                <p className="section-note">
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
                  <div className="overflow-x-auto">
                    <table className="table mt-2">
                      <thead>
                        <tr>
                          <th scope="col">
                            Month
                          </th>
                          {hasIncome && (
                            <th scope="col" className="num">
                              In
                            </th>
                          )}
                          <th scope="col" className="num">
                            {hasIncome ? 'Out' : 'Expenses'}
                          </th>
                          <th scope="col" className="num">
                            {hasIncome ? 'Net' : 'Total'}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {months.map((entry) => (
                          <tr key={entry.key}>
                            <td>
                              {formatMonth(entry.year, entry.month)}
                            </td>
                            {hasIncome && (
                              <td className="num text-income-strong">
                                {formatMoney(entry.income)}
                              </td>
                            )}
                            <td className="num">
                              {hasIncome
                                ? formatMoney(entry.expense)
                                : entry.expenseCount}
                            </td>
                            <td
                              className={`num ${
                                hasIncome && entry.net < 0
                                  ? 'text-overspend-strong'
                                  : ''
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
                  </div>
                </details>
              </section>

              {hasIncome && (
                <section className="my-10">
                  <h3 className="section-title">
                    Net by month
                  </h3>
                  <p className="section-note">
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
                  <h3 className="section-title">
                    By category
                  </h3>
                  <p className="section-note">
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
                    <div className="overflow-x-auto">
                      <table className="table mt-2">
                        <thead>
                          <tr>
                            <th scope="col">
                              Category
                            </th>
                            <th scope="col" className="num">
                              Expenses
                            </th>
                            <th scope="col" className="num">
                              Share
                            </th>
                            <th scope="col" className="num">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {byCategory.map((entry) => (
                            <tr key={entry.id}>
                              <td>{entry.name}</td>
                              <td className="num">
                                {entry.count}
                              </td>
                              <td className="num">
                                {formatShare(entry.share)}
                              </td>
                              <td className="num">
                                {formatMoney(entry.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </section>
              )}

              {hasIncome && (
                <section className="my-10">
                  <h3 className="section-title">By source</h3>
                  <p className="section-note">
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
                    <div className="overflow-x-auto">
                      <table className="table mt-2">
                        <thead>
                          <tr>
                            <th scope="col">
                              Source
                            </th>
                            <th scope="col" className="num">
                              Payments
                            </th>
                            <th scope="col" className="num">
                              Share
                            </th>
                            <th scope="col" className="num">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {bySource.map((entry) => (
                            <tr key={entry.id}>
                              <td>{entry.name}</td>
                              <td className="num">
                                {entry.count}
                              </td>
                              <td className="num">
                                {formatShare(entry.share)}
                              </td>
                              <td className="num">
                                {formatMoney(entry.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
