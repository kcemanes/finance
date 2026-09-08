/**
 * The local database behind the offline-first store.
 *
 * IndexedDB is the only browser storage that survives a reload, holds more
 * than a few megabytes, and can be written from a page that has no network.
 * This module is the thin part: opening the database, and reading or writing
 * whole object stores. Everything that knows what a category, an expense, an
 * income, an account or a balance *is* lives in ./store.
 *
 * Filtering — by user, by month — happens in JavaScript over a full store
 * read rather than through IndexedDB indexes. A personal budget is a few
 * thousand rows even after a decade, so an index would buy nothing and cost
 * a schema migration every time a query changed.
 *
 * If IndexedDB is unavailable (private windows, storage blocked by policy)
 * every operation quietly falls back to an in-memory copy. The app then
 * behaves like the online-only version it used to be: writes still work
 * while the tab is open, they just do not outlive it.
 */

const DB_NAME = 'budget'

/**
 * Bumped to 3 to add the two balance-sheet stores, after 2 added the two
 * income ones. `onupgradeneeded` below creates whatever is missing and leaves
 * everything that already exists alone, so an upgrade needs no data migration.
 *
 * It does carry one cost, and every bump pays it: a second tab still holding
 * the previous version open blocks the upgrade, and `onblocked` resolves
 * null — which drops *this* tab to the in-memory fallback for the rest of its
 * life, because `opening` is memoized. Writes still work and still sync; they
 * just do not outlive the tab. A reload clears it.
 */
const DB_VERSION = 3

export type StoreName =
  | 'categories'
  | 'expenses'
  | 'income_sources'
  | 'incomes'
  | 'accounts'
  | 'balances'
  | 'outbox'
  | 'meta'

/** Key path per store, and whether the key is generated for us. */
const STORES: Record<StoreName, { keyPath: string; autoIncrement: boolean }> = {
  categories: { keyPath: 'id', autoIncrement: false },
  expenses: { keyPath: 'id', autoIncrement: false },
  income_sources: { keyPath: 'id', autoIncrement: false },
  incomes: { keyPath: 'id', autoIncrement: false },
  accounts: { keyPath: 'id', autoIncrement: false },
  balances: { keyPath: 'id', autoIncrement: false },
  outbox: { keyPath: 'seq', autoIncrement: true },
  meta: { keyPath: 'key', autoIncrement: false },
}

type Row = Record<string, unknown>

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

let opening: Promise<IDBDatabase | null> | null = null

/** Resolves to null when IndexedDB cannot be used; callers fall back to memory. */
function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening

  opening = new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      for (const [name, { keyPath, autoIncrement }] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath, autoIncrement })
        }
      }
    }

    request.onsuccess = () => resolve(request.result)
    // Both of these are recoverable: the caller gets the memory fallback.
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return opening
}

// ---------------------------------------------------------------------------
// Memory fallback
// ---------------------------------------------------------------------------

const memory = new Map<StoreName, Map<IDBValidKey, Row>>()
let memorySeq = 0

function memoryStore(name: StoreName) {
  let store = memory.get(name)
  if (!store) {
    store = new Map()
    memory.set(name, store)
  }
  return store
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

/**
 * Runs `body` against the named stores in one transaction.
 *
 * Two ordering rules make this safe, and both are easy to get wrong:
 *
 * 1. `body` must issue every request synchronously. An IndexedDB transaction
 *    closes as soon as an event loop turn ends with nothing in flight, so
 *    awaiting *inside* `body` would leave the rest of the work holding a dead
 *    handle. Issue the requests, return their promises, await out here.
 * 2. The completion handlers are attached before `body` runs. `oncomplete`
 *    fires as a task, so attaching it after awaiting a request would race a
 *    transaction that had already finished — and wait forever.
 *
 * `fallback` is only for a browser with no usable IndexedDB at all. A
 * transaction that opens and then fails is a real error and propagates, so a
 * write the user believes was saved is never quietly downgraded to memory.
 */
async function transact<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  body: (stores: Record<string, IDBObjectStore>) => Promise<T>,
  fallback: () => T,
): Promise<T> {
  const db = await openDb()
  if (!db) return fallback()

  let tx: IDBTransaction
  try {
    tx = db.transaction(names, mode)
  } catch (error) {
    // Usually the connection was closed under us by a version change in
    // another tab. Drop the handle so the next call opens a fresh one.
    opening = null
    throw error
  }

  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
  })

  const stores: Record<string, IDBObjectStore> = {}
  for (const name of names) stores[name] = tx.objectStore(name)

  // Promise.all attaches handlers to both, so a rejection on either side is
  // observed rather than surfacing as an unhandled rejection.
  const [result] = await Promise.all([body(stores), done])
  return result
}

export function readAll<T>(name: StoreName): Promise<T[]> {
  return transact(
    [name],
    'readonly',
    (stores) => promised(stores[name].getAll() as IDBRequest<T[]>),
    () => [...memoryStore(name).values()] as T[],
  )
}

/** Inserts or replaces, keyed by each store's own key path. */
export function putAll(name: StoreName, rows: Row[]): Promise<void> {
  return transact(
    [name],
    'readwrite',
    async (stores) => {
      for (const row of rows) stores[name].put(row)
    },
    () => {
      const store = memoryStore(name)
      const { keyPath } = STORES[name]
      for (const row of rows) store.set(row[keyPath] as IDBValidKey, row)
    },
  )
}

export function put(name: StoreName, row: Row): Promise<void> {
  return putAll(name, [row])
}

export function remove(name: StoreName, keys: IDBValidKey[]): Promise<void> {
  return transact(
    [name],
    'readwrite',
    async (stores) => {
      for (const key of keys) stores[name].delete(key)
    },
    () => {
      const store = memoryStore(name)
      for (const key of keys) store.delete(key)
    },
  )
}

/** Appends to the outbox, returning the sequence number it was given. */
export function append(row: Row): Promise<number> {
  return transact(
    ['outbox'],
    'readwrite',
    (stores) => promised(stores.outbox.add(row) as IDBRequest<number>),
    () => {
      const seq = ++memorySeq
      memoryStore('outbox').set(seq, { ...row, seq })
      return seq
    },
  )
}

/** Wipes every store. Used on sign-out so one account leaves nothing behind. */
export function clearAll(): Promise<void> {
  const names = Object.keys(STORES) as StoreName[]
  return transact(
    names,
    'readwrite',
    async (stores) => {
      for (const name of names) stores[name].clear()
    },
    () => {
      memory.clear()
      memorySeq = 0
    },
  )
}

/** Replaces the whole contents of a store in one transaction. */
export function replaceAll(name: StoreName, rows: Row[]): Promise<void> {
  return transact(
    [name],
    'readwrite',
    async (stores) => {
      stores[name].clear()
      for (const row of rows) stores[name].put(row)
    },
    () => {
      const store = memoryStore(name)
      store.clear()
      const { keyPath } = STORES[name]
      for (const row of rows) store.set(row[keyPath] as IDBValidKey, row)
    },
  )
}
