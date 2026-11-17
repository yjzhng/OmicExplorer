/** A searchable multi-select over one condition's values, in the gene picker's look (GeneSwitch):
 *  a button naming what's kept, opening a portaled window with a search field and a checkbox row
 *  per value. Empty `selected` = unfiltered ("All"); ticking every value collapses back to that,
 *  and the last ticked value can't be cleared (keeping nothing would leave no data). "None" is a
 *  state of the open menu only: everything unticked, nothing committed until a value is ticked.
 *  As a `members` list (a batch's samples) it's plainly the ticked values instead: empty = none. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Chevron } from './Chevron'
import { IconSearch } from './GeneSelectMenu'
import { GENE_LIST_STYLES } from './geneListStyles'
import { PALETTES, UI } from './theme'
import { useUiTheme } from './useUiTheme'

/** How a value reads on screen: '' is a sample the condition doesn't apply to. */
const valueText = (v: string): string => (v === '' ? '(none)' : v)

export function ValueMultiSelect({
  values,
  selected,
  onChange,
  noun,
  labelOf,
  members = false,
  noteOf
}: {
  /** every value the condition takes upstream, in display order */
  values: string[]
  /** the kept values; empty = all */
  selected: string[]
  onChange: (next: string[]) => void
  /** what a value is, for the search placeholder ("compound" → "Search 12 compounds…") */
  noun: string
  /** how a value reads, when not as itself (a sample by its conditions, not its file name) — shown,
   *  searched and summarised; the value itself is what's selected, and its hover title */
  labelOf?: (v: string) => string
  /** `selected` is exactly the ticked values — empty is none, all is all, and it may be emptied —
   *  rather than a filter whose empty means unfiltered */
  members?: boolean
  /** a note beside a value in the list (where a sample is now: "in batch 2") */
  noteOf?: (v: string) => string | undefined
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [rect, setRect] = useState<DOMRect | null>(null)
  // "None" pressed: every box unticked in the menu, the filter itself unchanged until a tick.
  const [none, setNone] = useState(false)
  const text = (v: string): string => (labelOf ? labelOf(v) : valueText(v))
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

  // (as a members list nothing is the filter's "all": every value is all of them ticked)
  const all = !members && selected.length === 0
  const kept = useMemo(() => new Set(selected), [selected])
  // A kept value the upstream no longer has (it re-ran) stays listed, so it can be cleared.
  const listed = useMemo(
    () => [...values, ...selected.filter((v) => !values.includes(v))],
    [values, selected]
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? listed.filter((v) => (labelOf ? labelOf(v) : valueText(v)).toLowerCase().includes(needle))
      : listed
  }, [listed, q, labelOf])

  const isOn = (v: string): boolean => !none && (all || kept.has(v))
  // Normalise: every upstream value kept is no filter at all (a members list is as ticked).
  const commit = (next: string[]): void =>
    onChange(!members && values.length > 0 && values.every((v) => next.includes(v)) ? [] : next)
  const toggle = (v: string): void => {
    if (members) {
      commit(kept.has(v) ? selected.filter((x) => x !== v) : [...selected, v])
      return
    }
    if (none) {
      setNone(false)
      commit([v])
      return
    }
    const cur = all ? values : selected
    if (isOn(v)) {
      if (cur.length > 1) commit(cur.filter((x) => x !== v))
    } else commit([...cur, v])
  }

  const summary =
    all || (members && values.length > 0 && values.every((v) => kept.has(v)))
      ? 'All'
      : members && selected.length === 0
        ? 'None'
        : selected.length <= 3
          ? selected.map(text).join(', ')
          : `${selected.length} of ${values.length}`

  // Inverse of what's ticked now; inverting everything is None, inverting None is All.
  const invert = (): void => {
    if (members) {
      commit(values.filter((v) => !kept.has(v)))
      return
    }
    if (none) {
      setNone(false)
      onChange([])
      return
    }
    const next = values.filter((v) => !isOn(v))
    if (next.length) commit(next)
    else setNone(true)
  }

  const openMenu = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQ('')
    setNone(false)
    setOpen((o) => !o)
  }

  const L = GENE_LIST_STYLES
  const searching = q.trim() !== ''
  return (
    <>
      <button
        ref={btnRef}
        onClick={openMenu}
        title={all ? `Every ${noun} kept` : selected.map(text).join(', ')}
        aria-expanded={open}
        style={{ ...styles.btn, color: UI.text, borderColor: open ? UI.accent : UI.border }}
      >
        <span
          style={{
            ...styles.summary,
            color: all || (members && selected.length === 0) ? UI.textMuted : UI.text
          }}
        >
          {summary}
        </span>
        <Chevron deg={open ? -90 : 90} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...L.menu,
              left: rect.left,
              top: rect.bottom + 4,
              width: Math.max(rect.width, MENU_W),
              maxHeight: Math.max(160, window.innerHeight - rect.bottom - 4 - 8),
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
                placeholder={`Search ${values.length.toLocaleString()} ${noun}${values.length === 1 ? '' : 's'}…`}
                style={{
                  ...L.search,
                  paddingLeft: 26,
                  background: p.panelAlt,
                  color: p.text,
                  border: `1px solid ${p.border}`
                }}
              />
            </div>
            <div style={styles.actions}>
              <button
                style={{ ...styles.action, color: all && !none ? p.textMuted : p.accent }}
                disabled={all && !none}
                onClick={() => {
                  setNone(false)
                  onChange(members ? values : [])
                }}
              >
                All
              </button>
              <button
                style={{ ...styles.action, color: none ? p.textMuted : p.accent }}
                disabled={none}
                title="Untick everything, then tick the values to keep"
                onClick={() => (members ? onChange([]) : setNone(true))}
              >
                None
              </button>
              <button
                style={{ ...styles.action, color: p.accent }}
                title="Keep the values not ticked now"
                onClick={invert}
              >
                Inverse
              </button>
              {searching && filtered.length > 0 && (
                <button
                  style={{ ...styles.action, color: p.accent }}
                  title="Keep just the values the search matches"
                  onClick={() => {
                    setNone(false)
                    commit(filtered)
                  }}
                >
                  Only matches
                </button>
              )}
              <span style={{ marginLeft: 'auto', color: p.textMuted }}>
                {none ? 0 : all ? values.length : selected.length} kept
              </span>
            </div>
            <div
              style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              {filtered.length === 0 ? (
                <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
              ) : (
                filtered.slice(0, LIST_CAP).map((v) => {
                  const on = isOn(v)
                  const stale = !values.includes(v)
                  return (
                    <label
                      key={v}
                      style={{
                        ...L.geneRow,
                        paddingLeft: 6,
                        color: stale ? p.textMuted : p.text,
                        ...(on && !all ? { background: `${p.accent}22` } : {})
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(v)}
                        style={{ margin: 0, accentColor: p.accent }}
                      />
                      <span
                        style={{ ...L.geneName, maxWidth: 'none', flex: 1 }}
                        title={labelOf ? v : undefined}
                      >
                        {text(v)}
                      </span>
                      {stale ? (
                        <span style={{ ...L.geneDesc, flex: '0 0 auto' }}>not in data</span>
                      ) : (
                        noteOf?.(v) && (
                          <span style={{ ...L.geneDesc, flex: '0 0 auto' }}>{noteOf(v)}</span>
                        )
                      )}
                    </label>
                  )
                })
              )}
              {filtered.length > LIST_CAP && (
                <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>
                  +{(filtered.length - LIST_CAP).toLocaleString()} more — refine search
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

const MENU_W = 240

/** Rows rendered at once — a custom condition can take many values. */
const LIST_CAP = 300

const styles: Record<string, CSSProperties> = {
  btn: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    minWidth: 0,
    background: 'transparent',
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px',
    cursor: 'pointer'
  },
  summary: {
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  actions: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 6px', fontSize: 11 },
  action: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 11,
    textDecoration: 'underline',
    textUnderlineOffset: 2,
    cursor: 'pointer'
  }
}
