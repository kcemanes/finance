import { useCurrency } from '../lib/currency'
import type { TargetRow } from '../lib/analytics'

type Props = {
  rows: TargetRow[]
  /**
   * Which side of the target is the bad one, and the word for having landed
   * there. A `monthly_budget` is a ceiling you would rather stay under; an
   * `expected_monthly` is a floor you would rather clear.
   *
   * This is the whole reason the two directions cannot share a component by
   * accident: handed income rows with the expense test, it would paint a
   * source that *beat* its target in the overspend colour.
   */
  miss: 'over' | 'under'
  /** Which direction of money these are, which is all that changes the hue. */
  tone: 'expense' | 'income'
  /** Rendered only when both directions are on screen and need telling apart. */
  heading?: string
}

const TONES = {
  expense: { bar: 'bg-accent-mid', track: 'bg-accent-soft' },
  income: { bar: 'bg-income', track: 'bg-income-soft' },
}

function TargetSummary({ rows, miss, tone, heading }: Props) {
  const { formatMoney } = useCurrency()

  if (rows.length === 0) return null

  const colours = TONES[tone]

  // Bars are relative to the largest number on screen, so the biggest row
  // always fills the track.
  const scale = Math.max(
    ...rows.map((row) => Math.max(row.actual, row.target ?? 0)),
  )

  return (
    <section className="my-7">
      {heading && (
        <h3 className="eyebrow mb-3">{heading}</h3>
      )}
      <ul className="flex list-none flex-col gap-3.5 p-0">
        {rows.map(({ id, name, actual, target }) => {
          const missed =
            target !== null &&
            (miss === 'over' ? actual > target : actual < target)

          return (
            <li key={id}>
              <div className="mb-1.5 flex items-baseline justify-between gap-4 text-sm">
                <span className="font-medium text-ink">{name}</span>
                <span
                  className={
                    missed
                      ? 'font-semibold text-overspend-strong tabular-nums'
                      : 'text-ink tabular-nums'
                  }
                >
                  {formatMoney(actual)}
                  {target !== null && (
                    <span className="font-normal text-muted">
                      {' '}
                      of {formatMoney(target)}
                    </span>
                  )}
                  {/* A word, not just a colour: whether a target was missed is
                      the one thing here worth stating in text. */}
                  {missed && (
                    <span> · {miss === 'over' ? 'over' : 'short'}</span>
                  )}
                </span>
              </div>
              <div
                className={`h-2 overflow-hidden rounded-full ${colours.track}`}
              >
                <div
                  className={`h-full rounded-full ${missed ? 'bg-overspend' : colours.bar}`}
                  style={{ width: `${Math.min(100, (actual / scale) * 100)}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export default TargetSummary
