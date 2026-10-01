import { useMemo } from 'react'

import {
  condLabel,
  metaValue,
  type ClusterData,
  type ClusterMeta,
  type ClusterPoint,
  type ConditionKey
} from '../engine'
import { condsOf, planAesthetics } from './clusterPlan'
import { territoryRing, type TerritoryShape } from './territory'
import { blues, hslHex, reds, rgbHex, shadeHex } from './colormap'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** What marks the data: every replicate, or one centroid per condition. */
type Mode = 'replicate' | 'centroid'
/** The region drawn under each condition's markers, or none. */
type Territory = TerritoryShape | 'none'
type Legend = 'simple' | 'complex'
/** `#rrggbb` → `rgba(r,g,b,a)` for translucent territory fills. */
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
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
  legend = 'simple'
}: {
  cluster: ClusterData
  title?: string
  display?: Mode
  /** outline the replicates' convex hull, a ~95% Gaussian ellipse, or nothing */
  territory?: Territory
  legend?: Legend
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
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
    const hover = `%{text}<br>${xLabel}=%{x:.2f}<br>${yLabel}=%{y:.2f}<extra></extra>`

    // ── Complex legend: aesthetics driven by every varying condition ──────────────
    if (legend === 'complex') {
      const complex = buildComplex(cluster, display, p, hover, territory)
      if (complex) {
        lay.legend = complex.legend
        if (complex.annotations.length) lay.annotations = complex.annotations
        return { data: complex.traces, layout: lay }
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
    // Dose/time are quantitative: colour their groups on a sequential ramp (time→Reds, dose→Blues),
    // dark = high value, light = low — instead of unordered categorical colours. Groups are then
    // ordered by value so the legend reads low→high.
    const quant =
      (cluster.colorBy === 'dose' || cluster.colorBy === 'time') &&
      [...groups.keys()].every((g) => g === '' || Number.isFinite(Number(g)))
    const ramp = cluster.colorBy === 'time' ? reds : blues
    const nums = [...groups.keys()].map(Number).filter(Number.isFinite)
    const lo = nums.length ? Math.min(...nums) : 0
    const hi = nums.length ? Math.max(...nums) : 1
    const colorOf = (g: string, idx: number): string => {
      if (quant && Number.isFinite(Number(g))) {
        const t = hi > lo ? (Number(g) - lo) / (hi - lo) : 0.5
        // Start above 0 so the lowest value isn't near-white.
        return rgbHex(ramp(0.2 + 0.8 * t))
      }
      return CATEGORICAL[idx % CATEGORICAL.length]
    }
    const groupEntries = quant
      ? [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
      : [...groups.entries()]

    const traces: Array<Record<string, unknown>> = []
    let i = 0
    for (const [g, pts] of groupEntries) {
      const color = colorOf(g, i)
      const name = g || '(none)'
      traces.push(...condGroupTraces(pts, color, name, display, p, hover, true, true, territory))
      i++
    }
    return { data: territoriesBehind(traces), layout: lay }
  }, [cluster, title, display, territory, legend, mode])

  return <PlotlyChart data={data} layout={layout} />
}

/** Territory fills are pushed per group, so without this one group's fill can be drawn over
 *  another group's centroid. Plotly draws in trace order, so hoisting every fill to the front puts
 *  all territories behind all markers. */
function territoriesBehind(traces: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return [...traces.filter((t) => t.fill != null), ...traces.filter((t) => t.fill == null)]
}

/** One legend group's traces — a territory outline per condition (unless 'none'), under either
 *  the replicate markers or the condition centroids — all colour `color` and tied to the legend
 *  entry `name`. Shared by simple and complex modes. */
function condGroupTraces(
  pts: ClusterPoint[],
  color: string,
  name: string,
  display: Mode,
  p: (typeof PALETTES)[keyof typeof PALETTES],
  hover: string,
  showlegend = true,
  showMarkers = true,
  territory: Territory = 'none'
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const byCond = new Map<string, ClusterPoint[]>()
  for (const pt of pts) {
    let arr = byCond.get(pt.cond)
    if (!arr) {
      arr = []
      byCond.set(pt.cond, arr)
    }
    arr.push(pt)
  }
  // Territories go in FIRST so the centroid markers sit on top of their own fills. They are drawn
  // even in arrow mode (below): the arrows stand in for the MARKERS, not for the region, and a
  // territory the user explicitly asked for shouldn't vanish because a dose series is connected.
  if (territory !== 'none') {
    for (const [cond, reps] of byCond) {
      const ring = territoryRing(reps, territory)
      // A closed ring needs 3 corners + the repeat to enclose anything. Shorter than that (a
      // 2-replicate hull is a bare segment) there is no area, and with no stroke there would be
      // nothing to see — so skip it rather than push an invisible trace.
      if (!ring || ring.length < 4) continue
      out.push({
        type: 'scatter',
        mode: 'lines',
        name,
        legendgroup: name,
        showlegend: false,
        // `toself` closes and fills the ring. No stroke: the region reads as a soft wash in the
        // group's colour, so width must be 0 — a scatter trace draws a line by default.
        fill: 'toself',
        fillcolor: rgba(color, 0.14),
        line: { width: 0 },
        x: ring.map((q) => q.x),
        y: ring.map((q) => q.y),
        // The fill must not answer hovers meant for the centroid marker sitting on it.
        hoverinfo: 'skip',
        text: cond
      })
    }
  }
  // In arrow mode the connecting arrows replace the markers.
  if (!showMarkers) return out
  if (display === 'centroid') {
    const cx = [...byCond.values()].map((reps) => reps.reduce((s, r) => s + r.x, 0) / reps.length)
    const cy = [...byCond.values()].map((reps) => reps.reduce((s, r) => s + r.y, 0) / reps.length)
    const labels = [...byCond.entries()].map(([cond, reps]) => `${cond} (n=${reps.length})`)
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
      marker: { color, size: 13, opacity: 0.95, line: { color: p.panel, width: 1.5 } }
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
    text: pts.map((pt) => pt.sample),
    hovertemplate: hover,
    marker: { color, size: 8, opacity: 0.9 }
  })
  return out
}

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
  p: (typeof PALETTES)[keyof typeof PALETTES],
  hover: string,
  territory: Territory
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
  const plan = planAesthetics(varying, conds)
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

  // Quantitative colour ramp (only when there is no qualitative to colour by).
  const rampKey = plan.colorRamp ? (plan.colorKey as ConditionKey) : null
  const rampFn = rampKey === 'time' ? reds : blues
  const rampNums = rampKey ? sortedVals(rampKey, true).map(Number) : []
  const rlo = rampNums.length ? Math.min(...rampNums) : 0
  const rhi = rampNums.length ? Math.max(...rampNums) : 1

  // Shade range (light→dark by a quantitative condition within each colour group).
  const shadeKey = plan.shadeKey
  const shadeNums = shadeKey ? sortedVals(shadeKey, true).map(Number) : []
  const slo = shadeNums.length ? Math.min(...shadeNums) : 0
  const shi = shadeNums.length ? Math.max(...shadeNums) : 1
  const tShade = (v: number | null): number =>
    v == null || shi <= slo ? 0.5 : (v - slo) / (shi - slo)

  const baseColor = (m: ClusterMeta): string => {
    if (plan.grouped) return hslHex(groupedHue(outerOf(m), innerOf(m)), 0.62, 0.5)
    if (plan.colorKey && !plan.colorRamp) {
      const i = qualIdx.get(String(metaValue(m, plan.colorKey))) ?? 0
      return CATEGORICAL[i % CATEGORICAL.length]
    }
    if (rampKey) {
      const v = Number(metaValue(m, rampKey))
      const t = rhi > rlo ? (v - rlo) / (rhi - rlo) : 0.5
      return rgbHex(rampFn(0.2 + 0.8 * t))
    }
    return CATEGORICAL[0]
  }
  const finalColor = (m: ClusterMeta): string => {
    if (!shadeKey) return baseColor(m)
    const v = metaValue(m, shadeKey) // planAesthetics only ever picks a numeric shade key
    return shadeHex(baseColor(m), tShade(typeof v === 'number' ? v : null))
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
  // When arrows are on, they carry the connection between conditions — hide the dots so the
  // trail reads cleanly.
  const arrowMode = !!plan.arrowKey
  const dataTraces: Array<Record<string, unknown>> = []
  const legendReps = new Map<string, { color: string; sort: number }>()
  for (const cond of condOrder) {
    const pts = condPts.get(cond)!
    const m = pts[0].meta
    const gname = groupName(m)
    if (!legendReps.has(gname)) legendReps.set(gname, { color: baseColor(m), sort: groupSort(m) })
    dataTraces.push(
      ...condGroupTraces(pts, finalColor(m), gname, display, p, hover, false, !arrowMode, territory)
    )
  }
  // Territories behind the markers; the legend swatches and arrows below go on top of both.
  const traces: Array<Record<string, unknown>> = territoriesBehind(dataTraces)
  // One legend swatch per colour group (base, un-shaded colour), ordered by the group hierarchy.
  for (const [name, info] of [...legendReps.entries()].sort((a, b) => a[1].sort - b[1].sort)) {
    traces.push({
      type: 'scatter',
      mode: 'markers',
      name,
      legendgroup: name,
      showlegend: true,
      x: [null],
      y: [null],
      hoverinfo: 'skip',
      marker: { color: info.color, size: 11 }
    })
  }

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
      traces.push({
        type: 'scatter',
        mode: 'lines',
        showlegend: false,
        hoverinfo: 'skip',
        x: line.map((q) => q[0]),
        y: line.map((q) => q[1]),
        line: { color: rgba(col, 0.85), width: 2 }
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
          arrowsize: 1,
          arrowwidth: 2,
          arrowcolor: rgba(col, 0.85),
          standoff: 0,
          startstandoff: 0
        })
      }
    }
  }

  // Legend title summarises the encoding so the reader can decode colour/shade/arrow.
  const enc: string[] = []
  enc.push(
    plan.grouped
      ? `colour: ${plan.quals.map(condLabel).join(' × ')}`
      : `colour: ${condLabel(plan.colorKey as ConditionKey)}`
  )
  if (shadeKey) enc.push(`shade: ${condLabel(shadeKey)} (light→dark)`)
  if (plan.arrowKey) enc.push(`arrow: ${condLabel(plan.arrowKey)} (low→high)`)
  const legendCfg = { title: { text: enc.join('  ·  '), font: { size: 10 } } }

  return { traces, annotations, legend: legendCfg }
}
