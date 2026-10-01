/**
 * The app's colour picker: the caller's own preview is the trigger; click it and a spectrum grid
 * opens (portalled). Used by the plot settings (a legend group's colours) and the gene selector (a
 * geneset's colour), so a colour is picked the same way everywhere.
 *
 * Self-contained — no canvas context — so it works outside the workflow canvas too. A caller on the
 * canvas passes its `zoom`, to draw the grid at the tile's scale, and a `closeKey` that changes
 * when the canvas pans or zooms (a fixed overlay can't follow it, so it closes instead).
 */
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { PALETTES } from './theme'
import { POPOVER_PROPS, usePopover } from './usePopover'
import { useUiTheme } from './useUiTheme'

/** A cleared colour: drawn as nothing. The grid's clear chip sets it, and marks itself on it. */
export const CLEAR = 'transparent'

/** The picker's palette: a spectrum grid (hue across, light → dark down) over a greyscale row,
 *  like the swatch grid iPadOS shows. Generated rather than hand-listed so the steps stay even. */
const HUES = [0, 20, 40, 60, 90, 140, 175, 200, 220, 260, 290, 320]
// Muted: plot colours sit behind data, and a fully saturated grid pushes every pick toward neon.
const LEVELS: { s: number; l: number }[] = [
  { s: 45, l: 86 },
  { s: 45, l: 74 },
  { s: 45, l: 62 },
  { s: 45, l: 50 },
  { s: 42, l: 40 },
  { s: 38, l: 30 },
  { s: 32, l: 22 }
]
const GREYS = [
  '#ffffff',
  '#e6e6e6',
  '#cccccc',
  '#b3b3b3',
  '#999999',
  '#808080',
  '#666666',
  '#4d4d4d',
  '#333333',
  '#1a1a1a',
  '#000000'
]

/** `hsl(…)` → `#rrggbb`, so a picked colour is stored in the one notation the plots compare on. */
function hslHex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number): string => {
    const k = (n + h / 30) % 12
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function ColorPicker({
  value,
  onPick,
  onClear,
  clearLabel = 'Default',
  label,
  title,
  triggerStyle,
  zoom = 1,
  closeKey,
  children
}: {
  /** the current colour, for marking the grid's matching chip (CLEAR marks the clear chip) */
  value: string
  onPick: (color: string) => void
  /** when given, the grid offers a chip that unsets the colour */
  onClear?: () => void
  clearLabel?: string
  label: string
  title?: string
  triggerStyle: CSSProperties
  /** scale the grid is drawn at (the canvas zoom, for a picker on a tile); 1 elsewhere */
  zoom?: number
  /** any change closes an open grid (the canvas transform, on the canvas) */
  closeKey?: string
  children: ReactNode
}): ReactNode {
  const z = zoom
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const { open, setOpen, toggle, rect, btnRef, menuRef } = usePopover(closeKey)

  const norm = value.trim().toLowerCase()
  // "Cleared" is a value like any other — mark its chip so the grid always shows what's in force.
  const cleared = norm === CLEAR
  const chip = (color: string, key: string): ReactNode => {
    const on = color.toLowerCase() === norm
    return (
      <button
        key={key}
        onClick={() => {
          onPick(color)
          setOpen(false)
        }}
        aria-label={color}
        title={color}
        style={{
          width: 16 * z,
          height: 16 * z,
          borderRadius: 3 * z,
          background: color,
          border: on ? `2px solid ${p.text}` : `1px solid rgba(128,128,128,0.35)`,
          boxSizing: 'border-box',
          padding: 0,
          cursor: 'pointer'
        }}
      />
    )
  }
  const grid: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${HUES.length}, ${16 * z}px)`,
    gap: 3 * z
  }
  return (
    <>
      <button ref={btnRef} onClick={toggle} aria-label={label} title={title} style={triggerStyle}>
        {children}
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            {...POPOVER_PROPS}
            style={{
              position: 'fixed',
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 8 - 232 * z)),
              top: rect.bottom + 4 * z,
              // Above any popover it opens from (the gene selector sits at 4000).
              zIndex: 4100,
              background: p.panelAlt,
              border: `1px solid ${p.border}`,
              borderRadius: 8 * z,
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              padding: 6 * z,
              display: 'flex',
              flexDirection: 'column',
              gap: 4 * z
            }}
          >
            <div style={grid}>
              {LEVELS.map((lv, r) => HUES.map((h) => chip(hslHex(h, lv.s, lv.l), `${r}-${h}`)))}
            </div>
            <div style={grid}>
              {GREYS.map((g) => chip(g, g))}
              {onClear && (
                <button
                  onClick={() => {
                    onClear()
                    setOpen(false)
                  }}
                  aria-label={clearLabel}
                  title={clearLabel}
                  aria-pressed={cleared}
                  style={{
                    width: 16 * z,
                    height: 16 * z,
                    borderRadius: 3 * z,
                    padding: 0,
                    cursor: 'pointer',
                    border: cleared ? `2px solid ${p.text}` : `1px solid ${p.border}`,
                    boxSizing: 'border-box',
                    // A diagonal slash — the "no colour of its own" convention.
                    background: `linear-gradient(to bottom right, transparent 44%, ${p.err} 44%, ${p.err} 56%, transparent 56%)`
                  }}
                />
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
