import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  createCategory,
  createExpense,
  createIncome,
  createIncomeSource,
} from '../lib/api'
import { today } from '../lib/format'
import type { Category, IncomeSource } from '../types'

type Props = {
  userId: string
  categories: Category[]
  sources: IncomeSource[]
  /** These let the picker show a category or source the moment it is created. */
  onCategoryAdded: (category: Category) => void
  onSourceAdded: (source: IncomeSource) => void
}

const NEW_GROUP = '__new__'

// Fields wrap to full width below the 640px breakpoint.
const FIELD = 'flex flex-col gap-1 max-sm:min-w-0 max-sm:basis-full'
const LABEL = 'text-xs font-semibold text-ink'

const KINDS = [
  { id: 'expense', label: 'Expense' },
  { id: 'income', label: 'Income' },
] as const

type Kind = (typeof KINDS)[number]['id']

/**
 * One form for both directions of money.
 *
 * Expenses and incomes take the same five fields under different names, so a
 * mode switch reuses the layout rather than stacking a second near-identical
 * form under the first. The only asymmetry is which list the picker draws
 * from, and which of the two create calls a new name goes to.
 */
function EntryForm({
  userId,
  categories,
  sources,
  onCategoryAdded,
  onSourceAdded,
}: Props) {
  const [kind, setKind] = useState<Kind>('expense')
  const [on, setOn] = useState(today())
  // One remembered pick per direction, so switching across and back does not
  // discard the category you were entering against.
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '')
  const [newName, setNewName] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const income = kind === 'income'
  const groups: { id: string; name: string }[] = income ? sources : categories
  const picked = income ? sourceId : categoryId

  // Derived rather than stored, which is what keeps the select from ever
  // holding a value that matches none of its options — a picker that shows one
  // thing while its state says another, and submits the empty string.
  //
  // NEW_GROUP has to be admitted explicitly: it is a real option but is never
  // one of `groups`, so testing membership alone would snap the create choice
  // back to the first group and the name field would never open.
  //
  // With nothing to pick at all the form opens on the create field instead.
  // That is the normal case for income: a new account gets starter categories
  // but no sources.
  const selected =
    picked === NEW_GROUP || groups.some((group) => group.id === picked)
      ? picked
      : (groups[0]?.id ?? NEW_GROUP)
  const addingGroup = selected === NEW_GROUP

  function chooseGroup(id: string) {
    if (income) setSourceId(id)
    else setCategoryId(id)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const value = Number(amount)
    if (!Number.isFinite(value) || value <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }

    setBusy(true)
    try {
      let targetId = selected

      if (addingGroup) {
        if (income) {
          const created = await createIncomeSource(userId, newName, null)
          onSourceAdded(created)
          targetId = created.id
        } else {
          const created = await createCategory(userId, newName, null)
          onCategoryAdded(created)
          targetId = created.id
        }
      }

      // Guard against float drift from inputs like 19.99 + 0.1.
      const rounded = Math.round(value * 100) / 100
      const trimmed = note.trim() || null

      if (income) {
        await createIncome(userId, {
          source_id: targetId,
          received_on: on,
          amount: rounded,
          note: trimmed,
        })
      } else {
        await createExpense(userId, {
          category_id: targetId,
          spent_on: on,
          amount: rounded,
          note: trimmed,
        })
      }

      setAmount('')
      setNote('')
      setNewName('')
      chooseGroup(targetId)
    } catch (err) {
      // Reaching here means the local write failed, not the network — the
      // entry is saved and queued before this promise resolves.
      setError(
        err instanceof Error ? err.message : `Could not save the ${kind}.`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-card"
      onSubmit={handleSubmit}
    >
      {/* A mode switch rather than a field, so it gets a row of its own. */}
      <div className="flex basis-full gap-2" role="group" aria-label="Record">
        {KINDS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className={id === 'income' ? 'btn-toggle is-income' : 'btn-toggle'}
            aria-pressed={kind === id}
            onClick={() => {
              setKind(id)
              // A failure message about the other direction is stale now.
              setError(null)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={FIELD}>
        <label htmlFor="entry-date" className={LABEL}>
          Date
        </label>
        <input
          id="entry-date"
          type="date"
          className="input"
          required
          value={on}
          max={today()}
          onChange={(e) => setOn(e.target.value)}
        />
      </div>

      <div className={FIELD}>
        <label htmlFor="entry-group" className={LABEL}>
          {income ? 'Source' : 'Category'}
        </label>
        <select
          id="entry-group"
          className="input"
          required
          value={selected}
          onChange={(e) => chooseGroup(e.target.value)}
        >
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
          <option value={NEW_GROUP}>
            {income ? '+ New source…' : '+ New category…'}
          </option>
        </select>
      </div>

      {addingGroup && (
        <div className={FIELD}>
          <label htmlFor="new-group" className={LABEL}>
            {income ? 'New source name' : 'New category name'}
          </label>
          <input
            id="new-group"
            type="text"
            className="input"
            required
            maxLength={40}
            placeholder={income ? 'e.g. Salary' : 'e.g. Subscriptions'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
      )}

      <div className={FIELD}>
        <label htmlFor="amount" className={LABEL}>
          Amount
        </label>
        <input
          id="amount"
          type="number"
          className="input w-28 tabular-nums max-sm:w-full"
          inputMode="decimal"
          step="0.01"
          min="0.01"
          required
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </div>

      <div className={`${FIELD} min-w-40 flex-1`}>
        <label htmlFor="note" className={LABEL}>
          Note (optional)
        </label>
        <input
          id="note"
          type="text"
          className="input"
          maxLength={200}
          placeholder={income ? 'e.g. October pay' : 'What was it for?'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <button
        type="submit"
        className={`btn-primary max-sm:w-full${income ? ' is-income' : ''}`}
        disabled={busy}
      >
        {busy ? 'Adding…' : income ? 'Add income' : 'Add expense'}
      </button>

      {error && (
        <p className="msg msg-error basis-full" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}

export default EntryForm
