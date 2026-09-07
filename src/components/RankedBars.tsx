import { useState } from 'react'
import { useCurrency } from '../lib/currency'
import { formatShare } from '../lib/format'
import type { GroupTotal } from '../lib/analytics'

type Props = {
  groups: GroupTotal[]
  /** Which direction of money these are, which is all that changes the hue. */
  tone: 'expense' | 'income'
  label: string
}

const TONES = {
  expense: { bar: 'bg-accent', on: 'bg-accent-strong', track: 'bg-accent-soft' },
  income: { bar: 'bg-income', on: 'bg-income-strong', track: 'bg-income-soft' },
}

/**
 * Ranked horizontal bars, one hue per chart.
 *
 * Within a chart the parents are nominal — reordering them changes nothing —
 * so they are one series in one colour rather than eight. Colouring each bar
 * by its own value would spend the identity channel restating what the bar
 * length already says.
 *
 * Across charts the hue does carry identity, which is what `tone` is for:
 * spending and income are two different things being ranked, and the reader
 * should not have to check the heading to tell which they are looking at.
 */
function RankedBars({ groups, tone, label }: Props) {
  const { formatMoney } = useCurrency()
  const [active, setActive] = useState<string | null>(null)
  const colours = TONES[tone]

  // Bars are relative to the largest, so the top row fills the track.
  const scale = Math.max(...groups.map((g) => g.total), 0)

  return (
    <ul
      role="group"
      aria-label={label}
      className="flex list-none flex-col gap-3 p-0"
    >
      {groups.map((group) => {
        const width = scale > 0 ? (group.total / scale) * 100 : 0
        const on = active === group.id

        return (
          <li
            key={group.id}
            className="grid grid-cols-[minmax(4.5rem,7rem)_1fr_auto] items-center gap-3 text-sm"
            tabIndex={0}
            role="img"
            aria-label={`${group.name}: ${formatMoney(group.total)}, ${formatShare(group.share)} of the total`}
            onPointerEnter={() => setActive(group.id)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(group.id)}
            onBlur={() => setActive(null)}
          >
            <span className="truncate font-medium text-ink" title={group.name}>
              {group.name}
            </span>

            <div className={`relative h-2.5 rounded-[4px] ${colours.track}`}>
              <div
                className={`h-full rounded-r-[4px] ${on ? colours.on : colours.bar}`}
                style={{ width: `${width}%` }}
              />
              {on && (
                <div
                  className="pointer-events-none absolute bottom-full z-10 mb-2 -translate-x-1/2 rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-card"
                  style={{
                    left: `clamp(4rem, ${width}%, calc(100% - 4rem))`,
                  }}
                >
                  <div className="font-semibold text-ink tabular-nums">
                    {formatMoney(group.total)}
                  </div>
                  <div className="text-muted">
                    {formatShare(group.share)} of total · {group.count}{' '}
                    {group.count === 1 ? 'entry' : 'entries'}
                  </div>
                </div>
              )}
            </div>

            <span className="text-ink tabular-nums">
              {formatMoney(group.total)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default RankedBars
