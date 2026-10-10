/** One-gene pager shared by the single-gene tiles (TDR, gene bar, DR/TR). The navigable set is
 *  `genes` present in the data (the selected genes, or every gene for a DR), plus any pins not
 *  in it; a header
 *  shows "‹ n/m › gene_name", the arrows step through the set, and the gene-name button opens a
 *  searchable dropdown to jump straight to any gene. A gene hovered in another plot/table
 *  transiently drives the figure (linked selection) without moving the pager. Renders
 *  `children(gene)` for the currently-shown gene. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Chevron } from '../ui/Chevron'
import { IconSearch } from '../ui/GeneSelectMenu'
import { GENE_LIST_STYLES } from '../ui/geneListStyles'
import { PALETTES, UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { useUiTheme } from '../ui/useUiTheme'
import { useGeneDescriptions } from './useGeneMenuTabs'

export function GeneSwitch({
  genes,
  present,
  displayMap,
  aside,
  lead,
  children
}: {
  /** a control at the LEFT of the switcher's row, before the gene (e.g. the tile's view switch) */
  lead?: ReactNode
  /** a control at the right end of the switcher's row (e.g. the tile's axis-scale switch) */
  aside?: ReactNode
  genes: string[]
  /** uniqIDs that actually have data — a hovered/pinned gene only shows if present */
  present: Set<string>
  displayMap: Record<string, string>
  children: (gene: string) => ReactNode
}): ReactNode {
  const [pos, setPos] = useState(0)
  const hoverId = useSelection((s) => s.hoverId)
  const pinnedIds = useSelection((s) => s.pinnedIds)
  // Navigable set = `genes`, with any other pinned genes present in the data appended.
  const set = useMemo(() => {
    const seen = new Set(genes)
    const extra = [...pinnedIds].filter((id) => !seen.has(id) && present.has(id))
    return [...genes.filter((id) => present.has(id)), ...extra]
  }, [genes, pinnedIds, present])

  const safePos = set.length ? Math.min(pos, set.length - 1) : 0
  // A hovered gene (even one outside the set) transiently drives the figure; otherwise the paged
  // gene, else the first.
  const hoverActive = hoverId && present.has(hoverId) ? hoverId : null
  const displayed = hoverActive ?? set[safePos] ?? null

  // No gene yet: still show the lead control (a view switch must stay reachable).
  if (!displayed)
    return lead ? (
      <div style={styles.root}>
        <div className="oe-switch-strip" style={styles.bar}>
          {lead}
        </div>
        <div style={styles.placeholder}>Hover or select a gene to display.</div>
      </div>
    ) : (
      <div style={styles.placeholder}>Hover or select a gene to display.</div>
    )

  const idx = set.indexOf(displayed)
  const many = set.length > 1
  // Step through the set, wrapping within [0, set.length).
  const go = (d: number): void => {
    if (set.length)
      setPos(((((idx >= 0 ? idx : safePos) + d) % set.length) + set.length) % set.length)
  }

  return (
    <div style={styles.root}>
      <div className="oe-switch-strip" style={styles.bar}>
        {lead && <span style={{ display: 'flex', marginRight: 6 }}>{lead}</span>}
        <button
          onClick={() => go(-1)}
          disabled={!many}
          title="Previous gene"
          style={{
            ...styles.arrow,
            opacity: many ? 1 : 0.35,
            cursor: many ? 'pointer' : 'default'
          }}
        >
          <Chevron deg={180} size={11} color={UI.text} />
        </button>
        <span style={styles.pos}>{idx >= 0 ? `${idx + 1}/${set.length}` : `–/${set.length}`}</span>
        <button
          onClick={() => go(1)}
          disabled={!many}
          title="Next gene"
          style={{
            ...styles.arrow,
            opacity: many ? 1 : 0.35,
            cursor: many ? 'pointer' : 'default'
          }}
        >
          <Chevron deg={0} size={11} color={UI.text} />
        </button>
        <GenePicker
          set={set}
          current={displayed}
          displayMap={displayMap}
          onPick={(id) => {
            const i = set.indexOf(id)
            if (i >= 0) setPos(i)
          }}
        />
        {aside && <span style={{ marginLeft: 'auto', display: 'flex' }}>{aside}</span>}
      </div>
      <div style={styles.body}>{children(displayed)}</div>
    </div>
  )
}

/** The gene-name button + searchable jump-to dropdown (portaled to <body> so it isn't clipped by
 *  the tile). */
function GenePicker({
  set,
  current,
  displayMap,
  onPick
}: {
  set: string[]
  current: string
  displayMap: Record<string, string>
  onPick: (id: string) => void
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
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Each gene's protein description, as the nav's gene selector shows it — listed and searched.
  const descs = useGeneDescriptions()
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle
      ? set.filter(
          (id) =>
            (displayMap[id] ?? id).toLowerCase().includes(needle) ||
            (descs[id]?.toLowerCase().includes(needle) ?? false)
        )
      : set
  }, [set, q, displayMap, descs])

  const toggle = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setQ('')
    setOpen((o) => !o)
  }

  const L = GENE_LIST_STYLES
  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        title="Jump to a gene"
        aria-expanded={open}
        style={{ ...styles.nameBtn, color: UI.text, borderColor: open ? UI.accent : UI.border }}
      >
        <span style={styles.name}>{displayMap[current] ?? current}</span>
        <Chevron deg={open ? -90 : 90} />
      </button>
      {open &&
        rect &&
        createPortal(
          // The nav's gene selector window: its search field, then gene rows — name, description.
          <div
            ref={menuRef}
            style={{
              ...L.menu,
              left: rect.left,
              top: rect.bottom + 4,
              width: MENU_W,
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
                placeholder={`Search ${set.length.toLocaleString()} gene${set.length === 1 ? '' : 's'}…`}
                style={{
                  ...L.search,
                  paddingLeft: 26,
                  background: p.panelAlt,
                  color: p.text,
                  border: `1px solid ${p.border}`
                }}
              />
            </div>
            <div
              style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              {filtered.length === 0 ? (
                <div style={{ ...L.more, paddingLeft: 6, color: p.textMuted }}>No match.</div>
              ) : (
                filtered.slice(0, LIST_CAP).map((id) => {
                  const on = id === current
                  const desc = descs[id]
                  return (
                    <div
                      key={id}
                      role="button"
                      onClick={() => {
                        onPick(id)
                        setOpen(false)
                      }}
                      style={{
                        ...L.geneRow,
                        paddingLeft: 6,
                        color: p.text,
                        fontWeight: on ? 700 : undefined,
                        ...(on ? { background: `${p.accent}22` } : {})
                      }}
                    >
                      <span style={L.geneName}>{displayMap[id] ?? id}</span>
                      {desc && (
                        <span style={{ ...L.geneDesc, color: p.textMuted }} title={desc}>
                          {desc}
                        </span>
                      )}
                    </div>
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

/** The dropdown's width — room for a gene's name and its description, as the nav's menu. */
const MENU_W = 340

/** Rows the gene dropdown renders at once — the set can be every gene in the data. */
const LIST_CAP = 300

const styles: Record<string, CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 10px',
    flex: '0 0 auto'
  },
  // A bare chevron (no chip): the pager reads "‹ n/m ›".
  arrow: {
    background: 'transparent',
    border: 'none',
    width: 16,
    height: 20,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    padding: 0
  },
  pos: {
    fontSize: 10,
    fontWeight: 600,
    color: UI.textMuted,
    flex: '0 0 auto',
    fontVariantNumeric: 'tabular-nums'
  },
  nameBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    background: 'transparent',
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px',
    cursor: 'pointer',
    marginLeft: 2
  },
  name: {
    fontSize: 12,
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  body: { flex: 1, minHeight: 0 },
  placeholder: {
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    color: UI.textMuted,
    fontSize: 12,
    padding: 12,
    textAlign: 'center'
  }
}
