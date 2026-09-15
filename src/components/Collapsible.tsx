import type { ReactNode } from 'react'

type Props = {
  /** The name of the block, in the same voice as any other .eyebrow. */
  title: string
  /**
   * What the block says while it is shut — a total, a count. Closed is the
   * default state here, so without this the Month tab would open as three
   * words and nothing else.
   */
  hint?: ReactNode
  children: ReactNode
}

/**
 * A titled block that starts closed.
 *
 * Built on `<details>` rather than a `useState` toggle: the open/closed state,
 * the keyboard handling and the accessible name all come from the element, and
 * — unlike a conditional render — the content is still in the DOM for a
 * browser's find-in-page.
 */
function Collapsible({ title, hint, children }: Props) {
  return (
    <details className="group my-7 border-b border-line pb-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          {/* Rotates rather than swaps glyph, so the state change is a
              movement the eye can follow back to what it opened. */}
          <span
            aria-hidden="true"
            className="text-muted transition-transform duration-200 group-open:rotate-90"
          >
            ›
          </span>
          <span className="eyebrow">{title}</span>
        </span>
        {hint && <span className="text-sm text-muted tabular-nums">{hint}</span>}
      </summary>
      {children}
    </details>
  )
}

export default Collapsible
