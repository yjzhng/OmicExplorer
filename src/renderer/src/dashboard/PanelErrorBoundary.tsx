/**
 * Keeps one failing tile from taking down the Results page.
 *
 * A plot that throws while rendering (Plotly's "Something went wrong with axis scaling" from a
 * degenerate axis, say) otherwise unmounts the whole React tree: the page goes blank, the stack
 * trace names only Plotly internals, and reopening the project lands on the same tab and does it
 * again. Here the failing tile renders in place, naming itself and its error, and every other tile
 * still draws. The error goes to the log with its component stack (shared/ErrorBoundary.tsx).
 */
import type { ReactNode } from 'react'

import { ErrorBoundary } from '../shared/ErrorBoundary'

export function PanelErrorBoundary({
  label,
  nodeId,
  kind,
  resetKey,
  children
}: {
  label: string
  nodeId?: string
  kind?: string
  /** the tile's inputs: when they change, a failed tile tries again (as it does when resized) */
  resetKey?: unknown
  children: ReactNode
}): ReactNode {
  return (
    <ErrorBoundary
      label={label}
      nodeId={nodeId}
      kind={kind}
      where="render-tile"
      resetKey={resetKey}
    >
      {children}
    </ErrorBoundary>
  )
}
