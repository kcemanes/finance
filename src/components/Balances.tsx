import { Fragment, useMemo } from 'react'
import AccountsEditor from './AccountsEditor'
import NetWorthChart from './NetWorthChart'
import SnapshotForm from './SnapshotForm'
import {
  ACCOUNT_KINDS,
  monthlyFlow,
  netWorthSeries,
  reconcile,
  windowBounds,
} from '../lib/analytics'
import { useCurrency } from '../lib/currency'
import { formatMonth, formatMonthAbbr } from '../lib/format'
import { useFinanceData } from '../hooks/useFinanceData'
import { useNetWorth } from '../hooks/useNetWorth'

const now = new Date()

/**
 * The balance sheet: what everything is worth, how it got there, and the form
 * that keeps it up to date.
 *
 * The one section here that could not be built from the balances alone is the
 * reconciliation. Net worth moved; the ledger on the other two tabs says how
 * much of that was money arriving and leaving; the difference is everything
 * else. Keeping both halves in one app is what makes that subtraction
 * possible, and it is the reason this is a tab rather than its own thing.
 */
function Balances({ userId }: { userId: string }) {
  const { formatMoney } = useCurrency()
  const { accounts, balances, loading, error } = useNetWorth(userId)

  const points = useMemo(
    () => netWorthSeries(accounts, balances),
    [accounts, balances],
  )

  const latest = points.at(-1) ?? null
  const previous = points.at(-2) ?? null

  // The ledger has to reach back as far as the first reading for the
  // reconciliation to be able to explain every step. Before there is a single
  // reading there is nothing to explain, and the window collapses to a month.
  const span = points[0]
    ? (now.getFullYear() - points[0].year) * 12 +
      (now.getMonth() - points[0].month) +
      1
    : 1

  const bounds = useMemo(
    () => windowBounds(now.getFullYear(), now.getMonth(), span),
    [span],
  )
  const { expenses, incomes } = useFinanceData(userId, bounds.from, bounds.to)

  const months = useMemo(
    () => monthlyFlow(expenses, incomes, now.getFullYear(), now.getMonth(), span),
    [expenses, incomes, span],
  )
  const steps = useMemo(() => reconcile(points, months), [points, months])

  const names = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts],
  )
  const kinds = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.kind])),
    [accounts],
  )

  const change = latest && previous ? latest.net - previous.net : null

  if (loading) {
    return <p className="my-8 text-center text-muted">Loading…</p>
  }

  return (
    <>
      {error && (
        <p className="msg msg-error my-4" role="alert">
          {error}
        </p>
      )}

      {latest ? (
        <section className="my-8 text-center">
          <h2 className="stat-label">
            Net worth at {formatMonth(latest.year, latest.month)}
          </h2>
          <p className="stat-figure">{formatMoney(latest.net)}</p>
          <p className="stat-note">
            {change !== null && previous ? (
              <>
                <span
                  className={
                    change < 0 ? 'text-overspend-strong' : 'text-income-strong'
                  }
                >
                  {change < 0 ? '−' : '+'}
                  {formatMoney(Math.abs(change))}
                </span>{' '}
                since {formatMonthAbbr(previous.year, previous.month)}
              </>
            ) : (
              'The first reading — there is nothing to compare it with yet.'
            )}
            {latest.carried > 0 && (
              <>
                {' · '}
                {latest.carried} of {latest.holdings.length} carried from an
                earlier month
              </>
            )}
          </p>
        </section>
      ) : (
        <section className="my-8 text-center">
          <h2 className="stat-label">Net Worth</h2>
          <p className="mt-1.5 text-sm text-muted">
            Add your accounts and record what each was worth at the end of a
            month. Every month after that, only the ones that moved need
            typing.
          </p>
        </section>
      )}

      <SnapshotForm userId={userId} accounts={accounts} balances={balances} />

      {points.length >= 2 && (
        <section className="my-10">
          <h3 className="section-title">Over time</h3>
          <p className="section-note">
            Net worth at each month end that was recorded,{' '}
            {formatMonthAbbr(points[0].year, points[0].month)} –{' '}
            {formatMonthAbbr(latest!.year, latest!.month)}.
          </p>
          <NetWorthChart
            points={points}
            label={`Net worth at each recorded month end, ${formatMonthAbbr(
              points[0].year,
              points[0].month,
            )} to ${formatMonthAbbr(latest!.year, latest!.month)}`}
          />
        </section>
      )}

      {steps.length > 0 && (
        <section className="my-10">
          <h3 className="section-title">What moved it</h3>
          <p className="section-note">
            Each step split into the part the ledger accounts for and the part
            it does not. <em>Saved</em> is income less expenses over the same
            months, from the Month and Trends tabs. <em>Other</em> is the
            remainder — market movement, interest and revaluations, and
            anything that was spent without being recorded.
          </p>
          {/* The tightening below fits the usual figures; a genuinely huge
              one scrolls the table rather than the page. */}
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="num">
                    Change
                  </th>
                  <th scope="col" className="num">
                    Saved
                  </th>
                  <th scope="col" className="num">
                    Other
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...steps].reverse().map((step) => (
                  <tr key={step.key}>
                    <td>
                      {formatMonth(step.year, step.month)}
                      {step.span > 1 && (
                        <span className="sub">
                          {step.span} months since the previous reading
                        </span>
                      )}
                    </td>
                    <td
                      className={`num ${
                        step.change < 0
                          ? 'text-overspend-strong'
                          : 'text-income-strong'
                      }`}
                    >
                      {step.change < 0 ? '−' : '+'}
                      {formatMoney(Math.abs(step.change))}
                    </td>
                    {/* A span the ledger was not loaded for would make the split
                        a fiction, so it is left blank rather than guessed. */}
                    <td className="num">
                      {step.complete
                        ? `${step.flow < 0 ? '−' : '+'}${formatMoney(Math.abs(step.flow))}`
                        : '—'}
                    </td>
                    <td className="num">
                      {step.complete
                        ? `${step.unexplained < 0 ? '−' : '+'}${formatMoney(
                            Math.abs(step.unexplained),
                          )}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {latest && (
        <section className="my-10">
          <h3 className="section-title">
            Balance sheet at {formatMonth(latest.year, latest.month)}
          </h3>
          <p className="section-note">
            Every account that had a value at this month end. A figure marked{' '}
            <em>carried</em> is the last reading taken of that account rather
            than one taken for this month. One marked <em>not in total</em>{' '}
            is left out of every subtotal and the net worth figure above — see
            Manage accounts.
          </p>
          <div className="overflow-x-auto">
            <table className="table">
              <tbody>
                {ACCOUNT_KINDS.map(({ id, label, debt }) => {
                  const group = latest.holdings.filter(
                    (holding) => kinds.get(holding.account_id) === id,
                  )
                  if (group.length === 0) return null

                  const subtotal = group.reduce(
                    (sum, holding) =>
                      holding.excluded ? sum : sum + holding.amount,
                    0,
                  )

                  return (
                    <Fragment key={id}>
                      <tr>
                        <th scope="colgroup" colSpan={2} className="pt-4">
                          {label}
                        </th>
                      </tr>
                      {group
                        .slice()
                        .sort((a, b) =>
                          (names.get(a.account_id) ?? '').localeCompare(
                            names.get(b.account_id) ?? '',
                          ),
                        )
                        .map((holding) => (
                          <tr key={holding.account_id}>
                            <td>
                              {names.get(holding.account_id) ?? 'Unknown account'}
                              {holding.carried && (
                                <span className="text-muted"> · carried</span>
                              )}
                              {holding.excluded && (
                                <span className="text-muted">
                                  {' '}
                                  · Not in total
                                </span>
                              )}
                            </td>
                            <td
                              className={`num ${
                                holding.carried || holding.excluded
                                  ? 'text-muted'
                                  : ''
                              }`}
                            >
                              {formatMoney(holding.amount)}
                            </td>
                          </tr>
                        ))}
                      <tr>
                        <td className="font-semibold">
                          Subtotal — {label.toLowerCase()}
                        </td>
                        <td className="num font-semibold">
                          {debt ? '−' : ''}
                          {formatMoney(subtotal)}
                        </td>
                      </tr>
                    </Fragment>
                  )
                })}

                <tr>
                  <td className="pt-4 font-semibold">Total assets</td>
                  <td className="num pt-4 font-semibold">
                    {formatMoney(latest.assets)}
                  </td>
                </tr>
                {latest.debt > 0 && (
                  <tr>
                    <td className="font-semibold">Total debt</td>
                    <td className="num font-semibold text-overspend-strong">
                      −{formatMoney(latest.debt)}
                    </td>
                  </tr>
                )}
                <tr>
                  <td className="font-semibold">Net worth</td>
                  <td className="num font-semibold">
                    {formatMoney(latest.net)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <AccountsEditor userId={userId} accounts={accounts} />
    </>
  )
}

export default Balances
