import { useState } from 'react'
import { useCurrency } from '../lib/currency'
import { formatMonth, formatMonthShort, formatMonthTick } from '../lib/format'
import { axisBounds } from '../lib/analytics'
import type { NetWorthPoint } from '../lib/analytics'
import { useElementWidth } from '../hooks/useElementWidth'

type Props = {
  points: NetWorthPoint[]
  /** Accessible name for the figure; the visible heading is the caller's. */
  label: string
}

// Drawn at one unit per pixel — see useElementWidth for why. The same
// geometry as MonthlyChart and NetChart, so the three stack without the
// plots shifting under one another.
const PAD_LEFT = 54
const PAD_RIGHT = 6
const PAD_TOP = 18
const PLOT_H = 170
const AXIS_H = 26
const HEIGHT = PAD_TOP + PLOT_H + AXIS_H

// More than the four the other charts use. The step is what gets rounded
// (see axisMax), so a coarser division on figures this large snaps to the
// next power of ten and leaves the line sitting in the bottom two thirds of
// the plot with an empty band above it; a finer division keeps the rounded
// step closer to the actual range.
const DIVISIONS = 8

// The axis clears the highest point by this much before rounding to a nice
// top, e.g. a ~₱4M peak lands under a ₱6-7M top instead of a snug ₱5M one.
const HEADROOM = 1.5

const LABEL_W = 30
const LABEL_W_YEAR = 42
const YEARS_FROM = 13

// Below this the dots crowd into a bead chain and the line reads better alone.
const DOTS_UNTIL = 24

/**
 * Net worth over time: one point per month that was actually recorded.
 *
 * A line rather than columns, because this is the one quantity in the app that
 * *persists* between the points instead of being spent and re-earned — the
 * gaps between readings are still money you have, so joining them is telling
 * the truth. Everything else here is columns for the opposite reason.
 *
 * The axis comes from `axisBounds`, which pins zero to a gridline. For a
 * balance sheet in the black that makes it zero-based, which flattens the line
 * and is the honest way round: a chart cropped to the interesting band would
 * turn a 4% month into a cliff. The month-to-month differences are meant to be
 * read as figures in the table underneath, not measured off this.
 *
 * Debt gets a second line only when there is any, so an account with no debts
 * sees one series rather than one series and a flat zero.
 */
function NetWorthChart({ points, label }: Props) {
  const { formatMoney, formatMoneyCompact } = useCurrency()
  const [box, setBox] = useState<HTMLDivElement | null>(null)
  const [active, setActive] = useState<number | null>(null)
  const width = useElementWidth(box)

  const nets = points.map((point) => point.net)
  const hasDebt = points.some((point) => point.debt > 0)

  // Only the series actually drawn. Assets are not one of them: on a balance
  // sheet in the black they equal net worth anyway, and on one in the red they
  // would stretch the axis past anything on screen.
  const drawn = hasDebt
    ? [...nets, ...points.map((point) => point.debt)]
    : nets

  // Padded above the highest point on record, so that point lands partway up
  // the plot rather than on the top gridline — headroom to read the line
  // against, not just the tightest box it fits in.
  const { low, high, ticks } = axisBounds(
    Math.min(...drawn),
    Math.max(...drawn) * HEADROOM,
    DIVISIONS,
  )
  const span = high - low

  const plotW = Math.max(0, width - PAD_LEFT - PAD_RIGHT)
  // One point has no span to spread over, so it sits in the middle rather
  // than hard against the axis.
  const step = points.length > 1 ? plotW / (points.length - 1) : 0
  const x = (index: number) =>
    points.length > 1 ? PAD_LEFT + step * index : PAD_LEFT + plotW / 2

  const y = (value: number) =>
    PAD_TOP + PLOT_H - (span > 0 ? ((value - low) / span) * PLOT_H : 0)

  const withYear = points.length >= YEARS_FROM
  const labelWidth = withYear ? LABEL_W_YEAR : LABEL_W
  const labelStep = step > 0 ? Math.max(1, Math.ceil(labelWidth / step)) : 1

  // Pulled in at the ends so the first and last ticks are not cut in half by
  // the edge — see MonthlyChart.
  const labelX = (at: number) =>
    Math.min(Math.max(at, labelWidth / 2), width - labelWidth / 2)

  const line = (pick: (point: NetWorthPoint) => number) =>
    points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)} ${y(pick(point))}`)
      .join('')

  // Closed back along the zero line, so the line reads as a level rather than
  // as a path. Only the net series gets it; two filled areas would muddle.
  const area =
    points.length > 1
      ? `${line((point) => point.net)}L${x(points.length - 1)} ${y(0)}L${x(0)} ${y(0)}Z`
      : ''

  const hovered = active === null ? null : points[active]

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
            return (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  x2={width - PAD_RIGHT}
                  y1={at}
                  y2={at}
                  className={tick === 0 ? 'stroke-muted' : 'stroke-line'}
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

          {active !== null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_H}
              className="stroke-line"
              strokeWidth={1}
            />
          )}

          {area && <path d={area} className="fill-income-soft opacity-60" />}

          {hasDebt && (
            <path
              d={line((point) => point.debt)}
              fill="none"
              className="stroke-overspend"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          <path
            d={line((point) => point.net)}
            fill="none"
            className="stroke-income"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {points.map((point, index) => (
            <g key={point.key}>
              {(points.length <= DOTS_UNTIL || index === active) && (
                <circle
                  cx={x(index)}
                  cy={y(point.net)}
                  r={index === active ? 4 : 2.5}
                  className="fill-income"
                />
              )}

              {(index - (points.length - 1)) % labelStep === 0 && (
                <text
                  x={labelX(x(index))}
                  y={PAD_TOP + PLOT_H + 17}
                  textAnchor="middle"
                  className="fill-muted text-[11px]"
                >
                  {withYear
                    ? formatMonthTick(point.year, point.month)
                    : formatMonthShort(point.year, point.month)}
                </text>
              )}

              {/* One hit target per point, spanning the gap either side of it,
                  so a pointer anywhere over the plot picks the nearest. */}
              <rect
                x={x(index) - (step || plotW) / 2}
                y={PAD_TOP}
                width={step || plotW}
                height={PLOT_H}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={`${formatMonth(point.year, point.month)}: ${formatMoney(
                  point.net,
                )}${point.debt > 0 ? `, of which ${formatMoney(point.debt)} owed` : ''}`}
                onPointerEnter={() => setActive(index)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            </g>
          ))}
        </svg>
      )}

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-card"
          style={{
            left: Math.min(Math.max(x(active!), 70), width - 70),
            top: Math.max(y(hovered.net) - 10, PAD_TOP + 40),
          }}
        >
          <div className="font-semibold text-income-strong tabular-nums">
            {formatMoney(hovered.net)}
          </div>
          <div className="text-muted">
            {formatMonth(hovered.year, hovered.month)}
            {hovered.debt > 0 && (
              <> · {formatMoney(hovered.debt)} owed</>
            )}
          </div>
          {hovered.carried > 0 && (
            <div className="text-muted">
              {hovered.carried} carried from earlier
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default NetWorthChart
