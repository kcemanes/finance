import { useState } from 'react'
import { deleteExpense, deleteIncome } from '../lib/api'
import { useCurrency } from '../lib/currency'
import { formatDay } from '../lib/format'
import type { Category, Expense, Income, IncomeSource } from '../types'
import type { Kind } from './EntryForm'

type Props = {
  userId: string
  /** Which direction to list; the other list is ignored. */
  kind: Kind
  expenses: Expense[]
  incomes: Income[]
  categories: Category[]
  sources: IncomeSource[]
}

/** One row of the ledger, whichever direction it came from. */
type Entry = {
  id: string
  income: boolean
  on: string
  group: string
  note: string | null
  amount: number
  created_at: string
}

/**
 * One direction of money for the month, newest first — whichever the entry
 * form is switched to, so what you are adding to is what you are looking at.
 *
 * Direction is still carried by the sign in front of the amount, not by its
 * colour. A `+` is text and survives being read aloud, printed in greyscale,
 * or seen by someone who cannot separate the two hues; the colour only
 * confirms it.
 */
function Ledger({ userId, kind, expenses, incomes, categories, sources }: Props) {
  const { formatMoney } = useCurrency()
  const [removing, setRemoving] = useState<string | null>(null)

  const income = kind === 'income'
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]))
  const sourceNames = new Map(sources.map((s) => [s.id, s.name]))

  const entries: Entry[] = (
    income
      ? incomes.map((entry) => ({
          id: entry.id,
          income: true,
          on: entry.received_on,
          group: sourceNames.get(entry.source_id) ?? 'Unattributed',
          note: entry.note,
          amount: entry.amount,
          created_at: entry.created_at,
        }))
      : expenses.map((expense) => ({
          id: expense.id,
          income: false,
          on: expense.spent_on,
          // A category deleted on another device can still have expenses here.
          group: categoryNames.get(expense.category_id) ?? 'Uncategorised',
          note: expense.note,
          amount: expense.amount,
          created_at: expense.created_at,
        }))
  ).sort(
    (a, b) =>
      b.on.localeCompare(a.on) || b.created_at.localeCompare(a.created_at),
  )

  async function handleDelete(entry: Entry) {
    setRemoving(entry.id)
    try {
      if (entry.income) await deleteIncome(userId, entry.id)
      else await deleteExpense(userId, entry.id)
    } finally {
      setRemoving(null)
    }
  }

  if (entries.length === 0) {
    return (
      <p className="my-8 text-center text-muted">
        {income ? 'No income' : 'No expenses'} recorded this month yet.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{income ? 'Source' : 'Category'}</th>
            <th scope="col">Note</th>
            <th scope="col" className="num">
              Amount
            </th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="hover:bg-accent-soft">
              <td className="whitespace-nowrap">{formatDay(entry.on)}</td>
              <td>{entry.group}</td>
              <td className="text-muted">{entry.note}</td>
              <td
                className={`num font-medium ${
                  entry.income ? 'text-income-strong' : ''
                }`}
              >
                {entry.income ? '+' : '−'}
                {formatMoney(entry.amount)}
              </td>
              <td className="text-right">
                <button
                  type="button"
                  className="btn-link text-overspend-strong disabled:opacity-50"
                  disabled={removing === entry.id}
                  onClick={() => handleDelete(entry)}
                >
                  {removing === entry.id ? 'Removing…' : 'Delete'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default Ledger
