// Change this if you want dates in another locale.
// Money formatting lives in ./currency, which the user picks at runtime.
const LOCALE = 'en-CA'

const dayMonth = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  day: 'numeric',
})

const monthYear = new Intl.DateTimeFormat(LOCALE, {
  month: 'long',
  year: 'numeric',
})

// Axis ticks and range labels, where the full month name never fits.
const shortMonth = new Intl.DateTimeFormat(LOCALE, { month: 'short' })

const share = new Intl.NumberFormat(LOCALE, {
  style: 'percent',
  maximumFractionDigits: 0,
})

const shortMonthYear = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  year: 'numeric',
})

// Axis ticks on a window long enough that a bare month name repeats.
const tickMonthYear = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  year: '2-digit',
})

/**
 * Parse a YYYY-MM-DD date as a LOCAL date.
 *
 * `new Date('2026-09-03')` is parsed as UTC midnight, which renders as the
 * previous day everywhere west of Greenwich. Building the date from parts
 * avoids that.
 */
export function parseDay(day: string) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

export function formatDay(day: string) {
  return dayMonth.format(parseDay(day))
}

export function formatMonth(year: number, month: number) {
  return monthYear.format(new Date(year, month, 1))
}

export function formatMonthShort(year: number, month: number) {
  return shortMonth.format(new Date(year, month, 1))
}

export function formatMonthAbbr(year: number, month: number) {
  return shortMonthYear.format(new Date(year, month, 1))
}

/** "Sep 25" — the month plus just enough year to anchor it on an axis. */
export function formatMonthTick(year: number, month: number) {
  return tickMonthYear.format(new Date(year, month, 1))
}

/** A 0-1 fraction as a whole percentage. */
export function formatShare(fraction: number) {
  return share.format(fraction)
}

/** Today in the user's own timezone, as YYYY-MM-DD. */
export function today() {
  const now = new Date()
  return toDay(now.getFullYear(), now.getMonth(), now.getDate())
}

function toDay(year: number, month: number, date: number) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month + 1)}-${pad(date)}`
}

/** Inclusive first/last day of a month, for range queries. */
export function monthBounds(year: number, month: number) {
  return {
    from: toDay(year, month, 1),
    to: toDay(year, month, new Date(year, month + 1, 0).getDate()),
  }
}
