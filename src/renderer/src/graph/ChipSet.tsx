/**
 * A condition's value chips in the selector dialogs (Compare / Contrast / Curve fit): one chip per
 * value while there are few; past `CHIP_CAP`, one button summing up the picks that opens a
 * searchable, multi-selectable list — so a condition with dozens of levels (compounds, cell lines,
 * a custom axis) doesn't flood the dialog. The list shows each value as its chip would look (picked,
 * included, partly paired, greyed), so nothing the chips said is lost.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Chevron } from '../ui/Chevron'
import { IconSearch } from '../ui/GeneSelectMenu'
import { GENE_LIST_STYLES } from '../ui/geneListStyles'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { placeMenu } from '../ui/placeMenu'
import { useUiTheme } from '../ui/useUiTheme'
import { selectorStyles as S } from './selectorParts'

/** The most value chips a condition shows in a selector dialog; beyond it, the searchable picker.
 *  Higher than a tile's pill switch (PILL_CAP): the dialog has the room, and seeing every value at
 *  once is what defining the two sides needs. */
export const CHIP_CAP = 10

export interface ChipItem {
  value: string
  /** picked / included */
  on: boolean
  /** can't be toggled (greyed): `title` says why */
  disabled?: boolean
  title?: string
  /** the chip's look over the base chip; default: the accent fill when `on` */
  look?: CSSProperties | null
}

export function ChipSet({
  items,
  onToggle,
  label,
  single,
  cap = CHIP_CAP
}: {
  items: ChipItem[]
  /** toggle a value; absent: read-only chips (shown, not pickable) */
  onToggle?: (value: string) => void
  /** what the values are (the condition), for the dropdown's search and summary */
  label: string
  /** one value at most: picking one closes the dropdown */
  single?: boolean
  cap?: number
}): ReactNode {
  const lookOf = (it: ChipItem): CSSProperties => ({
    ...S.valChip,
    ...(it.look !== undefined ? it.look : it.on ? S.valChipOn : null),
    ...(it.disabled ? S.valChipDisabled : null),
    ...(!onToggle ? { cursor: 'default' } : null)
  })
  if (items.length <= cap)
    return (
      <div style={S.chips}>
        {items.map((it) =>
          onToggle ? (
            <button
              key={it.value}
              className="oe-chip"
              disabled={it.disabled}
              title={it.title}
              onClick={() => onToggle(it.value)}
              style={lookOf(it)}
            >
              {it.value}
            </button>
          ) : (
            <span key={it.value} title={it.title} style={lookOf(it)}>
              {it.value}
            </span>
          )
        )}
      </div>
    )
  return (
    <ChipPicker items={items} onToggle={onToggle} label={label} single={single} lookOf={lookOf} />
  )
}

/** How many of the values are picked, and the first few by name. */
function summary(items: ChipItem[]): string {
  const on = items.filter((i) => i.on).map((i) => i.value)
  if (on.length === 0) return 'none'
  if (on.length === items.length) return `all ${items.length}`
  const shown = on.slice(0, 3).join(', ')
  return on.length > 3 ? `${shown} +${on.length - 3}` : shown
}

function ChipPicker({
  items,
  onToggle,
  label,
  single,
  lookOf
}: {
  items: ChipItem[]
  onToggle?: (value: string) => void
  label: string
  single?: boolean
  lookOf: (it: ChipItem) => CSSProperties
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
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
      if (e.key === 'Escape') {
        // Close the list only, not the dialog under it.
        e.stopPropagation()
        setOpen(false)
      }
    }
    const onResize = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? items.filter((i) => i.value.toLowerCase().includes(needle)) : items
  }, [items, q])

  const pick = (it: ChipItem): void => {
    if (!onToggle || it.disabled) return
    onToggle(it.value)
    if (single && !it.on) setOpen(false)
  }
  const toggle = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQ('')
    setOpen((o) => !o)
  }
  const nOn = items.filter((i) => i.on).length
  const L = GENE_LIST_STYLES
  return (
    <>
      <button
        ref={btnRef}
        className="oe-chip"
        onClick={toggle}
        aria-expanded={open}
        title={`${nOn} of ${items.length} ${label} values ${onToggle ? 'picked' : 'shown'} — click to ${onToggle ? 'pick' : 'see them'}`}
        style={{
          ...S.valChip,
          ...(nOn > 0 && nOn < items.length ? S.valChipOn : null),
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: '100%',
          alignSelf: 'flex-start',
          borderRadius: 6,
          ...(open ? { borderColor: UI.accent } : null)
        }}
      >
        <span style={styles.summary}>{summary(items)}</span>
        <span style={{ opacity: 0.7, fontWeight: 400 }}>/ {items.length}</span>
        <Chevron deg={open ? -90 : 90} size={9} color="currentColor" />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...cssVars(p),
              ...L.menu,
              ...placeMenu(rect, MENU_W, MENU_H),
              width: MENU_W,
              zIndex: 5000,
              background: p.panel,
              border: `1px solid ${p.border}`
            }}
          >
            <div style={L.searchWrap}>
              <span style={{ ...L.searchIcon, color: p.textMuted }}>
                <IconSearch />
              </span>
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  // Enter toggles the only match.
                  if (e.key === 'Enter' && filtered.length === 1) pick(filtered[0])
                }}
                placeholder={`Search ${items.length} ${label} values…`}
                style={{
                  ...L.search,
                  paddingLeft: 26,
                  background: p.panelAlt,
                  color: p.text,
                  border: `1px solid ${p.border}`
                }}
              />
            </div>
            <div style={styles.list}>
              {filtered.length === 0 ? (
                <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
              ) : (
                filtered.map((it) => (
                  <div
                    key={it.value}
                    role={onToggle ? 'menuitemcheckbox' : undefined}
                    aria-checked={onToggle ? it.on : undefined}
                    aria-disabled={it.disabled || undefined}
                    title={it.title}
                    onClick={() => pick(it)}
                    style={{
                      ...styles.row,
                      cursor: onToggle && !it.disabled ? 'pointer' : 'default'
                    }}
                  >
                    {onToggle && (
                      <span
                        style={{
                          ...styles.check,
                          borderRadius: single ? 999 : 3,
                          ...(it.on
                            ? { background: p.accent, borderColor: p.accent, color: p.accentText }
                            : null),
                          ...(it.disabled ? { opacity: 0.35 } : null)
                        }}
                      >
                        {it.on ? '✓' : ''}
                      </span>
                    )}
                    {/* The value as its chip would look. */}
                    <span style={{ ...lookOf(it), ...styles.rowChip }}>{it.value}</span>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

const MENU_W = 260
const MENU_H = 380

const styles: Record<string, CSSProperties> = {
  summary: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
  list: {
    overflowY: 'auto',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  row: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px', borderRadius: 4 },
  check: {
    width: 13,
    height: 13,
    flex: '0 0 auto',
    boxSizing: 'border-box',
    border: `1px solid ${UI.border}`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    fontWeight: 700
  },
  rowChip: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    cursor: 'inherit'
  }
}
