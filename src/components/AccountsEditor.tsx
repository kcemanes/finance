import { useState } from 'react'
import { saveAccount } from '../lib/api'
import { ACCOUNT_KINDS } from '../lib/analytics'
import type { Account, AccountKind } from '../types'

type Draft = {
  name: string
  kind: AccountKind
  is_active: boolean
  include_in_net_worth: boolean
}

/**
 * Renaming, reclassifying and archiving accounts.
 *
 * Tucked behind a disclosure because it is setup rather than use: the numbers
 * get typed every month, this gets touched when an account is opened or closed.
 *
 * There is no delete. An account that is finished with is archived, which
 * stops it being asked about every month while leaving every reading it ever
 * held in place — those are still part of what net worth was in those months,
 * and removing the account would rewrite that history. The foreign key is
 * `on delete restrict`, so the database would refuse anyway.
 */
function AccountsEditor({
  userId,
  accounts,
}: {
  userId: string
  accounts: Account[]
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const draftFor = (account: Account): Draft =>
    drafts[account.id] ?? {
      name: account.name,
      kind: account.kind,
      is_active: account.is_active,
      include_in_net_worth: account.include_in_net_worth,
    }

  const isDirty = (account: Account) => {
    const draft = draftFor(account)
    return (
      draft.name !== account.name ||
      draft.kind !== account.kind ||
      draft.is_active !== account.is_active ||
      draft.include_in_net_worth !== account.include_in_net_worth
    )
  }

  function edit(account: Account, patch: Partial<Draft>) {
    setError(null)
    setDrafts((current) => ({
      ...current,
      [account.id]: { ...draftFor(account), ...patch },
    }))
  }

  async function save(account: Account) {
    const draft = draftFor(account)
    const name = draft.name.trim()

    if (!name) {
      setError('An account needs a name.')
      return
    }
    // Same check as the add form, for the same reason: a duplicate name that
    // reaches Postgres comes back as a refusal the sync engine will not try to
    // repair, because a rename and a creation are indistinguishable by then.
    if (
      accounts.some(
        (other) =>
          other.id !== account.id &&
          other.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError(`There is already an account called “${name}”.`)
      return
    }

    setBusy(account.id)
    setError(null)
    try {
      await saveAccount(userId, {
        id: account.id,
        name,
        kind: draft.kind,
        is_active: draft.is_active,
        include_in_net_worth: draft.include_in_net_worth,
      })
      setDrafts((current) => {
        const next = { ...current }
        delete next[account.id]
        return next
      })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not save the account.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (accounts.length === 0) return null

  return (
    <details className="my-10">
      <summary className="btn-link cursor-pointer text-muted">
        Manage accounts
      </summary>

      <ul className="mt-3">
        {accounts.map((account) => {
          const draft = draftFor(account)
          const dirty = isDirty(account)

          return (
            <li
              key={account.id}
              className="flex flex-wrap items-center gap-2 border-b border-line py-2"
            >
              <label className="sr-only" htmlFor={`name-${account.id}`}>
                Name
              </label>
              <input
                id={`name-${account.id}`}
                type="text"
                className="input min-w-40 flex-1"
                maxLength={40}
                value={draft.name}
                onChange={(e) => edit(account, { name: e.target.value })}
              />

              <label className="sr-only" htmlFor={`kind-${account.id}`}>
                Kind
              </label>
              <select
                id={`kind-${account.id}`}
                className="input"
                value={draft.kind}
                onChange={(e) =>
                  edit(account, { kind: e.target.value as AccountKind })
                }
              >
                {ACCOUNT_KINDS.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={draft.is_active}
                  onChange={(e) =>
                    edit(account, { is_active: e.target.checked })
                  }
                />
                Open
              </label>

              <label className="flex items-center gap-1.5 text-sm text-muted">
                <input
                  type="checkbox"
                  className="accent-accent"
                  checked={draft.include_in_net_worth}
                  onChange={(e) =>
                    edit(account, { include_in_net_worth: e.target.checked })
                  }
                />
                In total
              </label>

              <button
                type="button"
                className="btn-primary"
                disabled={!dirty || busy === account.id}
                onClick={() => void save(account)}
              >
                {busy === account.id ? 'Saving…' : 'Save'}
              </button>
            </li>
          )
        })}
      </ul>

      <p className="mt-2 text-xs text-muted">
        Unticking <em>Open</em> archives an account: it stops appearing on the
        monthly form and stops being carried forward, and every balance it
        already held stays exactly where it is. Unticking <em>In total</em>{' '}
        keeps it on the balance sheet but leaves it out of the net worth
        total — for something like a retirement account you won't touch or a
        car that only depreciates.
      </p>

      {error && (
        <p className="msg msg-error mt-3" role="alert">
          {error}
        </p>
      )}
    </details>
  )
}

export default AccountsEditor
