/** An (i) mark that shows a short explanation on hover (or keyboard focus) — for instructions that
 *  would otherwise sit as a paragraph above a control. The tip is portalled and fixed, so a dialog's
 *  clipping can't cut it off, and kept inside the window. Styled as StatusNote's blue info. */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { StatusIcon } from './StatusNote'
import { cssVars, PALETTES, UI } from './theme'
import { useUiTheme } from './useUiTheme'

const TIP_W = 320

export function InfoTip({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <HoverTip tip={children} focusable label={label} style={styles.mark}>
      <StatusIcon kind="info" />
    </HoverTip>
  )
}

/** The same tip box on hover over any content (in place of a native `title`, which can't be
 *  styled) — e.g. a control whose purpose wants a sentence. */
export function HoverTip({
  tip,
  children,
  label,
  focusable = false,
  above = false,
  style
}: {
  tip: ReactNode
  children: ReactNode
  /** accessible name, for a mark with no text of its own (InfoTip's) */
  label?: string
  /** reachable by Tab (for a mark that isn't a control itself) */
  focusable?: boolean
  /** open above the content (for content near the window's bottom, e.g. a dialog footer) */
  above?: boolean
  style?: CSSProperties
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const ref = useRef<HTMLSpanElement>(null)
  const [at, setAt] = useState<{ left: number; top?: number; bottom?: number } | null>(null)
  const show = (): void => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    // Below (or above) the content, left-aligned to it, nudged in from the window's right edge.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - TIP_W))
    setAt(above ? { left, bottom: window.innerHeight - r.top + 6 } : { left, top: r.bottom + 6 })
  }
  const hide = (): void => setAt(null)
  return (
    <>
      <span
        ref={ref}
        {...(focusable ? { tabIndex: 0, role: 'img', 'aria-label': label } : null)}
        onMouseEnter={show}
        onMouseLeave={hide}
        // Capture phase: hides even when the content stops the click (a chip opening its menu),
        // so the tip never covers what the click opened.
        onMouseDownCapture={hide}
        onFocus={show}
        onBlur={hide}
        style={{ display: 'inline-flex', ...style }}
      >
        {children}
      </span>
      {at &&
        createPortal(
          <div role="tooltip" style={{ ...cssVars(PALETTES[mode]), ...styles.tip, ...at }}>
            {tip}
          </div>,
          document.body
        )}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  mark: {
    display: 'inline-flex',
    alignItems: 'center',
    color: UI.info,
    cursor: 'help',
    outline: 'none'
  },
  tip: {
    position: 'fixed',
    zIndex: 10000,
    width: TIP_W,
    maxWidth: 'calc(100vw - 16px)',
    boxSizing: 'border-box',
    padding: '7px 10px',
    borderRadius: 5,
    border: `1px solid ${UI.border}`,
    background: UI.panelRaised,
    color: UI.text,
    fontSize: 11.5,
    lineHeight: 1.45,
    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
    pointerEvents: 'none'
  }
}
