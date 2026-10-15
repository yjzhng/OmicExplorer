/** One-gene pager shared by the single-gene tiles (TDR, gene bar, DR/TR, Response). The navigable
 *  set is `genes` present in the data (the selected genes, or every gene for a DR), plus any pins
 *  not in it; a header
 *  shows "‹ [n/m gene_name ▾] ›" (PagerTrigger), the arrows step through the set, and the gene-name button opens a
 *  searchable dropdown to jump straight to any gene. The picker sits at the top centre of the plot
 *  itself, over the gene's name drawn as the figure's title (GeneTitleContext → PlotlyChart), so a
 *  copied / downloaded plot is named; the tile's quick switches keep the strip above. A gene hovered in another plot/table
 *  transiently drives the figure (linked selection) without moving the pager. Renders
 *  `children(gene)` for the currently-shown gene. */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import { GeneTitleContext } from '../ui/geneTitle'
import { IconSearch } from '../ui/GeneSelectMenu'
import { GENE_LIST_STYLES } from '../ui/geneListStyles'
import { PagerTrigger } from '../ui/PagerTrigger'
import { PALETTES, UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { useUiTheme } from '../ui/useUiTheme'
import { useGeneDescriptions } from './useGeneMenuTabs'

export function GeneSwitch({
  genes,
  present,
  displayMap,
  controls,
  children
}: {
  /** the tile's quick switches (inline SwitchBars), in one strip above the plot */
  controls?: ReactNode
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

  // How many charts hold the picker (see GeneTitleCtx.claim); none → it's drawn here instead.
  const [claims, setClaims] = useState(0)
  const claim = useCallback(() => {
    setClaims((c) => c + 1)
    return () => setClaims((c) => c - 1)
  }, [])

  const safePos = set.length ? Math.min(pos, set.length - 1) : 0
  // A hovered gene (even one outside the set) transiently drives the figure; otherwise the paged
  // gene, else the first.
  const hoverActive = hoverId && present.has(hoverId) ? hoverId : null
  const displayed = hoverActive ?? set[safePos] ?? null

  // No gene yet: still show the controls (a view switch must stay reachable).
  if (!displayed)
    return controls ? (
      <div style={styles.root}>
        <div className="oe-switch-strip" style={styles.bar}>
          {controls}
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

  const picker = (
    <GenePicker
      set={set}
      current={displayed}
      displayMap={displayMap}
      pos={{ index: idx, total: set.length }}
      onStep={go}
      canStep={many}
      onPick={(id) => {
        const i = set.indexOf(id)
        if (i >= 0) setPos(i)
      }}
    />
  )

  return (
    <div style={styles.root}>
      {/* The tile's quick switches, in its order (the master ones — view, show — lead, as they
          shape the rest): one strip, wrapping only as the tile's width needs (hidden when empty). */}
      <div className="oe-switch-strip oe-gene-controls" style={styles.bar}>
        {controls}
      </div>
      {/* The picker sits at the top centre of the plot, over the gene's name as its title. */}
      <GeneTitleContext.Provider
        value={{ text: displayMap[displayed] ?? displayed, picker, claim }}
      >
        <div style={styles.body}>
          {children(displayed)}
          {claims === 0 && <div style={styles.fallback}>{picker}</div>}
        </div>
      </GeneTitleContext.Provider>
    </div>
  )
}

/** The gene-name button + searchable jump-to dropdown (portaled to <body> so it isn't clipped by
 *  the tile). */
function GenePicker({
  set,
  current,
  displayMap,
  pos,
  onStep,
  canStep,
  onPick
}: {
  set: string[]
  current: string
  displayMap: Record<string, string>
  /** the pager's "n/m" readout */
  pos: { index: number; total: number }
  onStep: (d: -1 | 1) => void
  canStep: boolean
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
      <PagerTrigger
        name={displayMap[current] ?? current}
        pos={pos}
        open={open}
        onToggle={toggle}
        btnRef={btnRef}
        onStep={onStep}
        canStep={canStep}
        noun="gene"
        title="Jump to a gene"
      />
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
  // As a SwitchStrip's: switches sit apart by its columnGap, wrapping lines by its rowGap.
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 4,
    columnGap: 14,
    padding: '5px 10px',
    flex: '0 0 auto'
  },
  body: { flex: 1, minHeight: 0, position: 'relative' },
  // The picker where no chart holds it (an empty state): at the body's top centre, as on a chart.
  fallback: { position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)' },
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
