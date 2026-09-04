/** A single dashboard panel: a titled header over a tile body.
 *  The header carries the `.panel-drag` class so the grid stage (added later) can
 *  bind dragging to the header only, leaving the body free for chart interaction. */
import { memo, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import { rasterizeGd } from '../export/plotExport'
import { sanitize } from '../export/paths'
import { collectTableExports } from '../export/tables'
import { accentOf, categoryOf, plotLabel } from '../graph/registry'
import { useGraph } from '../graph/store'
import { UI } from '../ui/theme'
import type { ClusterConfig, NodeResult, PlotChild, PlotOrient, StepNode } from '../graph/types'
import { Spinner } from '../ui/Spinner'
import { GOI_TOGGLE_KINDS } from './goi'
import { PanelBody } from './PanelBody'
import { enqueueReveal } from './renderQueue'
import { PanelSettingsDialog, type DownloadOpts, type PcaSettings } from './PanelSettingsDialog'
import { useInView } from './useInView'

/** Gear glyph for the panel-settings button. */
function IconGear(): ReactNode {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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
  // A tile's header shows its plot kind (a dr tile shows its axis: Dose- vs Time-response).
  const kind = child ? child.kind : node.data.kind
  const label = plotLabel(kind, child ? child.config : node.data.config)
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
  const canDownload = isPlot || isTable
  // The gear opens the per-tile settings window (view toggles + download); show it whenever
  // the tile has at least one setting to offer.
  // PCA/cluster tiles expose their computation parameters in the settings dialog.
  const pca: PcaSettings | undefined =
    kind === 'pca'
      ? {
          cfg: cfg as ClusterConfig,
          onChange: patchConfig,
          standardize:
            results[edges.find((e) => e.target === node.id)?.source ?? '']?.kind === 'standardize'
        }
      : undefined
  const hasSettings = canDownload || canToggle || canOrient || !!pca
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      if (written > 0) setSettingsOpen(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.tile}>
      <div className="panel-drag" style={{ ...styles.head, cursor: editing ? 'grab' : 'default' }}>
        <span style={{ ...styles.dot, background: accentOf(categoryOf(kind)) }} />
        <span style={styles.title}>{label}</span>
        <div style={styles.controls}>
          {hasSettings && (
            <button
              onClick={() => setSettingsOpen(true)}
              title="Panel settings…"
              aria-label="Panel settings"
              style={styles.dlBtn}
            >
              <IconGear />
            </button>
          )}
        </div>
      </div>
      {settingsOpen && (
        <PanelSettingsDialog
          title={label}
          canToggle={canToggle}
          goiOnly={goiOnly}
          onGoi={setGoiOnly}
          canOrient={canOrient}
          orient={orient}
          onOrient={(o) => patchConfig({ orient: o })}
          canDownload={canDownload}
          isPlot={isPlot}
          pca={pca}
          busy={busy}
          onClose={() => setSettingsOpen(false)}
          onDownload={runDownload}
        />
      )}
      <div style={styles.body} ref={bodyRef}>
        {inView ? (
          <DeferredMount>
            <PanelBody
              node={node}
              edges={edges}
              results={results}
              child={child}
              goiOnly={goiOnly}
              facetSel={facetSel}
            />
          </DeferredMount>
        ) : null}
      </div>
    </div>
  )
})

/** Paint a buffering spinner, then reveal `children` via the global reveal queue (one tile per
 *  frame). Building a tile's plot data is synchronous and can block for a while (clustering,
 *  correlation, big pivots); deferring lets the spinner show first, and pacing reveals through
 *  the queue keeps the app responsive when many heavy tiles mount at once (tab/project switch)
 *  instead of freezing while they all build in the same frame. Remounts show the spinner again. */
function DeferredMount({ children }: { children: ReactNode }): ReactNode {
  const [show, setShow] = useState(false)
  useEffect(() => enqueueReveal(() => setShow(true)), [])
  return show ? <>{children}</> : <Spinner />
}

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
  // Right-aligned control group: the settings (gear) button.
  controls: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto'
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
