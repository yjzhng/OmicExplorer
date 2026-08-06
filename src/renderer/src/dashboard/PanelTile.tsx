/** A single dashboard panel: a titled header over a tile body.
 *  The header carries the `.panel-drag` class so the grid stage (added later) can
 *  bind dragging to the header only, leaving the body free for chart interaction. */
import { memo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import { rasterizeGd } from '../export/plotExport'
import { sanitize } from '../export/paths'
import { collectTableExports } from '../export/tables'
import { accentOf, categoryOf, NODE_SPECS } from '../graph/registry'
import { useGraph } from '../graph/store'
import { UI } from '../ui/theme'
import type { NodeResult, PlotChild, PlotOrient, StepNode } from '../graph/types'
import { GOI_TOGGLE_KINDS } from './goi'
import { PanelBody } from './PanelBody'
import { PanelDownloadDialog, type DownloadOpts } from './PanelDownloadDialog'
import { useInView } from './useInView'

/** Download glyph (tray + down arrow). */
function IconDownload(): ReactNode {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  )
}

/** Orientation glyphs: a wide rectangle (landscape) and a tall one (portrait). */
function IconOrient({ portrait }: { portrait: boolean }): ReactNode {
  const w = portrait ? 9 : 15
  const h = portrait ? 15 : 9
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: 'block' }}>
      <rect
        x={(16 - w) / 2}
        y={(16 - h) / 2}
        width={w}
        height={h}
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  )
}

/** Memoized: dragging a tile updates `groupLayouts`, which re-renders the dashboard.
 *  Without this every other tile would rebuild its plot data on each drop. */
export const PanelTile = memo(function PanelTile({
  node,
  edges,
  results,
  editing = false,
  child,
  facetSel
}: {
  node: StepNode
  edges: Edge[]
  results: Record<string, NodeResult>
  editing?: boolean
  /** when set, this tile is one subcard of the group `node` (Results expands groups). */
  child?: PlotChild
  /** shared facet selection for this tile's group (from the results-header control); the
   *  faceted plots read it instead of showing their own tabs. */
  facetSel?: Record<string, string>
}): ReactNode {
  // A subcard's header shows its plot kind; the group id keeps it traceable to the tile.
  const kind = child ? child.kind : node.data.kind
  const label = NODE_SPECS[kind].label
  const idLabel = child ? `${node.id} · ${child.id}` : node.id
  const [bodyRef, inView] = useInView<HTMLDivElement>()
  // Per-tile view state: plot all genes (default) or only the GOI/focus subset. Only
  // offered for kinds that otherwise draw all genes (see GOI_TOGGLE_KINDS).
  const [goiOnly, setGoiOnly] = useState(false)
  const canToggle = GOI_TOGGLE_KINDS.has(kind)
  // Bubble/dumbbell/heatmap/bar can flip between landscape (categories across x) and
  // portrait (categories down y). Persisted in the node config so it survives a reload;
  // undefined falls back to each plot's natural orientation.
  const canOrient =
    kind === 'bubble' || kind === 'dumbbell' || kind === 'heatmap' || kind === 'geneBar'
  const cfg = child ? child.config : node.data.config
  const defaultOrient: PlotOrient =
    kind === 'dumbbell' || kind === 'heatmap' ? 'portrait' : 'landscape'
  const orient = (cfg as { orient?: PlotOrient }).orient ?? defaultOrient
  const patchConfig = (patch: Record<string, unknown>): void => {
    const s = useGraph.getState()
    if (child) s.updateChildConfig(node.id, child.id, patch)
    else s.updateConfig(node.id, patch)
  }

  // Which panels can be downloaded: plots → image (from the live graph div), analysis
  // tables → CSV/XLSX. Load/empty panels have nothing to save. Clicking opens an options
  // window (format, and DPI for plots).
  const isTable = kind === 'standardize' || kind === 'compare' || kind === 'contrast'
  const isPlot = categoryOf(kind) === 'plotting'
  const [dlOpen, setDlOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function runDownload(opts: DownloadOpts): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const base = sanitize(`${label}_${child ? `${node.id}_${child.id}` : node.id}`)
      let written = 0
      if (isPlot) {
        const gd = bodyRef.current?.querySelector('.js-plotly-plot')
        if (gd) {
          const fmt = opts.format === 'pdf' ? 'pdf' : 'png'
          const png = await rasterizeGd(gd, opts.dpi)
          const res = await window.api.exportPlots({
            baseDir: opts.baseDir,
            items: [{ relPath: `${base}.${fmt}`, format: fmt, ...png }]
          })
          written = res.written
        }
      } else {
        const [t] = collectTableExports(
          useGraph.getState().nodes,
          edges,
          results,
          new Set([node.id])
        )
        if (t) {
          const fmt = opts.format === 'xlsx' ? 'xlsx' : 'csv'
          const res = await window.api.exportTables({
            baseDir: opts.baseDir,
            format: fmt,
            items: [
              {
                relPath: `${base}.${fmt}`,
                sheetName: `${t.label} ${t.key}`,
                columns: t.columns,
                rows: t.rows
              }
            ]
          })
          written = res.written
        }
      }
      // Close on a successful write; keep the window open otherwise.
      if (written > 0) setDlOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.tile}>
      <div className="panel-drag" style={{ ...styles.head, cursor: editing ? 'grab' : 'default' }}>
        <span style={{ ...styles.dot, background: accentOf(categoryOf(kind)) }} />
        <span style={styles.title}>{label}</span>
        <span style={styles.id}>{idLabel}</span>
        <div style={styles.controls}>
          {canToggle && (
            <div style={styles.goiToggle} title="Show all genes or only the genes of interest">
              {(['all', 'goi'] as const).map((m) => {
                const on = (m === 'goi') === goiOnly
                return (
                  <button
                    key={m}
                    onClick={() => setGoiOnly(m === 'goi')}
                    style={{
                      ...styles.goiBtn,
                      background: on ? UI.accent : 'transparent',
                      color: on ? UI.accentText : UI.textMuted
                    }}
                  >
                    {m === 'all' ? 'All' : 'GOI'}
                  </button>
                )
              })}
            </div>
          )}
          {canOrient && (
            <div style={styles.goiToggle} title="Plot orientation">
              {(['landscape', 'portrait'] as const).map((o) => {
                const on = o === orient
                return (
                  <button
                    key={o}
                    onClick={() => patchConfig({ orient: o })}
                    title={
                      o === 'landscape'
                        ? 'Landscape (categories across)'
                        : 'Portrait (categories down)'
                    }
                    aria-label={o}
                    style={{
                      ...styles.goiBtn,
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '3px 7px',
                      background: on ? UI.accent : 'transparent',
                      color: on ? UI.accentText : UI.textMuted
                    }}
                  >
                    <IconOrient portrait={o === 'portrait'} />
                  </button>
                )
              })}
            </div>
          )}
          {(isPlot || isTable) && (
            <button
              onClick={() => setDlOpen(true)}
              title="Download panel…"
              aria-label="Download panel"
              style={styles.dlBtn}
            >
              <IconDownload />
            </button>
          )}
        </div>
      </div>
      {dlOpen && (
        <PanelDownloadDialog
          title={label}
          isPlot={isPlot}
          busy={busy}
          onClose={() => setDlOpen(false)}
          onConfirm={runDownload}
        />
      )}
      <div style={styles.body} ref={bodyRef}>
        {inView ? (
          <PanelBody
            node={node}
            edges={edges}
            results={results}
            child={child}
            goiOnly={goiOnly}
            facetSel={facetSel}
          />
        ) : null}
      </div>
    </div>
  )
})

const styles: Record<string, CSSProperties> = {
  tile: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '7px 10px',
    borderBottom: `1px solid ${UI.border}`,
    flex: '0 0 auto',
    background: UI.panelAlt
  },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flex: '0 0 auto' },
  title: { fontSize: 12, fontWeight: 700, color: UI.text },
  id: { fontSize: 11, color: UI.textMuted },
  // Right-aligned control group: GOI switch (optional) + download button.
  controls: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto'
  },
  goiToggle: {
    display: 'inline-flex',
    flex: '0 0 auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    overflow: 'hidden'
  },
  goiBtn: {
    border: 'none',
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.3,
    cursor: 'pointer',
    lineHeight: 1.4
  },
  dlBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 22,
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    cursor: 'pointer'
  },
  body: { flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }
}
