/**
 * The sync engine: it moves the outbox up to Supabase and pulls the account's
 * rows back down. Nothing in the UI awaits it — ./store already answered the
 * read or accepted the write, and this reconciles afterwards.
 *
 * A pass is always push-then-pull. Pushing first means the pull returns rows
 * that already include everything this browser had queued, so the pull can be
 * treated as the truth instead of having to be merged field by field.
 *
 * There is deliberately no Background Sync registration. Replaying a write
 * needs the Supabase session and its refresh logic, which live on the page;
 * duplicating them in the service worker would be a second, subtly different
 * copy of the auth code for a trigger that only Chromium implements. The page
 * syncs on load, on reconnect, when the tab is shown, and on a slow timer,
 * which covers the same ground with one implementation.
 */
import { supabase } from './supabase'
import {
  GROUPS,
  dropOps,
  loadCategories,
  readOutbox,
  remapGroup,
  replaceFromRemote,
  seedStarterCategories,
} from './store'
import type {
  GroupName,
  LocalCategory,
  LocalExpense,
  LocalIncome,
  LocalIncomeSource,
  OutboxOp,
  RemoteRows,
} from './store'
import * as db from './db'

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

export type SyncState = {
  status: SyncStatus
  /** Local changes not yet accepted by the server. */
  pending: number
  lastSyncedAt: string | null
  /** Set when the server refused a change and it had to be rolled back. */
  rejected: string[]
}

// PostgREST caps a response at 1000 rows by default, and says nothing about
// having done so. Every pull pages until a short page comes back.
const PAGE = 1000

// A quiet backstop for a tab left open: reconnects and tab switches do the
// real work, this only catches a connection that came back without an event.
const POLL_MS = 60_000

// ---------------------------------------------------------------------------
// Observable state
// ---------------------------------------------------------------------------

let state: SyncState = {
  status: 'idle',
  pending: 0,
  lastSyncedAt: null,
  rejected: [],
}

const listeners = new Set<() => void>()

export function getSyncState() {
  return state
}

export function subscribeSync(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// A fresh object each time, so useSyncExternalStore sees the change.
function setState(patch: Partial<SyncState>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

export function dismissRejected() {
  if (state.rejected.length) setState({ rejected: [] })
}

// ---------------------------------------------------------------------------
// Error classification
//
// supabase-js reports the two failure modes differently, and they need
// opposite handling: a call that *throws* never reached the server, while a
// call that *returns* an error was understood and refused.
// ---------------------------------------------------------------------------

/**
 * True when the change should stay queued and be tried again.
 *
 * 0 is a request that never got a response. 401/403 usually means the access
 * token is mid-refresh. 5xx and 429 are the server asking for patience.
 * Anything else in the 4xx range is a rejection that will be repeated
 * forever — a duplicate category name, a failed check constraint — so the
 * change is dropped and the following pull rolls the local row back.
 */
function isRetryable(status: number) {
  return status === 0 || status === 401 || status === 403 || status === 408 || status === 429 || status >= 500
}

function subject(op: OutboxOp): string {
  switch (op.kind) {
    case 'category.create':
      return `category “${String(op.row.name)}”`
    case 'source.create':
      return `income source “${String(op.row.name)}”`
    case 'expense.create':
      return `expense of ${String(op.row.amount)} on ${String(op.row.spent_on)}`
    case 'income.create':
      return `income of ${String(op.row.amount)} on ${String(op.row.received_on)}`
    case 'expense.delete':
      return 'a deleted expense'
    case 'income.delete':
      return 'a deleted income'
  }
}

function describe(op: OutboxOp, message: string) {
  return `${subject(op)} — ${message}`
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Sends one queued change.
 *
 * Creates go through `upsert` rather than `insert` so a replay is harmless:
 * if a previous attempt reached Postgres but its response was lost, the retry
 * writes the same row at the same id instead of a duplicate. The id came from
 * the client, which is what makes that possible. A delete of a row that is
 * already gone is a no-op for the same reason.
 *
 * `user_id` is never sent — the column defaults to `auth.uid()`, and the RLS
 * `with check` clause would reject anything else anyway.
 */
function apply(op: OutboxOp) {
  switch (op.kind) {
    case 'category.create':
      return supabase.from('categories').upsert(op.row, { onConflict: 'id' })
    case 'source.create':
      return supabase
        .from('income_sources')
        .upsert(op.row, { onConflict: 'id' })
    case 'expense.create':
      return supabase.from('expenses').upsert(op.row, { onConflict: 'id' })
    case 'income.create':
      return supabase.from('incomes').upsert(op.row, { onConflict: 'id' })
    case 'expense.delete':
      return supabase.from('expenses').delete().eq('id', op.row.id as string)
    case 'income.delete':
      return supabase.from('incomes').delete().eq('id', op.row.id as string)
  }
}

/**
 * Handles a category or income source creation the server refused because the
 * name is already taken — the collision two offline devices can produce.
 *
 * Finds the row that won, repoints this device's children at it, and patches
 * the ops still to be sent in this same pass. Returns false if the rejection
 * was something else, in which case the caller reports it.
 */
async function mergeDuplicateName(
  userId: string,
  op: OutboxOp,
  remaining: OutboxOp[],
): Promise<boolean> {
  const group: GroupName = op.kind === 'source.create' ? 'source' : 'category'
  const { parent, fk } = GROUPS[group]

  const { data, error } = await supabase
    .from(parent)
    .select('id')
    .eq('name', op.row.name as string)
    .maybeSingle()

  const winner = (data as { id: string } | null)?.id
  if (error || !winner) return false

  await remapGroup(userId, group, op.row.id as string, winner)

  // `remaining` was read before the repair, so the ops this pass has yet to
  // send still carry the dead id. Patch them in place to match the store.
  for (const later of remaining) {
    if (later.row[fk] === op.row.id) later.row[fk] = winner
  }

  return true
}

type PushResult = { blocked: boolean; rejected: string[] }

async function push(userId: string): Promise<PushResult> {
  const ops = await readOutbox(userId)
  const settled: number[] = []
  const rejected: string[] = []

  for (const op of ops) {
    let status: number
    let message: string | null = null

    try {
      const result = await apply(op)
      status = result.status
      message = result.error?.message ?? null
    } catch {
      // Thrown rather than returned: the request never made it out.
      status = 0
    }

    if (message === null && status >= 200 && status < 300) {
      settled.push(op.seq)
      continue
    }

    if (isRetryable(status)) {
      // Stop at the first change that could not be delivered. The queue is
      // ordered and a later change may depend on this one — an expense cannot
      // land before the category it points at.
      await dropOps(settled)
      return { blocked: true, rejected }
    }

    // Refused, and it will be refused again. Drop it and let the pull that
    // follows roll the local row back — unless it is a category or an income
    // source whose name is already taken, which is a merge rather than a loss.
    if (op.kind === 'category.create' || op.kind === 'source.create') {
      const merged = await mergeDuplicateName(userId, op, ops)
      if (merged) {
        settled.push(op.seq)
        continue
      }
    }

    rejected.push(describe(op, message ?? 'rejected by the server'))
    settled.push(op.seq)
  }

  await dropOps(settled)
  return { blocked: false, rejected }
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function selectAll(table: string, columns: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []

  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order('id')
      .range(offset, offset + PAGE - 1)

    if (error) throw new Error(error.message)

    const page = (data ?? []) as unknown as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

async function pull(userId: string): Promise<RemoteRows> {
  const [categories, expenses, sources, incomes] = await Promise.all([
    selectAll('categories', 'id, name, monthly_budget'),
    selectAll('expenses', 'id, category_id, spent_on, amount, note, created_at'),
    selectAll('income_sources', 'id, name, expected_monthly'),
    selectAll('incomes', 'id, source_id, received_on, amount, note, created_at'),
  ])

  // numeric() arrives as a string once the value is large enough, so every
  // money column is coerced back on the way in.
  return {
    categories: categories.map((row) => ({
      ...row,
      user_id: userId,
      monthly_budget:
        row.monthly_budget === null ? null : Number(row.monthly_budget),
    })) as LocalCategory[],
    expenses: expenses.map((row) => ({
      ...row,
      user_id: userId,
      amount: Number(row.amount),
    })) as LocalExpense[],
    income_sources: sources.map((row) => ({
      ...row,
      user_id: userId,
      expected_monthly:
        row.expected_monthly === null ? null : Number(row.expected_monthly),
    })) as LocalIncomeSource[],
    incomes: incomes.map((row) => ({
      ...row,
      user_id: userId,
      amount: Number(row.amount),
    })) as LocalIncome[],
  }
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

const LAST_SYNCED = (userId: string) => `lastSynced:${userId}`

async function readLastSynced(userId: string) {
  const rows = await db.readAll<{ key: string; value: string }>('meta')
  return rows.find((row) => row.key === LAST_SYNCED(userId))?.value ?? null
}

async function refreshPending(userId: string) {
  setState({ pending: (await readOutbox(userId)).length })
}

let running: Promise<void> | null = null
let queued = false

async function runSync(userId: string) {
  await refreshPending(userId)

  if (!navigator.onLine) {
    setState({ status: 'offline' })
    return
  }

  setState({ status: 'syncing' })

  try {
    let { blocked, rejected } = await push(userId)
    let remote = await pull(userId)
    await replaceFromRemote(userId, remote)

    // A brand-new account: nothing local, nothing remote. Seed the starters
    // and push them straight back, so the expense form has something to
    // select. Gated on a completed pull, so an offline start never re-seeds.
    if (!blocked && remote.categories.length === 0) {
      if ((await loadCategories(userId)).length === 0) {
        await seedStarterCategories(userId)
        const second = await push(userId)
        blocked = second.blocked
        rejected = [...rejected, ...second.rejected]
        remote = await pull(userId)
        await replaceFromRemote(userId, remote)
      }
    }

    const now = new Date().toISOString()
    await db.put('meta', { key: LAST_SYNCED(userId), value: now })

    await refreshPending(userId)
    setState({
      status: blocked ? 'offline' : 'idle',
      lastSyncedAt: now,
      rejected: rejected.length ? [...state.rejected, ...rejected] : state.rejected,
    })
  } catch {
    // A pull that failed outright. The local store is untouched and still
    // renders; the next trigger tries again.
    await refreshPending(userId)
    setState({ status: navigator.onLine ? 'error' : 'offline' })
  }
}

/**
 * Runs a sync, coalescing concurrent callers. A request that arrives while a
 * pass is in flight schedules exactly one more, so a burst of writes settles
 * with a single follow-up rather than one pass each.
 */
export function requestSync(userId: string): Promise<void> {
  if (running) {
    queued = true
    return running
  }

  running = runSync(userId).finally(() => {
    running = null
    if (queued) {
      queued = false
      void requestSync(userId)
    }
  })

  return running
}

/**
 * Wires up the triggers for a signed-in session and does the first pass.
 * Returns a cleanup for when the user signs out or the account changes.
 */
export function startSync(userId: string) {
  let stopped = false

  const trigger = () => {
    if (!stopped) void requestSync(userId)
  }

  const onOnline = () => {
    setState({ status: 'syncing' })
    trigger()
  }
  const onOffline = () => setState({ status: 'offline' })
  const onVisible = () => {
    if (document.visibilityState === 'visible') trigger()
  }

  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(trigger, POLL_MS)

  // Show the last successful sync straight away, before this pass finishes.
  void readLastSynced(userId).then((value) => {
    if (!stopped && value && !state.lastSyncedAt) setState({ lastSyncedAt: value })
  })

  if (!navigator.onLine) setState({ status: 'offline' })
  trigger()

  return () => {
    stopped = true
    window.removeEventListener('online', onOnline)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}

/** Drops sync state back to its defaults. Used on sign-out. */
export function resetSyncState() {
  setState({ status: 'idle', pending: 0, lastSyncedAt: null, rejected: [] })
}
