/**
 * Keeps a render error contained and traced.
 *
 * Without a boundary, a component that throws while rendering unmounts the whole React tree: the
 * window goes blank and the stack names only library internals. A boundary renders a fallback in
 * place of the part that failed — a tile, a settings panel, or (outermost) the whole app — and
 * reports the error with the component stack to the log (shared/diagnostics.ts).
 *
 *  - `variant="tile"`: a centred note naming the part and its error (a plot tile, a panel);
 *  - `variant="app"`: the last resort around the app, with Reload and Copy diagnostics.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { UI } from '../ui/theme'
import { diagnosticsText, reportError } from './diagnostics'

interface Props {
  /** what failed, as the fallback names it ("Volcano", "Settings") */
  label: string
  /** the area, for the log ('render' unless said otherwise) */
  where?: string
  /** the node it renders, for the log */
  nodeId?: string
  kind?: string
  /** the tile fallback's first line (default: "This plot couldn’t be drawn.") */
  title?: string
  variant?: 'tile' | 'app'
  /** a tile's inputs (its results, its condition): a change gives a failed tile a fresh attempt */
  resetKey?: unknown
  children: ReactNode
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack names the view (FcHeatmapView, BubbleView, …); the message alone is
    // usually a library internal.
    reportError(
      error,
      {
        where: this.props.where ?? 'render',
        nodeId: this.props.nodeId,
        kind: this.props.kind,
        detail: this.props.label
      },
      { componentStack: info.componentStack ?? undefined }
    )
  }

  /** A different part in this place, or new inputs for it, gets a fresh attempt rather than
   *  staying failed. */
  componentDidUpdate(prev: Props): void {
    if (
      this.state.error &&
      (prev.label !== this.props.label ||
        prev.nodeId !== this.props.nodeId ||
        prev.resetKey !== this.props.resetKey)
    )
      this.setState({ error: null })
    this.watchSize()
  }

  componentDidMount(): void {
    this.watchSize()
  }

  componentWillUnmount(): void {
    this.sizeWatch?.disconnect()
  }

  // A failed tile tries again once it's resized: a plot can fail at one size only (Plotly throws
  // when the box leaves it no room), and without this one bad moment mid-drag left the tile failed
  // at any size until it was rebuilt. Watched only while failed.
  private fallback: HTMLDivElement | null = null
  private sizeWatch: ResizeObserver | null = null
  private watchSize(): void {
    const el = this.state.error && this.props.variant !== 'app' ? this.fallback : null
    if (!el || typeof ResizeObserver === 'undefined') {
      this.sizeWatch?.disconnect()
      this.sizeWatch = null
      return
    }
    if (this.sizeWatch) return
    let first: string | null = null
    this.sizeWatch = new ResizeObserver(() => {
      const size = `${el.clientWidth}x${el.clientHeight}`
      // (the first report is the size it failed at)
      if (first === null) first = size
      else if (size !== first) this.setState({ error: null })
    })
    this.sizeWatch.observe(el)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.variant === 'app') return <AppFallback error={error} />
    return (
      <div
        ref={(n) => {
          this.fallback = n
        }}
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
        <span style={{ color: UI.text }}>{this.props.title ?? 'This plot couldn’t be drawn.'}</span>
        <span style={{ fontSize: 11 }}>{this.props.label}</span>
        <span style={{ fontSize: 11, opacity: 0.85, wordBreak: 'break-word' }}>
          {error.message || String(error)}
        </span>
      </div>
    )
  }
}

/** The whole window failed to render: say so, and offer a reload and the diagnostics. */
function AppFallback({ error }: { error: Error }): ReactNode {
  const copy = async (): Promise<void> => {
    const tail = (await window.api?.logTail?.(100).catch(() => '')) ?? ''
    const text =
      diagnosticsText({ name: __APP_NAME__, version: __APP_VERSION__ }) +
      (tail ? `\n\nlog:\n${tail}` : '')
    await navigator.clipboard.writeText(text).catch(() => undefined)
  }
  const button = {
    padding: '6px 14px',
    borderRadius: 6,
    border: `1px solid ${UI.border}`,
    background: UI.panel,
    color: UI.text,
    cursor: 'pointer'
  }
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 24,
        textAlign: 'center',
        background: UI.bg,
        color: UI.textMuted,
        fontSize: 13
      }}
    >
      <span style={{ color: UI.text, fontSize: 15 }}>Something went wrong.</span>
      <span style={{ maxWidth: 560, wordBreak: 'break-word' }}>
        {error.message || String(error)}
      </span>
      <span style={{ fontSize: 12 }}>
        The error was written to the log (Help › Show Log File). Reloading keeps the last saved
        project.
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={button} onClick={() => location.reload()}>
          Reload
        </button>
        <button style={button} onClick={() => void copy()}>
          Copy diagnostics
        </button>
      </div>
    </div>
  )
}
