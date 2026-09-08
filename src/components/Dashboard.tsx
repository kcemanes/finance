import { useEffect, useMemo, useState } from 'react'
import Balances from './Balances'
import Charts from './Charts'
import EntryForm from './EntryForm'
import InstallButton from './InstallButton'
import Ledger from './Ledger'
import SyncStatus from './SyncStatus'
import TargetSummary from './TargetSummary'
import ThemeToggle from './ThemeToggle'
import { categoryTargets, sourceTargets } from '../lib/analytics'
import { signOut } from '../lib/auth'
import type { Account } from '../lib/auth'
import { CURRENCIES, useCurrency } from '../lib/currency'
import type { CurrencyCode } from '../lib/currency'
import { formatMonth, monthBounds } from '../lib/format'
import { dismissRejected, startSync } from '../lib/sync'
import { useFinanceData } from '../hooks/useFinanceData'
import { useSyncState } from '../hooks/useSyncState'

const now = new Date()

// Round stepper; colours and hover come from .btn-quiet.
const STEP =
  'btn-quiet h-9 w-9 rounded-full p-0 text-xl leading-none disabled:opacity-35'

// Flows first, then the stock they move: the month you are working in, the
// trend across several of them, and the balance sheet all of it adds up to.
const TABS = [
  { id: 'month', label: 'Month' },
  { id: 'charts', label: 'Trends' },
  { id: 'worth', label: 'Net Worth' },
] as const

type TabId = (typeof TABS)[number]['id']

function Dashboard({ account }: { account: Account }) {
  const { currency, setCurrency, formatMoney } = useCurrency()
  const [tab, setTab] = useState<TabId>('month')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth())
  const sync = useSyncState()

  const bounds = useMemo(() => monthBounds(year, month), [year, month])

  // Push and pull for as long as this account is on screen.
  useEffect(() => startSync(account.id), [account.id])

  const {
    categories,
    expenses,
    sources,
    incomes,
    loading,
    error,
    setCategories,
    setSources,
  } = useFinanceData(account.id, bounds.from, bounds.to)

  // The hero figure stays what it always was — what this month cost — so the
  // number in that position still means what it used to. Income and the net
  // go underneath it rather than replacing it.
  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0)
  const earned = incomes.reduce((sum, income) => sum + income.amount, 0)
  const net = earned - total

  // Actuals joined to their targets. The two lists are built the same way and
  // measured by opposite tests — see TargetSummary.
  const spendRows = useMemo(
    () => categoryTargets(expenses, categories),
    [expenses, categories],
  )
  const earnRows = useMemo(
    () => sourceTargets(incomes, sources),
    [incomes, sources],
  )

  function shiftMonth(delta: number) {
    const shifted = new Date(year, month + delta, 1)
    setYear(shifted.getFullYear())
    setMonth(shifted.getMonth())
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  // Reads are local and quick, so the spinner is really only for the very
  // first launch of an account, where there is nothing on this device yet and
  // the opening sync is what will produce it.
  const firstEverSync =
    sync.lastSyncedAt === null &&
    sync.status === 'syncing' &&
    categories.length === 0

  async function handleSignOut() {
    if (
      sync.pending > 0 &&
      !window.confirm(
        `${sync.pending} change${sync.pending === 1 ? '' : 's'} on this device ` +
          'have not reached the server yet. Signing out erases them. Sign out anyway?',
      )
    ) {
      return
    }
    await signOut()
  }

  const monthView = (
    <>
      <section className="my-6 flex items-center justify-center gap-6 max-sm:gap-2">
        <button
          type="button"
          className={STEP}
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        {/* The steppers are fixed at 36px, so on a phone this block takes
            whatever is left rather than holding a 192px floor that pushes the
            forward stepper off a 320px screen. */}
        <div className="min-w-48 text-center max-sm:min-w-0 max-sm:flex-1">
          <h2 className="stat-label">{formatMonth(year, month)}</h2>
          <p className="stat-figure">{formatMoney(total)}</p>
          <p className="stat-note">
            {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}
            {/* An account that records no income sees exactly what it saw
                before any of this existed. */}
            {earned > 0 && (
              <>
                {' · '}
                {formatMoney(earned)} in
                {' · '}
                {formatMoney(Math.abs(net))} {net < 0 ? 'short' : 'left'}
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className={STEP}
          onClick={() => shiftMonth(1)}
          disabled={isCurrentMonth}
          aria-label="Next month"
        >
          ›
        </button>
      </section>

      {error && (
        <p className="msg msg-error my-4" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="my-8 text-center text-muted">Loading…</p>
      ) : (
        <>
          <EntryForm
            userId={account.id}
            categories={categories}
            sources={sources}
            onCategoryAdded={(category) =>
              setCategories((current) =>
                [...current, category].sort((a, b) =>
                  a.name.localeCompare(b.name),
                ),
              )
            }
            onSourceAdded={(source) =>
              setSources((current) =>
                [...current, source].sort((a, b) =>
                  a.name.localeCompare(b.name),
                ),
              )
            }
          />
          {/* Same shape, opposite tests: spending wants to stay under its
              target, income wants to clear it. Headings appear only when both
              lists are on screen and need telling apart. */}
          <TargetSummary
            rows={spendRows}
            miss="over"
            tone="expense"
            heading={earnRows.length > 0 ? 'Spending' : undefined}
          />
          <TargetSummary
            rows={earnRows}
            miss="under"
            tone="income"
            heading="Income"
          />
          <Ledger
            userId={account.id}
            expenses={expenses}
            incomes={incomes}
            categories={categories}
            sources={sources}
          />
        </>
      )}
    </>
  )

  return (
    <div className="mx-auto w-full max-w-[860px] flex-1 px-5 pt-6 pb-16 max-sm:px-4">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 max-sm:gap-2">
        <h1 className="text-2xl font-medium tracking-[-0.4px] text-ink max-sm:text-xl">
          Finance
        </h1>
        <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm max-sm:gap-2">
          {/* An address with no spaces in it is one long word, which in a
              wrapping row is a word wider than the screen. */}
          <span className="min-w-0 truncate text-muted">{account.email}</span>
          <SyncStatus />
          <label htmlFor="currency" className="sr-only">
            Currency
          </label>
          <select
            id="currency"
            className="input py-1.5"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
          >
            {CURRENCIES.map(({ code, label }) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <InstallButton />
          <ThemeToggle />
          <button
            type="button"
            className="btn-quiet"
            onClick={() => void handleSignOut()}
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="btn-toggle"
            aria-pressed={tab === id}
            aria-controls="view"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {sync.rejected.length > 0 && (
        <div className="msg msg-notice my-4" role="alert">
          <p className="font-semibold">
            The server refused {sync.rejected.length === 1 ? 'a change' : 'some changes'},
            so {sync.rejected.length === 1 ? 'it has' : 'they have'} been undone here:
          </p>
          <ul className="mt-1.5 list-disc pl-5">
            {sync.rejected.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-link mt-2 font-semibold"
            onClick={dismissRejected}
          >
            Dismiss
          </button>
        </div>
      )}

      <section
        id="view"
        aria-label={
          tab === 'charts' ? 'Trends' : tab === 'worth' ? 'Net worth' : 'This month'
        }
      >
        {/* An account whose first sync is still running has nothing on this
            device yet, so no view has anything true to show. */}
        {firstEverSync ? (
          <p className="my-8 text-center text-muted">Loading…</p>
        ) : tab === 'charts' ? (
          <Charts userId={account.id} />
        ) : tab === 'worth' ? (
          <Balances userId={account.id} />
        ) : (
          monthView
        )}
      </section>
    </div>
  )
}

export default Dashboard
