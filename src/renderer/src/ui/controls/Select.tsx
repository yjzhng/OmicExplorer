/**
 * The app's dropdown: a themed replacement for the native <select> — same {value, options,
 * onChange} API, rendered as a styled trigger plus a <body>-portal menu in the panel palette. Used
 * by every config select, and anywhere else a choice is made from a list (the gene selector's
 * Group by), so none fall back to the OS popup.
 *
 * Self-contained (see usePopover). On the canvas, the caller passes its `zoom` so the menu matches
 * the tile's scale, and a `closeKey` that changes when the canvas moves.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { groupHeading, markedTint } from './groupHeading'
import { Chevron } from './Chevron'
import { PALETTES, UI } from '../app/theme'
import { POPOVER_PROPS, usePopover } from './usePopover'
import { useUiTheme } from '../app/useUiTheme'
import { VirtualList } from '../table/VirtualRows'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** drawn instead of the label text (e.g. a line swatch); the label stays the accessible name */
  render?: ReactNode
  /** a heading the option sits under: one is drawn wherever it changes from the option before */
  group?: string
  /** highlighted with a soft neutral tint (e.g. what another control has picked); the text is its
   *  tooltip */
  marked?: string
}

export function Select({
  value,
  options,
  onChange,
  placeholder = '— select —',
  disabled,
  zoom = 1,
  closeKey
}: {
  value: string
  options: SelectOption[]
  onChange: (v: string) => void
  placeholder?: string
  /** greyed and unopenable — the whole select is inert, not just some of its options */
  disabled?: boolean
  /** scale the menu is drawn at (the canvas zoom, for a select on a tile); 1 elsewhere */
  zoom?: number
  /** any change closes an open menu (the canvas transform, on the canvas) */
  closeKey?: string
}): ReactNode {
  const z = zoom
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const { open, setOpen, toggle, rect, btnRef, menuRef } = usePopover(closeKey)
  const current = options.find((o) => o.value === value)
  // The menu's rows: each option, after a heading where its group starts.
  const rows = useMemo(() => {
    const out: { head?: string; i: number }[] = []
    options.forEach((o, i) => {
      if (o.group && o.group !== options[i - 1]?.group) out.push({ head: o.group, i })
      out.push({ i })
    })
    return out
  }, [options])
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <button
        ref={btnRef}
        onClick={toggle}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          background: UI.panelAlt,
          border: `1px solid ${UI.border}`,
          borderRadius: 4,
          padding: '4px 7px',
          fontSize: 12,
          boxSizing: 'border-box',
          textAlign: 'left',
          cursor: 'pointer',
          color: current ? UI.text : UI.textMuted,
          ...(disabled ? { opacity: 0.5, cursor: 'default' } : null)
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={current?.label}
          aria-label={current?.render ? current.label : undefined}
        >
          {current?.render ?? current?.label ?? placeholder}
        </span>
        <Chevron color="currentColor" size={11} deg={open ? -90 : 90} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            {...POPOVER_PROPS}
            style={{
              position: 'fixed',
              left: rect.left,
              top: rect.bottom + 4 * z,
              minWidth: rect.width,
              // Above any popover it opens from (the gene selector sits at 4000).
              zIndex: 4100,
              background: p.panelAlt,
              border: `1px solid ${p.border}`,
              borderRadius: 6 * z,
              boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
              padding: 4 * z,
              maxHeight: 340 * z,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Windowed (ui/table/VirtualRows) — a file list or a condition's values can run long. A
                group heading is a row of its own. */}
            <VirtualList
              count={rows.length}
              style={{ display: 'flex', flexDirection: 'column' }}
              row={(k) => {
                const r = rows[k]
                if (r.head != null)
                  return (
                    <div key={`\u0000${r.head}`} style={groupHeading(z, p.textMuted, k > 0)}>
                      {r.head}
                    </div>
                  )
                const o = options[r.i]
                return (
                  <SelectItem
                    key={o.value}
                    label={o.label}
                    render={o.render}
                    selected={o.value === value}
                    indent={!!o.group}
                    marked={o.marked}
                    disabled={o.disabled}
                    z={z}
                    colors={{ text: p.text, hover: p.panel, accent: p.accent, muted: p.textMuted }}
                    onClick={() => {
                      if (o.disabled) return
                      onChange(o.value)
                      setOpen(false)
                    }}
                  />
                )
              }}
            />
          </div>,
          document.body
        )}
    </div>
  )
}

/** One row in the dropdown; own hover state, metrics pre-scaled by the caller. Shared with other
 *  menus drawn in the Select's look (the unit box's suggestions). */
export function SelectItem({
  label,
  render,
  selected,
  indent,
  marked,
  disabled,
  z,
  colors,
  onClick
}: {
  label: string
  render?: ReactNode
  selected: boolean
  /** under a group heading: set in from it */
  indent?: boolean
  marked?: string
  disabled?: boolean
  z: number
  colors: { text: string; hover: string; accent: string; muted: string }
  onClick: () => void
}): ReactNode {
  const [hover, setHover] = useState(false)
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      disabled={disabled}
      title={marked}
      style={{
        opacity: disabled ? 0.4 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 6 * z,
        width: '100%',
        border: 'none',
        borderRadius: 4 * z,
        padding: `${5 * z}px ${8 * z}px ${5 * z}px ${(indent ? 18 : 8) * z}px`,
        fontSize: 12 * z,
        fontWeight: selected ? 600 : 400,
        color: selected ? colors.accent : colors.text,
        background: selected
          ? `${colors.accent}22`
          : hover
            ? colors.hover
            : marked
              ? markedTint(colors.muted)
              : 'transparent',
        cursor: 'pointer',
        textAlign: 'left',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ flex: `0 0 ${12 * z}px`, color: colors.accent }}>{selected ? '✓' : ''}</span>
      <span aria-label={render ? label : undefined}>{render ?? label}</span>
    </button>
  )
}
