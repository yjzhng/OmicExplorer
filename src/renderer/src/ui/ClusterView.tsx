import { useMemo } from 'react'

import type { ClusterData, ClusterMeta, ClusterPoint } from '../engine'
import { blues, hslHex, reds, rgbHex, shadeHex } from './colormap'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

type Mode = 'replicate' | 'centroid'
type Legend = 'simple' | 'complex'
type Cond = 'strain' | 'cmpd' | 'dose' | 'time'
const CONDS: Cond[] = ['strain', 'cmpd', 'dose', 'time']

/** `#rrggbb` → `rgba(r,g,b,a)` for translucent territory fills. */
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

/**
 * Complex-legend aesthetic plan: which condition drives colour, which drives light→dark
 * shade, and which is connected by low→high arrows. Qualitative conditions (strain, cmpd)
 * take colour; quantitative ones (dose, time) take shade then arrow. Channel hierarchy is
 * colour → shade → arrow; condition hierarchy is strain → cmpd → dose → time.
 */
interface Plan {
  grouped: boolean // two qualitatives → strain hue-family, cmpd within it
  colorKey: Cond | null // single-qualitative colour, or (colorRamp) the quantitative ramp key
  colorRamp: boolean // colorKey is a quantitative used as a sequential ramp (no qualitative present)
  shadeKey: Cond | null
  arrowKey: Cond | null
}

function planAesthetics(varying: Set<Cond>): Plan {
  const Q = (['strain', 'cmpd'] as Cond[]).filter((c) => varying.has(c))
  const N = (['dose', 'time'] as Cond[]).filter((c) => varying.has(c))
  let grouped = false
  let colorKey: Cond | null = null
  let colorRamp = false
  let shadeKey: Cond | null = null
  let arrowKey: Cond | null = null

  if (Q.length === 2) grouped = true
  else if (Q.length === 1) colorKey = Q[0]
  else if (N.length >= 1) {
    colorKey = N[0]
    colorRamp = true
  }

  const freeQuant = colorRamp ? N.slice(1) : N
  if (grouped) {
    // Grouped colour consumes both qualitatives; quantitatives fall to arrows (dose preferred),
    // an extra one to shade.
    if (freeQuant.length) {
      arrowKey = freeQuant.includes('dose') ? 'dose' : freeQuant[0]
      const rest = freeQuant.filter((k) => k !== arrowKey)
      if (rest.length) shadeKey = rest[0]
    }
  } else if (colorKey && !colorRamp) {
    if (freeQuant.length === 1) shadeKey = freeQuant[0]
    else if (freeQuant.length >= 2) {
      // dose+time with one qualitative: shade by time, connect doses with arrows.
      shadeKey = 'time'
      arrowKey = 'dose'
    }
  } else if (colorRamp && freeQuant.length >= 1) {
    arrowKey = freeQuant[0]
  }
  return { grouped, colorKey, colorRamp, shadeKey, arrowKey }
}

/** Compact number for the diagnostic caption: scientific for large/small magnitudes, else a couple
 *  of significant figures. */
function fmtNum(v: number): string {
  if (!Number.isFinite(v)) return '–'
  const a = Math.abs(v)
  if (a !== 0 && (a >= 1e4 || a < 1e-2)) return v.toExponential(1)
  return v.toLocaleString(undefined, { maximumSignificantDigits: 3 })
}

/** Sample/condition embedding (PCA / UMAP / t-SNE). `display` toggles what is drawn:
 *  'centroid' shows one marker per condition, 'replicate' shows every underlying data point.
 *  `legend` picks single-condition colouring ('simple') or the multi-condition aesthetics
 *  ('complex'). */
export function ClusterView({
  cluster,
  title,
  display = 'centroid',
  legend = 'simple'
}: {
  cluster: ClusterData
  title?: string
  display?: Mode
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
      const complex = buildComplex(cluster, display, p, hover)
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
      traces.push(...condGroupTraces(pts, color, name, display, p, hover))
      i++
    }
    return { data: traces, layout: lay }
  }, [cluster, title, display, legend, mode])

  const d = cluster.diag
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <PlotlyChart data={data} layout={layout} />
      </div>
      {d && (
        <div
          style={{
            flex: '0 0 auto',
            padding: '3px 10px',
            fontSize: 10,
            color: 'var(--text-muted)',
            fontVariantNumeric: 'tabular-nums',
            textAlign: 'right'
          }}
        >
          {d.items} items · {d.features.toLocaleString()} features · {d.missingPct.toFixed(1)}% missing
          {d.transform && (
            <>
              {' '}
              · {d.transform}
              {d.range && (
                <>
                  {' '}
                  (raw {fmtNum(d.range[0])}–{fmtNum(d.range[1])})
                </>
              )}
            </>
          )}
          {d.scree && d.scree.length > 0 && (
            <> · scree {d.scree.slice(0, 5).map((v) => `${(v * 100).toFixed(1)}`).join(' · ')}%</>
          )}
        </div>
      )}
    </div>
  )
}

/** Territory ellipse(s) + the centroid or replicate markers for one legend group's points,
 *  all colour `color` and tied to the legend entry `name`. Shared by simple and complex modes. */
function condGroupTraces(
  pts: ClusterPoint[],
  color: string,
  name: string,
  display: Mode,
  p: (typeof PALETTES)[keyof typeof PALETTES],
  hover: string,
  showlegend = true,
  showMarkers = true
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
  // In arrow mode the connecting arrows replace the markers — nothing to draw here.
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
  } else {
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
  }
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
  hover: string
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
  const distinct = (c: Cond): Set<string> => {
    const s = new Set<string>()
    for (const cond of condOrder) {
      const v = metaOf(cond)[c]
      if (v != null && v !== '') s.add(String(v))
    }
    return s
  }
  const varying = new Set<Cond>(CONDS.filter((c) => distinct(c).size > 1))
  const plan = planAesthetics(varying)
  if (!plan.grouped && !plan.colorKey) return null // nothing varies → let simple mode handle it

  const sortedVals = (c: Cond, numeric: boolean): string[] => {
    const arr = [...distinct(c)]
    return numeric ? arr.sort((a, b) => Number(a) - Number(b)) : arr.sort()
  }

  // Grouped colour: each strain gets a hue family; cmpds spread across a window within it.
  const strainList = sortedVals('strain', false)
  const cmpdByStrain = new Map<string, string[]>()
  if (plan.grouped) {
    const tmp = new Map<string, Set<string>>()
    for (const cond of condOrder) {
      const m = metaOf(cond)
      const s = String(m.strain)
      if (!tmp.has(s)) tmp.set(s, new Set())
      tmp.get(s)!.add(String(m.cmpd))
    }
    for (const [s, set] of tmp) cmpdByStrain.set(s, [...set].sort())
  }
  const FAMILY_SPAN = 60
  const groupedHue = (strain: string, cmpd: string): number => {
    const si = Math.max(0, strainList.indexOf(strain))
    const center = (360 * si) / Math.max(1, strainList.length)
    const cmpds = cmpdByStrain.get(strain) ?? [cmpd]
    const ci = Math.max(0, cmpds.indexOf(cmpd))
    const off = cmpds.length > 1 ? (ci / (cmpds.length - 1) - 0.5) * FAMILY_SPAN : 0
    return center + off
  }

  // Single-qualitative colour (categorical).
  const qualVals = plan.colorKey && !plan.colorRamp ? sortedVals(plan.colorKey, false) : []
  const qualIdx = new Map(qualVals.map((v, i) => [v, i]))

  // Quantitative colour ramp (only when there is no qualitative to colour by).
  const rampKey = plan.colorRamp ? (plan.colorKey as Cond) : null
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
    if (plan.grouped) return hslHex(groupedHue(String(m.strain), String(m.cmpd)), 0.62, 0.5)
    if (plan.colorKey && !plan.colorRamp) {
      const i = qualIdx.get(String(m[plan.colorKey])) ?? 0
      return CATEGORICAL[i % CATEGORICAL.length]
    }
    if (rampKey) {
      const v = Number(m[rampKey])
      const t = rhi > rlo ? (v - rlo) / (rhi - rlo) : 0.5
      return rgbHex(rampFn(0.2 + 0.8 * t))
    }
    return CATEGORICAL[0]
  }
  const finalColor = (m: ClusterMeta): string => {
    if (!shadeKey) return baseColor(m)
    const v = m[shadeKey] // shadeKey is always a quantitative (dose/time)
    return shadeHex(baseColor(m), tShade(typeof v === 'number' ? v : null))
  }

  const groupName = (m: ClusterMeta): string => {
    if (plan.grouped) return `${m.strain} | ${m.cmpd}`
    if (plan.colorKey) return String(m[plan.colorKey]) || '(none)'
    return '(all)'
  }
  const groupSort = (m: ClusterMeta): number => {
    if (plan.grouped) {
      const si = strainList.indexOf(String(m.strain))
      const cmpds = cmpdByStrain.get(String(m.strain)) ?? []
      return si * 1000 + cmpds.indexOf(String(m.cmpd))
    }
    if (plan.colorKey && !plan.colorRamp) return qualIdx.get(String(m[plan.colorKey])) ?? 0
    if (rampKey) return Number(m[rampKey]) || 0
    return 0
  }

  // Data traces (no legend — the legend comes from dedicated swatch traces below so the
  // per-shade colours don't each spawn an entry).
  // When arrows are on, they carry the connection between conditions — hide the dots so the
  // trail reads cleanly.
  const arrowMode = !!plan.arrowKey
  const traces: Array<Record<string, unknown>> = []
  const legendReps = new Map<string, { color: string; sort: number }>()
  for (const cond of condOrder) {
    const pts = condPts.get(cond)!
    const m = pts[0].meta
    const gname = groupName(m)
    if (!legendReps.has(gname)) legendReps.set(gname, { color: baseColor(m), sort: groupSort(m) })
    traces.push(...condGroupTraces(pts, finalColor(m), gname, display, p, hover, false, !arrowMode))
  }
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
    const otherVarying = CONDS.filter((c) => c !== ak && varying.has(c))
    const seriesKey = (m: ClusterMeta): string => otherVarying.map((c) => String(m[c])).join('¦')
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
    for (const conds of series.values()) {
      const sorted = conds
        .slice()
        .sort((a, b) => (Number(metaOf(a)[ak]) || 0) - (Number(metaOf(b)[ak]) || 0))
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
  enc.push(plan.grouped ? 'colour: strain × cmpd' : `colour: ${plan.colorKey}`)
  if (shadeKey) enc.push(`shade: ${shadeKey} (light→dark)`)
  if (plan.arrowKey) enc.push(`arrow: ${plan.arrowKey} (low→high)`)
  const legendCfg = { title: { text: enc.join('  ·  '), font: { size: 10 } } }

  return { traces, annotations, legend: legendCfg }
}
