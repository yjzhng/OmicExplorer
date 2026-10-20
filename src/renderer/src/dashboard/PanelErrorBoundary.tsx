/**
 * Keeps one failing tile from taking down the Results page.
 *
 * A plot that throws while rendering (Plotly's "Something went wrong with axis scaling" from a
 * degenerate axis, say) otherwise unmounts the whole React tree: the page goes blank, the stack
 * trace names only Plotly internals, and reopening the project lands on the same tab and does it
 * again. Here the failing tile renders in place, naming itself and its error, and every other tile
 * still draws.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { UI } from '../ui/theme'

export class PanelErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack names the view (FcHeatmapView, BubbleView, …); the message alone is
    // usually a library internal.
    console.error(`[panel ${this.props.label}]`, error, info.componentStack)
  }

  /** A different plot in this tile gets a fresh attempt rather than staying failed. */
  componentDidUpdate(prev: { label: string }): void {
    if (prev.label !== this.props.label && this.state.error) this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          padding: 12,
          textAlign: 'center',
          fontSize: 12,
          color: UI.textMuted
        }}
      >
        <span style={{ color: UI.text }}>This plot couldn’t be drawn.</span>
        <span style={{ fontSize: 11 }}>{this.props.label}</span>
        <span style={{ fontSize: 11, opacity: 0.85, wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </span>
      </div>
    )
  }
}
