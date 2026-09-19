/** A single dashboard panel: a titled header over a tile body.
 *  The header carries the `.panel-drag` class so the grid stage (added later) can
 *  bind dragging to the header only, leaving the body free for chart interaction. */
import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode
} from 'react'
import type { Edge } from '@xyflow/react'

import { facetDims, type ConditionKey, type ContextRow } from '../engine'
import { copyGd, gdToExportItem } from '../export/plotExport'
import { sanitize } from '../export/paths'
import { collectTableExports } from '../export/tables'
import { accentOf, categoryOf, PLOT_CONFIG_KINDS, plotLabel } from '../graph/registry'
import { IconGear } from '../ui/icons'
import { PlotAxesContext } from '../ui/plotAxes'
import { useGraph } from '../graph/store'
import { UI } from '../ui/theme'
import { useAppSettings } from '../ui/useAppSettings'
import type { NodeResult, PlotAxes, PlotChild, PlotOrient, StepNode } from '../graph/types'
import { Spinner } from '../ui/Spinner'
import { EMPTY_SEL, resolveFacets } from './facet'
import { SUBSET_TOGGLE_KINDS } from './subset'
import { PanelBody } from './PanelBody'
import { enqueueReveal } from './renderQueue'
import { PanelSettingsDialog, type TilePlotConfig } from './PanelSettingsDialog'
import type { Anchor } from './TileDialog'
import { useInView } from './useInView'

/** Header-button glyphs (16px stroke icons on currentColor). */
const glyph = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

/** Copy: two overlapping sheets. */
function IconCopy(): ReactNode {
  return (
    <svg {...glyph}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" />
    </svg>
  )
}

/** Copied: a tick, shown while the copy feedback is on. */
function IconCheck(): ReactNode {
  return (
    <svg {...glyph}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

/** Download: tray with a downward arrow (matches the top-nav export glyph). */
function IconDownload(): ReactNode {
  return (
    <svg {...glyph}>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 17v2.5h16V17" />
    </svg>
  )
}

/** Gear glyph for the panel-settings button. */
/** A file-name-safe token: runs of anything outside [A-Za-z0-9._-] become one '-'; " | " → "-". */
const fileSafe = (v: string): string => v.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

/** Header buttons never take focus from a mouse click: Chromium kept the focus ring on them after
 *  the click (accent-coloured — near-black in the light theme — it read as a stuck outline).
 *  Keyboard users still reach them by Tab and get the focus-visible ring. */
const noFocus = (e: MouseEvent<HTMLButtonElement>): void => e.preventDefault()

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
  // Per-tile view state: plot all genes (default) or only the selected genes. Only offered for
  // kinds that otherwise draw all genes (see SUBSET_TOGGLE_KINDS).
  const [selectedOnly, setSelectedOnly] = useState(false)
  const canToggle = SUBSET_TOGGLE_KINDS.has(kind)
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

  // Header buttons, top-right: copy · download · config.
  //  - Plots (a live Plotly graph div) copy to the clipboard straight away in the app-wide default
  //    format/DPI (Settings → Plots), and download via a window (SVG/PNG/PDF, DPI, destination).
  //  - Analysis tables download as CSV/XLSX; load/empty panels have nothing to save.
  //  - The gear opens the config window: view toggles plus the canvas tile's own plot config.
  // A Data-table tile shows (and downloads) its UPSTREAM step's table; the analysis tiles their own.
  const tableRootId =
    kind === 'table'
      ? edges.find((e) => e.target === node.id)?.source
      : kind === 'standardize' || kind === 'compare' || kind === 'contrast'
        ? node.id
        : undefined
  const isTable = !!tableRootId
  const isPlot = categoryOf(kind) === 'plotting' && kind !== 'table'
  const canDownload = isPlot || isTable
  const plotConfig: TilePlotConfig | undefined =
    categoryOf(kind) === 'plotting' && PLOT_CONFIG_KINDS.has(kind)
      ? { kind, config: cfg, update: patchConfig, edgeNodeId: node.id }
      : undefined
  const hasSettings = canToggle || canOrient || !!plotConfig
  // The popovers hang below the header, right-aligned to the tile's edge: each open state holds
  // that anchor (the button's vertical extent, the tile's right edge).
  const tileRef = useRef<HTMLDivElement>(null)
  const [settingsAt, setSettingsAt] = useState<Anchor | null>(null)
  const rectOf = (e: MouseEvent<HTMLButtonElement>): Anchor => {
    const r = e.currentTarget.getBoundingClientRect()
    const right = tileRef.current?.getBoundingClientRect().right ?? r.right
    return { top: r.top, bottom: r.bottom, left: r.left, right }
  }
  const [busy, setBusy] = useState(false)
  // Button feedback for 1 s: accent fill + a tick on success, red fill (reason in the tooltip) on
  // failure — for Copy and for Download (whose only UI is the OS save window).
  type Feedback = { ok: true } | { ok: false; why: string } | null
  const [copied, setCopied] = useState<Feedback>(null)
  const [saved, setSaved] = useState<Feedback>(null)
  const copiedTimer = useRef<number | undefined>(undefined)
  const savedTimer = useRef<number | undefined>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(copiedTimer.current)
      window.clearTimeout(savedTimer.current)
    },
    []
  )
  const downloadFormat = useAppSettings((s) => s.downloadFormat)
  const downloadDpi = useAppSettings((s) => s.downloadDpi)
  const tableFormat = useAppSettings((s) => s.tableFormat)
  const copyFormat = useAppSettings((s) => s.copyFormat)
  const copyDpi = useAppSettings((s) => s.copyDpi)

  const liveGd = (): Element | null => bodyRef.current?.querySelector('.js-plotly-plot') ?? null

  async function runCopy(): Promise<void> {
    if (busy) return
    const gd = liveGd()
    setBusy(true)
    let outcome: NonNullable<typeof copied> = { ok: false, why: 'the plot has not drawn yet' }
    try {
      if (gd) {
        await copyGd(gd, copyFormat, copyDpi)
        outcome = { ok: true }
      }
    } catch (e) {
      outcome = { ok: false, why: e instanceof Error ? e.message : String(e) }
      console.error('copy plot failed:', e)
    } finally {
      setBusy(false)
      setCopied(outcome)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(null), 1000)
    }
  }

  /** What this plot is showing, for its file name: the comparison on view (a multi-comparison
   *  tile's `comparison` switch, else the analysis's single comparison) and the context tuple as
   *  `WT`, `Amk`, `10`, `24` parts in hierarchy order. The shared facet selection is resolved
   *  exactly as FacetedPlot resolves it, with the dims a plot consumes as an axis left out
   *  (DR/bubble axis; TDR's dose × time). */
  function viewed(): { comparison: string | null; context: string[] } {
    const upId = edges.find((e) => e.target === node.id)?.source
    const up = upId ? results[upId] : undefined
    const rows: ContextRow[] | null =
      up?.kind === 'compare' ? up.cmp.rows : up?.kind === 'contrast' ? up.ctr.rows : null
    const comparisons =
      up?.kind === 'compare'
        ? up.cmp.comparisons
        : up?.kind === 'contrast'
          ? up.ctr.comparisons
          : []
    if (!rows) return { comparison: null, context: [] }
    const exclude: ConditionKey[] | undefined =
      kind === 'dr' || kind === 'bubble'
        ? [(cfg as { axis: ConditionKey }).axis]
        : kind === 'tdr'
          ? ['dose', 'time']
          : undefined
    const dims = facetDims(rows, exclude)
    const bars = dims.length ? resolveFacets(rows, dims, facetSel ?? EMPTY_SEL).bars : []
    const ORDER = ['cell', 'cmpd', 'dose', 'time']
    const context = bars
      .filter((b) => b.dim !== 'comparison')
      .sort((a, b) => ORDER.indexOf(a.dim) - ORDER.indexOf(b.dim))
      // Bare values in hierarchy order (cell, cmpd, dose, time) — the order says which is which.
      .map((b) => fileSafe(String(b.value)))
    const onView = bars.find((b) => b.dim === 'comparison')?.value
    const comparison =
      onView != null ? String(onView) : comparisons.length === 1 ? comparisons[0] : null
    return { comparison, context }
  }

  /** Download straight to the OS save window in the app-wide default format/DPI (Settings →
   *  Plots) — no window of its own. A failure tints the button and puts the reason in its tip. */
  async function runDownload(): Promise<void> {
    if (busy) return
    const fail = (why: string): void => {
      console.error('download failed:', why)
      setSaved({ ok: false, why })
      window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSaved(null), 3000)
    }
    // File names: `<plot type>-<comparison>_<context…>` — the comparison on view ("Amk | DMSO" →
    // "Amk-DMSO"; none for a Clean-data plot) then the context tuple (`Volcano-Amk-DMSO_WT_10`).
    // Tables: `<table>-<comparison>` or `<table>_<node id>`.
    const v = viewed()
    const cmp = v.comparison ? fileSafe(v.comparison) : null
    // Plot type and comparison are joined with '-' (one "what" token); '_' separates the context.
    const head = cmp ? `${label}-${cmp}` : label
    const base = sanitize(
      [head, ...(isPlot ? v.context : cmp ? [] : [child ? `${node.id}_${child.id}` : node.id])]
        .filter(Boolean)
        .join('_')
    )
    const fmt = isPlot ? downloadFormat : tableFormat
    const dpi = downloadDpi
    // Native save-as: the OS window names the file and picks its folder. Open in the folder the
    // last download in this project went to, else the project's `output/` folder.
    const { dataDir, saveDir } = useGraph.getState()
    const dir = saveDir ?? (dataDir ? `${dataDir}/output` : null)
    const typeName = {
      svg: 'SVG image',
      png: 'PNG image',
      pdf: 'PDF document',
      csv: 'CSV table',
      xlsx: 'Excel workbook'
    }[fmt]
    let path: string | null
    try {
      path = await window.api.pickSavePath({
        defaultPath: dir ? `${dir}/${base}.${fmt}` : `${base}.${fmt}`,
        ext: fmt,
        typeName
      })
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
      return
    }
    if (!path) return // cancelled
    const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
    const baseDir = path.slice(0, cut)
    const fileName = path.slice(cut + 1)
    useGraph.getState().setSaveDir(baseDir) // remembered for this project's next download
    setBusy(true)
    try {
      let written = 0
      let errors: string[] = []
      if (isPlot) {
        const gd = liveGd()
        if (!gd) {
          fail('this panel has no plot drawn yet')
          return
        }
        const item = await gdToExportItem(gd, fileName, fmt as 'png' | 'pdf' | 'svg', dpi)
        const res = await window.api.exportPlots({ baseDir, items: [item] })
        written = res.written
        errors = res.errors
      } else {
        const [t] = collectTableExports(
          useGraph.getState().nodes,
          edges,
          results,
          new Set([tableRootId!])
        )
        if (t) {
          const res = await window.api.exportTables({
            baseDir,
            format: fmt as 'csv' | 'xlsx',
            items: [
              {
                relPath: fileName,
                sheetName: `${t.label} ${t.key}`,
                columns: t.columns,
                rows: t.rows
              }
            ]
          })
          written = res.written
          errors = res.errors
        }
      }
      if (written > 0) {
        setSaved({ ok: true })
        window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSaved(null), 1000)
      } else fail(errors[0] ?? 'nothing was written')
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.tile} ref={tileRef}>
      <div className="panel-drag" style={{ ...styles.head, cursor: editing ? 'grab' : 'default' }}>
        <span style={{ ...styles.dot, background: accentOf(categoryOf(kind)) }} />
        <span style={styles.title}>{label}</span>
        <div style={styles.controls}>
          {isPlot && (
            <button
              onClick={() => void runCopy()}
              disabled={busy}
              title={
                copied
                  ? copied.ok
                    ? 'Copied'
                    : `Copy failed — ${copied.why}`
                  : `Copy plot (${copyFormat.toUpperCase()}${copyFormat === 'png' ? `, ${copyDpi} dpi` : ''})`
              }
              aria-label="Copy plot"
              className="oe-tilebtn"
              data-tint={copied ? (copied.ok ? 'ok' : 'fail') : undefined}
              onMouseDown={noFocus}
              style={{
                ...styles.dlBtn,
                ...(copied ? (copied.ok ? styles.btnOk : styles.btnFail) : null)
              }}
            >
              {copied?.ok ? <IconCheck /> : <IconCopy />}
            </button>
          )}
          {canDownload && (
            <button
              onClick={() => void runDownload()}
              disabled={busy}
              title={
                saved
                  ? saved.ok
                    ? 'Saved'
                    : `Download failed — ${saved.why}`
                  : isPlot
                    ? `Download plot (${downloadFormat.toUpperCase()}${downloadFormat === 'svg' ? '' : `, ${downloadDpi} dpi`})…`
                    : `Download table (${tableFormat.toUpperCase()})…`
              }
              aria-label="Download"
              className="oe-tilebtn"
              data-tint={saved ? (saved.ok ? 'ok' : 'fail') : undefined}
              onMouseDown={noFocus}
              style={{
                ...styles.dlBtn,
                ...(saved ? (saved.ok ? styles.btnOk : styles.btnFail) : null)
              }}
            >
              {saved?.ok ? <IconCheck /> : <IconDownload />}
            </button>
          )}
          {hasSettings && (
            <button
              onClick={(e) => setSettingsAt(rectOf(e))}
              title="Panel settings…"
              aria-label="Panel settings"
              className="oe-tilebtn"
              onMouseDown={noFocus}
              style={styles.dlBtn}
            >
              <IconGear />
            </button>
          )}
        </div>
      </div>
      {settingsAt && (
        <PanelSettingsDialog
          title={label}
          anchor={settingsAt}
          canToggle={canToggle}
          selectedOnly={selectedOnly}
          onSelectedOnly={setSelectedOnly}
          canOrient={canOrient}
          orient={orient}
          onOrient={(o) => patchConfig({ orient: o })}
          plotConfig={plotConfig}
          onClose={() => setSettingsAt(null)}
        />
      )}
      <div style={styles.body} ref={bodyRef}>
        {inView ? (
          <DeferredMount>
            {/* The tile's axis overrides reach every PlotlyChart inside (faceted plots too). */}
            <PlotAxesContext.Provider value={(cfg as { axes?: PlotAxes }).axes}>
              <PanelBody
                node={node}
                edges={edges}
                results={results}
                child={child}
                selectedOnly={selectedOnly}
                facetSel={facetSel}
              />
            </PlotAxesContext.Provider>
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
  // Right-aligned control group: copy · download · settings (gear).
  controls: {
    marginLeft: 'auto',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    flex: '0 0 auto'
  },
  // `.oe-tilebtn` (dashboard.css) adds hover/active feedback, no UA focus outline and a keyboard
  // focus-visible ring; the copy button's `data-tint` suspends hover while its feedback fill shows.
  dlBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 26,
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    cursor: 'pointer'
  },
  // Copy feedback: the button fills with the accent on success, the plotting-category red on
  // failure, for 1 s.
  // Written as the `border` shorthand, like dlBtn: a `borderColor` longhand on top would be
  // cleared to '' when the feedback ends (React leaves the unchanged shorthand alone), leaving the
  // border at currentColor — a stuck dark outline.
  btnOk: { background: UI.accent, color: UI.accentText, border: `1px solid ${UI.accent}` },
  btnFail: { background: '#e0678f', color: '#fff', border: '1px solid #e0678f' },
  body: { flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }
}
