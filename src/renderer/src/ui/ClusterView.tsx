import { useContext, useMemo, type CSSProperties } from 'react'

import {
  CLUSTER_COLOR,
  condLabel,
  isNumericCond,
  metaValue,
  type ClusterData,
  type ClusterMeta,
  type ClusterPoint,
  type ConditionKey,
  type NumericConds
} from '../engine'
import { clusterStyle, type AxisStyle, type ClusterStyle, type PlotAxes } from '../graph/types'
import { AUTO } from './ColorPicker'
import { condsOf, planAesthetics, type PlanOverrides } from './clusterPlan'
import { condTooltip, valueLine } from './condTooltip'
import { bindSampleLink, sampleKey, sampleMeta } from './sampleLink'
import { territoryRing, type TerritoryShape } from './territory'
import { hslHex } from './colormap'
import { shade } from './condColor'
import { PlotlyChart } from './PlotlyChart'
import { AXIS_LINE_WIDTH, PlotAxesContext, type PlotAxesCtx } from './plotAxes'
import { axisBase, CATEGORICAL, PALETTES, plotBase, UI, withAlpha, type Palette } from './theme'
import { useUiTheme } from './useUiTheme'
import { sectionKey, SECTIONED_LEGEND } from './legendSections'
import { groupMeta } from './traceFocus'
import { DEFAULT_OUTLINE } from './pointStyle'

/** What marks the data: every replicate, or one centroid per condition. */
type Mode = 'replicate' | 'centroid'
/** The region drawn under each condition's markers, or none. */
type Territory = TerritoryShape | 'none'
type Legend = 'simple' | 'complex'
/** The axes: Plotly's full axes ('standard'), or only a short L at the bottom-left corner with
 *  the axis titles along it ('minimal') — an embedding's coordinates carry no meaning of their own,
 *  so the ticks and numbers are often just clutter. */
type AxisMode = 'standard' | 'minimal'
/** minimal axes: each segment's length (px) */
const MINIMAL_AXIS_PX = 40
/** The neutral the complex legend's shade and arrow keys are drawn in. */
const SHADE_KEY_GREY = '#808080'
/** A dose/time level's place on the shade, by RANK among its levels — 0 the lowest (palest), 1 the
 *  highest (the full colour), evenly apart, so 0.1 / 1 / 10 / 100 nM each read as a step rather
 *  than all pale beside 1000 (as QC and the gene bar shade); one level is the full colour. */
function rankT(levels: number[], v: number | null): number {
  if (v == null || levels.length < 2) return 1
  const i = levels.indexOf(v)
  return i < 0 ? 1 : i / (levels.length - 1)
}

/** Sample/condition embedding (PCA / UMAP / t-SNE). Two independent settings: `display` is what
 *  marks the data — 'replicate' every underlying data point, 'centroid' one marker per condition —
 *  and `territory` a filled region per condition under those markers ('hull' / 'gaussian'), or
 *  'none'. `legend` picks single-condition colouring ('simple') or the multi-condition aesthetics
 *  ('complex'). */
export function ClusterView({
  cluster,
  title,
  display = 'replicate',
  territory = 'none',
  legend = 'simple',
  axisMode = 'standard',
  look = DEFAULT_STYLE,
  scheme = NO_SCHEME,
  categorical = CATEGORICAL,
  condTitle = condLabel,
  numeric
}: {
  /** the dataset's numeric conditions (its schema): ordered colour, shade and arrows */
  numeric: NumericConds
  /** a condition's legend heading — with its unit for dose / time (default: its name) */
  condTitle?: (c: ConditionKey) => string
  cluster: ClusterData
  title?: string
  display?: Mode
  /** outline the replicates' convex hull, a ~95% Gaussian ellipse, or nothing */
  territory?: Territory
  legend?: Legend
  /** full axes, or a short corner L with the titles (see AxisMode) */
  axisMode?: AxisMode
  /** markers' and arrow trails' look (the tile's settings; see ClusterStyle) */
  look?: ClusterStyle
  /** complex legend: the user's colour / shade / arrow choices (unset = automatic) */
  scheme?: PlanOverrides
  /** the categorical palette its groups cycle (the plot's own, else the global one) */
  categorical?: readonly string[]
}) {
  const mode = useUiTheme((s) => s.mode)

  const {
    data,
    layout: own,
    xLabel,
    yLabel
  } = useMemo(() => {
    const p = PALETTES[mode]
    // Axis labels per method: PCA reports variance explained; UMAP/t-SNE are unitless.
    const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
    const [xLabel, yLabel] =
      cluster.method === 'pca'
        ? [`PC1 (${pct(cluster.varExplained[0])})`, `PC2 (${pct(cluster.varExplained[1])})`]
        : cluster.method === 'umap'
          ? ['UMAP 1', 'UMAP 2']
          : ['t-SNE 1', 't-SNE 2']
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: xLabel, zeroline: false },
      yaxis: { ...axisBase(p), title: yLabel, zeroline: false }
    }
    const hover = `%{text}<br>${valueLine(xLabel, '%{x:.3~g}')}<br>${valueLine(yLabel, '%{y:.3~g}')}<extra></extra>`

    // ── Complex legend: aesthetics driven by every varying condition ──────────────
    if (legend === 'complex') {
      const complex = buildComplex(
        cluster,
        display,
        p,
        hover,
        territory,
        look,
        scheme,
        categorical,
        condTitle,
        numeric
      )
      if (complex) {
        lay.legend = complex.legend
        if (complex.annotations.length) lay.annotations = complex.annotations
        return { data: complex.traces, layout: lay, xLabel, yLabel }
      }
      // Not enough varying conditions to be meaningful — fall through to simple.
    }

    // ── Simple legend: colour by the single chosen condition ──────────────────────
    const groups = new Map<string, ClusterPoint[]>()
    for (const pt of cluster.points) {
      let arr = groups.get(pt.group)
      if (!arr) {
        arr = []
        groups.set(pt.group, arr)
      }
      arr.push(pt)
    }
    // A numeric condition (dose, time, any declared numeric) is quantitative: colour its groups in
    // shades of the palette's primary colour, dark = high value, light = low (as the shade channel
    // and QC / the gene bar do) — instead of unordered categorical colours. Groups are then ordered
    // by value so the legend reads low→high.
    const quant =
      cluster.colorBy !== CLUSTER_COLOR &&
      isNumericCond(cluster.colorBy, numeric) &&
      [...groups.keys()].every((g) => g === '' || Number.isFinite(Number(g)))
    const nums = [...new Set([...groups.keys()].map(Number).filter(Number.isFinite))].sort(
      (a, b) => a - b
    )
    const colorOf = (g: string, idx: number): string => {
      if (quant && Number.isFinite(Number(g))) return shade(categorical[0], rankT(nums, Number(g)))
      return categorical[idx % categorical.length]
    }
    const groupEntries = quant
      ? [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
      : [...groups.entries()]

    const traces: Array<Record<string, unknown>> = []
    const groupColor = new Map<string, string>()
    let i = 0
    for (const [g, pts] of groupEntries) {
      const color = colorOf(g, i)
      groupColor.set(g, color)
      traces.push(...condGroupTraces(pts, color, g || '(none)', display, p, hover, look))
      i++
    }
    // A territory per condition, around ALL its replicates — even when the colouring splits them
    // (a computed cluster can) — in the colour of the group most of them are in.
    if (territory !== 'none') {
      const byCond = new Map<string, ClusterPoint[]>()
      for (const pt of cluster.points) byCond.set(pt.cond, [...(byCond.get(pt.cond) ?? []), pt])
      for (const reps of byCond.values()) {
        const count = new Map<string, number>()
        for (const r of reps) count.set(r.group, (count.get(r.group) ?? 0) + 1)
        const g = [...count].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
        traces.push(...territoryTrace(reps, territory, groupColor.get(g)!, g || '(none)'))
      }
    }
    // the legend headed by what the colours are: the condition (dose / time with its unit)
    if (cluster.colorBy !== 'cluster')
      lay.legend = { title: { text: condTitle(cluster.colorBy as ConditionKey) } }
    return { data: territoriesBehind(traces), layout: lay, xLabel, yLabel }
  }, [
    cluster,
    title,
    display,
    territory,
    legend,
    mode,
    look,
    scheme,
    categorical,
    condTitle,
    numeric
  ])

  // Minimal axes take only the tile's title size and axis-line width (drawn into the corner L
  // here); every other override is for axes that aren't drawn, so none is passed on to the chart.
  const outer = useContext(PlotAxesContext)
  const minimal = axisMode === 'minimal'
  const layout = useMemo(
    () => (minimal ? minimalAxes(own, xLabel, yLabel, PALETTES[mode], outer?.axes) : own),
    [minimal, own, xLabel, yLabel, mode, outer?.axes]
  )
  const axesCtx = useMemo((): PlotAxesCtx | undefined => {
    if (!minimal || !outer) return outer
    const report = outer.onDefaults
    return {
      // the tile's legend switch still applies (only the axis overrides are dropped)
      legend: outer.legend,
      // the settings' title placeholders: the titles the L shows, not the hidden axes' blank ones
      onDefaults:
        report && ((d) => report({ x: { ...d.x, title: xLabel }, y: { ...d.y, title: yLabel } }))
    }
  }, [minimal, outer, xLabel, yLabel])

  const diag = cluster.diag
  // Nothing to embed: say why rather than draw an empty plot.
  if (!cluster.points.length)
    return (
      <div style={styles.empty}>
        {diag && diag.items < 2
          ? 'Needs at least two samples to embed.'
          : 'No genes left to embed — every gene was filtered out (missing values or the top-variance cap).'}
      </div>
    )
  return (
    <div style={styles.wrap}>
      <PlotAxesContext.Provider value={axesCtx}>
        <PlotlyChart data={data} layout={layout} onGraphMount={bindSampleLink} />
      </PlotAxesContext.Provider>
      {/* 'complete' kept too few genes (a gap somewhere in nearly every one): embedded on every
          gene, gaps imputed — said here so the setting isn't silently overridden. */}
      {diag?.completeFallback != null && (
        <div
          style={styles.note}
          title={`Missing values is set to “complete”, but only ${diag.completeFallback} gene${diag.completeFallback === 1 ? ' is' : 's are'} quantified in every sample — embedded on all ${diag.features.toLocaleString()} genes with gaps imputed instead.`}
        >
          {diag.completeFallback} complete gene{diag.completeFallback === 1 ? '' : 's'} — gaps
          imputed
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: { position: 'relative', height: '100%', minHeight: 0 },
  empty: {
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    padding: 16,
    fontSize: 12,
    color: UI.textMuted,
    textAlign: 'center'
  },
  note: {
    position: 'absolute',
    left: 8,
    bottom: 4,
    fontSize: 10,
    color: UI.textMuted,
    background: UI.panel,
    borderRadius: 3,
    padding: '1px 5px',
    opacity: 0.9,
    cursor: 'help'
  }
}

/** The layout with minimal axes: Plotly's own axes stripped to nothing (no line, ticks, numbers or
 *  title) and, in their place, two short segments meeting at the plot area's bottom-left corner,
 *  each titled along its length — the x title under the horizontal one, the y title (rotated)
 *  beside the vertical one. Pixel-sized, so the L stays the same size whatever the tile's shape.
 *  Of the tile's axis overrides only the title size (the L's titles) and the axis-line width (its
 *  segments) apply. */
function minimalAxes(
  lay: Record<string, unknown>,
  xLabel: string,
  yLabel: string,
  p: Palette,
  axes: PlotAxes | undefined
): Record<string, unknown> {
  const bare = (ax: unknown): Record<string, unknown> => ({
    ...(ax as Record<string, unknown>),
    title: { text: '' },
    showline: false,
    showticklabels: false,
    ticks: '',
    zeroline: false
  })
  // Each segment as thick as its axis's line-width setting (unset: the default, as the Axes section's box shows).
  const line = (st: AxisStyle | undefined): Record<string, unknown> => ({
    color: p.textMuted,
    width: st?.lineWidth || AXIS_LINE_WIDTH
  })
  const corner = { type: 'line', xref: 'paper', yref: 'paper', layer: 'above' }
  const shapes = [
    {
      ...corner,
      line: line(axes?.x),
      xsizemode: 'pixel',
      xanchor: 0,
      x0: 0,
      x1: MINIMAL_AXIS_PX,
      y0: 0,
      y1: 0
    },
    {
      ...corner,
      line: line(axes?.y),
      ysizemode: 'pixel',
      yanchor: 0,
      y0: 0,
      y1: MINIMAL_AXIS_PX,
      x0: 0,
      x1: 0
    }
  ]
  const font = (st: AxisStyle | undefined): Record<string, unknown> =>
    st?.titleSize ? { size: st.titleSize } : {}
  const label = { xref: 'paper', yref: 'paper', x: 0, y: 0, showarrow: false }
  const annotations = [
    {
      ...label,
      text: xLabel,
      font: font(axes?.x),
      xanchor: 'left',
      yanchor: 'top',
      yshift: -3
    },
    {
      ...label,
      text: yLabel,
      font: font(axes?.y),
      textangle: -90,
      xanchor: 'right',
      yanchor: 'bottom',
      xshift: -3
    }
  ]
  const ownShapes = Array.isArray(lay.shapes) ? (lay.shapes as unknown[]) : []
  const ownNotes = Array.isArray(lay.annotations) ? (lay.annotations as unknown[]) : []
  return {
    ...lay,
    xaxis: bare(lay.xaxis),
    yaxis: bare(lay.yaxis),
    shapes: [...ownShapes, ...shapes],
    annotations: [...ownNotes, ...annotations]
  }
}

/** Territory fills are pushed per group, so without this one group's fill can be drawn over
 *  another group's centroid. Plotly draws in trace order, so hoisting every fill to the front puts
 *  all territories behind all markers. */
function territoriesBehind(traces: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...traces.filter((t) => t.fill != null), ...traces.filter((t) => t.fill == null)]
}

/** A condition's territory: one region around its replicates, in `color` (the colour-by's for that
 *  condition), tied to the legend entry `name`. Empty when they enclose no area — averaged
 *  replicates (one point per condition) draw none. */
function territoryTrace(
  pts: ClusterPoint[],
  territory: TerritoryShape,
  color: string,
  name: string
): Array<Record<string, unknown>> {
  const ring = territoryRing(pts, territory)
  // A closed ring needs 3 corners + the repeat to enclose anything. Shorter than that (a
  // 2-replicate hull is a bare segment) there is no area, and with no stroke there would be nothing to
  // see — so skip it rather than push an invisible trace.
  if (!ring || ring.length < 4) return []
  return [
    {
      type: 'scatter',
      mode: 'lines',
      name,
      legendgroup: name,
      showlegend: false,
      // `toself` closes and fills the ring. No stroke: the region reads as a soft wash in the
      // group's colour, so width must be 0 — a scatter trace draws a line by default.
      fill: 'toself',
      fillcolor: withAlpha(color, 0.14),
      line: { width: 0 },
      x: ring.map((q) => q.x),
      y: ring.map((q) => q.y),
      // The fill must not answer hovers meant for the markers sitting on it.
      hoverinfo: 'skip',
      text: pts[0].cond,
      // dims with its condition when another sample is hovered (see sampleLink)
      meta: sampleMeta(sampleKey(pts[0].meta))
    }
  ]
}

/** One legend group's markers — the replicates or the condition centroids — all colour `color`
 *  and tied to the legend entry `name`. Shared by simple and complex modes; territories are drawn
 *  apart, per condition (territoryTrace). */
function condGroupTraces(
  pts: ClusterPoint[],
  color: string,
  name: string,
  display: Mode,
  p: Palette,
  hover: string,
  look: ClusterStyle,
  showlegend = true,
  showMarkers = true
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  // The conditions the tooltips list, in hierarchy order.
  const conds = condsOf(pts.map((pt) => pt.meta))
  const byCond = new Map<string, ClusterPoint[]>()
  for (const pt of pts) {
    let arr = byCond.get(pt.cond)
    if (!arr) {
      arr = []
      byCond.set(pt.cond, arr)
    }
    arr.push(pt)
  }
  // In arrow mode the connecting arrows replace the markers.
  if (!showMarkers) return out
  if (display === 'centroid') {
    const cx = [...byCond.values()].map((reps) => reps.reduce((s, r) => s + r.x, 0) / reps.length)
    const cy = [...byCond.values()].map((reps) => reps.reduce((s, r) => s + r.y, 0) / reps.length)
    // The condition's identity (without a replicate — the centroid stands for them all), and n.
    const labels = [...byCond.entries()].map(([cond, reps]) => {
      const ident = condTooltip(reps[0].meta, conds, p.textMuted, { rep: false })
      return `${ident || cond}<br>${valueLine('n', reps.length)}`
    })
    out.push({
      type: 'scatter',
      mode: 'markers',
      name,
      legendgroup: name,
      showlegend,
      x: cx,
      y: cy,
      text: labels,
      hovertemplate: hover,
      // a centroid stands for every replicate of its condition (see sampleLink)
      meta: sampleMeta([...byCond.values()].map((reps) => sampleKey(reps[0].meta))),
      marker: {
        color,
        size: look.centroidSize,
        opacity: look.centroidOpacity,
        line: { color: outlineInk(look, p), width: look.outlineWidth ?? DEFAULT_OUTLINE }
      }
    })
    return out
  }
  // 'replicate': every underlying data point, as its own marker.
  out.push({
    type: 'scatter',
    mode: 'markers',
    name,
    legendgroup: name,
    showlegend,
    x: pts.map((pt) => pt.x),
    y: pts.map((pt) => pt.y),
    text: pts.map((pt) => condTooltip(pt.meta, conds, p.textMuted) || pt.sample),
    hovertemplate: hover,
    meta: sampleMeta(pts.map((pt) => sampleKey(pt.meta, pt.meta.rep))),
    marker: {
      color,
      size: look.markerSize,
      opacity: look.markerOpacity,
      line: { color: outlineInk(look, p), width: look.outlineWidth ?? DEFAULT_OUTLINE }
    }
  })
  return out
}

/** The markers' outline colour: the one set, else the panel's (so a dot reads against its fill). */
const outlineInk = (look: ClusterStyle, p: (typeof PALETTES)[keyof typeof PALETTES]): string =>
  look.outlineColor !== AUTO ? look.outlineColor : p.panel
const DEFAULT_STYLE = clusterStyle({})
const NO_SCHEME: PlanOverrides = {}

interface ComplexBuild {
  traces: Array<Record<string, unknown>>
  annotations: Array<Record<string, unknown>>
  legend: Record<string, unknown>
}

/** Build the complex-legend traces/arrows/legend for a cluster, or null when fewer than the
 *  needed conditions vary (caller falls back to the simple legend). */
function buildComplex(
  cluster: ClusterData,
  display: Mode,
  p: Palette,
  hover: string,
  territory: Territory,
  look: ClusterStyle,
  scheme: PlanOverrides,
  categorical: readonly string[],
  condTitle: (c: ConditionKey) => string,
  numeric: NumericConds
): ComplexBuild | null {
  // Distinct conditions (replicates of a condition share meta), in first-seen order.
  const condOrder: string[] = []
  const condPts = new Map<string, ClusterPoint[]>()
  for (const pt of cluster.points) {
    let a = condPts.get(pt.cond)
    if (!a) {
      a = []
      condPts.set(pt.cond, a)
      condOrder.push(pt.cond)
    }
    a.push(pt)
  }
  const metaOf = (cond: string): ClusterMeta => condPts.get(cond)![0].meta
  const metas = condOrder.map(metaOf)
  const conds = condsOf(metas)
  const distinct = (c: ConditionKey): Set<string> => {
    const s = new Set<string>()
    for (const m of metas) {
      const v = metaValue(m, c)
      if (v != null && v !== '') s.add(String(v))
    }
    return s
  }
  const varying = new Set<ConditionKey>(conds.filter((c) => distinct(c).size > 1))
  // The user's channel choices; arrows switched off take the arrow channel away entirely.
  const plan = planAesthetics(
    varying,
    conds,
    numeric,
    look.arrows ? scheme : { ...scheme, arrow: 'none' }
  )
  if (!plan.grouped && !plan.colorKey) return null // nothing varies → let simple mode handle it

  const sortedVals = (c: ConditionKey, numeric: boolean): string[] => {
    const arr = [...distinct(c)]
    return numeric ? arr.sort((a, b) => Number(a) - Number(b)) : arr.sort()
  }

  // Grouped colour: the first qualitative (`outer`) picks a hue family; every remaining
  // qualitative combines into an `inner` tuple that spreads across a window within that family.
  // With exactly cell + cmpd varying that is one cell family per cmpd, as before; a third
  // qualitative simply refines the tuple, so distinct combinations never share a colour.
  const [outerKey, ...innerKeys] = plan.quals
  const outerOf = (m: ClusterMeta): string => (outerKey ? String(metaValue(m, outerKey) ?? '') : '')
  const innerOf = (m: ClusterMeta): string =>
    innerKeys.map((c) => String(metaValue(m, c) ?? '')).join(' | ')
  const outerList = outerKey ? sortedVals(outerKey, false) : []
  const innerByOuter = new Map<string, string[]>()
  if (plan.grouped) {
    const tmp = new Map<string, Set<string>>()
    for (const m of metas) {
      const o = outerOf(m)
      if (!tmp.has(o)) tmp.set(o, new Set())
      tmp.get(o)!.add(innerOf(m))
    }
    for (const [o, set] of tmp) innerByOuter.set(o, [...set].sort())
  }
  const FAMILY_SPAN = 60
  const groupedHue = (outer: string, inner: string): number => {
    const si = Math.max(0, outerList.indexOf(outer))
    const center = (360 * si) / Math.max(1, outerList.length)
    const inners = innerByOuter.get(outer) ?? [inner]
    const ci = Math.max(0, inners.indexOf(inner))
    const off = inners.length > 1 ? (ci / (inners.length - 1) - 0.5) * FAMILY_SPAN : 0
    return center + off
  }

  // Single-qualitative colour (categorical).
  const qualVals = plan.colorKey && !plan.colorRamp ? sortedVals(plan.colorKey, false) : []
  const qualIdx = new Map(qualVals.map((v, i) => [v, i]))

  // Quantitative colour ramp (only when there is no qualitative to colour by): shades of the
  // palette's primary colour, light = low → dark = high.
  const rampKey = plan.colorRamp ? (plan.colorKey as ConditionKey) : null
  const rampNums = rampKey ? sortedVals(rampKey, true).map(Number) : []

  // Shade range (light→dark by a quantitative condition within each colour group).
  const shadeKey = plan.shadeKey
  const shadeNums = shadeKey ? sortedVals(shadeKey, true).map(Number) : []
  const tShade = (v: number | null): number => rankT(shadeNums, v)

  const baseColor = (m: ClusterMeta): string => {
    if (plan.grouped) return hslHex(groupedHue(outerOf(m), innerOf(m)), 0.62, 0.5)
    if (plan.colorKey && !plan.colorRamp) {
      const i = qualIdx.get(String(metaValue(m, plan.colorKey))) ?? 0
      return categorical[i % categorical.length]
    }
    if (rampKey) {
      return shade(categorical[0], rankT(rampNums, Number(metaValue(m, rampKey))))
    }
    return categorical[0]
  }
  // A condition's shade group (`cond=value`, as the shade's legend entries select), if shaded.
  const shadeGroupOf = (m: ClusterMeta): string[] => {
    const v = shadeKey ? metaValue(m, shadeKey) : null
    return shadeKey && v != null && v !== '' ? [`${shadeKey}=${v}`] : []
  }
  const finalColor = (m: ClusterMeta): string => {
    if (!shadeKey) return baseColor(m)
    const v = metaValue(m, shadeKey) // planAesthetics only ever picks a numeric shade key
    return shade(baseColor(m), tShade(typeof v === 'number' ? v : null))
  }

  const groupName = (m: ClusterMeta): string => {
    if (plan.grouped) return [outerOf(m), innerOf(m)].filter((x) => x !== '').join(' | ')
    if (plan.colorKey) return String(metaValue(m, plan.colorKey)) || '(none)'
    return '(all)'
  }
  const groupSort = (m: ClusterMeta): number => {
    if (plan.grouped) {
      const si = outerList.indexOf(outerOf(m))
      const inners = innerByOuter.get(outerOf(m)) ?? []
      return si * 1000 + inners.indexOf(innerOf(m))
    }
    if (plan.colorKey && !plan.colorRamp)
      return qualIdx.get(String(metaValue(m, plan.colorKey))) ?? 0
    if (rampKey) return Number(metaValue(m, rampKey)) || 0
    return 0
  }

  // Data traces (no legend — the legend comes from dedicated swatch traces below so the
  // per-shade colours don't each spawn an entry).
  // When arrows are on, they carry the connection between conditions — the dots are hidden so the
  // trail reads cleanly, unless they're set to stay under it.
  const arrowMode = !!plan.arrowKey && !look.markersUnderArrows
  const dataTraces: Array<Record<string, unknown>> = []
  const legendReps = new Map<string, { color: string; sort: number }>()
  for (const cond of condOrder) {
    const pts = condPts.get(cond)!
    const m = pts[0].meta
    const gname = groupName(m)
    if (!legendReps.has(gname)) legendReps.set(gname, { color: baseColor(m), sort: groupSort(m) })
    // Each condition's marks are in its colour group (their legendgroup) AND its shade value's
    // group, so the shade's legend entries highlight a dose across every colour (traceFocus).
    const shadeGroups = shadeGroupOf(m)
    dataTraces.push(
      ...[
        // its territory around its replicates, in its colour — drawn even in arrow mode: the
        // arrows stand in for the markers, not the region
        ...(territory !== 'none' ? territoryTrace(pts, territory, finalColor(m), gname) : []),
        ...condGroupTraces(pts, finalColor(m), gname, display, p, hover, look, false, !arrowMode)
      ].map((t) =>
        shadeGroups.length
          ? { ...t, meta: { ...(t.meta as object), ...groupMeta({ groups: shadeGroups }) } }
          : t
      )
    )
  }
  // Territories behind the markers; the legend swatches and arrows below go on top of both.
  const traces: Array<Record<string, unknown>> = territoriesBehind(dataTraces)
  // The legend, a section per channel under its condition (legendSections): one swatch per colour
  // group (base, un-shaded colour), ordered by the group hierarchy — each selects its group.
  const colorSection = plan.grouped
    ? plan.quals.map(condTitle).join(' × ')
    : condTitle(plan.colorKey as ConditionKey)
  for (const [name, info] of [...legendReps.entries()].sort((a, b) => a[1].sort - b[1].sort))
    traces.push(
      sectionKey({
        name,
        section: colorSection,
        group: name,
        marker: { color: info.color, size: 11 }
      })
    )

  // Arrows: within each series (points identical except the arrow condition), connect the
  // centroids in ascending arrow-value order, low → high.
  const annotations: Array<Record<string, unknown>> = []
  if (plan.arrowKey) {
    const ak = plan.arrowKey
    const otherVarying = conds.filter((c) => c !== ak && varying.has(c))
    const seriesKey = (m: ClusterMeta): string =>
      otherVarying.map((c) => String(metaValue(m, c))).join('¦')
    const series = new Map<string, string[]>()
    for (const cond of condOrder) {
      const k = seriesKey(metaOf(cond))
      if (!series.has(k)) series.set(k, [])
      series.get(k)!.push(cond)
    }
    const centroid = (cond: string): [number, number] => {
      const pts = condPts.get(cond)!
      return [
        pts.reduce((s, r) => s + r.x, 0) / pts.length,
        pts.reduce((s, r) => s + r.y, 0) / pts.length
      ]
    }
    for (const group of series.values()) {
      const sorted = group
        .slice()
        .sort(
          (a, b) =>
            (Number(metaValue(metaOf(a), ak)) || 0) - (Number(metaValue(metaOf(b), ak)) || 0)
        )
      if (sorted.length < 2) continue
      const line = sorted.map(centroid)
      const col = finalColor(metaOf(sorted[sorted.length - 1]))
      // A continuous polyline through the series' centroids — this is the actual connection,
      // with no gaps. Arrow annotations sit on top only to mark direction (low → high).
      // The trail fades with its series' groups — its colour group and, shaded, its shade value
      // (a series varies only along the arrow).
      const sm = metaOf(sorted[0])
      traces.push({
        type: 'scatter',
        mode: 'lines',
        showlegend: false,
        hoverinfo: 'skip',
        meta: groupMeta({ groups: [groupName(sm), ...shadeGroupOf(sm)] }),
        x: line.map((q) => q[0]),
        y: line.map((q) => q[1]),
        line: { color: withAlpha(col, look.trailOpacity), width: look.trailWidth }
      })
      for (let k = 0; k < sorted.length - 1; k++) {
        const [ax, ay] = centroid(sorted[k])
        const [bx, by] = centroid(sorted[k + 1])
        // Put the arrowhead at the SEGMENT MIDPOINT (the polyline already draws the full line).
        // The shaft runs all the way back to the previous centroid — half the segment, hidden
        // under the polyline — so it's always long enough for Plotly to render the head (a shaft
        // only a few pixels long gets its arrowhead dropped).
        annotations.push({
          x: (ax + bx) / 2,
          y: (ay + by) / 2,
          ax,
          ay,
          xref: 'x',
          yref: 'y',
          axref: 'x',
          ayref: 'y',
          showarrow: true,
          arrowhead: 2, // simple solid (filled) triangle
          arrowsize: look.arrowSize,
          arrowwidth: look.trailWidth,
          arrowcolor: withAlpha(col, look.trailOpacity),
          standoff: 0,
          startstandoff: 0
        })
      }
    }
  }

  // The shade's section: its values light → dark, on a neutral grey (each colour group takes the
  // same steps) — each selects its value across every colour; and the arrows' section: the
  // direction they run, a key only (it selects nothing).
  if (shadeKey)
    for (const v of shadeNums)
      traces.push(
        sectionKey({
          name: String(v),
          section: condTitle(shadeKey),
          group: `${shadeKey}=${v}`,
          marker: { color: shade(SHADE_KEY_GREY, tShade(v)), size: 11 }
        })
      )
  if (plan.arrowKey) {
    const vals = sortedVals(plan.arrowKey, true)
    traces.push(
      sectionKey({
        name: `${vals[0]} → ${vals[vals.length - 1]}`,
        section: condTitle(plan.arrowKey),
        group: '',
        marker: { symbol: 'triangle-right', color: SHADE_KEY_GREY, size: 11 }
      })
    )
  }

  return { traces, annotations, legend: { ...SECTIONED_LEGEND } }
}
