// Three 24px-grid glyphs, stroked in currentColor so each one takes the
// colour of the button it sits in — muted when the view is not the current
// one, accent when it is. Sized in the markup rather than here, because the
// bar shows them and the desktop pills do not.
function MonthIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.2" y="5" width="17.6" height="16" rx="2.4" />
      <path d="M3.2 9.8h17.6M8.2 3v4M15.8 3v4" />
    </svg>
  )
}

function TrendsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 19.5V4.5" />
      <path d="M3.5 19.5h17" />
      <path d="m7 15.2 3.8-4.4 3.1 2.5 4.6-5.6" />
    </svg>
  )
}

// A stack of coins seen from slightly above: the one shape that reads as an
// amount held rather than an amount moved, which is the whole distinction
// between this view and the two before it.
function WorthIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <ellipse cx="12" cy="6.4" rx="7.2" ry="3.1" />
      <path d="M4.8 6.4v5c0 1.7 3.2 3.1 7.2 3.1s7.2-1.4 7.2-3.1v-5" />
      <path d="M4.8 11.4v5c0 1.7 3.2 3.1 7.2 3.1s7.2-1.4 7.2-3.1v-5" />
    </svg>
  )
}

// Flows first, then the stock they move: the month you are working in, the
// trend across several of them, and the balance sheet all of it adds up to.
// The order is also the left-to-right order of the bar, so it doubles as the
// reading order on a phone.
const TABS = [
  { id: 'month', label: 'Month', Icon: MonthIcon },
  { id: 'charts', label: 'Trends', Icon: TrendsIcon },
  { id: 'worth', label: 'Net Worth', Icon: WorthIcon },
] as const

export type TabId = (typeof TABS)[number]['id']

/**
 * The view switcher, in both of its shapes.
 *
 * Above `sm` it is the row of pills it has always been, under the header.
 * Below `sm` the same three buttons become a bar pinned to the bottom edge,
 * where they are in thumb reach and cannot scroll away — the ledger and the
 * charts both run well past a viewport, so a switcher at the top means
 * flicking back up every time you want another view. The two shapes are one
 * element and one list; only the styling forks, so the tabs cannot get out of
 * step with each other. See `.tabbar` in index.css.
 *
 * The icons only show in the bar. In a pill next to a word they would be
 * decoration, and on desktop there is no thumb to aim with.
 */
function ViewTabs({
  tab,
  onSelect,
}: {
  tab: TabId
  onSelect: (id: TabId) => void
}) {
  return (
    <nav className="tabbar" aria-label="Views">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="btn-toggle tabbar-item"
          aria-pressed={tab === id}
          aria-controls="view"
          onClick={() => onSelect(id)}
        >
          <span className="hidden max-sm:block">
            <Icon />
          </span>
          {label}
        </button>
      ))}
    </nav>
  )
}

export default ViewTabs
