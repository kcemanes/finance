import { Component } from 'react'
import type { ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Catches failures from the lazily-loaded AppShell chunk — a missing
 * Supabase config, or the dynamic import itself failing while offline before
 * the chunk is cached — so /login and /app fail with a recoverable message
 * instead of silently unmounting the whole app to a blank page.
 */
class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-ink">Something went wrong loading the app.</p>
        <p className="max-w-sm text-sm text-muted">{error.message}</p>
        <button
          type="button"
          className="btn-primary px-4 py-2"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    )
  }
}

export default RouteErrorBoundary
