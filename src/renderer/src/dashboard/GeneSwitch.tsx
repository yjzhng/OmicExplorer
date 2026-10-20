/** One-gene pager shared by the single-gene tiles (TDR, gene bar, DR/TR, Response). The navigable
 *  set is `genes` present in the data (the selected genes, or every gene for a DR), plus any pins
 *  not in it; a header
 *  shows "‹ [n/m gene_name ▾] ›" (PagerTrigger), the arrows step through the set, and the gene-name button opens a
 *  searchable dropdown to jump straight to any gene. The picker sits at the top centre of the plot
 *  itself, over the gene's name drawn as the figure's title (GeneTitleContext → PlotlyChart), so a
 *  copied / downloaded plot is named; the tile's quick switches keep the strip above. A gene hovered in another plot/table
 *  transiently drives the figure (linked selection) without moving the pager. Renders
 *  `children(gene)` for the currently-shown gene. */
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { GeneTitleContext } from '../ui/geneTitle'
import { PagerTrigger } from '../ui/PagerTrigger'
import { UI } from '../ui/theme'
import { useSelection } from '../ui/useSelection'
import { GeneSearchMenu } from './GeneSearchMenu'

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
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setOpen(false), [])

  const toggle = (): void => {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect())
    setOpen((o) => !o)
  }

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
      {open && rect && (
        <GeneSearchMenu
          genes={set}
          current={current}
          displayMap={displayMap}
          anchor={rect}
          triggerRef={btnRef}
          onPick={onPick}
          onClose={close}
        />
      )}
    </>
  )
}

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
