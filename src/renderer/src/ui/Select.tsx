/**
 * The app's dropdown: a themed replacement for the native <select> — same {value, options,
 * onChange} API, rendered as a styled trigger plus a <body>-portal menu in the panel palette. Used
 * by every config select, and anywhere else a choice is made from a list (the gene selector's
 * Group by), so none fall back to the OS popup.
 *
 * Self-contained (see usePopover). On the canvas, the caller passes its `zoom` so the menu matches
 * the tile's scale, and a `closeKey` that changes when the canvas moves.
 */
import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { PALETTES, UI } from './theme'
import { POPOVER_PROPS, usePopover } from './usePopover'
import { useUiTheme } from './useUiTheme'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** drawn instead of the label text (e.g. a line swatch); the label stays the accessible name */
  render?: ReactNode
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
        <Chevron size={11} deg={open ? -90 : 90} />
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
            {options.map((o) => (
              <SelectItem
                key={o.value}
                label={o.label}
                render={o.render}
                selected={o.value === value}
                disabled={o.disabled}
                z={z}
                colors={{ text: p.text, hover: p.panel, accent: p.accent }}
                onClick={() => {
                  if (o.disabled) return
                  onChange(o.value)
                  setOpen(false)
                }}
              />
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

/** One row in the dropdown; own hover state, metrics pre-scaled by the caller. */
function SelectItem({
  label,
  render,
  selected,
  disabled,
  z,
  colors,
  onClick
}: {
  label: string
  render?: ReactNode
  selected: boolean
  disabled?: boolean
  z: number
  colors: { text: string; hover: string; accent: string }
  onClick: () => void
}): ReactNode {
  const [hover, setHover] = useState(false)
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      disabled={disabled}
      style={{
        opacity: disabled ? 0.4 : 1,
        display: 'flex',
        alignItems: 'center',
        gap: 6 * z,
        width: '100%',
        border: 'none',
        borderRadius: 4 * z,
        padding: `${5 * z}px ${8 * z}px`,
        fontSize: 12 * z,
        fontWeight: selected ? 600 : 400,
        color: selected ? colors.accent : colors.text,
        background: selected ? `${colors.accent}22` : hover ? colors.hover : 'transparent',
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

/** The trigger's open-chevron (SVG): 90 = points down (closed), -90 = up (open). */
function Chevron({ size, deg }: { size: number; deg: number }): ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      style={{ flex: '0 0 auto', transform: `rotate(${deg}deg)`, transition: 'transform 0.12s' }}
    >
      <polyline
        points="3.5,1.5 7,5 3.5,8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
