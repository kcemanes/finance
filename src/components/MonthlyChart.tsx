import { useState } from 'react'
import { useCurrency } from '../lib/currency'
import { formatMonth, formatMonthShort } from '../lib/format'
import { axisMax } from '../lib/analytics'
import type { MonthFlow } from '../lib/analytics'
import { useElementWidth } from '../hooks/useElementWidth'

type Props = {
  months: MonthFlow[]
  /** Draw income beside spending. False collapses this to one series. */
  withIncome: boolean
  /** Accessible name for the figure; the visible heading is the caller's. */
  label: string
}

// Drawn at one unit per pixel — see useElementWidth for why.
const PAD_LEFT = 54 // room for a compact money tick
const PAD_RIGHT = 6
const PAD_TOP = 20 // room for the direct label above the tallest column
const PLOT_H = 180
const AXIS_H = 26
const HEIGHT = PAD_TOP + PLOT_H + AXIS_H

const MAX_BAR = 24 // marks stay thin; the band's leftover is air
const BAR_GAP = 2 // between the pair inside one month
const TICKS = [0, 0.25, 0.5, 0.75, 1] // four divisions

type SeriesKey = 'income' | 'expense'

// Income first, so the pair reads left-to-right as in, then out. Position is
// doing as much work as the hue here, which is the point: the two are also
// told apart by where they sit in the band.
const SERIES: { key: SeriesKey; legend: string; fill: string; swatch: string }[] = [
  { key: 'income', legend: 'Money in', fill: 'fill-income', swatch: 'bg-income' },
  { key: 'expense', legend: 'Money out', fill: 'fill-accent', swatch: 'bg-accent' },
]

/** Rounded at the data end, square where it meets the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h)
  return (
    `M${x} ${y + h}` +
    `L${x} ${y + r}Q${x} ${y} ${x + r} ${y}` +
    `L${x + w - r} ${y}Q${x + w} ${y} ${x + w} ${y + r}` +
    `L${x + w} ${y + h}Z`
  )
}

function MonthlyChart({ months, withIncome, label }: Props) {
  const { formatMoney, formatMoneyCompact } = useCurrency()
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const width = useElementWidth(box)

  const series = withIncome ? SERIES : SERIES.filter((s) => s.key === 'expense')

  const peak = Math.max(
    ...months.flatMap((m) => series.map((s) => m[s.key])),
    0,
  )
  const max = axisMax(peak, TICKS.length - 1)
  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT)
  const band = months.length > 0 ? plotW / months.length : 0

  // The pair has to share the band the single column used to have to itself.
  const barW = Math.max(
    1,
    Math.min(MAX_BAR, (band * 0.66 - BAR_GAP * (series.length - 1)) / series.length),
  )
  const groupW = barW * series.length + BAR_GAP * (series.length - 1)

  // Below these widths the text would collide with its neighbours, so the
  // tooltip and the table carry those values instead of clipping them.
  const labelStep = band >= 30 ? 1 : 2
  const showValues = band >= 40

  // Direct labels are for the single-series case only. With a pair in every
  // band there is nowhere to put them that does not land on the other column.
  const lastIndex = months.length - 1
  const peakIndex = months.findIndex((m) => m.expense === peak)
  const labelled = new Set<number>()
  if (!withIncome && showValues && peak > 0) {
    labelled.add(peakIndex)
    // The most recent month is the other one worth calling out — unless it is
    // next to the peak, where the two labels would overlap.
    if (months[lastIndex].expense > 0 && Math.abs(lastIndex - peakIndex) > 1) {
      labelled.add(lastIndex)
    }
  }

  const y = (value: number) =>
    PAD_TOP + PLOT_H - (max > 0 ? (value / max) * PLOT_H : 0)

  const hovered = active === null ? null : months[active]

  const readout = (month: MonthFlow) =>
    withIncome
      ? `${formatMonth(month.year, month.month)}: ${formatMoney(month.income)} in, ${formatMoney(month.expense)} out, ${formatMoney(month.net)} net`
      : `${formatMonth(month.year, month.month)}: ${formatMoney(month.expense)}`

  return (
    <div ref={setBox} className="relative">
      {withIncome && (
        <ul className="mb-2 flex list-none flex-wrap gap-4 p-0 text-xs text-muted">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`inline-block h-2.5 w-2.5 rounded-[2px] ${s.swatch}`}
              />
              {s.legend}
            </li>
          ))}
        </ul>
      )}

      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          // A group rather than an img: role="img" would make the focusable
          // bands inside it presentational, and they carry the per-month
          // readout. The table view below is the full text equivalent.
          role="group"
          aria-label={label}
          className="block"
        >
          {TICKS.map((fraction) => {
            const at = y(max * fraction)
            return (
              <g key={fraction}>
                <line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={at}
                  y2={at}
                  className="stroke-line"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 8}
                  y={at}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted text-[11px] tabular-nums"
                >
                  {formatMoneyCompact(max * fraction)}
                </text>
              </g>
            )
          })}

          {months.map((month, index) => {
            const x = PAD_LEFT + band * index
            const groupX = x + (band - groupW) / 2

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

                {series.map((s, slot) => {
                  const value = month[s.key]
                  // A non-zero month always gets a visible sliver rather than
                  // disappearing into the baseline.
                  const h = value > 0 ? Math.max(2, PAD_TOP + PLOT_H - y(value)) : 0
                  if (h === 0) return null
                  const barX = groupX + slot * (barW + BAR_GAP)
                  return (
                    <path
                      key={s.key}
                      d={columnPath(barX, PAD_TOP + PLOT_H - h, barW, h)}
                      className={s.fill}
                    />
                  )
                })}

                {labelled.has(index) && (
                  <text
                    x={groupX + groupW / 2}
                    y={PAD_TOP + PLOT_H - Math.max(2, PAD_TOP + PLOT_H - y(month.expense)) - 7}
                    textAnchor="middle"
                    className="fill-ink text-[11px] font-medium tabular-nums"
                  >
                    {formatMoneyCompact(month.expense)}
                  </text>
                )}

                {(index - lastIndex) % labelStep === 0 && (
                  <text
                    x={x + band / 2}
                    y={PAD_TOP + PLOT_H + 17}
                    textAnchor="middle"
                    className="fill-muted text-[11px]"
                  >
                    {formatMonthShort(month.year, month.month)}
                  </text>
                )}

                {/* The hit target is the whole band, not the painted column. */}
                <rect
                  x={x}
                  y={PAD_TOP}
                  width={band}
                  height={PLOT_H}
                  fill="transparent"
                  tabIndex={0}
                  role="img"
                  aria-label={readout(month)}
                  onPointerEnter={() => setActive(index)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive(null)}
                />
              </g>
            )
          })}

          <line
            x1={PAD_LEFT}
            x2={width - PAD_RIGHT}
            y1={PAD_TOP + PLOT_H}
            y2={PAD_TOP + PLOT_H}
            className="stroke-line"
            strokeWidth={1}
          />
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
            // Sits above the taller of the pair, but never above the plot: a
            // tall column would otherwise push it out over the heading.
            top: Math.max(
              y(Math.max(hovered.expense, withIncome ? hovered.income : 0)) - 10,
              PAD_TOP + 44,
            ),
          }}
        >
          <div className="font-semibold text-ink">
            {formatMonth(hovered.year, hovered.month)}
          </div>
          {withIncome ? (
            <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-2.5 tabular-nums">
              <dt className="text-muted">In</dt>
              <dd className="text-right text-income-strong">
                {formatMoney(hovered.income)}
              </dd>
              <dt className="text-muted">Out</dt>
              <dd className="text-right text-ink">
                {formatMoney(hovered.expense)}
              </dd>
              <dt className="border-t border-line pt-0.5 text-muted">Net</dt>
              <dd
                className={`border-t border-line pt-0.5 text-right font-semibold ${
                  hovered.net < 0 ? 'text-overspend-strong' : 'text-income-strong'
                }`}
              >
                {hovered.net < 0 ? '−' : '+'}
                {formatMoney(Math.abs(hovered.net))}
              </dd>
            </dl>
          ) : (
            <div className="text-muted">
              <span className="font-semibold text-ink tabular-nums">
                {formatMoney(hovered.expense)}
              </span>
              {' · '}
              {hovered.expenseCount}{' '}
              {hovered.expenseCount === 1 ? 'expense' : 'expenses'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default MonthlyChart
