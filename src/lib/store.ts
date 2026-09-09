/**
 * The local-first store: the only thing the UI reads from.
 *
 * Every read is served from IndexedDB, so a month renders whether or not
 * there is a network. Every write lands in IndexedDB immediately and is
 * appended to an *outbox* — an ordered log of changes that ./sync replays to
 * Supabase when a connection is available. The UI never waits on the network
 * and never needs to know whether it is online.
 *
 * Row ids are generated here rather than by Postgres. That is what makes a
 * write work offline: the row has a real, final id the moment it is created,
 * so nothing has to be re-pointed when it eventually syncs, and a replay that
 * runs twice writes the same row rather than a duplicate.
 *
 * There are two directions of money and a table pair for each — categories
 * with expenses, income sources with incomes. Both amounts are positive and
 * the table carries the direction, so nothing downstream reasons about signs.
 * The generic parts below are generic over that pairing rather than written
 * twice, because the interesting logic (what a pull may overwrite, how a
 * duplicate name is repaired) is subtle enough that two copies would drift.
 *
 * Accounts and balances are a third pair, and the one that breaks the mould:
 * every other row here is written once and then only ever deleted, while both
 * of these are *set*. An account is renamed or archived; a balance for a month
 * already recorded is corrected. So their outbox ops are upserts rather than
 * creates, which changes one thing further down — see `overwrites`.
 */
import * as db from './db'
import type {
  Account,
  AccountKind,
  Balance,
  Category,
  Expense,
  Income,
  IncomeSource,
} from '../types'

export type LocalCategory = Category & { user_id: string }
export type LocalExpense = Expense & { user_id: string }
export type LocalIncomeSource = IncomeSource & { user_id: string }
export type LocalIncome = Income & { user_id: string }
export type LocalAccount = Account & { user_id: string }
export type LocalBalance = Balance & { user_id: string }

/** A change waiting to reach Supabase. Replayed in `seq` order. */
export type OutboxOp = {
  seq: number
  user_id: string
  kind:
    | 'category.create'
    | 'expense.create'
    | 'expense.delete'
    | 'source.create'
    | 'income.create'
    | 'income.delete'
    | 'account.set'
    | 'balance.set'
    | 'balance.delete'
  row: Record<string, unknown>
}

/** Everything the generic helpers below need to know about a synced row. */
type Owned = { id: string; user_id: string }

/** What a pull hands back: every row the account owns, per store. */
export type RemoteRows = {
  categories: LocalCategory[]
  expenses: LocalExpense[]
  income_sources: LocalIncomeSource[]
  incomes: LocalIncome[]
  accounts: LocalAccount[]
  balances: LocalBalance[]
}

/**
 * The six synced stores, and the outbox kinds that speak for each.
 *
 * Categories, income sources and accounts have no delete kind because nothing
 * deletes one: the UI offers no button, and every composite foreign key is
 * `on delete restrict`, so a parent with rows under it could not go anyway.
 * An account that is finished with is archived instead — see `is_active`.
 *
 * `overwrites` marks the two stores whose op is an upsert of a row that may
 * already exist on the server rather than a first sighting of a new one. It
 * decides who wins in `replaceFromRemote` when a pulled row and a still-queued
 * local row share an id; the note there explains why the answer differs.
 */
const SYNCED: {
  store: keyof RemoteRows
  create: OutboxOp['kind']
  remove: OutboxOp['kind'] | null
  overwrites: boolean
}[] = [
  { store: 'categories', create: 'category.create', remove: null, overwrites: false },
  { store: 'expenses', create: 'expense.create', remove: 'expense.delete', overwrites: false },
  { store: 'income_sources', create: 'source.create', remove: null, overwrites: false },
  { store: 'incomes', create: 'income.create', remove: 'income.delete', overwrites: false },
  { store: 'accounts', create: 'account.set', remove: null, overwrites: true },
  { store: 'balances', create: 'balance.set', remove: 'balance.delete', overwrites: true },
]

export type GroupName = 'category' | 'source'

/**
 * The two parent/child pairs, for the duplicate-name repair.
 *
 * `parent` and `child` are local store names; `table` is the Postgres name of
 * the parent, which is what lets ./sync look up the row that won a name
 * collision. `parent` used to serve as both, but the categories table was
 * renamed to `expense_categories` on the server while the local store kept
 * the name it was created under, so the remote name is now carried here
 * rather than inferred.
 */
export const GROUPS: Record<
  GroupName,
  { parent: db.StoreName; table: string; child: db.StoreName; fk: string }
> = {
  category: {
    parent: 'categories',
    table: 'expense_categories',
    child: 'expenses',
    fk: 'category_id',
  },
  source: {
    parent: 'income_sources',
    table: 'income_sources',
    child: 'incomes',
    fk: 'source_id',
  },
}

/**
 * Categories every new account starts with, so the expense form is usable
 * before the user has set anything up.
 *
 * Income sources are deliberately *not* seeded. There is no equivalent of
 * "Groceries" that is right for everyone, an empty picker offering only
 * "+ New source…" explains itself, and skipping it means there is no second
 * re-seed gate to keep in step with the one in ./sync.
 */
const STARTER_CATEGORIES = [
  'Groceries',
  'Rent',
  'Transport',
  'Utilities',
  'Dining out',
  'Other',
]

function uuid(): string {
  // randomUUID is secure-context only, which covers https and localhost — but
  // a plain-http preview on a LAN address is neither, and would throw.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}

// ---------------------------------------------------------------------------
// Change notification
//
// Writes and syncs both mutate the store behind the UI's back, so components
// subscribe once and re-read rather than threading a reload callback down
// through every level.
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>()

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyChanged() {
  for (const listener of listeners) listener()
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name)

export async function loadCategories(userId: string): Promise<Category[]> {
  const rows = await db.readAll<LocalCategory>('categories')
  return rows.filter((row) => row.user_id === userId).sort(byName)
}

export async function loadIncomeSources(
  userId: string,
): Promise<IncomeSource[]> {
  const rows = await db.readAll<LocalIncomeSource>('income_sources')
  return rows.filter((row) => row.user_id === userId).sort(byName)
}

// Newest day first, and within a day the order the entries were typed — which
// is what makes the merged ledger read the way it was written.
export async function loadExpenses(
  userId: string,
  from: string,
  to: string,
): Promise<Expense[]> {
  const rows = await db.readAll<LocalExpense>('expenses')
  return rows
    .filter(
      (row) =>
        row.user_id === userId && row.spent_on >= from && row.spent_on <= to,
    )
    .sort(
      (a, b) =>
        b.spent_on.localeCompare(a.spent_on) ||
        b.created_at.localeCompare(a.created_at),
    )
}

export async function loadIncomes(
  userId: string,
  from: string,
  to: string,
): Promise<Income[]> {
  const rows = await db.readAll<LocalIncome>('incomes')
  return rows
    .filter(
      (row) =>
        row.user_id === userId &&
        row.received_on >= from &&
        row.received_on <= to,
    )
    .sort(
      (a, b) =>
        b.received_on.localeCompare(a.received_on) ||
        b.created_at.localeCompare(a.created_at),
    )
}

export async function loadAccounts(userId: string): Promise<Account[]> {
  const rows = await db.readAll<LocalAccount>('accounts')
  return rows.filter((row) => row.user_id === userId).sort(byName)
}

/**
 * Every balance the account has ever recorded, oldest month first.
 *
 * Unlike expenses and incomes this takes no day range. One row per account per
 * month is a couple of hundred rows after a decade of a dozen accounts, and
 * net worth is a running series: a window over it would have to be widened by
 * one month anyway to know what the first month in view changed *from*.
 */
export async function loadBalances(userId: string): Promise<Balance[]> {
  const rows = await db.readAll<LocalBalance>('balances')
  return rows
    .filter((row) => row.user_id === userId)
    .sort(
      (a, b) =>
        a.as_of.localeCompare(b.as_of) ||
        a.created_at.localeCompare(b.created_at),
    )
}

export async function readOutbox(userId: string): Promise<OutboxOp[]> {
  const rows = await db.readAll<OutboxOp>('outbox')
  return rows
    .filter((row) => row.user_id === userId)
    .sort((a, b) => a.seq - b.seq)
}

// ---------------------------------------------------------------------------
// Writes — local first, then queued
// ---------------------------------------------------------------------------

export async function addCategory(
  userId: string,
  name: string,
  monthlyBudget: number | null,
): Promise<Category> {
  const row: LocalCategory = {
    id: uuid(),
    user_id: userId,
    name: name.trim(),
    monthly_budget: monthlyBudget,
  }

  await db.put('categories', row)
  await db.append({
    user_id: userId,
    kind: 'category.create',
    row: { id: row.id, name: row.name, monthly_budget: row.monthly_budget },
  })

  notifyChanged()
  return row
}

export async function addIncomeSource(
  userId: string,
  name: string,
  expectedMonthly: number | null,
): Promise<IncomeSource> {
  const row: LocalIncomeSource = {
    id: uuid(),
    user_id: userId,
    name: name.trim(),
    expected_monthly: expectedMonthly,
  }

  await db.put('income_sources', row)
  await db.append({
    user_id: userId,
    kind: 'source.create',
    row: { id: row.id, name: row.name, expected_monthly: row.expected_monthly },
  })

  notifyChanged()
  return row
}

export async function addExpense(
  userId: string,
  input: {
    category_id: string
    spent_on: string
    amount: number
    note: string | null
  },
): Promise<Expense> {
  const row: LocalExpense = {
    id: uuid(),
    user_id: userId,
    created_at: new Date().toISOString(),
    ...input,
  }

  await db.put('expenses', row)
  await db.append({
    user_id: userId,
    kind: 'expense.create',
    // created_at is pushed too, so the order rows were entered in survives a
    // replay that happens minutes or days later.
    row: {
      id: row.id,
      category_id: row.category_id,
      spent_on: row.spent_on,
      amount: row.amount,
      note: row.note,
      created_at: row.created_at,
    },
  })

  notifyChanged()
  return row
}

export async function addIncome(
  userId: string,
  input: {
    source_id: string
    received_on: string
    amount: number
    note: string | null
  },
): Promise<Income> {
  const row: LocalIncome = {
    id: uuid(),
    user_id: userId,
    created_at: new Date().toISOString(),
    ...input,
  }

  await db.put('incomes', row)
  await db.append({
    user_id: userId,
    kind: 'income.create',
    row: {
      id: row.id,
      source_id: row.source_id,
      received_on: row.received_on,
      amount: row.amount,
      note: row.note,
      created_at: row.created_at,
    },
  })

  notifyChanged()
  return row
}

/**
 * Creates an account, or replaces one that already exists.
 *
 * One function for both because the row is small and complete: a rename, an
 * archive and a first creation all write the same fields, and the op is an
 * upsert either way. Passing an `id` is what says "this one", and a caller
 * that has an account in hand can spread it and change one field.
 */
export async function setAccount(
  userId: string,
  input: {
    id?: string
    name: string
    kind: AccountKind
    is_active: boolean
    include_in_net_worth: boolean
  },
): Promise<Account> {
  const row: LocalAccount = {
    id: input.id ?? uuid(),
    user_id: userId,
    name: input.name.trim(),
    kind: input.kind,
    is_active: input.is_active,
    include_in_net_worth: input.include_in_net_worth,
  }

  await db.put('accounts', row)
  await db.append({
    user_id: userId,
    kind: 'account.set',
    row: {
      id: row.id,
      name: row.name,
      kind: row.kind,
      is_active: row.is_active,
      include_in_net_worth: row.include_in_net_worth,
    },
  })

  notifyChanged()
  return row
}

/**
 * Records what an account was worth at a month end, replacing any reading the
 * same account already had for the same month.
 *
 * The lookup for that existing row is the important line. Reusing its id turns
 * a correction into an update of one row rather than a second row for the same
 * month, which is what keeps the local store agreeing with the unique
 * constraint the server enforces — and means the upsert lands on `id` like
 * every other push, instead of needing a conflict target of its own.
 *
 * `as_of` is expected to be a month end already; ./format's `monthEnd` is what
 * callers use to get one, and the server rejects anything else.
 */
export async function setBalance(
  userId: string,
  input: {
    account_id: string
    as_of: string
    amount: number
    note: string | null
  },
): Promise<Balance> {
  const existing = (await db.readAll<LocalBalance>('balances')).find(
    (row) =>
      row.user_id === userId &&
      row.account_id === input.account_id &&
      row.as_of === input.as_of,
  )

  const row: LocalBalance = {
    id: existing?.id ?? uuid(),
    user_id: userId,
    // Kept from the original reading, so re-recording a month does not shuffle
    // it to the end of a list ordered by when things were entered.
    created_at: existing?.created_at ?? new Date().toISOString(),
    ...input,
  }

  await db.put('balances', row)
  await db.append({
    user_id: userId,
    kind: 'balance.set',
    row: {
      id: row.id,
      account_id: row.account_id,
      as_of: row.as_of,
      amount: row.amount,
      note: row.note,
      created_at: row.created_at,
    },
  })

  notifyChanged()
  return row
}

/**
 * Drops a row locally and queues the delete — unless the create for it is
 * still sitting in the outbox, in which case that create is dropped instead.
 * A row the server has never seen should not be described to it twice.
 */
async function removeEntry(
  userId: string,
  store: db.StoreName,
  kinds: { create: OutboxOp['kind']; remove: OutboxOp['kind'] },
  id: string,
): Promise<void> {
  await db.remove(store, [id])

  const queued = await readOutbox(userId)
  const pendingCreate = queued.find(
    (op) => op.kind === kinds.create && op.row.id === id,
  )

  if (pendingCreate) {
    await db.remove('outbox', [pendingCreate.seq])
  } else {
    await db.append({ user_id: userId, kind: kinds.remove, row: { id } })
  }

  notifyChanged()
}

export function removeExpense(userId: string, id: string): Promise<void> {
  return removeEntry(
    userId,
    'expenses',
    { create: 'expense.create', remove: 'expense.delete' },
    id,
  )
}

export function removeIncome(userId: string, id: string): Promise<void> {
  return removeEntry(
    userId,
    'incomes',
    { create: 'income.create', remove: 'income.delete' },
    id,
  )
}

export function removeBalance(userId: string, id: string): Promise<void> {
  return removeEntry(
    userId,
    'balances',
    { create: 'balance.set', remove: 'balance.delete' },
    id,
  )
}

/**
 * Forgets a local balance without telling the server anything.
 *
 * The repair for the one collision this schema can produce: two devices, both
 * offline, both recording the same account and month. Each minted its own id,
 * so the second to arrive is refused by the unique constraint on
 * (account, month) — and the right outcome is simply to keep the row that won.
 * Dropping the local loser lets the pull that follows bring it down, which is
 * a plain `removeEntry` minus the queued delete that would take the winner
 * with it. See ./sync's `adoptRemoteBalance`.
 */
export async function discardBalance(id: string): Promise<void> {
  await db.remove('balances', [id])
  notifyChanged()
}

/**
 * Seeds the starter categories for an account that has none. Called only once
 * a pull has confirmed the server side is genuinely empty — seeding on any
 * empty read would re-seed on every cold offline start.
 */
export async function seedStarterCategories(userId: string): Promise<void> {
  for (const name of STARTER_CATEGORIES) {
    const row: LocalCategory = {
      id: uuid(),
      user_id: userId,
      name,
      monthly_budget: null,
    }
    await db.put('categories', row)
    await db.append({
      user_id: userId,
      kind: 'category.create',
      row: { id: row.id, name, monthly_budget: null },
    })
  }
  // One notification for the batch, rather than six re-reads of the same list.
  notifyChanged()
}

// ---------------------------------------------------------------------------
// Sync support
// ---------------------------------------------------------------------------

/**
 * Replaces local rows with what the server just returned, keeping any local
 * change that has not been pushed yet.
 *
 * Rows the outbox still owns are layered back on top, so a pull that overlaps
 * an unsynced write does not make the user's row flicker out. A change the
 * server *rejected* has already been dropped from the outbox by this point,
 * so this is also what quietly reverts it.
 *
 * Rows belonging to another account are left untouched throughout: this
 * browser may hold a second user's data, and a pull for one must not wipe the
 * other.
 */
export async function replaceFromRemote(
  userId: string,
  remote: RemoteRows,
): Promise<void> {
  const queued = await readOutbox(userId)

  for (const table of SYNCED) {
    const local = await db.readAll<Owned>(table.store)
    const localById = new Map(local.map((row) => [row.id, row]))

    const kept: Owned[] = []
    const deletedLocally = new Set<string>()

    for (const op of queued) {
      const id = op.row.id as string
      if (op.kind === table.create) {
        const row = localById.get(id)
        if (row) kept.push(row)
      } else if (table.remove && op.kind === table.remove) {
        deletedLocally.add(id)
      }
    }

    const incoming: Owned[] = remote[table.store]
    const incomingIds = new Set(incoming.map((row) => row.id))
    const keptIds = new Set(kept.map((row) => row.id))

    // Who wins when a pulled row and a still-queued local row share an id
    // depends on what the queued op means.
    //
    // For an insert-only create, an id in both can only be a push that reached
    // Postgres and lost its response: the server has the row, its copy is the
    // one with the server's defaults on it, and the queued op will write the
    // same values again anyway. Incoming wins.
    //
    // For an upsert — an account renamed, a balance corrected — an id in both
    // is the normal case, because the row was already there before it was
    // edited. Letting incoming win would revert the edit on screen every time
    // a sync ran before it was pushed, which on a slow connection is most of
    // them. The local row wins, and stays until the push makes it moot.
    await db.replaceAll(table.store, [
      ...local.filter((row) => row.user_id !== userId),
      ...incoming.filter(
        (row) =>
          !deletedLocally.has(row.id) &&
          !(table.overwrites && keptIds.has(row.id)),
      ),
      ...kept.filter((row) => table.overwrites || !incomingIds.has(row.id)),
    ])
  }

  notifyChanged()
}

export async function dropOps(seqs: number[]): Promise<void> {
  if (seqs.length) await db.remove('outbox', seqs)
}

/**
 * Repoints everything that referenced a locally-created category or income
 * source at a different one, and drops the local parent row.
 *
 * This is the repair for the one collision the schema can produce: two
 * devices, both offline, both adding a parent with the same name. Names are
 * unique per account, so the second one to reach the server is refused — but
 * the rows queued behind it are perfectly good, and would otherwise be
 * refused too for pointing at a parent that no longer exists. Sending them to
 * the parent that survived is what the user meant either way.
 */
export async function remapGroup(
  userId: string,
  group: GroupName,
  fromId: string,
  toId: string,
): Promise<void> {
  const { parent, child, fk } = GROUPS[group]

  const queued = await readOutbox(userId)
  for (const op of queued) {
    if (op.row[fk] === fromId) {
      await db.put('outbox', { ...op, row: { ...op.row, [fk]: toId } })
    }
  }

  const rows = await db.readAll<Record<string, unknown>>(child)
  const touched = rows
    .filter((row) => row.user_id === userId && row[fk] === fromId)
    .map((row) => ({ ...row, [fk]: toId }))
  if (touched.length) await db.putAll(child, touched)

  await db.remove(parent, [fromId])
  notifyChanged()
}

/** Everything this browser holds, dropped. Used on an explicit sign-out. */
export async function clearLocalData(): Promise<void> {
  await db.clearAll()
  notifyChanged()
}
