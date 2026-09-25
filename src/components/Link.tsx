import {
  useCallback,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'
import { navigate } from '../lib/router'

function isModifiedClick(event: MouseEvent) {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey
  )
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }

/** An `<a>` that navigates in-page, and still works as a real link — new
 * tab, copy address, open-in-new-window — for anything that asks for one. */
function Link({ href, onClick, target, ...rest }: LinkProps) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event)
      if (target && target !== '_self') return
      if (isModifiedClick(event)) return
      event.preventDefault()
      navigate(href)
    },
    [href, onClick, target],
  )

  return <a href={href} target={target} onClick={handleClick} {...rest} />
}

export default Link
