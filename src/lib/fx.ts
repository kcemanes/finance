/**
 * The CAD → PHP rate, for typing a Canadian figure into a ledger kept in pesos.
 *
 * Converted once, on save: what is stored is still a plain PHP number, so
 * nothing downstream — sync, charts, totals — knows a rate was involved.
 *
 * Frankfurter republishes the ECB's reference rates, which move once a working
 * day. It needs no key, so the browser can call it directly; there is no
 * server of our own to put a secret behind.
 */
import { formatMoneyIn } from './currency'
import { formatDay } from './format'

const ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=CAD&symbols=PHP'
const STORAGE_KEY = 'budget.fx.CAD-PHP'

// Well inside a day, so a rate published this morning is picked up by the
// afternoon, without asking again on every form that opens.
const FRESH_FOR = 6 * 60 * 60 * 1000

export type FxRate = {
  /** Pesos per Canadian dollar. */
  rate: number
  /** The day the rate was published for, as YYYY-MM-DD. */
  date: string
  /** When this copy was fetched, in epoch milliseconds. */
  fetchedAt: number
}

function isRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFxRate(value: unknown): value is FxRate {
  if (typeof value !== 'object' || value === null) return false
  const { rate, date, fetchedAt } = value as Record<string, unknown>
  return isRate(rate) && typeof date === 'string' && typeof fetchedAt === 'number'
}

/** The last rate fetched, kept so CAD entry still works offline. */
export function storedRate(): FxRate | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (isFxRate(saved)) return saved
  } catch {
    // Unreadable or blocked storage is the same as never having fetched.
  }
  return null
}

function storeRate(rate: FxRate) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rate))
  } catch {
    // Not persisting it only costs a refetch next time.
  }
}

export function isFresh(rate: FxRate | null) {
  return rate !== null && Date.now() - rate.fetchedAt < FRESH_FOR
}

// Two forms on screen at once share one request rather than racing two.
let inFlight: Promise<FxRate> | null = null

export function fetchCadToPhp(): Promise<FxRate> {
  inFlight ??= (async () => {
    const response = await fetch(ENDPOINT)
    if (!response.ok) {
      throw new Error(`Exchange rate request failed (${response.status}).`)
    }
    const body = await response.json()
    const rate = body?.rates?.PHP
    if (!isRate(rate) || typeof body.date !== 'string') {
      throw new Error('Exchange rate response was not understood.')
    }
    const fetched = { rate, date: body.date, fetchedAt: Date.now() }
    storeRate(fetched)
    return fetched
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** A CAD figure in pesos, to the centavo — the precision every amount is stored at. */
export function convertCadToPhp(cad: number, rate: number) {
  return Math.round(cad * rate * 100) / 100
}

/** "1 CAD = ₱45.48 (Nov 2)", so a converted figure says what it was converted at. */
export function describeRate(rate: FxRate) {
  return `1 CAD = ${formatMoneyIn('PHP', rate.rate)} (${formatDay(rate.date)})`
}
