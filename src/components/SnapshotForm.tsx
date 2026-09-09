import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { deleteBalance, saveAccount, saveBalance } from '../lib/api'
import { ACCOUNT_KINDS } from '../lib/analytics'
import { formatMonth, formatMonthAbbr, monthEnd, parseDay } from '../lib/format'
import { useCurrency } from '../lib/currency'
import type { Account, AccountKind, Balance } from '../types'

type Props = {
  userId: string
  accounts: Account[]
  balances: Balance[]
}

const now = new Date()

// Round stepper; colours and hover come from .btn-quiet. The same control as
// the month view's, so the two screens step through months identically.
const STEP =
  'btn-quiet h-9 w-9 rounded-full p-0 text-xl leading-none disabled:opacity-35'

const LABEL = 'field-label'

/** What one account is worth this month, and where that figure came from. */
type Row = {
  account: Account
  /** A reading taken for *this* month, if there is one. */
  existing: Balance | null
  /** The figure that applies with no new reading: this month's, or the last. */
  baseline: number | null
  /** The month `baseline` was read in, when it was not this one. */
  carriedFrom: string | null
}

/**
 * Empty is `null` — a month with no reading, which is not the same as zero.
 * Anything unparseable or negative is `undefined`, so the caller can tell
 * "cleared" from "typed wrong".
 */
function parseAmount(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return undefined
  // Guard against float drift from inputs like 19.99 + 0.1.
  return Math.round(value * 100) / 100
}

/**
 * The month-end entry screen: what every account was worth, in one list.
 *
 * This is the form the whole module exists for. A grid of accounts across
 * months is unusable on a phone — thirteen columns of a spreadsheet, scrolled
 * sideways, with the row labels off screen — while the same thirteen numbers
 * as a vertical list, prefilled, is a minute on the couch. The grid is the
 * good way to *read* a balance sheet and the worst way to write one.
 *
 * Every field starts on the figure that already applies: this month's reading
 * if one was taken, otherwise the last one carried forward. **Only fields that
 * were changed are written.** Leaving an account alone is not an omission —
 * carrying forward already says it did not move — so the four or five that did
 * move are the whole job, and the store does not fill up with rows restating
 * last month.
 */
function SnapshotForm({ userId, accounts, balances }: Props) {
  const { formatMoney } = useCurrency()
  // The month most likely to be getting written down is the one that has
  // ended. Stepping forward to the current month is allowed for a reading
  // taken on the last day of it.
  const [year, setYear] = useState(new Date(now.getFullYear(), now.getMonth() - 1).getFullYear())
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth() - 1).getMonth())
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<AccountKind>('bank')

  const asOf = monthEnd(year, month)

  const rows = useMemo<Row[]>(() => {
    const existing = new Map<string, Balance>()
    const carried = new Map<string, Balance>()

    // Balances arrive oldest first, so the last one to land before this month
    // is the one that carries.
    for (const balance of balances) {
      if (balance.as_of === asOf) existing.set(balance.account_id, balance)
      else if (balance.as_of < asOf) carried.set(balance.account_id, balance)
    }

    return accounts
      // Archived accounts drop out of the form, but not out of a month they
      // were already recorded in — that reading is still correctable.
      .filter((account) => account.is_active || existing.has(account.id))
      .map((account) => {
        const own = existing.get(account.id) ?? null
        const before = carried.get(account.id) ?? null
        return {
          account,
          existing: own,
          baseline: own ? own.amount : (before?.amount ?? null),
          carriedFrom: own ? null : (before?.as_of ?? null),
        }
      })
  }, [accounts, balances, asOf])

  const textFor = (row: Row) =>
    drafts[row.account.id] ??
    (row.baseline === null ? '' : String(row.baseline))

  // What Save would actually write. Untouched fields are not changes, and
  // neither is typing the figure that was already there.
  const changed = rows.filter((row) => {
    const text = drafts[row.account.id]
    if (text === undefined) return false
    const value = parseAmount(text)
    return value !== undefined && value !== row.baseline
  })

  const invalid = rows.filter((row) => {
    const text = drafts[row.account.id]
    return text !== undefined && parseAmount(text) === undefined
  })

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth()

  function shiftMonth(delta: number) {
    const shifted = new Date(year, month + delta, 1)
    setYear(shifted.getFullYear())
    setMonth(shifted.getMonth())
    // A different month puts a different figure in every field, so nothing
    // typed against the old one should survive the step. Cleared here rather
    // than from an effect watching the month: this is the only thing that
    // moves it, and an effect would re-render the whole list a second time.
    setDrafts({})
    setError(null)
    setSaved(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(null)

    if (invalid.length > 0) {
      setError('Enter an amount of zero or more, or clear the field.')
      return
    }
    if (changed.length === 0) return

    setBusy(true)
    try {
      for (const row of changed) {
        const value = parseAmount(drafts[row.account.id])
        if (value === null) {
          // Cleared. Only a reading taken for this month can be withdrawn; a
          // figure that was only ever carried forward has no row to remove.
          if (row.existing) await deleteBalance(userId, row.existing.id)
          continue
        }
        if (value === undefined) continue
        await saveBalance(userId, {
          account_id: row.account.id,
          as_of: asOf,
          amount: value,
          note: null,
        })
      }

      const count = changed.length
      setDrafts({})
      setSaved(
        `${count} ${count === 1 ? 'account' : 'accounts'} recorded for ${formatMonth(year, month)}.`,
      )
    } catch (err) {
      // Reaching here means the local write failed, not the network — every
      // figure is saved and queued before these promises resolve.
      setError(
        err instanceof Error ? err.message : 'Could not save these balances.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleAddAccount() {
    const name = newName.trim()
    if (!name) {
      setError('Give the account a name.')
      return
    }
    // Checked here as well as by the server, because a duplicate that reaches
    // Postgres comes back as a refusal the sync engine deliberately does not
    // try to repair — see `adoptRemoteBalance` in lib/sync.
    if (
      accounts.some(
        (account) => account.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError(`There is already an account called “${name}”.`)
      return
    }

    setBusy(true)
    setError(null)
    try {
      await saveAccount(userId, {
        name,
        kind: newKind,
        is_active: true,
        include_in_net_worth: true,
      })
      setNewName('')
      setAdding(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not add the account.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="rounded-xl border border-line bg-surface p-4 shadow-card"
      onSubmit={handleSubmit}
    >
      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          className={STEP}
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          ‹
        </button>
        <div className="min-w-48 text-center">
          <h3 className="stat-label text-ink">{formatMonth(year, month)}</h3>
          <p className="stat-note mt-0">Balances at the end of the month</p>
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
      </div>

      {rows.length === 0 ? (
        <p className="my-6 text-center text-sm text-muted">
          No accounts yet. Add the first one below — a bank account, an
          investment account, something you own outright, or something you owe.
        </p>
      ) : (
        <div className="mt-5">
          {ACCOUNT_KINDS.map(({ id, label }) => {
            const group = rows.filter((row) => row.account.kind === id)
            if (group.length === 0) return null

            return (
              <fieldset key={id} className="mt-4 first:mt-0">
                <legend className="eyebrow">{label}</legend>
                <ul className="mt-1.5">
                  {group.map((row) => {
                    const text = textFor(row)
                    const value = parseAmount(text)
                    const isChanged =
                      drafts[row.account.id] !== undefined &&
                      value !== undefined &&
                      value !== row.baseline
                    const isInvalid =
                      drafts[row.account.id] !== undefined && value === undefined

                    return (
                      <li
                        key={row.account.id}
                        className="flex items-center gap-3 border-b border-line py-2 last:border-b-0"
                      >
                        <label
                          htmlFor={`balance-${row.account.id}`}
                          className="min-w-0 flex-1 text-sm text-ink"
                        >
                          {row.account.name}
                          {!row.account.is_active && (
                            <span className="text-muted"> · archived</span>
                          )}
                          {!row.account.include_in_net_worth && (
                            <span className="text-muted"> · Not in total</span>
                          )}
                          {/* Where the figure in the box came from, so a
                              carried number is never mistaken for a reading. */}
                          <span className="sub">
                            {isChanged
                              ? 'will be saved'
                              : row.carriedFrom
                                ? `carried from ${formatMonthAbbr(
                                    parseDay(row.carriedFrom).getFullYear(),
                                    parseDay(row.carriedFrom).getMonth(),
                                  )}`
                                : row.existing
                                  ? 'recorded'
                                  : 'not recorded yet'}
                          </span>
                        </label>
                        <input
                          id={`balance-${row.account.id}`}
                          type="number"
                          className={`input w-36 text-right tabular-nums max-sm:w-28 ${
                            isInvalid
                              ? 'border-danger'
                              : isChanged
                                ? 'border-accent-mid'
                                : row.carriedFrom
                                  ? 'text-muted'
                                  : ''
                          }`}
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          placeholder="—"
                          value={text}
                          onChange={(e) =>
                            setDrafts((current) => ({
                              ...current,
                              [row.account.id]: e.target.value,
                            }))
                          }
                        />
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            )
          })}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="btn-primary max-sm:w-full"
          disabled={busy || changed.length === 0}
        >
          {busy
            ? 'Saving…'
            : changed.length === 0
              ? 'Nothing changed'
              : `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}
        </button>
        {!adding && (
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setAdding(true)
              setError(null)
            }}
          >
            + Add account
          </button>
        )}
        {changed.length > 0 && (
          <span className="text-xs text-muted">
            {formatMoney(
              changed.reduce((sum, row) => {
                const value = parseAmount(drafts[row.account.id])
                return sum + ((value ?? 0) - (row.baseline ?? 0))
              }, 0),
            )}{' '}
            of movement in what you have typed
          </span>
        )}
      </div>

      {adding && (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <div className="flex min-w-40 flex-1 flex-col gap-1">
            <label htmlFor="account-name" className={LABEL}>
              Account name
            </label>
            <input
              id="account-name"
              type="text"
              className="input"
              maxLength={40}
              placeholder="e.g. BDO Savings"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="account-kind" className={LABEL}>
              Kind
            </label>
            <select
              id="account-kind"
              className="input"
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as AccountKind)}
            >
              {ACCOUNT_KINDS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => void handleAddAccount()}
          >
            Add
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setAdding(false)
              setNewName('')
              setError(null)
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="msg msg-error mt-4" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="mt-4 text-sm text-muted" role="status">
          {saved}
        </p>
      )}
    </form>
  )
}

export default SnapshotForm
