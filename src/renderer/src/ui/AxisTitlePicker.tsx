/**
 * A pick-list on a plot's own axis titles: each title (x, y) is made clickable where Plotly drew it,
 * with a small chevron beside it, and opens a list of what that axis can show. Plotly still draws the
 * titles — the overlay only sits on top — so copies and exports keep plain axis titles.
 *
 * One title's button, chevron and list; useAxisTitlePickers places them.
 */
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Chevron } from './Chevron'
import { GENE_LIST_STYLES } from './geneListStyles'
import { groupHeading, markedTint } from './groupHeading'
import { placeMenu } from './placeMenu'
import { PALETTES } from './theme'
import { useUiTheme } from './useUiTheme'

export type Axis = 'x' | 'y'
export type Box = { left: number; top: number; width: number; height: number }

export interface AxisPick<V extends string> {
  value: V
  /** each option's `group` (if any) is drawn as a heading wherever it changes */
  /** a `marked` option is tinted, the text its tooltip (e.g. the other axis's pick) */
  options: readonly { value: V; label: string; group?: string; marked?: string }[]
  onChange: (v: V) => void
}

/** One axis title's clickable overlay, its chevron and its list. */
export function TitleButton<V extends string>({
  axis,
  box,
  pick
}: {
  axis: Axis
  box: Box
  pick: AxisPick<V>
}): ReactNode {
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const pad = 3
  const L = GENE_LIST_STYLES
  const place = rect ? placeMenu(rect, MENU_W, MENU_H) : null
  // The chevron: after the x title's end; above the (rotated, bottom-to-top) y title's end — turned
  // with that title, so it points "down" along the text either way (up once open), as a pager's.
  const half = CHEVRON / 2
  const caret =
    axis === 'x'
      ? { left: box.left + box.width + 3, top: box.top + box.height / 2 - half }
      : { left: box.left + box.width / 2 - half, top: box.top - CHEVRON - 3 }
  const deg = (open ? -90 : 90) - (axis === 'y' ? 90 : 0)
  // The button: the title and its chevron, padded.
  const ext = CHEVRON + 3
  const hit =
    axis === 'x'
      ? {
          left: box.left - pad,
          top: box.top - pad,
          width: box.width + ext + 2 * pad,
          height: box.height + 2 * pad
        }
      : {
          left: box.left - pad,
          top: box.top - ext - pad,
          width: box.width + 2 * pad,
          height: box.height + ext + 2 * pad
        }
  return (
    <>
      <button
        ref={btnRef}
        title={`Change the ${axis} axis`}
        aria-label={`Change the ${axis} axis`}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
          setOpen((o) => !o)
        }}
        style={{
          position: 'absolute',
          ...hit,
          padding: 0,
          border: `1px solid ${hover || open ? p.border : 'transparent'}`,
          borderRadius: 4,
          background: hover || open ? `${p.accent}14` : 'transparent',
          cursor: 'pointer',
          zIndex: 2
        }}
      />
      <span
        aria-hidden
        style={{
          position: 'absolute',
          ...caret,
          display: 'flex',
          pointerEvents: 'none',
          zIndex: 2
        }}
      >
        <Chevron deg={deg} size={CHEVRON} color={hover || open ? p.text : p.textMuted} />
      </span>
      {open &&
        place &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...L.menu,
              ...place,
              width: MENU_W,
              zIndex: 5000,
              gap: 0,
              background: p.panel,
              border: `1px solid ${p.border}`
            }}
          >
            {pick.options.map((o, i) => {
              const on = o.value === pick.value
              const heading = o.group && o.group !== pick.options[i - 1]?.group
              return (
                <Fragment key={o.value}>
                  {heading && <div style={groupHeading(1, p.textMuted, i > 0)}>{o.group}</div>}
                  <div
                    role="button"
                    title={o.marked}
                    onClick={() => {
                      pick.onChange(o.value)
                      setOpen(false)
                    }}
                    style={{
                      ...L.geneRow,
                      // Set in under a group heading.
                      paddingLeft: o.group ? 18 : 6,
                      color: p.text,
                      fontWeight: on ? 700 : undefined,
                      ...(on
                        ? { background: `${p.accent}22` }
                        : o.marked
                          ? { background: markedTint(p.textMuted) }
                          : null)
                    }}
                  >
                    {o.label}
                  </div>
                </Fragment>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}

/** The chevron's size (px). */
const CHEVRON = 11

/** The list's width and tallest height. */
const MENU_W = 180
const MENU_H = 360
