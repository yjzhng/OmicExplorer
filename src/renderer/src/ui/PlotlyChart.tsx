/**
 * The app's one Plotly chart: renders a view's traces and layout, and wires what every plot
 * shares. The parts live in ui/plotly/, each its own job:
 *   highlight.ts   linked selection — which points stand for the selected genes, the emphasis
 *                  overlay over them, the in-place fade of the rest
 *   labels.ts      collision-managed point labels and their leader lines
 *   pointer.ts     hovering / clicking a gene point, a tick label or a legend entry
 *   guides.ts, guideDrag.ts   dragging the threshold guides
 *   hoverTip.ts    the floating tooltip, above the tiles at the cursor
 *   legendHover.ts a per-gene legend entry hovers its gene
 *   cameras.ts     3-D scenes: the camera kept across redraws, trackpad pinch zoom
 * This file keeps the React side: the render, the refs the handlers read, the selection
 * subscription, label scheduling and margins.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { createPortal } from 'react-dom'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'
import {
  applyPlotAxes,
  fitMargins,
  thinAxes,
  withoutLegend,
  axisTitleText,
  PlotAxesContext,
  type AxisDefault,
  type AxisDefaults
} from './plotAxes'
import { DEFAULT_HIGHLIGHT, type ResolvedHighlight } from './pointStyle'
import { glSlot, type GlSlot } from './glBudget'
import { binDenseTraces, wouldBin } from './densityBins'
import { sceneCount, toGlTraces } from './glTraces'
import { Spinner } from './Spinner'
import { hasPlotValues, NO_DATA_NOTE } from './plotEmpty'
import { GENE_TITLE_BAND, GeneTitleContext, geneTitleLayout } from './geneTitle'
import { UI } from './theme'
import { TileDrawContext } from './tileDraw'
import { applyFocus } from './traceFocus'
import { useSelection } from './useSelection'
import { reportError } from '../shared/diagnostics'
import {
  type PlotLabel,
  SIDES,
  ABOVE_SIDES,
  labelOpacity,
  labelText,
  placeLabelAnnotations,
  type LabelInputs,
  labelInputs,
  sameLabelInputs,
  annotKey,
  sameAnnots
} from './plotly/labels'
import { type GuideDrag } from './plotly/guides'
import { bindGuides, type GuideState } from './plotly/guideDrag'
import { bindPointer } from './plotly/pointer'
import { bindHoverParking } from './plotly/hoverTip'
import {
  type Trace,
  type BaseOpacity,
  snapshotBases,
  decorateData,
  repaintPoints,
  type OverlayNames,
  applyHighlight
} from './plotly/highlight'
import { bindLegendHover } from './plotly/legendHover'
import { type Aspect, bindPinchZoom, liveCameras } from './plotly/cameras'

export type { PlotLabel } from './plotly/labels'
export type { GuideDrag } from './plotly/guides'

interface PlotlyChartProps {
  data: unknown[]
  layout?: Record<string, unknown>
  style?: CSSProperties
  /** Points eligible for collision-managed labelling (scatter/volcano/MA significant genes). */
  labels?: PlotLabel[]
  /** Label text colour (the view's theme text colour). */
  labelColor?: string
  /** Look of the selection emphasis (overlay bump/ring/name) and of the dimmed cloud — a point
   *  plot's per-tile highlight config, resolved. Defaults to the shared DEFAULT_HIGHLIGHT. */
  emphasis?: ResolvedHighlight
  /** Restrict collision-managed labels to positions ABOVE the marker (centred / up-left / up-right)
   *  — labels slide sideways but never drop below or beside the dot. Used by the enrichment ridge. */
  labelsAbove?: boolean
  /** An active (hovered/pinned) gene keeps its own collision-managed label where it sits, in bold,
   *  instead of the overlay naming it — for a view that draws its own highlight and opts out of the
   *  overlay (the STRING network). The other labels still hide while anything is active, and a
   *  pinned gene stays a candidate, so the labels sit exactly where they do with nothing active. */
  labelsInPlace?: boolean
  /** y-axis tick labels to bold when a linked-selected (hovered/pinned) gene belongs to that tick.
   *  `genesByTick[i]` are the genes associated with tick i; `ticktext[i]` is its (possibly rich-text)
   *  label. Applied imperatively on hover so it doesn't reset zoom. Optionally also re-texts the
   *  per-category legend items (each a separate annotation tagged `__oeLegendCat`) so the entries for
   *  the active ticks' categories bold: `categoryByTick[i]` is tick i's category, and
   *  `legendItemText(cat, active)` returns one legend item's text. */
  boldTicks?: {
    genesByTick: string[][]
    /** full tick text for tick i given its state: `active` (a hovered gene is in it) and
     *  `anyActive` (something is hovered) — so non-active ticks can be muted while one is active. */
    tickLabel: (index: number, active: boolean, anyActive: boolean) => string
    /** which axis carries the gene ticks (default 'y'; the bubble puts genes on 'x' in landscape). */
    axis?: 'x' | 'y'
    categoryByTick?: (string | undefined)[]
    /** one legend item's text for the same state, so the active category's entry stands out. */
    legendItemText?: (category: string, active: boolean, anyActive: boolean) => string
    /** the id a tick's LABEL stands for (an enrichment term's): hovering the label hovers it — the
     *  same focus as hovering its mark — and a click selects it (its genes, through pinIdsOf).
     *  Unset, or null for a tick, = the label is inert. */
    idByTick?: (string | null)[]
  }
  /** Escape hatch for bespoke imperative interactions (e.g. the STRING network's neighbour
   *  highlight): called with the live graph div after each render; return a cleanup run before the
   *  next render and on unmount — told which (`unmounting`): a chart going away needs its listeners
   *  off but nothing redrawn (Plotly would finish that redraw on a purged div, and throw). Prefer
   *  the built-in linked-selection for gene highlighting. */
  onGraphMount?: (el: PlotlyGraphDiv) => ((unmounting?: boolean) => void) | void
  /** A click on an annotation drawn with `captureevents: true` (e.g. a clickable legend chip),
   *  given that annotation's `name`. */
  onAnnotationClick?: (name: string) => void
  /** For a point whose id is its own (an `__oeOwnIds` trace — an enrichment term), the genes it
   *  stands for: a click pins (or unpins) them all, so the selection reaches every plot (an empty
   *  list pins nothing). Unset, or null for an id, = the id itself is pinned. */
  pinIdsOf?: (id: string) => string[] | null | undefined
  /** show Plotly's control bar (zoom/pan/download) on hover — default on; off where it would cover
   *  the view's own controls (the enrichment plot's category chips) */
  modeBar?: boolean
  /** off: no autoscale — the bar's button is gone and a double-click resets to the layout's range.
   *  For a view whose guides run far past its pinned range (so a zoom out still shows them to the
   *  edges), which an autoscale would take in. */
  autoscale?: boolean
  /** ms a hovered gene must stay under the cursor before the OTHER plots light it (the shared
   *  hover). Each one rebuilds and redraws its highlight on a change, so a sweep across a dense
   *  view (a heatmap's thousands of rows) would redraw every open plot per row crossed; held
   *  back, a sweep costs them nothing and a pause still links. This chart's own focus is the
   *  view's (heatmapFocus), immediate. Unset = at once. */
  linkDelay?: number
  /** a 3-D scene's camera, each time the user turns or zooms it (Plotly saves it on mouse-up and
   *  wheel) — so a view that unmounts the chart can put it back as it was */
  onCamera?: (scene: string, camera: Record<string, unknown>) => void
  /** Draggable threshold guides drawn as `layout.shapes`. A custom drag (not Plotly's built-in
   *  shape editing) constrains each guide to ONE axis so a line never slants, shows a resize
   *  cursor on hover, follows the cursor smoothly, and commits the new value via `onGuide`. */
  guides?: GuideDrag[]
  /** Called with a guide's new value ONCE, on release (`done:true`) — the drag itself only moves the
   *  line(s) and previews the value in a tooltip; re-classification happens on this commit. The view
   *  maps `key` to its own threshold field. */
  onGuide?: (key: string, value: number, done: boolean) => void
  /** What the chart says, in place of the figure, when no trace has a point to draw
   *  (hasPlotValues) — default NO_DATA_NOTE; false for a view that writes its own (the enrichment
   *  plot's "No enriched terms"). */
  emptyNote?: string | false
}

/**
 * Layout with every categorical axis pinned strictly categorical. Plotly re-types an axis whenever a
 * trace's x/y data is restyled (as the overlay's is on each hover/pin), and with the default
 * `autotypenumbers: 'convert types'` numeric-looking category strings ("2.5", "10") then flip an
 * explicitly `type: 'category'` axis to linear — even spacing collapses to numeric spacing, and
 * the flip sticks through later renders. 'strict' keeps such strings categorical through any
 * restyle (verified against plotly.js 2.35). Applied centrally so no view needs the workaround.
 */
function strictCategoryAxes(layout: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...layout }
  for (const key of Object.keys(layout)) {
    if (!/^[xy]axis\d*$/.test(key)) continue
    const ax = layout[key] as { type?: unknown; autotypenumbers?: unknown } | undefined
    if (ax && ax.type === 'category' && ax.autotypenumbers === undefined)
      out[key] = { ...ax, autotypenumbers: 'strict' }
  }
  return out
}

/** Thin React wrapper over plotly.js-strict-dist-min (bundled locally — CSP-safe, no CDN). */
export function PlotlyChart({
  data,
  layout,
  style,
  labels,
  labelColor,
  emphasis = DEFAULT_HIGHLIGHT,
  labelsAbove,
  labelsInPlace,
  boldTicks,
  onGraphMount,
  guides,
  onGuide,
  onAnnotationClick,
  pinIdsOf,
  modeBar = true,
  autoscale = true,
  linkDelay,
  onCamera,
  emptyNote = NO_DATA_NOTE
}: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const empty = useMemo(() => emptyNote !== false && !hasPlotValues(data), [data, emptyNote])
  // The latest camera callback, for the once-bound relayout handler.
  const onCameraRef = useRef(onCamera)
  useEffect(() => {
    onCameraRef.current = onCamera
  }, [onCamera])
  // The tile's per-axis overrides (title, fonts, range, ticks, …), merged over the view's layout
  // at render (see plotAxes.ts). Provided by the tile so no view has to thread it.
  const axesCtx = useContext(PlotAxesContext)
  const axes = axesCtx?.axes
  const legendOff = axesCtx?.legend === false
  // A single-gene plot's gene: its name as the figure's title, the live picker laid over it.
  const geneTitle = useContext(GeneTitleContext)
  const geneTitleText = geneTitle?.text
  const claimGeneTitle = geneTitle?.claim
  // Before paint, so the pager's own fallback copy never flashes.
  useLayoutEffect(() => claimGeneTitle?.(), [claimGeneTitle])
  // The dashboard tile around it (if any) waits for its draws before the next tile is revealed.
  const tileDraw = useContext(TileDrawContext)
  // Report what each axis shows WITHOUT an override — the view's own title and the range actually
  // drawn — so the tile's settings can use them as placeholders. The tile only supplies the
  // callback while its settings window is open, so a plot nobody is configuring never pays for it;
  // a signature check means an unchanged report can't loop with the tile's re-render.
  const reportDefaults = axesCtx?.onDefaults
  const reportedRef = useRef('')
  const publishDefaults = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!reportDefaults || !el) return
    const fl = (el as unknown as { _fullLayout?: Record<string, unknown> })._fullLayout
    const axisOf = (key: 'xaxis' | 'yaxis'): AxisDefault => {
      // Range from the LIVE layout (an autoranged axis only resolves at draw time); the title from
      // the view's own layout, since the live one may already carry an override.
      const live = fl?.[key] as
        | {
            range?: unknown
            showgrid?: unknown
            zeroline?: unknown
            showline?: unknown
            mirror?: unknown
          }
        | undefined
      const r = Array.isArray(live?.range) ? (live.range as unknown[]) : []
      const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
      const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
      return {
        title: axisTitleText(layout?.[key]),
        min: num(r[0]),
        max: num(r[1]),
        grid: bool(live?.showgrid),
        zeroline: bool(live?.zeroline),
        line: bool(live?.showline),
        // a frame Plotly draws (mirror) — or none, where it's off or hand-drawn (frameShape)
        frame: live?.mirror == null ? undefined : live.mirror !== false
      }
    }
    const next: AxisDefaults = { x: axisOf('xaxis'), y: axisOf('yaxis') }
    const sig = JSON.stringify(next)
    if (sig === reportedRef.current) return
    reportedRef.current = sig
    reportDefaults(next)
  }, [layout, reportDefaults])
  useEffect(publishDefaults, [publishDefaults])
  // Zoom/pan changes the drawn range, so re-publish (cheap: it no-ops unless something changed).
  const publishRef = useRef(publishDefaults)
  useEffect(() => {
    publishRef.current = publishDefaults
  }, [publishDefaults])
  // Floating tooltip that previews a guide's value while it's being dragged.
  const tipRef = useRef<HTMLDivElement>(null)
  // Buffering: show a spinner until the FIRST Plotly render resolves, then never again (updates
  // to an already-drawn chart shouldn't flash a spinner). No delay — the tile's DeferredMount
  // spinner is torn down the moment this mounts, so showing ours immediately keeps the buffering
  // continuous through the (sometimes slow) Plotly draw instead of leaving a blank gap.
  const [ready, setReady] = useState(false)

  // Latest data/active read imperatively so event handlers bind once (no stale closures).
  // Init-only here; kept current via the effect below (ref writes during render are unsafe).
  const dataRef = useRef(data)
  // Base opacities captured per render (Plotly mutates the trace objects on restyle).
  const basesRef = useRef<BaseOpacity[]>([])
  // Per-trace signature of the highlight last pushed to Plotly (see applyHighlight).
  const appliedRef = useRef<string[]>([])
  // The highlight look every apply site draws with; mirrored from the prop (see the effect below).
  const emphRef = useRef<ResolvedHighlight>(emphasis)

  // Selection is read IMPERATIVELY (not via a useSelection hook) so a hover anywhere doesn't
  // re-render every mounted chart — with many charts on a dashboard that made every hover
  // laggy. The affected traces are restyled directly instead (mirrors DataTableView's paint).
  const activeRef = useRef<Set<string>>(new Set())
  // Just the PINNED (click-selected) ids — used to fade non-selected gene labels. Kept separate from
  // `activeRef` (which also folds in the transient hover) so a hover doesn't dim every other label.
  const pinnedRef = useRef<Set<string>>(new Set())
  // True while a threshold guide is hovered/dragged → applyHighlight fades every point (read by all
  // apply sites so a concurrent selection change keeps the cloud dimmed).
  const guideDimRef = useRef(false)
  // True while the cursor is over a guide (hover OR drag) → Plotly hover is disabled so it can't
  // focus/tooltip the point beneath the line. Read by the render effect so a commit's re-render
  // keeps hover suppressed instead of resetting hovermode.
  const hoverSuppressedRef = useRef(false)
  // y-tick bolding (enrichment ridge): kept in a ref so the once-bound selection handler sees the
  // latest without rebinding; `boldSig` is the last-applied bold pattern to skip redundant relayouts.
  const boldTicksRef = useRef(boldTicks)
  const boldSigRef = useRef('')
  // The annotation-click handler, read by the once-bound Plotly listener.
  const annotationClickRef = useRef(onAnnotationClick)
  // A clicked point's genes (pinIdsOf), read by the once-bound click listeners.
  const pinIdsOfRef = useRef(pinIdsOf)
  // The shared-hover delay (linkDelay), read by the once-bound hover listener.
  const linkDelayRef = useRef(linkDelay)
  // Bespoke imperative interaction (network neighbour highlight): kept in a ref so re-mounts see the
  // latest; `mountCleanup` runs the previous mount's teardown before re-mounting / on unmount.
  const onGraphMountRef = useRef(onGraphMount)
  const mountCleanupRef = useRef<((unmounting?: boolean) => void) | null>(null)
  // Guide-drag config + callback, kept in refs so the once-bound drag handlers always see the latest
  // (the guide `value` baselines update every render as the threshold changes).
  const guidesRef = useRef(guides)
  const onGuideRef = useRef(onGuide)

  // Collision-managed gene labels. Pre-sorted by priority (most important first); the placement
  // pass keeps as many as fit the current view. Read imperatively from refs so the (once-bound)
  // relayout/resize handlers always see the latest without rebinding.
  const sortedLabels = useMemo(
    () => (labels ? [...labels].sort((a, b) => b.priority - a.priority) : undefined),
    [labels]
  )
  // Init-only; kept in sync via the label effect below (writing refs during render is unsafe).
  const labelsRef = useRef(sortedLabels)
  const labelColorRef = useRef(labelColor)
  const labelsAboveRef = useRef(labelsAbove)
  const labelsInPlaceRef = useRef(!!labelsInPlace)
  // Each labelled gene's priority, for the overlay's name culling (see cullOverlayNames).
  const namePriorityRef = useRef(new Map<string, number>())
  const namesNow = (): OverlayNames => ({
    priority: namePriorityRef.current,
    first: useSelection.getState().hoverId
  })
  // Annotations the VIEW put in `layout` (e.g. cluster arrows) — labels are appended to these,
  // never replacing them.
  const baseAnnotsRef = useRef<unknown[]>([])
  const labelRaf = useRef(0)
  // The last placement's inputs, and the annotations it set (annotKey each) — see placeLabels.
  const lastPlacedRef = useRef<{ inputs: LabelInputs; out: string[] } | null>(null)
  // True while the left margin is pinned for bold tick labels (see reserveBoldMargin) — the pin is
  // imperative, so it must be released when the plot stops needing it.
  const pinnedMarginRef = useRef(false)
  // The layout this chart was last rendered with, for restoring a margin the pin overwrote.
  const layoutRef = useRef(layout)
  /** True from the start of a Plotly.react until it resolves (see the react effect). */
  const reactPendingRef = useRef(false)
  /** Settles once every Plotly call this chart has in flight (a render, a margin relayout) has: the
   *  unmount purges only then — purging mid-draw left Plotly's own follow-up work (an automargin
   *  redraw, its events) running on a stripped div, throwing "emit is not a function". */
  const inFlightRef = useRef<Promise<unknown>>(Promise.resolve())
  const track = useCallback(<T,>(p: Promise<T>): Promise<T> => {
    inFlightRef.current = Promise.allSettled([inFlightRef.current, p])
    return p
  }, [])
  /** Per 3-D scene, the aspect ratio last asked for (see liveCameras). */
  const lastAspectRef = useRef<Record<string, Aspect | null>>({})
  // Detaches the current legend-hover listeners (rebound after each render, since Plotly
  // rebuilds the legend DOM).
  const legendCleanupRef = useRef<() => void>(() => {})
  // Detaches the tooltip-parking observer (rebound with the legend, in case a render rebuilt the
  // svg framework and with it the hover layer).
  const hoverParkCleanupRef = useRef<() => void>(() => {})

  const placeLabels = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    const labs = labelsRef.current
    if (!el || !labs) return // this chart opted out of auto-labels
    // A placement is a pure function of its inputs and the plot's geometry: when none of them moved
    // since the last one and the live annotations are still the ones it set (a render, which resets
    // them, makes them differ), it would hand Plotly the same annotations again — a full annotation
    // redraw, after walking every marker for nothing. E.g. a tile resize schedules one before
    // Plotly's (deferred) re-fit has changed anything.
    const inputs = labelInputs(
      el,
      labs,
      labelColorRef.current ?? '#888',
      baseAnnotsRef.current,
      labelsAboveRef.current ? ABOVE_SIDES : SIDES,
      activeRef.current,
      pinnedRef.current,
      labelsInPlaceRef.current
    )
    const last = lastPlacedRef.current
    const liveAnns = (el as unknown as { layout?: { annotations?: unknown[] } }).layout?.annotations
    if (inputs && last && sameLabelInputs(inputs, last.inputs) && sameAnnots(liveAnns, last.out))
      return
    const merged = placeLabelAnnotations(
      el,
      labs,
      labelColorRef.current ?? '#888',
      baseAnnotsRef.current,
      labelsAboveRef.current ? ABOVE_SIDES : SIDES,
      activeRef.current,
      pinnedRef.current,
      labelsInPlaceRef.current
    )
    lastPlacedRef.current = merged && inputs ? { inputs, out: merged.map(annotKey) } : null
    if (merged) {
      // Only annotations change here (never the axis range), so this can't recurse into the
      // relayout handler, which reacts to xaxis/yaxis keys. (`relayout` isn't in the minified
      // type defs, hence the cast.)
      try {
        void (
          Plotly as unknown as {
            relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
          }
        ).relayout(el, { annotations: merged })
      } catch {
        /* labels are cosmetic — never take the panel down */
      }
    }
  }, [])
  const scheduleLabels = useCallback((): void => {
    cancelAnimationFrame(labelRaf.current)
    labelRaf.current = requestAnimationFrame(placeLabels)
  }, [placeLabels])

  // (Re)attach the legend-hover listeners. Plotly rebuilds the legend DOM on render, resize, and
  // zoom, so this runs after each of those.
  const rebindDom = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    legendCleanupRef.current()
    legendCleanupRef.current = bindLegendHover(el)
    hoverParkCleanupRef.current()
    hoverParkCleanupRef.current = bindHoverParking(el)
  }, [])

  // With bold-on-hover tick labels, bolding a label makes it wider — automargin would then re-measure
  // and the left margin would jump. So once automargin has sized the base (non-bold) labels, pin the
  // left margin a bit wider (headroom for the bold weight) and turn automargin OFF, so hovering can't
  // move the margin. Re-run after each render (which resets automargin ON via the passed layout).
  const BOLD_MARGIN_PAD = 1.12
  const reserveBoldMargin = useCallback((): void => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    const R = Plotly as unknown as {
      relayout: (e: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
    }
    // Only the y-axis (enrichment, portrait bubble) case needs the left-margin reserve; an x-axis
    // gene tick (landscape bubble) relies on automargin and must not have its left margin pinned.
    // The pin is IMPERATIVE, so it outlives a re-render — when the gene ticks move to x (the
    // orientation toggle) it has to be undone here, or the old reserve keeps squeezing the plot.
    // A view that sizes the y labels' margin itself (yaxis.automargin: false — it measured them
    // bold, over every row) keeps it: re-measuring here would follow the rows on show.
    const viewPinned =
      (layoutRef.current?.yaxis as { automargin?: unknown } | undefined)?.automargin === false
    if (viewPinned || !boldTicksRef.current || (boldTicksRef.current.axis ?? 'y') !== 'y') {
      if (!pinnedMarginRef.current) return
      pinnedMarginRef.current = false
      void track(
        R.relayout(el, {
          'yaxis.automargin': true,
          'margin.l': (layoutRef.current?.margin as { l?: number } | undefined)?.l ?? 55
        })
      )
        .then(() => scheduleLabels())
        .catch(() => {})
      return
    }
    pinnedMarginRef.current = true
    const readL = (): number | undefined =>
      (el as unknown as { _fullLayout?: { _size?: { l: number } } })._fullLayout?._size?.l
    // MUST measure from automargin each time (idempotent). Plotly.react's minimal diff compares the
    // new layout to the LAST one it was given, not the live gd state — so our prior imperative pin
    // survives a re-render, and reading the current margin would compound it (runaway growth). So
    // first force automargin ON with a small base margin to measure the true required width for the
    // base (non-bold) labels, then pin a bit wider with automargin OFF so hover-bolding can't move it.
    void track(
      R.relayout(el, { 'yaxis.automargin': true, 'margin.l': 6 }).then(() => {
        const l = readL()
        if (!l || !(l > 0)) return undefined
        return R.relayout(el, {
          'yaxis.automargin': false,
          'margin.l': Math.ceil(l * BOLD_MARGIN_PAD) + 2
        })
      })
    )
      .then(() => scheduleLabels()) // legend container-left position depends on the final margin
      .catch(() => {})
  }, [scheduleLabels, track])

  // Mirror the latest `data` / highlight look into the refs the once-bound hover/selection
  // handlers read.
  useEffect(() => {
    dataRef.current = data
  }, [data])
  useEffect(() => {
    emphRef.current = emphasis
  }, [emphasis])
  useEffect(() => {
    layoutRef.current = layout
  }, [layout])

  // WebGL rationing (glBudget.ts): this plot's slot, registered before its first render so that
  // render is already in the right mode; a change of permission re-renders it in place (glTick).
  const glSlotRef = useRef<GlSlot | null>(null)
  const [glTick, setGlTick] = useState(0)
  // Emptied while hidden (its WebGL slot taken by a plot on screen): drawn for real when shown.
  const blankRef = useRef(false)
  // A very dense bulk drawn as a density (densityBins), keeping the labelled genes as markers.
  // The labels matter only to a plot that bins: elsewhere a change of labels must not redraw it.
  const bins = useMemo(() => wouldBin(data), [data])
  const binLabels = useMemo(() => (bins ? labels : undefined), [bins, labels])
  const binned = useMemo(() => {
    const keep = new Set<string>()
    for (const lab of binLabels ?? []) if (lab.id) keep.add(lab.id)
    return binDenseTraces(data, keep)
  }, [data, binLabels])
  const dense = useMemo(() => toGlTraces(binned.traces) !== binned.traces, [binned])
  // The 3-D scenes it draws: each holds a WebGL context however the budget goes (no SVG for them).
  const scenes = useMemo(() => sceneCount(data), [data])
  useLayoutEffect(() => {
    const el = ref.current
    const slot = glSlot({ dense, shown: !!el && el.offsetParent !== null, scenes }, (allowed) => {
      // Its slot taken while it's hidden: free the WebGL context with an empty plot (at its size,
      // so showing it isn't a re-fit) rather than redraw it as SVG for nobody — that redraw, for
      // every plot of the tab just left, was a busy second or more after each tab switch. It's
      // drawn for real when its tab is shown again (below).
      if (!allowed && el && el.offsetParent === null) {
        const lay = (el as unknown as { _fullLayout?: { width?: number; height?: number } })
          ._fullLayout
        blankRef.current = true
        void Plotly.react(el, [], { width: lay?.width, height: lay?.height })
        return
      }
      // Granted while on screen and already drawn (as SVG): it takes WebGL at its next redraw for
      // its own reasons, not now — redrawing every plot of a tab just shown, for a look that
      // doesn't change, was a busy second after each switch. (Emptied ones are drawn on show.)
      if (
        allowed &&
        el &&
        el.offsetParent !== null &&
        !blankRef.current &&
        el.querySelector('.main-svg')
      )
        return
      setGlTick((n) => n + 1)
    })
    glSlotRef.current = slot
    // A dropped context (Chromium's per-page cap) → SVG from now on, never a blank plot. The event
    // doesn't bubble, so listen in the capture phase.
    const onLost = (): void => slot.lost()
    el?.addEventListener('webglcontextlost', onLost, true)
    // On screen or not: a hidden dashboard tab is display:none, so the box goes to 0×0.
    const ro =
      el && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const shown = el.offsetParent !== null
            slot.update({ shown })
            if (shown && blankRef.current) setGlTick((n) => n + 1)
          })
        : null
    if (el) ro?.observe(el)
    return () => {
      ro?.disconnect()
      el?.removeEventListener('webglcontextlost', onLost, true)
      slot.release()
      glSlotRef.current = null
    }
    // Registered once per mount; density changes go through update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useLayoutEffect(() => {
    glSlotRef.current?.update({ dense, scenes })
  }, [dense, scenes])

  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    let cancelled = false
    blankRef.current = false
    // A placement scheduled while this render is in flight would measure the OLD plot and could
    // land after it — the render's own completion schedules the (only) placement instead.
    reactPendingRef.current = true
    // Tell the tile a draw is in flight (ended once it settles, fails, or is superseded).
    const endDraw = tileDraw?.begin()
    // Snapshot base opacities from this render's fresh (un-dimmed) trace objects.
    basesRef.current = snapshotBases(data)
    // Render with the current highlight already baked in (dims + overlay), so this pass shows the
    // final look at once; record the baked state so the in-place apply below skips those traces.
    const baked = decorateData(
      data,
      activeRef.current,
      basesRef.current,
      guideDimRef.current,
      emphasis,
      glSlotRef.current?.allowed() ?? false,
      binned
    )
    appliedRef.current = baked.sigs
    // Remember any view-owned annotations so the label pass appends to (not replaces) them. Clone
    // each object: Plotly mutates the layout we pass it (and strips unknown keys like our
    // __oeAlignContainerLeft flag), which would otherwise break re-placement on zoom/resize.
    baseAnnotsRef.current = Array.isArray(layout?.annotations)
      ? (layout!.annotations as unknown[]).map((a) =>
          a && typeof a === 'object' ? { ...(a as Record<string, unknown>) } : a
        )
      : []
    const shown = {
      traces: baked.traces,
      layout: {
        autosize: true,
        // A copy: Plotly writes into the layout it's given (a relayout of margin.l lands here), and
        // the shared constant would carry one plot's pinned margin into every other plot.
        margin: { ...BASE_MARGIN },
        ...strictCategoryAxes(applyPlotAxes(thinAxes(layout ?? {}), axes, data)),
        // Over the margin in effect (the view's, else the base) — not a bare top margin, which
        // would leave Plotly's own wide defaults on the other sides.
        ...(geneTitleText != null
          ? geneTitleLayout(geneTitleText, {
              ...layout,
              margin: (layout?.margin as object | undefined) ?? BASE_MARGIN
            })
          : null),
        // If a guide is under the cursor when this render fires (e.g. a drag's commit), keep hover
        // disabled so the re-render doesn't reset hovermode and let a point tooltip flash back.
        ...(hoverSuppressedRef.current ? { hovermode: false } : {}),
        ...liveCameras(el, layout, lastAspectRef.current)
      } as Record<string, unknown>
    }
    // The tile's legend switched off: no legend, no colour scale bars.
    const legendFree = legendOff ? withoutLegend(shown.traces, shown.layout) : shown
    // Margins that fit the box actually there (a small tile, a facet's cell): ones that left the
    // plot no room made Plotly throw "Something went wrong with axis scaling", taking the tile down.
    const drawn = {
      traces: legendFree.traces,
      layout: fitMargins(legendFree.layout, el.clientWidth, el.clientHeight)
    }
    void track(
      Plotly.react(el, drawn.traces, drawn.layout, {
        responsive: true,
        displaylogo: false,
        ...(modeBar ? null : { displayModeBar: false }),
        ...(autoscale ? null : { doubleClick: 'reset', modeBarButtonsToRemove: ['autoScale2d'] })
      })
    )
      .then(() => {
        if (cancelled) return
        // A WebGL context Chromium wouldn't create (past its per-page cap, or no usable GPU):
        // Plotly draws its "WebGL is not supported" notice instead of the plot, and no context is
        // ever lost to tell us. SVG from now on, as for a dropped one (a 3-D scene has no SVG to
        // fall back to — its notice stays). A 2-D plot's notice is never shown (app.css), so
        // the fallback doesn't flash it.
        if (el.querySelector('.no-webgl') && !sceneCount(data)) {
          // its notice is an overlay Plotly leaves behind when the traces change: cleared, so
          // the SVG redraw shows — and what Plotly set on its container with it (a white
          // background, a click opening get.webgl.org)
          el.querySelectorAll('.no-webgl').forEach((n) => {
            const box = n.parentElement
            n.remove()
            if (box) {
              box.style.background = ''
              box.onclick = null
            }
          })
          glSlotRef.current?.lost()
        }
        // Bind linked-selection events once per graph div (idempotent).
        const div = el as PlotlyGraphDiv & { __oeBound?: boolean }
        if (!div.__oeBound) {
          div.__oeBound = true
          bindPinchZoom(div)
          // the threshold guides' state, shared by the gene pointer handlers and the guide drag
          const guide: GuideState = { dragging: false, over: false }
          bindPointer(
            el,
            {
              pinIdsOf: () => pinIdsOfRef.current,
              linkDelay: () => linkDelayRef.current,
              boldTicks: () => boldTicksRef.current,
              onAnnotation: (name) => annotationClickRef.current?.(name)
            },
            guide
          )
          // Re-place labels whenever the VIEW RANGE changes (zoom / pan / autorange reset), so a
          // zoomed-in view surfaces labels that were crowded out at full extent. Match only range keys
          // ('xaxis.range[0]', 'yaxis.autorange', …) — NOT our own cosmetic writes (yaxis.ticktext,
          // annotations[i].text, margin.l), which would otherwise re-run placement and clobber the
          // hover bolding we just applied to the ticks/legend.
          ;(
            el as unknown as { on: (ev: string, cb: (ed: Record<string, unknown>) => void) => void }
          ).on('plotly_relayout', (ed) => {
            // A 3-D scene's camera (turned or zoomed) — handed to the view that keeps it.
            for (const [k, v] of Object.entries(ed ?? {})) {
              const m = /^(scene\d*)\.camera$/.exec(k)
              if (m && v && typeof v === 'object')
                onCameraRef.current?.(m[1], v as Record<string, unknown>)
            }
            if (Object.keys(ed ?? {}).some((k) => k.includes('range'))) {
              // A zoom box (or the reset button) can start with the cursor on a point, and Plotly
              // then never sends that point's unhover — the hover stuck, every other gene stayed
              // faded and its label lingered, until a hover elsewhere replaced it. A new view range
              // always ends any hover.
              if (useSelection.getState().hoverId) useSelection.getState().clearHover()
              repaintPoints(el)
              // the overlay's names are culled in pixels: a new range re-culls them
              applyHighlight(
                el,
                dataRef.current,
                activeRef.current,
                basesRef.current,
                appliedRef,
                guideDimRef.current,
                emphRef.current,
                namesNow()
              )
              scheduleLabels()
              rebindDom() // ticks (and legend) re-render on zoom/pan → reattach hover listeners
              publishRef.current()
            }
          })
          bindGuides(
            el,
            {
              guides: () => guidesRef.current,
              onGuide: (key, value, done) => onGuideRef.current?.(key, value, done),
              // Gated so it only restyles on the true/false transitions.
              setGuideDim: (on) => {
                if (guideDimRef.current === on) return
                guideDimRef.current = on
                applyHighlight(
                  el,
                  dataRef.current,
                  activeRef.current,
                  basesRef.current,
                  appliedRef,
                  on,
                  emphRef.current,
                  namesNow()
                )
              },
              hoverSuppressed: hoverSuppressedRef,
              tip: () => tipRef.current
            },
            guide
          )
        }
        reactPendingRef.current = false
        // This render reset the y-tick labels to their base (unbolded) text — force the next selection
        // apply to re-bold by clearing the last-applied signature.
        boldSigRef.current = ''
        // Freeze the left margin with bold headroom so hover-bolding a label can't move it.
        reserveBoldMargin()
        applyHighlight(
          el,
          dataRef.current,
          activeRef.current,
          basesRef.current,
          appliedRef,
          guideDimRef.current,
          emphRef.current,
          namesNow()
        )
        scheduleLabels()
        // Rebind legend-hover (the legend DOM was just (re)built).
        rebindDom()
        // (Re)run any bespoke imperative mount (network neighbour highlight), tearing down the prior.
        mountCleanupRef.current?.()
        mountCleanupRef.current = onGraphMountRef.current?.(el) ?? null
        // A redraw brings fresh traces: put a legend selection back on them.
        applyFocus(el)
        setReady(true)
        publishRef.current()
      })
      // A failed render must not leave placement deferred forever — nor the chart's spinner up
      // (a render that never got through would otherwise read as busy for good). Said, not
      // swallowed, so the cause can be found.
      .catch((err: unknown) => {
        reactPendingRef.current = false
        if (cancelled) return
        reportError(err, { where: 'plotly-render' })
        setReady(true)
      })
      .finally(() => endDraw?.())
    return () => {
      cancelled = true
      endDraw?.()
    }
  }, [
    data,
    binned,
    layout,
    axes,
    legendOff,
    geneTitleText,
    emphasis,
    scheduleLabels,
    rebindDom,
    reserveBoldMargin,
    modeBar,
    autoscale,
    glTick,
    track,
    tileDraw
  ])

  // Drive the highlight from the selection store imperatively: subscribe once, restyle the
  // affected traces on change (rAF-coalesced so a mouse sweep is one redraw), WITHOUT
  // re-rendering this React component — so N mounted charts don't all re-render per hover.
  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    let raf = 0
    // A chart scrolled out of view skips the restyle (it is a redraw nobody sees) and catches up
    // once it scrolls back in — as applyHighlight skips one in a hidden tab.
    let visible = true
    let stale = false
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting)
      if (visible && stale) {
        stale = false
        apply()
      }
    })
    io.observe(el)
    const apply = (): void => {
      const { hoverId, hoverMembers, pinnedIds } = useSelection.getState()
      const active = new Set(pinnedIds)
      if (hoverId) active.add(hoverId)
      // A hovered group (an enrichment term, a STRING cluster — in this view or another) lights
      // its member genes here as a hovered gene is lit. The bold labels keep to the group itself,
      // so other terms sharing a gene don't bold with it.
      const lit = new Set(active)
      for (const g of hoverMembers) lit.add(g)
      // …and the other way: a mark that stands for genes (an enrichment term — pinIdsOf) is
      // selected while EVERY one of its genes is — what clicking it selects — so a clicked term
      // stays highlighted (its label bold) and the rest fade, as hovering it does; terms that only
      // share some of its genes don't light with it.
      const selectedOwn = new Set<string>()
      const genesOf = pinIdsOfRef.current
      if (genesOf && pinnedIds.size) {
        for (const raw of dataRef.current) {
          const t = raw as Trace & { __oeOwnIds?: boolean }
          if (!t.__oeOwnIds || !Array.isArray(t.customdata)) continue
          for (const id of t.customdata) {
            if (typeof id !== 'string' || selectedOwn.has(id)) continue
            const genes = genesOf(id)
            if (genes?.length && genes.every((g) => pinnedIds.has(g))) selectedOwn.add(id)
          }
        }
      }
      for (const id of selectedOwn) lit.add(id)
      // Bold ticks: a group hovered in ANOTHER view bolds its members' ticks here, as a hovered
      // gene does; one this view owns (its own term) bolds only itself — and the selected terms.
      const ownGroup = !!hoverId && pinIdsOfRef.current?.(hoverId) != null
      const bold = ownGroup ? new Set([...active, ...selectedOwn]) : lit
      // the overlay (enlarged, named points) and labels take the members too
      activeRef.current = lit
      pinnedRef.current = new Set(pinnedIds)
      cancelAnimationFrame(raf)
      if (!visible) {
        stale = true
        return
      }
      raf = requestAnimationFrame(() => {
        applyHighlight(
          el,
          dataRef.current,
          lit,
          basesRef.current,
          appliedRef,
          guideDimRef.current,
          emphRef.current,
          namesNow()
        )
        // Bold the y-tick label of any pathway containing an active (hovered/pinned) gene, and (when
        // provided) rebuild the category legend so the active pathways' categories bold too.
        const bt = boldTicksRef.current
        if (bt) {
          const boldRow = bt.genesByTick.map((g) => g.some((x) => bold.has(x)))
          const anyActive = boldRow.some(Boolean)
          const sig = boldRow.map((b) => (b ? '1' : '0')).join('')
          if (sig !== boldSigRef.current) {
            boldSigRef.current = sig
            const tt = boldRow.map((on, i) => bt.tickLabel(i, on, anyActive))
            const update: Record<string, unknown> = { [`${bt.axis ?? 'y'}axis.ticktext`]: tt }
            // Legend: re-text each per-category item (separate annotations, fixed positions) so the
            // active category's entry stands out and the others mute — without shifting them.
            const legendItemText = bt.legendItemText
            if (legendItemText && bt.categoryByTick) {
              const activeCats = new Set<string>()
              boldRow.forEach((b, i) => {
                const c = bt.categoryByTick![i]
                if (b && c) activeCats.add(c)
              })
              baseAnnotsRef.current.forEach((a, idx) => {
                const cat = (a as Record<string, unknown>)?.__oeLegendCat
                if (typeof cat === 'string')
                  update[`annotations[${idx}].text`] = legendItemText(
                    cat,
                    activeCats.has(cat),
                    activeCats.size > 0
                  )
              })
            }
            try {
              void (
                Plotly as unknown as {
                  relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
                }
              ).relayout(el, update)
            } catch {
              /* cosmetic */
            }
          }
        }
        // Collision-managed gene labels, adjusted in place (so they don't re-place) by the same
        // rule the placement pass uses (see labelOpacity).
        const liveAnns = (el as unknown as { layout?: { annotations?: unknown[] } }).layout
          ?.annotations
        if (Array.isArray(liveAnns)) {
          const upd: Record<string, unknown> = {}
          liveAnns.forEach((a, i) => {
            const lid = (a as { __oeLabelId?: string }).__oeLabelId
            if (typeof lid !== 'string') return
            const inPlace = labelsInPlaceRef.current
            // in place, a hovered group's members keep (and bold) their labels as its genes do
            const on = inPlace ? lit : active
            const op = labelOpacity(lid, on, inPlace)
            // Also write the value onto the live object so a placement that lands between this
            // read and the relayout can't leave the two out of step.
            if ((a as { opacity?: number }).opacity !== op) {
              ;(a as { opacity?: number }).opacity = op
              upd[`annotations[${i}].opacity`] = op
            }
            const base = (a as { __oeLabelText?: string }).__oeLabelText
            const text = base != null ? labelText(base, lid, on, inPlace) : undefined
            if (text != null && (a as { text?: string }).text !== text) {
              ;(a as { text?: string }).text = text
              upd[`annotations[${i}].text`] = text
            }
          })
          if (Object.keys(upd).length) {
            try {
              void (
                Plotly as unknown as {
                  relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
                }
              ).relayout(el, upd)
            } catch {
              /* cosmetic */
            }
          }
        }
      })
    }
    apply()
    const unsub = useSelection.subscribe(apply)
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      unsub()
    }
  }, [])

  // Plotly's `plotly_unhover` doesn't reliably fire when the cursor leaves the plot
  // (e.g. exits fast), which would leave points stuck dimmed. Clear on native leave.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onLeave = (): void => useSelection.getState().clearHover()
    el.addEventListener('mouseleave', onLeave)
    return () => el.removeEventListener('mouseleave', onLeave)
  }, [])

  // Plotly's `responsive:true` only reacts to window resize, not container resize.
  // In the reconfigurable dashboard a tile resizes without the window changing, so
  // observe the element and tell Plotly to re-fit (rAF-debounced against drag churn).
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (el.offsetParent === null) return
        // The size Plotly last laid out at: a hidden tab revealed at the size it was drawn (0×0 →
        // back to its own box) needs no re-fit — only the highlight it skipped while hidden.
        const lay = (el as unknown as { _fullLayout?: { width?: number; height?: number } })
          ._fullLayout
        const same =
          lay?.width != null &&
          Math.abs(lay.width - el.clientWidth) < 1 &&
          Math.abs((lay.height ?? 0) - el.clientHeight) < 1
        if (same) {
          applyHighlight(
            el as unknown as PlotlyGraphDiv,
            dataRef.current,
            activeRef.current,
            basesRef.current,
            appliedRef,
            guideDimRef.current,
            emphRef.current,
            namesNow()
          )
          return
        }
        Plotly.Plots.resize(el)
        // Also the moment a hidden tab is revealed (0×0 → sized): flush the highlight
        // that was skipped while it was hidden.
        applyHighlight(
          el as unknown as PlotlyGraphDiv,
          dataRef.current,
          activeRef.current,
          basesRef.current,
          appliedRef,
          guideDimRef.current,
          emphRef.current,
          namesNow()
        )
        // The plot area changed size — labels must be re-placed against the new geometry, and the
        // legend/tick DOM re-rendered, so reattach their hover listeners.
        scheduleLabels()
        rebindDom()
      })
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [scheduleLabels, rebindDom])

  // Re-place labels when the candidate set or colour changes (a new comparison, theme flip, or
  // a selection that reshuffles which genes are pre-labelled by their own traces). Sync the refs
  // the (once-bound) handlers read, then schedule a placement.
  useEffect(() => {
    labelsRef.current = sortedLabels
    labelColorRef.current = labelColor
    labelsAboveRef.current = labelsAbove
    labelsInPlaceRef.current = !!labelsInPlace
    namePriorityRef.current = new Map(
      (sortedLabels ?? []).flatMap((l) => (l.id ? [[l.id, l.priority] as [string, number]] : []))
    )
    // New candidates usually arrive together with new data: that render places them when it
    // completes (see the react effect). Placing now too would measure the outgoing plot.
    if (!reactPendingRef.current) scheduleLabels()
  }, [sortedLabels, labelColor, labelsAbove, labelsInPlace, scheduleLabels])

  useEffect(() => {
    annotationClickRef.current = onAnnotationClick
  }, [onAnnotationClick])
  useEffect(() => {
    pinIdsOfRef.current = pinIdsOf
  }, [pinIdsOf])
  useEffect(() => {
    linkDelayRef.current = linkDelay
  }, [linkDelay])
  // Keep the (once-bound) selection handler's view of the bold-tick config current.
  useEffect(() => {
    boldTicksRef.current = boldTicks
    boldSigRef.current = '' // config changed → re-evaluate on the next selection apply
  }, [boldTicks])

  useEffect(() => {
    onGraphMountRef.current = onGraphMount
  }, [onGraphMount])

  useEffect(() => {
    guidesRef.current = guides
    onGuideRef.current = onGuide
  }, [guides, onGuide])

  // Mounted — read by the deferred purge below: StrictMode (dev) unmounts and remounts at once on
  // the SAME div, and a purge landing after the remount would strip the plot it's now drawing.
  const aliveRef = useRef(false)
  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    aliveRef.current = true
    return () => {
      aliveRef.current = false
      cancelAnimationFrame(labelRaf.current)
      legendCleanupRef.current()
      hoverParkCleanupRef.current()
      mountCleanupRef.current?.(true)
      if (el) {
        el.removeAllListeners?.('plotly_hover')
        el.removeAllListeners?.('plotly_unhover')
        el.removeAllListeners?.('plotly_click')
        el.removeAllListeners?.('plotly_doubleclick')
        el.removeAllListeners?.('plotly_legendclick')
        el.removeAllListeners?.('plotly_legenddoubleclick')
        el.removeAllListeners?.('plotly_relayout')
        // after whatever Plotly still has in flight on it (see inFlightRef) — unless it's been
        // mounted again meanwhile (aliveRef)
        void inFlightRef.current.then(() => {
          if (!aliveRef.current) Plotly.purge(el)
        })
      }
    }
  }, [])

  return (
    // oe-plot-2d: no 3-D scene, so a WebGL failure falls back to SVG — its notice hidden (on this
    // box, not the graph div: a className there would overwrite the classes Plotly adds to it)
    <div
      className={scenes ? undefined : 'oe-plot-2d'}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {/* Nothing to draw: the figure (axes, legend, control bar) hidden, the note alone — kept
          mounted, so the next conditions with data draw into it as ever. */}
      <div
        ref={ref}
        style={{
          width: '100%',
          height: '100%',
          ...style,
          ...(empty ? { visibility: 'hidden' } : null)
        }}
      />
      {geneTitle && (
        <div style={{ ...geneTitleStyle, height: GENE_TITLE_BAND }}>
          <span style={{ pointerEvents: 'auto', display: 'flex' }}>{geneTitle.picker}</span>
        </div>
      )}
      {!ready && <Spinner />}
      {ready && empty && <div style={emptyNoteStyle}>{emptyNote}</div>}
      {/* Drag preview: portaled to <body> so the tile's overflow can't crop it. Positioned
          imperatively (viewport coords) while a guide is being dragged. */}
      {createPortal(<div ref={tipRef} hidden style={tipStyle} />, document.body)}
    </div>
  )
}

/** The chart's margin where a view sets none. */
const BASE_MARGIN = { l: 55, r: 20, t: 30, b: 45 }

/** The gene picker over the figure's title band: top-centre; only the picker itself takes clicks. */
const geneTitleStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none'
}

/** The no-data note, centred in the chart's box (the figure under it hidden). */
const emptyNoteStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  textAlign: 'center',
  color: UI.textMuted,
  fontSize: 13,
  pointerEvents: 'none'
}

/** Floating tooltip for the guide-drag value preview (positioned imperatively during a drag). */
const tipStyle: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  zIndex: 2000,
  background: 'rgba(20,20,20,0.85)',
  color: '#fff',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap'
}
