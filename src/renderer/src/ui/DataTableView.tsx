import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { cssVars, PALETTES, UI } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

export interface Column {
  key: string
  label: string
  align?: 'left' | 'right'
  format?: (v: unknown) => string
  /** optional per-cell style (e.g. a heat-map background + matching text colour); undefined =
   *  default cell. A solid background overrides the row's zebra/hover tint for that cell. */
  cellStyle?: (v: unknown) => CSSProperties | undefined
}

interface DataTableProps {
  columns: Column[]
  rows: Array<Record<string, unknown>>
  maxRows?: number
  caption?: string
  /** row field holding the linked-selection feature id; '' opts the table out */
  idKey?: string
}

type ColType = 'numeric' | 'categorical'
type Filter =
  | { type: 'categorical'; selected: string[] }
  | { type: 'numeric'; min: number | null; max: number | null }
interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

const strKey = (v: unknown): string => (v == null ? '' : String(v))

// Row backgrounds, applied imperatively (see the painter in DataTableView). Neutral
// tints rather than `accent` so they read the same in both themes; the inset bar marks
// a pin as sticky rather than transient.
const ALT_BG = 'rgba(255,255,255,0.02)'
const PIN_BG = 'rgba(128,128,128,0.18)'
const HOVER_BG = 'rgba(128,128,128,0.32)'
const PIN_BAR = `inset 3px 0 0 ${UI.accent}`

/** A column is numeric when every non-blank sampled value parses as a finite number. */
function inferType(key: string, rows: Array<Record<string, unknown>>): ColType {
  let sawNumber = false
  for (const r of rows) {
    const v = r[key]
    if (v == null || v === '') continue
    if (typeof v === 'boolean') return 'categorical'
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return 'categorical'
    sawNumber = true
  }
  return sawNumber ? 'numeric' : 'categorical'
}

/** Scrollable table with global search, per-column sort + filter, and a reset. */
export function DataTableView({ columns, rows, maxRows = 500, idKey = 'uniqID' }: DataTableProps) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState | null>(null)
  const [filters, setFilters] = useState<Record<string, Filter>>({})
  const [menu, setMenu] = useState<{ key: string; rect: DOMRect } | null>(null)
  // "Show only selected" narrows the table to the pinned genes so they're easy to find
  // and unpin. Subscribe to `pinnedIds` (changes only on click — no hover churn) so the
  // toolbar count + this filter stay live; hover highlighting stays imperative below.
  const [selectedOnly, setSelectedOnly] = useState(false)
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const clearPins = useSelection((s) => s.clearPins)

  // Linked selection: rows share the plots' `uniqID` key, so hovering/clicking a row
  // drives the same store the charts read (and vice versa).
  //
  // Deliberately NOT subscribed with the `useSelection(...)` hook: a table shows
  // hundreds of rows, and re-rendering all of them on every hover made a mouse move
  // over any plot cost ~120ms of React work. The highlight is painted straight onto
  // the row elements instead (same imperative approach PlotlyChart uses).
  const scrollRef = useRef<HTMLDivElement>(null)
  // True while the pointer is over this table — suppresses the follow-scroll so the
  // rows don't shift under the cursor we're hovering with.
  const localHover = useRef(false)

  const colType = useMemo(() => {
    const t: Record<string, ColType> = {}
    for (const c of columns) t[c.key] = inferType(c.key, rows)
    return t
  }, [columns, rows])

  const fmt = (c: Column, v: unknown): string => (c.format ? c.format(v) : strKey(v))

  const processed = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = rows.filter((r) => {
      if (selectedOnly && pinnedIds.size > 0 && !pinnedIds.has(idKey ? strKey(r[idKey]) : ''))
        return false
      for (const c of columns) {
        const f = filters[c.key]
        if (!f) continue
        const v = r[c.key]
        if (f.type === 'categorical') {
          if (f.selected.length && !f.selected.includes(strKey(v))) return false
        } else {
          const n = typeof v === 'number' ? v : Number(v)
          if (!Number.isFinite(n)) return false
          if (f.min != null && n < f.min) return false
          if (f.max != null && n > f.max) return false
        }
      }
      if (q) {
        let hit = false
        for (const c of columns) {
          if (fmt(c, r[c.key]).toLowerCase().includes(q)) {
            hit = true
            break
          }
        }
        if (!hit) return false
      }
      return true
    })
    if (sort) {
      const { key, dir } = sort
      const numeric = colType[key] === 'numeric'
      out = [...out].sort((a, b) => {
        let cmp: number
        if (numeric) {
          const an = Number(a[key])
          const bn = Number(b[key])
          const aok = Number.isFinite(an)
          const bok = Number.isFinite(bn)
          cmp = aok && bok ? an - bn : aok ? -1 : bok ? 1 : 0
        } else {
          const as = strKey(a[key])
          const bs = strKey(b[key])
          cmp = as < bs ? -1 : as > bs ? 1 : 0
        }
        return dir === 'asc' ? cmp : -cmp
      })
    }
    return out
  }, [rows, columns, filters, query, sort, colType, selectedOnly, pinnedIds, idKey])

  const shown = processed.slice(0, maxRows)
  const active =
    query.trim() !== '' || sort != null || Object.keys(filters).length > 0 || selectedOnly

  const rowEls = useRef(new Map<string, { el: HTMLTableRowElement; alt: boolean }>())
  // Paint the current selection onto the rows, and re-paint whenever it changes.
  // No dep array: it must also re-run after a sort/filter/search re-render, since
  // those recycle the row elements under different ids.
  useEffect(() => {
    let lastHover: string | null = null
    const paint = (): void => {
      const { hoverId, pinnedIds } = useSelection.getState()
      for (const [id, { el, alt }] of rowEls.current) {
        const hovered = id === hoverId
        const pinned = pinnedIds.has(id)
        const bg = hovered ? HOVER_BG : pinned ? PIN_BG : alt ? ALT_BG : 'transparent'
        if (el.style.background !== bg) el.style.background = bg
        const bar = pinned ? PIN_BAR : ''
        if (el.style.boxShadow !== bar) el.style.boxShadow = bar
      }
      // When the hover comes from another panel, bring the matching row into view —
      // a linked highlight is useless if it lands 400 rows below the fold. Scroll the
      // table's own container by hand rather than using scrollIntoView, which walks up
      // and scrolls every ancestor too — that yanked the whole dashboard to the table.
      if (hoverId && hoverId !== lastHover && !localHover.current) {
        const sc = scrollRef.current
        const el = rowEls.current.get(hoverId)?.el
        if (sc && el) {
          const row = el.getBoundingClientRect()
          const box = sc.getBoundingClientRect()
          // The header is sticky, so treat the area under it as covered.
          const headH = sc.querySelector('thead')?.getBoundingClientRect().height ?? 0
          if (row.top < box.top + headH) sc.scrollTop += row.top - box.top - headH
          else if (row.bottom > box.bottom) sc.scrollTop += row.bottom - box.bottom
        }
      }
      lastHover = hoverId
    }
    paint()
    return useSelection.subscribe(paint)
  })

  const reset = (): void => {
    setQuery('')
    setSort(null)
    setFilters({})
    setMenu(null)
    setSelectedOnly(false)
  }

  const openMenu = (key: string, el: HTMLElement): void => {
    setMenu((m) => (m?.key === key ? null : { key, rect: el.getBoundingClientRect() }))
  }

  const menuCol = menu ? columns.find((c) => c.key === menu.key) : undefined

  return (
    <div style={styles.wrap}>
      <div style={styles.toolbar}>
        <input
          style={styles.search}
          placeholder="Search all columns…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {pinnedIds.size > 0 && (
          <>
            <button
              style={{ ...styles.selBtn, ...(selectedOnly ? styles.selBtnOn : null) }}
              onClick={() => setSelectedOnly((v) => !v)}
              title="Show only the selected (pinned) genes"
            >
              ★ {pinnedIds.size} selected
            </button>
            <button
              style={styles.reset}
              onClick={() => {
                clearPins()
                setSelectedOnly(false)
              }}
              title="Deselect all genes"
            >
              Clear
            </button>
          </>
        )}
        <button
          style={{ ...styles.reset, opacity: active ? 1 : 0.45 }}
          onClick={reset}
          disabled={!active}
          title="Clear search, sort and filters"
        >
          Reset
        </button>
      </div>
      <div
        style={styles.scroll}
        ref={scrollRef}
        onMouseEnter={() => {
          localHover.current = true
        }}
        onMouseLeave={() => {
          localHover.current = false
          if (idKey) useSelection.getState().clearHover()
        }}
      >
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => {
                const sorted = sort?.key === c.key ? sort.dir : null
                const filtered = !!filters[c.key]
                return (
                  <th
                    key={c.key}
                    onClick={(e) => openMenu(c.key, e.currentTarget)}
                    style={{
                      ...styles.th,
                      textAlign: c.align ?? 'left',
                      color: filtered || sorted ? UI.accent : UI.text
                    }}
                    title="Sort & filter"
                  >
                    <span style={styles.thInner}>
                      <span>{c.label}</span>
                      {sorted && <span>{sorted === 'asc' ? '▲' : '▼'}</span>}
                      {filtered && <span style={styles.filterDot} />}
                      <span style={styles.caret}>▾</span>
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const id = idKey ? strKey(r[idKey]) : ''
              return (
                <tr
                  key={id || i}
                  ref={(el) => {
                    if (!id) return
                    if (el) rowEls.current.set(id, { el, alt: i % 2 === 1 })
                    else rowEls.current.delete(id)
                  }}
                  onMouseEnter={id ? () => useSelection.getState().setHover(id) : undefined}
                  onClick={id ? () => useSelection.getState().selectOnly(id) : undefined}
                  // Background is owned by the imperative painter above (which also
                  // draws the zebra stripe), so React must not set it here and fight it.
                  style={{ cursor: id ? 'pointer' : undefined }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{ ...styles.td, textAlign: c.align ?? 'left', ...c.cellStyle?.(r[c.key]) }}
                    >
                      {fmt(c, r[c.key])}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div style={styles.footer}>
        showing {shown.length.toLocaleString()} of {processed.length.toLocaleString()} rows
        {processed.length !== rows.length ? ` (filtered from ${rows.length.toLocaleString()})` : ''}
      </div>

      {menu &&
        menuCol &&
        createPortal(
          <ColumnMenu
            rows={rows}
            column={menuCol}
            type={colType[menu.key]}
            rect={menu.rect}
            filter={filters[menu.key]}
            sortDir={sort?.key === menu.key ? sort.dir : null}
            onSort={(dir) => setSort(dir ? { key: menu.key, dir } : null)}
            onFilter={(f) =>
              setFilters((prev) => {
                const next = { ...prev }
                if (f) next[menu.key] = f
                else delete next[menu.key]
                return next
              })
            }
            onClose={() => setMenu(null)}
          />,
          document.body
        )}
    </div>
  )
}

// ── per-column sort + filter popover ──────────────────────────────────────────────

function ColumnMenu({
  rows,
  column,
  type,
  rect,
  filter,
  sortDir,
  onSort,
  onFilter,
  onClose
}: {
  rows: Array<Record<string, unknown>>
  column: Column
  type: ColType
  rect: DOMRect
  filter?: Filter
  sortDir: 'asc' | 'desc' | null
  onSort: (dir: 'asc' | 'desc' | null) => void
  onFilter: (f: Filter | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [find, setFind] = useState('')
  const mode = useUiTheme((s) => s.mode)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const distinct = useMemo(() => {
    if (type !== 'categorical') return []
    const set = new Set<string>()
    for (const r of rows) set.add(strKey(r[column.key]))
    return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  }, [rows, column.key, type])

  const selected = filter?.type === 'categorical' ? filter.selected : []
  const toggle = (v: string): void => {
    const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]
    onFilter(next.length ? { type: 'categorical', selected: next } : null)
  }

  const range = filter?.type === 'numeric' ? filter : { min: null, max: null }
  const setRange = (min: number | null, max: number | null): void =>
    onFilter(min == null && max == null ? null : { type: 'numeric', min, max })

  const MENU_W = 240
  const left = Math.max(6, Math.min(rect.left, window.innerWidth - MENU_W - 6))
  const filtered = find
    ? distinct.filter((v) => v.toLowerCase().includes(find.toLowerCase()))
    : distinct
  const CAP = 300

  return (
    <div
      ref={ref}
      style={{
        ...cssVars(PALETTES[mode]),
        ...styles.menu,
        left,
        top: rect.bottom + 2,
        width: MENU_W
      }}
    >
      <div style={styles.menuRow}>
        <button
          style={{ ...styles.sortBtn, ...(sortDir === 'asc' ? styles.sortActive : null) }}
          onClick={() => onSort(sortDir === 'asc' ? null : 'asc')}
        >
          ▲ Ascending
        </button>
        <button
          style={{ ...styles.sortBtn, ...(sortDir === 'desc' ? styles.sortActive : null) }}
          onClick={() => onSort(sortDir === 'desc' ? null : 'desc')}
        >
          ▼ Descending
        </button>
      </div>
      <div style={styles.menuDivider} />
      {type === 'numeric' ? (
        <div style={styles.menuBody}>
          <div style={styles.menuLabel}>Range</div>
          <div style={styles.rangeRow}>
            <input
              style={styles.numInput}
              type="number"
              placeholder="min"
              value={range.min ?? ''}
              onChange={(e) =>
                setRange(e.target.value === '' ? null : Number(e.target.value), range.max)
              }
            />
            <span style={styles.rangeDash}>–</span>
            <input
              style={styles.numInput}
              type="number"
              placeholder="max"
              value={range.max ?? ''}
              onChange={(e) =>
                setRange(range.min, e.target.value === '' ? null : Number(e.target.value))
              }
            />
          </div>
          {filter && (
            <button style={styles.clearBtn} onClick={() => onFilter(null)}>
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div style={styles.menuBody}>
          <input
            style={styles.menuSearch}
            placeholder="Filter values…"
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          <div style={styles.menuActions}>
            <button style={styles.linkBtn} onClick={() => onFilter(null)}>
              All
            </button>
            <button
              style={styles.linkBtn}
              onClick={() => onFilter({ type: 'categorical', selected: [...filtered] })}
            >
              Only shown
            </button>
          </div>
          <div style={styles.options}>
            {filtered.slice(0, CAP).map((v) => (
              <label key={v} style={styles.optRow}>
                <input
                  type="checkbox"
                  checked={selected.length === 0 || selected.includes(v)}
                  onChange={() => toggle(v)}
                />
                <span style={styles.optLabel}>{v === '' ? '(blank)' : v}</span>
              </label>
            ))}
            {filtered.length > CAP && (
              <div style={styles.more}>+{filtered.length - CAP} more — refine search</div>
            )}
            {filtered.length === 0 && <div style={styles.more}>no matching values</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/** Format a numeric cell to `digits` decimals; a missing value shows as "NaN". A real 0 still
 *  shows as "0.000" — only null/undefined/'' (and non-numeric text) are treated as missing. The
 *  null/'' guard must come before Number(), which coerces both to 0 (a finite value). */
// eslint-disable-next-line react-refresh/only-export-components
export function fixed(digits: number) {
  return (v: unknown): string => {
    if (v == null || v === '') return 'NaN'
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n.toFixed(digits) : 'NaN'
  }
}

const styles: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  search: {
    flex: 1,
    minWidth: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 9px',
    fontSize: 12
  },
  reset: {
    flex: '0 0 auto',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  selBtn: {
    flex: '0 0 auto',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  selBtnOn: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  caption: { padding: '6px 10px', color: UI.textMuted, fontSize: 12, flex: '0 0 auto' },
  scroll: { overflow: 'auto', flex: 1, minHeight: 0 },
  table: {
    borderCollapse: 'collapse',
    width: '100%',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums'
  },
  th: {
    position: 'sticky',
    top: 0,
    background: UI.panelAlt,
    color: UI.text,
    padding: '6px 10px',
    borderBottom: `1px solid ${UI.border}`,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    zIndex: 1
  },
  thInner: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  caret: { fontSize: 8, opacity: 0.55 },
  filterDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: UI.accent,
    display: 'inline-block'
  },
  td: {
    padding: '4px 10px',
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    whiteSpace: 'nowrap'
  },
  footer: {
    padding: '6px 10px',
    color: UI.textMuted,
    fontSize: 11,
    borderTop: `1px solid ${UI.border}`,
    flex: '0 0 auto'
  },
  // popover
  menu: {
    position: 'fixed',
    zIndex: 4000,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6
  },
  menuRow: { display: 'flex', gap: 6 },
  sortBtn: {
    flex: 1,
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 6px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  sortActive: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  menuDivider: { height: 1, background: UI.border, margin: '2px 0' },
  menuBody: { display: 'flex', flexDirection: 'column', gap: 6 },
  menuLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  rangeRow: { display: 'flex', alignItems: 'center', gap: 6 },
  rangeDash: { color: UI.textMuted },
  numInput: {
    width: '100%',
    minWidth: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 12,
    boxSizing: 'border-box'
  },
  menuSearch: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    padding: '3px 6px',
    fontSize: 12
  },
  menuActions: { display: 'flex', gap: 10 },
  linkBtn: {
    background: 'transparent',
    color: UI.accent,
    border: 'none',
    padding: 0,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  options: { maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 2 },
  optRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  optLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  more: { fontSize: 11, color: UI.textMuted, padding: '2px 0' },
  clearBtn: {
    background: 'transparent',
    color: UI.accent,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    alignSelf: 'flex-start'
  }
}
