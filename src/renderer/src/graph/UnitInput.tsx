/**
 * A numeric condition's unit as a text box: any text is a unit (nM, mg/mL, MIC, %, h…), with the
 * common ones in a dropdown in the app's own look (the Select's menu), narrowed to what's typed;
 * and — when what was typed has a standard SI spelling ("uM", "hrs") — a prompt offering it.
 * Committed on Enter, on picking a suggestion, or on leaving the box; an empty box clears it.
 * Used by the interactive import's Set unit rows and the Load tile's Condition units.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { SelectItem } from '../ui/Select'
import { PALETTES, UI } from '../ui/theme'
import { POPOVER_PROPS } from '../ui/usePopover'
import { useUiTheme } from '../ui/useUiTheme'
import { siUnit } from './siUnit'

export function UnitInput({
  value,
  onChange,
  suggestions,
  placeholder = 'type a unit',
  disabled,
  style
}: {
  value: string | undefined
  onChange: (unit: string | undefined) => void
  /** the common units, offered in the dropdown */
  suggestions: readonly string[]
  placeholder?: string
  disabled?: boolean
  /** the box's own look (the caller's input style) */
  style?: CSSProperties
}): ReactNode {
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const commit = (raw: string): void => {
    setDraft(null)
    setRect(null)
    const v = raw.trim() || undefined
    if (v !== value) onChange(v)
  }
  // the suggestions narrowed to what's typed (all of them until something new is)
  const typed = draft?.trim().toLowerCase() ?? ''
  const shown = typed ? suggestions.filter((u) => u.toLowerCase().includes(typed)) : suggestions
  const si = draft == null && value ? siUnit(value) : null
  return (
    <span style={styles.wrap}>
      <input
        ref={ref}
        type="text"
        aria-label="unit"
        aria-autocomplete="list"
        style={{ ...styles.input, ...style }}
        value={draft ?? value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => setRect(e.currentTarget.getBoundingClientRect())}
        onChange={(e) => {
          setDraft(e.target.value)
          setRect(e.currentTarget.getBoundingClientRect())
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          else if (e.key === 'Escape') {
            setDraft(null)
            setRect(null)
            e.currentTarget.blur()
          }
        }}
      />
      {si && !disabled && (
        <span style={styles.si}>
          SI: <b>{si}</b>
          <button type="button" style={styles.use} onClick={() => onChange(si)}>
            use
          </button>
        </span>
      )}
      {rect &&
        shown.length > 0 &&
        createPortal(
          <div
            {...POPOVER_PROPS}
            // keep the box focused while a suggestion is clicked
            onMouseDown={(e) => e.preventDefault()}
            style={{
              ...styles.menu,
              left: rect.left,
              top: rect.bottom + 4,
              minWidth: rect.width,
              background: p.panelAlt,
              border: `1px solid ${p.border}`
            }}
          >
            {shown.map((u) => (
              <SelectItem
                key={u}
                label={u}
                selected={u === value}
                z={1}
                colors={{ text: p.text, hover: p.panel, accent: p.accent, muted: p.textMuted }}
                onClick={() => {
                  // committed by the blur, as the box now reads it (committing here too would
                  // have the blur commit the half-typed text over it)
                  const box = ref.current
                  if (!box) return commit(u)
                  box.value = u
                  box.blur()
                }}
              />
            ))}
          </div>,
          document.body
        )}
    </span>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 },
  input: {
    fontSize: 12,
    padding: '4px 7px',
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    background: UI.panelAlt,
    color: UI.text,
    width: 90,
    boxSizing: 'border-box'
  },
  menu: {
    position: 'fixed',
    zIndex: 4100,
    borderRadius: 6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
    padding: 4,
    maxHeight: 340,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column'
  },
  si: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: UI.textMuted },
  use: {
    fontSize: 11,
    padding: '0 6px',
    border: `1px solid ${UI.accent}`,
    borderRadius: 9,
    background: 'transparent',
    color: UI.accent,
    cursor: 'pointer'
  }
}
