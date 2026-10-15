import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'

import { IconSearch } from './GeneSelectMenu'
import { truncateLabel } from './plotAxes'
import { GENE_LIST_STYLES } from './geneListStyles'
import { cssVars, PALETTES, UI } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

export interface Column {
  key: string
  /** header text; ` · ` separates parts (e.g. the conditions of a sample), each shown on its own
   *  line so long multi-condition labels don't make the column wide */
  label: string
  /** the header as named lines (e.g. a sample's conditions: cell WT / dose 10 / rep 1): each
   *  value on its own line with its name in small faint text to its left. Overrides splitting
   *  `label` (which still names the column everywhere else). */
  labelLines?: HeaderLine[]
  align?: 'left' | 'right'
  format?: (v: unknown) => string
  /** optional per-cell style (e.g. a heat-map background + matching text colour); undefined =
   *  default cell. A solid background overrides the row's zebra/hover tint for that cell. */
  cellStyle?: (v: unknown) => CSSProperties | undefined
}

/** One line of a stacked column header: a condition's (faint) name and its value. */
export interface HeaderLine {
  key: string
  value: string
}

interface DataTableProps {
  columns: Column[]
  rows: Array<Record<string, unknown>>
  maxRows?: number
  caption?: string
  /** row field holding the linked-selection feature id; '' opts the table out */
  idKey?: string
  /** a column's display cap, by column key: a longer value is cut to this many characters with
   *  "…" (its full text on hover). Display only — search, filters, sort and copy see it whole. */
  maxChars?: Record<string, number>
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

/** The separator matrix views join a column's parts with; the header stacks them as lines. */
const LABEL_SEP = ' · '

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
export function DataTableView({
  columns,
  rows,
  maxRows = 500,
  idKey = 'uniqID',
  maxChars
}: DataTableProps) {
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

  // A column's type is read only by a sort and by its menu — so it's inferred on first ask and
  // kept, not for every column up front (a whole scan of a long table per column).
  const colType = useMemo(() => {
    const t: Record<string, ColType> = {}
    return (key: string): ColType => (t[key] ??= inferType(key, rows))
  }, [rows])

  const fmt = (c: Column, v: unknown): string => (c.format ? c.format(v) : strKey(v))

  // Whether a row survives the search, the selected-only switch and every column filter — except
  // `skipKey`'s own, so a column's menu can list the values still available given everything ELSE.
  const passes = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (r: Record<string, unknown>, skipKey?: string): boolean => {
      if (selectedOnly && pinnedIds.size > 0 && !pinnedIds.has(idKey ? strKey(r[idKey]) : ''))
        return false
      for (const c of columns) {
        const f = filters[c.key]
        if (!f || c.key === skipKey) continue
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
    }
  }, [columns, filters, query, selectedOnly, pinnedIds, idKey])

  const narrowed = query.trim() !== '' || Object.keys(filters).length > 0 || selectedOnly
  const processed = useMemo(() => {
    // Nothing to narrow by: every row passes, so skip the per-row check (a long table's whole scan).
    let out = narrowed ? rows.filter((r) => passes(r)) : rows
    if (sort) {
      const { key, dir } = sort
      const numeric = colType(key) === 'numeric'
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
  }, [rows, passes, sort, colType, narrowed])

  // The rows a column's menu draws its value list from: everything that passes the search and the
  // OTHER columns' filters (not this column's own, or unticked values would disappear from the
  // list and could never be re-ticked).
  const menuRows = useMemo(
    () => (menu ? rows.filter((r) => passes(r, menu.key)) : rows),
    [rows, passes, menu]
  )

  const shown = processed.slice(0, maxRows)
  const active =
    query.trim() !== '' || sort != null || Object.keys(filters).length > 0 || selectedOnly

  // A row's React key must be unique, but a long table has MANY rows per gene (one per sample /
  // context), so the id alone collided and rows mis-rendered under search/filter/sort. Key by
  // id + the row's position in the ORIGINAL array (stable across filtering, unlike the shown index).
  // Only needed once the rows are narrowed or reordered (otherwise a row's position is its index)
  // — and then built once per table, not per render.
  const reordered = processed !== rows
  const rowIndex = useMemo(
    () => (reordered ? new Map(rows.map((r, i) => [r, i])) : null),
    [rows, reordered]
  )

  // Row elements by gene id — a Map per id because a gene can span several rows (long views),
  // and every one of them must light up. `alt` = zebra stripe.
  const rowEls = useRef(new Map<string, Map<HTMLTableRowElement, boolean>>())
  const trackRow = (id: string, el: HTMLTableRowElement | null, alt: boolean): void => {
    if (!id) return
    if (el) {
      let set = rowEls.current.get(id)
      if (!set) rowEls.current.set(id, (set = new Map()))
      set.set(el, alt)
    }
  }
  const untrackRow = (id: string, el: HTMLTableRowElement): void => {
    const set = rowEls.current.get(id)
    if (!set) return
    set.delete(el)
    if (set.size === 0) rowEls.current.delete(id)
  }
  // Paint the current selection onto the rows, and re-paint whenever it changes.
  // No dep array: it must also re-run after a sort/filter/search re-render, since
  // those recycle the row elements under different ids.
  useEffect(() => {
    let lastHover: string | null = null
    const paint = (): void => {
      const { hoverId, hoverMembers, pinnedIds } = useSelection.getState()
      // a hovered group (a STRING cluster, an enrichment term): its member genes' rows too
      const members = hoverMembers.length ? new Set(hoverMembers) : null
      for (const [id, els] of rowEls.current) {
        const hovered = id === hoverId || !!members?.has(id)
        const pinned = pinnedIds.has(id)
        const bar = pinned ? PIN_BAR : ''
        for (const [el, alt] of els) {
          const bg = hovered ? HOVER_BG : pinned ? PIN_BG : alt ? ALT_BG : 'transparent'
          if (el.style.background !== bg) el.style.background = bg
          if (el.style.boxShadow !== bar) el.style.boxShadow = bar
        }
      }
      // When the hover comes from another panel, bring the matching row into view —
      // a linked highlight is useless if it lands 400 rows below the fold. Scroll the
      // table's own container by hand rather than using scrollIntoView, which walks up
      // and scrolls every ancestor too — that yanked the whole dashboard to the table.
      if (hoverId && hoverId !== lastHover && !localHover.current) {
        const sc = scrollRef.current
        // A gene with several rows: bring its first (topmost) one into view.
        const el = rowEls.current.get(hoverId)?.keys().next().value
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

  // Whether rows run on above (hidden under the sticky header) or below the visible window, and
  // the header's height (where the top fade starts). Set only when one changes, so a scroll
  // doesn't re-render the table.
  const [edges, setEdges] = useState({ top: false, bottom: false, head: 0, barX: 0, barY: 0 })
  const measureEdges = (): void => {
    const sc = scrollRef.current
    if (!sc) return
    const top = sc.scrollTop > 1
    const bottom = sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1
    // Where the stuck header ends inside the scroller: a header CELL's bottom edge (the cells are
    // what's sticky — the <thead> box itself scrolls away with the rows), rounded down so the fade
    // butts against it rather than leaving a slit.
    const th = sc.querySelector('th')
    const head = th
      ? Math.max(0, Math.floor(th.getBoundingClientRect().bottom - sc.getBoundingClientRect().top))
      : 0
    // The scrollbars' thickness (vertical, horizontal), so the fades stop short of them.
    const barY = sc.offsetWidth - sc.clientWidth
    const barX = sc.offsetHeight - sc.clientHeight
    setEdges((e) =>
      e.top === top && e.bottom === bottom && e.head === head && e.barX === barX && e.barY === barY
        ? e
        : { top, bottom, head, barX, barY }
    )
  }
  // Re-measure when the box or its content resizes (a tile resize, a filter shrinking the rows).
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    measureEdges()
    const ro = new ResizeObserver(() => measureEdges())
    ro.observe(sc)
    const table = sc.querySelector('table')
    if (table) ro.observe(table)
    return () => ro.disconnect()
  }, [])

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
        {/* The magnifier inside the field, at its left — as the gene selector's search. */}
        <div style={{ ...GENE_LIST_STYLES.searchWrap, flex: 1, minWidth: 0 }}>
          <span style={{ ...GENE_LIST_STYLES.searchIcon, color: UI.textMuted }}>
            <IconSearch />
          </span>
          <input
            style={styles.search}
            placeholder="Search all columns…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {pinnedIds.size > 0 && (
          <>
            <button
              className="oe-dt-btn"
              style={{ ...styles.selBtn, ...(selectedOnly ? styles.selBtnOn : null) }}
              onClick={() => setSelectedOnly((v) => !v)}
              title="Show only the selected (pinned) genes"
            >
              ★ {pinnedIds.size} selected
            </button>
            <button
              className="oe-dt-btn"
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
          className="oe-dt-btn"
          style={{ ...styles.reset, opacity: active ? 1 : 0.45 }}
          onClick={reset}
          disabled={!active}
          title="Clear search, sort and filters"
        >
          Reset
        </button>
      </div>
      {/* The scroller sits in a positioned box so the edge fades can overlay it. */}
      <div style={styles.scrollBox}>
        <div
          style={styles.scroll}
          ref={scrollRef}
          onScroll={measureEdges}
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
                      className="oe-dt-th"
                      data-col-menu
                      onClick={(e) => openMenu(c.key, e.currentTarget)}
                      style={{
                        ...styles.th,
                        textAlign: 'center',
                        color: filtered || sorted ? UI.accent : UI.text
                      }}
                      title="Sort & filter"
                    >
                      <span style={styles.thInner}>
                        {c.labelLines?.length ? (
                          // Name | value per line; the names right-aligned against their values.
                          <span style={styles.thLines}>
                            {c.labelLines.map((l, i) => (
                              <Fragment key={i}>
                                <span style={styles.thKey}>{l.key}</span>
                                <span style={styles.thValue}>{l.value}</span>
                              </Fragment>
                            ))}
                          </span>
                        ) : (
                          <span style={styles.thLabel}>
                            {c.label.split(LABEL_SEP).map((part, i) => (
                              <span key={i}>{part}</span>
                            ))}
                          </span>
                        )}
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
                const alt = i % 2 === 1
                return (
                  <tr
                    key={`${id}\u0000${rowIndex ? (rowIndex.get(r) ?? i) : i}`}
                    ref={(el) => {
                      // React 19 ref callbacks may return a cleanup; this one tracks the element
                      // explicitly so the map never holds a stale row.
                      trackRow(id, el, alt)
                      return () => {
                        if (el) untrackRow(id, el)
                      }
                    }}
                    onMouseEnter={id ? () => useSelection.getState().setHover(id) : undefined}
                    // Click toggles the gene's pin — the same gesture as clicking a point in a plot —
                    // so selecting a second row adds to the selection instead of replacing it.
                    onClick={id ? () => useSelection.getState().togglePin(id) : undefined}
                    // Background is owned by the imperative painter above (which also
                    // draws the zebra stripe), so React must not set it here and fight it.
                    style={{ cursor: id ? 'pointer' : undefined }}
                  >
                    {columns.map((c) => {
                      // Cut to the column's display cap (maxChars) — the full text on hover.
                      const text = fmt(c, r[c.key])
                      const cap = maxChars?.[c.key]
                      const shown = cap && text.length > cap ? truncateLabel(text, cap) : text
                      return (
                        <td
                          key={c.key}
                          style={{
                            ...styles.td,
                            textAlign: c.align ?? 'left',
                            ...c.cellStyle?.(r[c.key])
                          }}
                          title={shown !== text ? text : undefined}
                        >
                          {shown}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {/* Faint fades where rows run on out of view: under the sticky header once scrolled down,
          and at the bottom while there's more below. Overlays — they never take a click. */}
        {edges.top && (
          <div
            style={{ ...styles.fade, ...styles.fadeTop, top: edges.head, right: edges.barY }}
            aria-hidden
          />
        )}
        {edges.bottom && (
          <div
            style={{ ...styles.fade, ...styles.fadeBottom, bottom: edges.barX, right: edges.barY }}
            aria-hidden
          />
        )}
      </div>
      <div style={styles.footer}>
        showing {shown.length.toLocaleString()} of {processed.length.toLocaleString()} rows
        {processed.length !== rows.length ? ` (filtered from ${rows.length.toLocaleString()})` : ''}
      </div>

      {menu &&
        menuCol &&
        createPortal(
          <ColumnMenu
            rows={menuRows}
            column={menuCol}
            type={colType(menu.key)}
            rect={menu.rect}
            tableScroller={scrollRef}
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
  tableScroller,
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
  /** the table body's scroll container — its scrolling never detaches the (sticky) header */
  tableScroller: RefObject<HTMLElement | null>
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
      const t = e.target as Element
      // A header cell toggles the menu itself on click; treating its mousedown as "outside" closed
      // the menu first, so the click then re-opened it and the header could never close it.
      if (ref.current && !ref.current.contains(t) && !t.closest?.('[data-col-menu]')) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // The menu is fixed to the header cell, so an ancestor scroll would detach it → close. But
    // NOT for scrolls inside the menu (its own value list scrolls) or of the table body (the header
    // is sticky; and applying a filter shrinks the body, clamping its scrollTop and firing a scroll
    // — which closed the menu on the first tick of any checkbox or keystroke in a range box).
    const onScroll = (e: Event): void => {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      const sc = tableScroller.current
      if (sc && (t === sc || sc.contains(t))) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose, tableScroller])

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
  /** A filter bound from the box: blank (or a partial entry like "-") = no bound, never NaN. */
  const numOrNull = (raw: string): number | null => {
    if (raw.trim() === '') return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  }
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
          className="oe-dt-btn"
          style={{ ...styles.sortBtn, ...(sortDir === 'asc' ? styles.sortActive : null) }}
          onClick={() => onSort(sortDir === 'asc' ? null : 'asc')}
        >
          ▲ Ascending
        </button>
        <button
          className="oe-dt-btn"
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
              onChange={(e) => setRange(numOrNull(e.target.value), range.max)}
            />
            <span style={styles.rangeDash}>–</span>
            <input
              style={styles.numInput}
              type="number"
              placeholder="max"
              value={range.max ?? ''}
              onChange={(e) => setRange(range.min, numOrNull(e.target.value))}
            />
          </div>
          {filter && (
            <button className="oe-dt-btn" style={styles.clearBtn} onClick={() => onFilter(null)}>
              Clear filter
            </button>
          )}
        </div>
      ) : (
        <div style={styles.menuBody}>
          <input
            style={styles.menuSearch}
            placeholder="Filter values… (Enter applies)"
            value={find}
            autoFocus
            onChange={(e) => setFind(e.target.value)}
            // Enter confirms: keep exactly the values matching the typed text ("Only shown").
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              e.preventDefault()
              onFilter(filtered.length ? { type: 'categorical', selected: [...filtered] } : null)
            }}
          />
          <div style={styles.menuActions}>
            <button className="oe-dt-link" style={styles.linkBtn} onClick={() => onFilter(null)}>
              All
            </button>
            <button
              className="oe-dt-link"
              style={styles.linkBtn}
              onClick={() => onFilter({ type: 'categorical', selected: [...filtered] })}
            >
              Only shown
            </button>
          </div>
          <div style={styles.options}>
            {filtered.slice(0, CAP).map((v) => (
              <label key={v} className="oe-dt-opt" style={styles.optRow}>
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
    width: '100%',
    boxSizing: 'border-box',
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    // room on the left for the magnifier
    padding: '4px 9px 4px 26px',
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
  selBtnOn: { background: UI.accent, color: UI.accentText, border: `1px solid ${UI.accent}` },
  caption: { padding: '6px 10px', color: UI.textMuted, fontSize: 12, flex: '0 0 auto' },
  scrollBox: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column'
  },
  scroll: { overflow: 'auto', flex: 1, minHeight: 0 },
  fade: { position: 'absolute', left: 0, right: 0, height: 18, pointerEvents: 'none', zIndex: 2 },
  fadeTop: { background: `linear-gradient(to bottom, ${UI.panel}, transparent)` },
  fadeBottom: { background: `linear-gradient(to top, ${UI.panel}, transparent)` },
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
    // The rule under the header as an inset shadow, not a border: with collapsed borders a sticky
    // cell's border stays behind in the table, leaving a 1px slit the rows show through.
    boxShadow: `inset 0 -1px 0 ${UI.border}`,
    whiteSpace: 'nowrap',
    // multi-line labels grow the header row; keep single-line ones on its bottom line
    verticalAlign: 'bottom',
    cursor: 'pointer',
    userSelect: 'none',
    zIndex: 1
  },
  thInner: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  thLines: {
    display: 'inline-grid',
    gridTemplateColumns: 'auto auto',
    columnGap: 4,
    alignItems: 'baseline',
    lineHeight: 1.25
  },
  thKey: {
    justifySelf: 'end',
    fontSize: 9,
    fontWeight: 400,
    color: UI.textMuted,
    opacity: 0.8
  },
  thValue: { justifySelf: 'start' },
  thLabel: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    lineHeight: 1.25
  },
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
  sortActive: { background: UI.accent, color: UI.accentText, border: `1px solid ${UI.accent}` },
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
