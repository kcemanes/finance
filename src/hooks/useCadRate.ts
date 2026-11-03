import { useEffect, useState } from 'react'
import { fetchCadToPhp, isFresh, storedRate } from '../lib/fx'
import type { FxRate } from '../lib/fx'

/**
 * Today's CAD → PHP rate, for a form that is taking a figure in CAD.
 *
 * Starts on the cached rate, so an offline entry still converts, and only goes
 * to the network once `enabled` — a visit that never types CAD never calls a
 * third party. A failed refresh keeps the cached rate; coming back online
 * tries again.
 */
export function useCadRate(enabled: boolean) {
  const [rate, setRate] = useState<FxRate | null>(storedRate)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let live = true

    const refresh = () => {
      if (isFresh(storedRate())) return
      fetchCadToPhp().then(
        (fetched) => {
          if (!live) return
          setRate(fetched)
          setFailed(false)
        },
        () => {
          if (live) setFailed(true)
        },
      )
    }

    refresh()
    window.addEventListener('online', refresh)
    return () => {
      live = false
      window.removeEventListener('online', refresh)
    }
  }, [enabled])

  return {
    rate,
    /** No rate to convert with, and none on the way. */
    unavailable: rate === null && failed,
  }
}
