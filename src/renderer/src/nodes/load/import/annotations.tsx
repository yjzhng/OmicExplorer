/** The Metadata stage's annotation picker: one category's checkbox and its member list. */
import { type ReactNode, useState } from 'react'
import { createPortal } from 'react-dom'
import { cssVars, PALETTES, UI } from '../../../ui/app/theme'
import { useUiTheme } from '../../../ui/app/useUiTheme'
import { styles } from './styles'
import { type AnnGroup, useFloatingMenu } from './annotationFields'

/** One annotation category: a checkbox that (de)selects every fetchable member at once
 *  (indeterminate when only some are picked) and a caret that opens the member list to pick
 *  individually. Placeholder members are shown disabled. */
export function AnnCategory({
  group,
  picked,
  disabled,
  onChange
}: {
  group: AnnGroup
  picked: Set<string>
  disabled: boolean
  onChange: (next: Set<string>) => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const [open, setOpen] = useState(false)
  const isOpen = open && !disabled
  const { btnRef, menuRef, rect } = useFloatingMenu(isOpen, setOpen)
  const available = group.members.filter((m) => !m.soon)
  const on = available.filter((m) => picked.has(m.id)).length
  const all = available.length > 0 && on === available.length
  const toggleAll = (): void => {
    const next = new Set(picked)
    for (const m of available) {
      if (all) next.delete(m.id)
      else next.add(m.id)
    }
    onChange(next)
  }
  const toggleOne = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <>
      {/* A button-styled chip holding the checkbox (a real <button> can't contain one): the box
          toggles the whole category; the label/caret opens the member list. */}
      <span
        ref={btnRef}
        style={{
          ...styles.annCatBtn,
          borderColor: isOpen ? UI.accent : UI.border,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'default' : 'pointer'
        }}
      >
        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && !all
          }}
          checked={all}
          disabled={disabled}
          onChange={toggleAll}
          title={
            all
              ? `Deselect all ${group.label.toLowerCase()}`
              : `Select all ${group.label.toLowerCase()}`
          }
          style={{ margin: 0, cursor: disabled ? 'default' : 'pointer' }}
        />
        <span
          role="button"
          aria-disabled={disabled}
          aria-expanded={isOpen}
          style={styles.annCatLabel}
          onClick={() => {
            if (!disabled) setOpen((o) => !o)
          }}
          title="Choose which to fetch"
        >
          {group.label}
          {on > 0 && !all && (
            <span style={styles.annCatCount}>
              {on}/{available.length}
            </span>
          )}
          <span style={styles.dropdownCaret}>{isOpen ? '▲' : '▼'}</span>
        </span>
      </span>
      {isOpen &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...cssVars(PALETTES[mode]),
              ...styles.dropdownMenu,
              right: rect.right,
              top: rect.top,
              minWidth: Math.max(rect.width, 160)
            }}
          >
            <div style={styles.dropdownList}>
              {group.members.map((m) => (
                <label
                  key={m.id}
                  style={{ ...styles.dropdownItem, ...(m.soon ? { cursor: 'default' } : null) }}
                  title={m.soon ? 'Not available yet' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={!m.soon && picked.has(m.id)}
                    disabled={!!m.soon}
                    onChange={() => toggleOne(m.id)}
                  />
                  <span style={m.soon ? styles.dropdownItemOff : undefined}>{m.label}</span>
                  {m.soon && <span style={styles.annSoon}>soon</span>}
                </label>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
