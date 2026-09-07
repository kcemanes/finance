import { useState } from 'react'
import { useCurrency } from '../lib/currency'
import { formatMonth, formatMonthShort } from '../lib/format'
import { axisBounds } from '../lib/analytics'
import type { MonthFlow } from '../lib/analytics'
import { useElementWidth } from '../hooks/useElementWidth'

type Props = {
  months: MonthFlow[]
  /** Accessible name for the figure; the visible heading is the caller's. */
  label: string
}

// Drawn at one unit per pixel — see useElementWidth for why.
const PAD_LEFT = 54
const PAD_RIGHT = 6
const PAD_TOP = 18 // room for a label above a surplus column
const PLOT_H = 170
const AXIS_H = 26
const HEIGHT = PAD_TOP + PLOT_H + AXIS_H

const MAX_BAR = 24
const DIVISIONS = 4

/**
 * Rounded at the data end, square where it meets the zero line — so the
 * corner that is rounded is itself a readout of which way the month went.
 */
function columnPath(x: number, y: number, w: number, h: number, up: boolean) {
  const r = Math.min(4, w / 2, h)
  if (up) {
    return (
      `M${x} ${y + h}` +
      `L${x} ${y + r}Q${x} ${y} ${x + r} ${y}` +
      `L${x + w - r} ${y}Q${x + w} ${y} ${x + w} ${y + r}` +
      `L${x + w} ${y + h}Z`
    )
  }
  return (
    `M${x} ${y}` +
    `L${x} ${y + h - r}Q${x} ${y + h} ${x + r} ${y + h}` +
    `L${x + w - r} ${y + h}Q${x + w} ${y + h} ${x + w} ${y + h - r}` +
    `L${x + w} ${y}Z`
  )
}

/**
 * Net per month: what was earned less what was spent, diverging from zero.
 *
 * This is the one chart in the app where colour is a value judgment rather
 * than an identity, so it does not reuse the two series hues. A surplus is
 * `income` — the money stayed with you — and a deficit is `overspend`, which
 * is what that token already means everywhere else. Emerald deliberately does
 * not appear: next to the grouped chart above it, emerald means "spending",
 * and reusing it for "good month" would make the pair contradict each other.
 *
 * Direction is never carried by hue alone. Every column is also on its own
 * side of the zero line, the tooltip signs the figure, and the by-month table
 * above carries the net column in text.
 */
function NetChart({ months, label }: Props) {
  const { formatMoney, formatMoneyCompact } = useCurrency()
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const width = useElementWidth(box)

  const nets = months.map((m) => m.net)
  const { low, high, ticks } = axisBounds(
    Math.min(...nets),
    Math.max(...nets),
    DIVISIONS,
  )
  const span = high - low

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT)
  const band = months.length > 0 ? plotW / months.length : 0
  const barW = Math.min(MAX_BAR, band * 0.6)

  const labelStep = band >= 30 ? 1 : 2
  const showValues = band >= 44

  const y = (value: number) =>
    PAD_TOP + PLOT_H - (span > 0 ? ((value - low) / span) * PLOT_H : 0)
  const zeroY = y(0)

  // The month furthest from zero either way is the one worth naming outright.
  const extreme = nets.reduce(
    (best, net, index) => (Math.abs(net) > Math.abs(nets[best]) ? index : best),
    0,
  )

  const hovered = active === null ? null : months[active]

  return (
    <div ref={setBox} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="group"
          aria-label={label}
          className="block"
        >
          {ticks.map((tick) => {
            const at = y(tick)
            const isZero = tick === 0
            return (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={at}
                  y2={at}
                  // The zero line is the one the reader measures against, so
                  // it is drawn as ink rather than as another gridline.
                  className={isZero ? 'stroke-muted' : 'stroke-line'}
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={at}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted text-[11px] tabular-nums"
                >
                  {formatMoneyCompact(tick)}
                </text>
              </g>
            )
          })}

          {months.map((month, index) => {
            const x = PAD_LEFT + band * index
            const barX = x + (band - barW) / 2
            const up = month.net >= 0
            const at = y(month.net)
            // A non-zero month always gets a visible sliver rather than
            // vanishing into the zero line.
            const h = month.net === 0 ? 0 : Math.max(2, Math.abs(at - zeroY))
            const top = up ? zeroY - h : zeroY

            return (
              <g key={month.key}>
                {active === index && (
                  <rect
                    x={x}
                    y={PAD_TOP}
                    width={band}
                    height={PLOT_H}
                    className="fill-accent-soft"
                  />
                )}

                {h > 0 && (
                  <path
                    d={columnPath(barX, top, barW, h, up)}
                    className={up ? 'fill-income' : 'fill-overspend'}
                  />
                )}

                {showValues && index === extreme && month.net !== 0 && (
                  <text
                    x={barX + barW / 2}
                    y={up ? top - 6 : top + h + 13}
                    textAnchor="middle"
                    className="fill-ink text-[11px] font-medium tabular-nums"
                  >
                    {up ? '+' : '−'}
                    {formatMoneyCompact(Math.abs(month.net))}
                  </text>
                )}

                {(index - (months.length - 1)) % labelStep === 0 && (
                  <text
                    x={x + band / 2}
                    y={PAD_TOP + PLOT_H + 17}
                    textAnchor="middle"
                    className="fill-muted text-[11px]"
                  >
                    {formatMonthShort(month.year, month.month)}
                  </text>
                )}

                <rect
                  x={x}
                  y={PAD_TOP}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={`${formatMonth(month.year, month.month)}: ${
                    month.net < 0 ? 'short by' : 'left over'
                  } ${formatMoney(Math.abs(month.net))}`}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}
        </svg>
      )}

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-card"
          style={{
            left: Math.min(
              Math.max(PAD_LEFT + band * (active! + 0.5), 70),
              width - 70,
            ),
            top: Math.max(Math.min(y(hovered.net), zeroY) - 10, PAD_TOP + 40),
          }}
        >
          <div
            className={`font-semibold tabular-nums ${
              hovered.net < 0 ? 'text-overspend-strong' : 'text-income-strong'
            }`}
          >
            {hovered.net < 0 ? '−' : '+'}
            {formatMoney(Math.abs(hovered.net))}
          </div>
          <div className="text-muted">
            {formatMonth(hovered.year, hovered.month)} ·{' '}
            {hovered.net < 0 ? 'spent more than came in' : 'kept'}
          </div>
        </div>
      )}
    </div>
  )
}

export default NetChart
