/**
 * The app's one searchable multi-select over a list of values (a condition's levels, samples, a
 * column's values): a search field, the actions — Select all · Clear all · Invert, and Only
 * matches while searching — the count kept, and a checkbox row per value.
 *
 * - `ValueChecklist` is the list itself, for a menu that holds other things too (the data table's
 *   column menu: sort, then this).
 * - `ValueMultiSelect` is the dropdown: a button naming what's kept, opening the checklist in a
 *   floating window. It stays open while its own list scrolls; it closes on a click outside,
 *   Escape, a resize, or a scroll of the page under it (which would leave it floating astray).
 *
 * Two readings of `selected`:
 * - a filter (default): empty = unfiltered ("All"); ticking every value collapses back to that, and
 *   the last ticked value can't be unticked (keeping nothing would leave no data). Clear all is a
 *   state of the open list only — everything unticked, nothing committed until a value is ticked.
 * - `members`: exactly the ticked values — empty is none, and it may be emptied (a batch's samples,
 *   the values an import filter keeps).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Chevron } from './Chevron'
import { IconSearch } from './GeneSelectMenu'
import { GENE_LIST_STYLES } from './geneListStyles'
import { cssVars, PALETTES, UI } from './theme'
import { useUiTheme } from './useUiTheme'
import { VirtualList } from './VirtualRows'

/** How a value reads on screen: '' is a sample the condition doesn't apply to. */
const valueText = (v: string): string => (v === '' ? '(none)' : v)

interface ChecklistProps {
  /** every value there is, in display order */
  values: string[]
  /** the kept values (see the module note for the two readings) */
  selected: string[]
  onChange: (next: string[]) => void
  /** what a value is, for the search placeholder ("compound" → "Search 12 compounds…") */
  noun: string
  /** how a value reads, when not as itself (a sample by its conditions, not its file name) — shown,
   *  searched and summarised; the value itself is what's selected, and its hover title */
  labelOf?: (v: string) => string
  /** `selected` is exactly the ticked values (see the module note) */
  members?: boolean
  /** a note beside a value in the list (where a sample is now: "in batch 2") */
  noteOf?: (v: string) => string | undefined
  /** a line under the list (e.g. that only the commonest values are listed) */
  footnote?: ReactNode
}

export function ValueChecklist({
  values,
  selected,
  onChange,
  noun,
  labelOf,
  members = false,
  noteOf,
  footnote
}: ChecklistProps): ReactNode {
  const p = PALETTES[useUiTheme((s) => s.mode)]
  const [q, setQ] = useState('')
  // Clear all on a filter: every box unticked here, the filter itself unchanged until a tick.
  const [none, setNone] = useState(false)
  const text = (v: string): string => (labelOf ? labelOf(v) : valueText(v))

  // (as a members list nothing is the filter's "all": every value is all of them ticked)
  const all = !members && selected.length === 0
  const kept = useMemo(() => new Set(selected), [selected])
  // A kept value no longer among the values (the upstream re-ran) stays listed, so it can be cleared.
  // (sets, not includes: a column of genes has thousands of values)
  const known = useMemo(() => new Set(values), [values])
  const listed = useMemo(
    () => [...values, ...selected.filter((v) => !known.has(v))],
    [values, selected, known]
  )
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? listed.filter((v) => (labelOf ? labelOf(v) : valueText(v)).toLowerCase().includes(needle))
      : listed
  }, [listed, q, labelOf])

  const isOn = (v: string): boolean => !none && (all || kept.has(v))
  // Normalise: every value kept is no filter at all (a members list is as ticked).
  const commit = (next: string[]): void => {
    const picked = new Set(next)
    onChange(!members && values.length > 0 && values.every((v) => picked.has(v)) ? [] : next)
  }
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
  const selectAll = (): void => {
    setNone(false)
    onChange(members ? values : [])
  }
  const clearAll = (): void => (members ? onChange([]) : setNone(true))
  // The values not ticked now; inverting everything is cleared, inverting cleared is all.
  const invert = (): void => {
    if (members) {
      commit(values.filter((v) => !kept.has(v)))
      return
    }
    if (none) return selectAll()
    const next = values.filter((v) => !isOn(v))
    if (next.length) commit(next)
    else setNone(true)
  }

  const count = none ? 0 : all ? values.length : selected.length
  const everything = all || (members && values.length > 0 && values.every((v) => kept.has(v)))
  const L = GENE_LIST_STYLES
  const searching = q.trim() !== ''
  const action = (label: string, onClick: () => void, title: string, off = false): ReactNode => (
    <button
      style={{ ...styles.action, color: off ? p.textMuted : p.accent }}
      disabled={off}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  )
  return (
    <>
      <div style={L.searchWrap}>
        <span style={{ ...L.searchIcon, color: p.textMuted }}>
          <IconSearch />
        </span>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // Enter keeps just what the search matches.
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searching && filtered.length) {
              setNone(false)
              commit(filtered)
            }
          }}
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
        {action('Select all', selectAll, `Keep every ${noun}`, everything && !none)}
        {action(
          'Clear all',
          clearAll,
          members ? `Keep no ${noun}` : `Untick every ${noun}, then tick the ones to keep`,
          none || (members && selected.length === 0)
        )}
        {action('Invert', invert, `Keep the ${noun}s not ticked now`)}
        {searching &&
          filtered.length > 0 &&
          action(
            'Only matches',
            () => {
              setNone(false)
              commit(filtered)
            },
            `Keep just the ${noun}s the search matches (Enter)`
          )}
        <span style={{ marginLeft: 'auto', color: p.textMuted, whiteSpace: 'nowrap' }}>
          {count.toLocaleString()} of {values.length.toLocaleString()}
        </span>
      </div>
      <div style={styles.list}>
        {filtered.length === 0 ? (
          <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
        ) : (
          <VirtualList
            count={filtered.length}
            style={styles.rows}
            row={(i) => {
              const v = filtered[i]
              const on = isOn(v)
              const stale = !known.has(v)
              return (
                <label
                  key={v}
                  style={{
                    ...L.geneRow,
                    paddingLeft: 6,
                    color: stale ? p.textMuted : p.text,
                    ...(on && !everything ? { background: `${p.accent}22` } : {})
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
            }}
          />
        )}
      </div>
      {footnote && <div style={{ ...styles.footnote, color: p.textMuted }}>{footnote}</div>}
    </>
  )
}

export function ValueMultiSelect(
  props: ChecklistProps & {
    /** greyed and unopenable */
    disabled?: boolean
  }
): ReactNode {
  const { values, selected, noun, labelOf, members = false, disabled } = props
  const mode = useUiTheme((s) => s.mode)
  const p = PALETTES[mode]
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const text = (v: string): string => (labelOf ? labelOf(v) : valueText(v))
  const isOpen = open && !disabled

  useEffect(() => {
    if (!isOpen) return
    const inside = (t: EventTarget | null): boolean =>
      !!t && (!!menuRef.current?.contains(t as Node) || !!btnRef.current?.contains(t as Node))
    const onDown = (e: MouseEvent): void => {
      if (!inside(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    // The window is placed under the button once: a scroll of what's under it would leave it
    // floating astray, so that closes it — but not its own list scrolling.
    const onScroll = (e: Event): void => {
      if (!inside(e.target)) setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
  }, [isOpen])

  const all = !members && selected.length === 0
  const kept = new Set(selected)
  const summary =
    all || (members && values.length > 0 && values.every((v) => kept.has(v)))
      ? 'All'
      : selected.length === 0
        ? 'None'
        : selected.length <= 3
          ? selected.map(text).join(', ')
          : `${selected.length} of ${values.length}`

  const toggleOpen = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        disabled={disabled}
        title={all ? `Every ${noun} kept` : selected.map(text).join(', ')}
        aria-expanded={isOpen}
        style={{
          ...styles.btn,
          color: UI.text,
          borderColor: isOpen ? UI.accent : UI.border,
          ...(disabled ? { opacity: 0.5, cursor: 'default' } : null)
        }}
      >
        <span
          style={{
            ...styles.summary,
            color: all || (members && selected.length === 0) ? UI.textMuted : UI.text
          }}
        >
          {summary}
        </span>
        <Chevron deg={isOpen ? -90 : 90} />
      </button>
      {isOpen &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              // portalled out of the themed app root: its palette's variables again
              ...cssVars(p),
              ...GENE_LIST_STYLES.menu,
              left: Math.max(6, Math.min(rect.left, window.innerWidth - MENU_W - 6)),
              top: rect.bottom + 4,
              width: Math.max(rect.width, MENU_W),
              maxHeight: Math.max(160, window.innerHeight - rect.bottom - 4 - 8),
              zIndex: 5000,
              background: p.panel,
              border: `1px solid ${p.border}`
            }}
          >
            <ValueChecklist {...props} />
          </div>,
          document.body
        )}
    </>
  )
}

const MENU_W = 260

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
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  list: { overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' },
  rows: { display: 'flex', flexDirection: 'column' },
  footnote: { fontSize: 11, padding: '2px 6px 4px', lineHeight: 1.4 }
}
