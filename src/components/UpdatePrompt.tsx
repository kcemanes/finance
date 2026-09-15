import { useUpdateWaiting } from '../hooks/usePwa'
import { reloadForUpdate } from '../lib/pwa'

/**
 * Offers the new build once one has downloaded.
 *
 * The service worker is registered in `prompt` mode precisely so this is a
 * choice: reloading on its own would be fine for a page you read, and hostile
 * for a form you are halfway through typing into. Nothing is lost by waiting —
 * the current build keeps working, and the next launch picks the update up
 * anyway.
 */
function UpdatePrompt() {
  const waiting = useUpdateWaiting()
  if (!waiting) return null

  return (
    <div
      role="status"
      className="update-banner fixed inset-x-0 z-50 flex items-center justify-center gap-3 border-t border-line bg-surface px-4 py-3 text-sm text-ink shadow-card"
    >
      <span>A new version is ready.</span>
      <button type="button" className="btn-primary" onClick={reloadForUpdate}>
        Reload
      </button>
    </div>
  )
}

export default UpdatePrompt
