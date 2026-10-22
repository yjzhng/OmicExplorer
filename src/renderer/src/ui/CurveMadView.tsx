/**
 * QC plots — curve-fit QC. Five checks (ResidualCheck): by dose — below; by sample — the
 * same, each dose's replicates apart; against the fitted value (fittedCheck); normality
 * (normalityCheck); and the curves' metrics, one against another (metricsCheck).
 *
 * By dose, after CurveCurator's MAD analysis: at each dose (the control
 * first), the distribution of every protein's residual from its own curve's fit (ratio − fitted
 * ratio), the dose's replicates together — a violin with its quartile box, and the dose's most
 * extreme residuals (the top OUTLIER_SHARE by |residual|) as dots (hover: the gene and its
 * replicate). Side by side per comparison on
 * show. A violin off zero is high or low on most curves (a normalisation, loading or sample
 * problem); a wide one misses them either way.
 */
import { useMemo } from 'react'

import {
  curveMetrics,
  curvePointsFromStd,
  curveResidualMad,
  curveResidualPoints,
  normalPpf,
  type StdLookup,
  thinPoints,
  xUnits,
  type StoredScale,
  type ResidualPoint,
  type CompareResultRow,
  type ThresholdConfig
} from '../engine'
import {
  CURVE_QC_DEFAULT_X,
  CURVE_QC_DEFAULT_Y,
  CURVE_QC_METRIC_LABEL,
  curveQcAxisOptions,
  DEFAULT_EFFECT_LABELS,
  type CurveQcAxis,
  type CurveQcMetric,
  type EffectColors,
  type EffectLabels,
  type PointStyle,
  type ResidualCheck
} from '../graph/types'
import { condLine, tooltip, valueLine } from './condTooltip'
import { useAxisTitlePickers } from './useAxisTitlePickers'
import { PlotlyChart } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight, type ResolvedGroup } from './pointStyle'
import { axisBase, CATEGORICAL, guideLine, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** The share of each dose's residuals marked as outlier dots: the most extreme by |residual|
 *  (at least one per dose). */
const OUTLIER_SHARE = 0.0005

/** A trace's share of the plot's point cap: in proportion to its points among the plot's `total`
 *  (rounded down, so the shares never sum past the cap). */
const capShare = (n: number, total: number, cap: number): number =>
  total <= cap ? n : Math.floor((cap * n) / total)

/** A tooltip's comparison line — only when several comparisons share the plot (one alone is the
 *  facet on show). Inside the tooltip, not Plotly's side box (`<extra>`): that floats beside it in
 *  the trace's colour, which every view keeps off. */
const cmpLine = (comparisons: string[], i: number, p: { textMuted: string }): string =>
  comparisons.length > 1 ? `<br>${condLine('comparison', comparisons[i], p.textMuted)}` : ''

/** A fit's x (log₁₀ dose, or steps on a linear axis: `sc`) as the dose itself, three significant
 *  figures. */
const doseLabel = (x: number, sc: StoredScale): string =>
  String(Number(xUnits(sc, x).toPrecision(3)))

/** A colour at an alpha, for a violin's fill (a #rrggbb colour; anything else as it is). */
const withAlpha = (c: string, a: number): string =>
  /^#[0-9a-f]{6}$/i.test(c)
    ? `${c}${Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')}`
    : c

export function CurveMadView({
  rows,
  displayMap,
  std,
  unit,
  style,
  yScale = 'fit',
  show = 'dot',
  check = 'dose',
  maxPoints = Infinity,
  metricX = CURVE_QC_DEFAULT_X,
  metricY = CURVE_QC_DEFAULT_Y,
  threshold,
  doseScale = 1,
  effectLabels = DEFAULT_EFFECT_LABELS,
  effectColors,
  onMetricX,
  onMetricY,
  title
}: {
  /** the curve-fit rows of the facet on show */
  rows: CompareResultRow[]
  /** gene names, for the hover */
  displayMap: Record<string, string>
  /** the Clean data rows the Compare ran on — the points of curves fitted before they were kept
   *  are rebuilt from them */
  std?: StdLookup
  /** the curve axis's unit (a dose unit), for the axis title */
  unit?: string
  /** the control / dosed violins' and outliers' look (unset fields use the defaults) */
  style?: PointStyle
  /** the residual axis: every residual ('range'), or fitted to the violins' bulk ('fit') */
  yScale?: 'fit' | 'range'
  /** each dose's residuals as a violin (with its quartile box and outlier dots), or every residual
   *  as a dot (with its quartile box) */
  show?: 'violin' | 'dot'
  /** what the residuals are checked against: by dose (replicates pooled — CurveCurator's MAD
   *  view), by sample (dose × replicate — finds one bad injection), against the fitted value (does
   *  the error grow with the signal — the F-test's constant variance), or their normality (a
   *  Q–Q plot of the per-curve standardised residuals — the F-test's normal errors) */
  check?: ResidualCheck
  /** the most residuals the dot views draw (thinPoints); Infinity = every one */
  maxPoints?: number
  /** the metrics check's axes */
  metricX?: CurveQcAxis
  metricY?: CurveQcAxis
  /** the curve fit's threshold (the relevance score's limits and α) */
  threshold?: ThresholdConfig
  /** the dose unit's size in molar, so pEC50 is molar (see curveMetrics) */
  doseScale?: number
  /** the upstream Compare's effect labels and colours — the metrics check's dots are coloured by
   *  each curve's call */
  effectLabels?: EffectLabels
  effectColors?: EffectColors
  /** pick the metrics check's x / y on its axis titles (unset: the titles are plain) */
  onMetricX?: (m: CurveQcAxis) => void
  onMetricY?: (m: CurveQcAxis) => void
  title?: string
}) {
  const mode = useUiTheme((s) => s.mode)
  // The pinned / hovered genes' look, as on the volcano and MA (PlotlyChart's shared overlay).
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const byGene = std
  // Memo inputs kept primitive: the parent hands fresh label / colour objects per render.
  const { up: upName, down: downName, none: noneName } = effectLabels
  const upColor = effectColors?.up
  const downColor = effectColors?.down
  const noneColor = effectColors?.none
  // Each curve with its points: kept with the fit, else rebuilt from the Clean data.
  const curves = useMemo(
    () =>
      rows.map((r) => {
        const c = r.curve
        if (!c || (c.x && c.rep) || !byGene) return r
        const got = curvePointsFromStd(r, byGene.get(r.uniqID) ?? [], c.axis)
        return got ? { ...r, curve: { ...c, ...got } } : r
      }),
    [rows, byGene]
  )
  const { data, layout, missing } = useMemo(() => {
    const p = PALETTES[mode]
    const comparisons = [...new Set(curves.map((r) => r.comparison))]
    const axis = curves.find((r) => r.curve)?.curve?.axis ?? 'dose'
    // the run's scale: every curve of a run shares it
    const sc: StoredScale = curves.find((r) => r.curve)?.curve ?? {}
    const curvesOf = (c: string) =>
      curves
        .filter((r) => r.comparison === c && r.curve)
        .map((r) => ({ ...r.curve!, id: r.uniqID }))
    if (check === 'metrics') {
      const built = metricsCheck(curves, comparisons, metricX, metricY, {
        threshold,
        doseScale,
        displayMap,
        style,
        effectLabels: { up: upName, down: downName, none: noneName },
        effectColors:
          upColor && downColor && noneColor
            ? { up: upColor, down: downColor, none: noneColor }
            : undefined,
        p
      })
      return {
        data: built.data,
        layout: { ...built.layout, title: title ? { text: title, font: { size: 13 } } : undefined },
        missing: false
      }
    }
    if (check === 'fitted' || check === 'normality') {
      const pts = comparisons.map((c) => curveResidualPoints(curvesOf(c)))
      const built =
        check === 'fitted'
          ? fittedCheck(pts, comparisons, axis, displayMap, p, style, yScale, maxPoints, sc)
          : normalityCheck(pts, comparisons, p, style)
      return {
        data: built.data,
        layout: {
          ...built.layout,
          title: title ? { text: title, font: { size: 13 } } : undefined
        },
        missing: curves.some((r) => r.curve && !r.curve.x)
      }
    }
    // By dose: each dose's replicates pooled; by sample: one group per dose × replicate.
    const perCmp = comparisons.map((c) => curveResidualMad(curvesOf(c), check !== 'sample'))
    const cat = (x: number | null): string => (x == null ? 'control' : doseLabel(x, sc))
    // A group's category: its dose, and its replicate when split by sample.
    const lab = (d: { x: number | null; rep: number | null }): string =>
      d.rep == null ? cat(d.x) : `${cat(d.x)} r${d.rep}`
    const many = comparisons.length > 1
    const groups = resolveGroups(style, 'curveMad')
    const traces: Record<string, unknown>[] = []
    const shapes: Record<string, unknown>[] = []
    // Every residual on show (dot mode thins them to `maxPoints`).
    const totalRes = perCmp.flat().reduce((n, d) => n + d.residuals.length, 0)
    // Dot mode: every residual as a dot on a numeric x (the plots' shared point trace — gene
    // hover, pins and highlight as on the volcano or MA), each dose's dots spread across its slot
    // (one slot per comparison), its quartile box drawn over them.
    const dots = show === 'dot'
    // Every group any comparison has, in order (the control first; by sample, replicates within).
    const ord = (a: number | null, b: number | null): number =>
      a === b ? 0 : a == null ? -1 : b == null ? 1 : a - b
    const cats = [
      ...new Set(
        perCmp
          .flat()
          .sort((a, b) => ord(a.x, b.x) || ord(a.rep, b.rep))
          .map(lab)
      )
    ]
    const catIdx = new Map(cats.map((c, k) => [c, k]))
    const SLOT = 0.9 / comparisons.length
    const slotMid = (c: string, i: number): number => (catIdx.get(c) ?? 0) - 0.45 + SLOT * (i + 0.5)
    // A fixed spread per residual (a seeded generator), so the dots stay put across redraws.
    let seed = 1
    const jitter = (): number => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647 - 0.5
    }
    perCmp.forEach((m, i) => {
      for (const key of ['control', 'dose'] as const) {
        const g = groups.get(key)!
        // Several comparisons: each its own colour, unless the group's colour was set.
        const color =
          many && !style?.groups?.[key]?.color ? CATEGORICAL[i % CATEGORICAL.length] : g.color
        if (dots) {
          const pts: DotPoint[] = []
          for (const d of m) {
            if ((d.x == null) !== (key === 'control')) continue
            const c = cat(d.x)
            const mid = slotMid(lab(d), i)
            d.residuals.forEach((r, j) => {
              const rep = d.reps[j]
              pts.push({
                x: mid + jitter() * SLOT * 0.8,
                y: r,
                id: d.ids[j],
                where: tooltip(
                  {
                    conds: [[axis, c], ...(rep == null ? [] : [['rep', rep] as [string, number]])]
                  },
                  p.textMuted
                )
              })
            })
            // the quartile box over the dots, and its median (layout shapes, over the SVG dots)
            const half = SLOT * 0.3
            const edge = { ...guideLine(p, 1.5), dash: 'solid' }
            const box = { xref: 'x', yref: 'y', layer: 'above', line: edge }
            shapes.push(
              { ...box, type: 'rect', x0: mid - half, x1: mid + half, y0: d.q1, y1: d.q3 },
              { ...box, type: 'line', x0: mid - half, x1: mid + half, y0: d.median, y1: d.median }
            )
          }
          if (!pts.length) continue
          const drawn = thinPoints(pts, capShare(pts.length, totalRes, maxPoints), (q) =>
            Math.abs(q.y)
          )
          traces.push(
            pointTrace(drawn, g, color, many ? `${comparisons[i]} · ${g.name}` : g.name, {
              scope: `dot-${check}`,
              legendgroup: `${i}|${key}`,
              hover: `<b>%{text}</b><br>%{hovertext}${cmpLine(comparisons, i, p)}<br>${valueLine('residual', '%{y:.3f}')}<extra></extra>`,
              displayMap,
              p
            })
          )
          continue
        }
        const x: string[] = []
        const y: number[] = []
        // The outlier dots: each dose's most extreme residuals.
        const ox: string[] = []
        const oy: number[] = []
        const ids: Array<string | undefined> = []
        const text: string[] = []
        const where: string[] = []
        for (const d of m) {
          if ((d.x == null) !== (key === 'control')) continue
          const c = cat(d.x)
          for (const r of d.residuals) {
            x.push(lab(d))
            y.push(r)
          }
          const n = Math.max(1, Math.round(d.residuals.length * OUTLIER_SHARE))
          const top = d.residuals
            .map((r, j) => j)
            .sort((a, b) => Math.abs(d.residuals[b]) - Math.abs(d.residuals[a]))
            .slice(0, n)
          for (const j of top) {
            ox.push(lab(d))
            oy.push(d.residuals[j])
            const id = d.ids[j]
            ids.push(id)
            text.push((id && displayMap[id]) || id || '')
            const rep = d.reps[j]
            where.push(
              tooltip(
                { conds: [[axis, c], ...(rep == null ? [] : [['rep', rep] as [string, number]])] },
                p.textMuted
              )
            )
          }
        }
        if (!y.length) continue
        traces.push({
          type: 'violin',
          name: many ? `${comparisons[i]} · ${g.name}` : g.name,
          showlegend: g.legend,
          legendgroup: `${i}|${key}`,
          // Side by side per comparison at each dose (violinmode 'group' below).
          offsetgroup: many ? comparisons[i] : undefined,
          x,
          y,
          // Every residual shapes the violin; the outlier dots are their own trace below.
          points: false,
          spanmode: 'hard',
          // Its own box has whiskers Plotly can't hide — the quartile box is drawn below instead.
          box: { visible: false },
          width: 0.9,
          meanline: { visible: false },
          line: { color, width: 1 },
          fillcolor: withAlpha(color, 0.35),
          hoveron: 'violins'
        })
        // The median and quartiles: a narrow box, no whiskers (precomputed — no raw values again).
        const qs = m.filter((d) => (d.x == null) === (key === 'control'))
        traces.push({
          type: 'box',
          name: `${many ? `${comparisons[i]} · ` : ''}${g.name} quartiles`,
          showlegend: false,
          legendgroup: `${i}|${key}`,
          offsetgroup: many ? comparisons[i] : undefined,
          x: qs.map(lab),
          q1: qs.map((d) => d.q1),
          median: qs.map((d) => d.median),
          q3: qs.map((d) => d.q3),
          lowerfence: qs.map((d) => d.q1),
          upperfence: qs.map((d) => d.q3),
          showwhiskers: false,
          boxpoints: false,
          width: 0.12,
          fillcolor: p.panel,
          line: { color, width: 1 },
          hoverinfo: 'y'
        })
        traces.push({
          type: 'scatter',
          mode: 'markers',
          name: `${many ? `${comparisons[i]} · ` : ''}${g.name} outliers`,
          showlegend: false,
          legendgroup: `${i}|${key}`,
          // Over its violin (scattermode 'group' lines it up with the violins' offsets).
          offsetgroup: many ? comparisons[i] : undefined,
          x: ox,
          y: oy,
          text,
          hovertext: where,
          customdata: ids,
          hovertemplate: `<b>%{text}</b><br>%{hovertext}${cmpLine(comparisons, i, p)}<br>${valueLine('residual', '%{y:.3f}')}<extra></extra>`,
          marker: {
            color,
            size: g.size,
            opacity: g.opacity,
            line: { width: g.outline, color: g.outlineColor ?? p.text }
          }
        })
      }
    })
    // Fitted: symmetric about zero, out to where 99.9% of all residuals (every dose and comparison)
    // fall by size — |residual|'s 99.9th percentile, padded a little; the rarest extremes past it are
    // clipped from view, so they don't flatten the violins.
    let fitRange: [number, number] | undefined
    if (yScale === 'fit') {
      const abs = perCmp.flatMap((m) => m.flatMap((d) => d.residuals.map(Math.abs)))
      abs.sort((x, y) => x - y)
      if (abs.length) {
        const at = (abs.length - 1) * 0.999
        const lo = Math.floor(at)
        const q = abs[lo] + (abs[Math.min(lo + 1, abs.length - 1)] - abs[lo]) * (at - lo)
        const a = (q || abs[abs.length - 1] || 0.05) * 1.05
        fitRange = [-a, a]
      }
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      violinmode: many ? 'group' : 'overlay',
      boxmode: many ? 'group' : 'overlay',
      // Wide violins: little gap between doses (or between comparisons at a dose).
      violingap: 0.08,
      violingroupgap: 0.04,
      scattermode: many ? 'group' : undefined,
      showlegend: legendOn(style),
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: dots
        ? {
            ...axisBase(p),
            title: unit ? `${axis} (${unit})` : axis,
            // numeric slots labelled as the doses (the dots spread within them)
            type: 'linear',
            tickmode: 'array',
            tickvals: cats.map((_, k) => k),
            ticktext: cats,
            range: [-0.5, cats.length - 0.5],
            zeroline: false,
            showgrid: false
          }
        : {
            ...axisBase(p),
            title: unit ? `${axis} (${unit})` : axis,
            type: 'category',
            categoryorder: 'array',
            categoryarray: cats
          },
      yaxis: {
        ...axisBase(p),
        title: 'residual (ratio − fit)',
        zeroline: true,
        ...(fitRange ? { range: fitRange, autorange: false } : {})
      },
      ...(shapes.length ? { shapes } : {})
    }
    return {
      data: traces,
      layout: lay,
      missing: curves.some((r) => r.curve && !r.curve.x)
    }
  }, [
    curves,
    displayMap,
    unit,
    style,
    yScale,
    show,
    check,
    maxPoints,
    title,
    mode,
    metricX,
    metricY,
    threshold,
    doseScale,
    upName,
    downName,
    noneName,
    upColor,
    downColor,
    noneColor
  ])

  // The metrics check: each axis title picks its metric (or none — the other's distribution).
  const pickers = useAxisTitlePickers<CurveQcAxis>(
    check === 'metrics'
      ? {
          ...(onMetricX
            ? {
                x: {
                  value: metricX,
                  options: curveQcAxisOptions(metricY, 'y'),
                  onChange: onMetricX
                }
              }
            : {}),
          ...(onMetricY
            ? {
                y: {
                  value: metricY,
                  options: curveQcAxisOptions(metricX, 'x'),
                  onChange: onMetricY
                }
              }
            : {})
        }
      : {}
  )
  // The metrics check keeps its axes even with no points, so their titles can pick other metrics.
  const pickable = check === 'metrics' && !!(onMetricX || onMetricY)
  if (!data.length && !pickable)
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted, #888)' }}>
        {missing
          ? 'These curves’ points aren’t kept and the Clean data isn’t available — re-run the Compare.'
          : check === 'metrics' &&
              curves.some((r) => r.curve) &&
              (LOF_METRICS.has(metricX as CurveQcMetric) ||
                LOF_METRICS.has(metricY as CurveQcMetric))
            ? 'No lack-of-fit test here: it needs replicates at the doses to estimate pure error from, and at least five dose levels (the control included).'
            : 'No fitted curves here.'}
      </div>
    )
  if (pickable)
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <PlotlyChart
          data={data}
          layout={layout}
          emphasis={emphasis}
          onGraphMount={pickers.onGraphMount}
        />
        {pickers.overlay}
      </div>
    )
  return <PlotlyChart data={data} layout={layout} emphasis={emphasis} />
}

type Palette = (typeof PALETTES)[keyof typeof PALETTES]
type Built = { data: Record<string, unknown>[]; layout: Record<string, unknown> }

/** One residual as a point: where it's drawn, its gene, and what the hover says of it. */
interface DotPoint {
  x: number
  y: number
  id?: string
  where?: string
}

/** A group's points as the point plots draw them (MAView, VolcanoView): an SVG scatter whose
 *  customdata are ids PlotlyChart highlights by — so it rings and labels a hovered or pinned point
 *  with its shared overlay, dims the rest, and a legend click selects the group — styled by the
 *  group (size, opacity, outline, its own highlight).
 *
 *  The ids are each POINT's own (__oeOwnIds, as the enrichment plot's terms), not its gene's: a
 *  gene has a residual at every dose and replicate, in both groups, so gene ids would light a
 *  gene's every dot on hover and make a legend click select every gene. Each point's id is the
 *  view (`scope`), the trace's name and its place in it — stable across redraws (the thinning is
 *  deterministic), and apart between views, so a pin doesn't land on another dot after a switch. */
function pointTrace(
  pts: DotPoint[],
  g: ResolvedGroup,
  color: string,
  name: string,
  o: {
    /** the view the points belong to (their ids' namespace) */
    scope: string
    legendgroup?: string
    hover: string
    displayMap: Record<string, string>
    p: Palette
  }
): Record<string, unknown> {
  return {
    type: 'scatter',
    mode: 'markers',
    name,
    showlegend: g.legend,
    ...(o.legendgroup ? { legendgroup: o.legendgroup } : {}),
    __oeEmph: g.highlight,
    __oeOwnIds: true,
    x: pts.map((q) => q.x),
    y: pts.map((q) => q.y),
    text: pts.map((q) => (q.id && o.displayMap[q.id]) || q.id || ''),
    hovertext: pts.map((q) => q.where ?? ''),
    customdata: pts.map((_, k) => `residual|${o.scope}|${name}|${k}`),
    hovertemplate: o.hover,
    marker: {
      color,
      size: g.size,
      opacity: g.opacity,
      line: { width: g.outline, color: g.outlineColor ?? o.p.text }
    }
  }
}

/** The colour a comparison's marks take: its own when several are shown (unless the group's colour
 *  was set), else the group's. */
function markColor(
  style: PointStyle | undefined,
  g: ResolvedGroup,
  i: number,
  many: boolean
): string {
  return many && !style?.groups?.[g.key]?.color ? CATEGORICAL[i % CATEGORICAL.length] : g.color
}

/** The residual axis fitted symmetric about zero to 99.9% of the residuals (as the dose view). */
function fitSym(res: number[]): [number, number] | undefined {
  const abs = res.map(Math.abs).sort((x, y) => x - y)
  if (!abs.length) return undefined
  const at = (abs.length - 1) * 0.999
  const lo = Math.floor(at)
  const q = abs[lo] + (abs[Math.min(lo + 1, abs.length - 1)] - abs[lo]) * (at - lo)
  const a = (q || abs[abs.length - 1] || 0.05) * 1.05
  return [-a, a]
}

/** An axis range over `vs`, padded 5% (pinned, as the point plots do, so it never re-pads when a
 *  hovered point's overlay grows at an edge). */
function padded(vs: number[]): [number, number] | undefined {
  let lo = Infinity
  let hi = -Infinity
  for (const v of vs) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return undefined
  const pad = (hi - lo || 1) * 0.05
  return [lo - pad, hi + pad]
}

/** Residual against fitted ratio — the constant-variance check: a cloud whose spread widens with
 *  the fitted value says the error grows with the signal (expected on this linear ratio scale when
 *  noise is proportional), against the F-test's equal-variance assumption. The fitted ratio on a
 *  log₂ axis, as every ratio in the app; a running ±median |residual| over fitted-value bins (the
 *  guide-line style) traces the spread. */
function fittedCheck(
  pts: ResidualPoint[][],
  comparisons: string[],
  axis: string,
  displayMap: Record<string, string>,
  p: Palette,
  style: PointStyle | undefined,
  yScale: 'fit' | 'range',
  maxPoints: number,
  sc: StoredScale
): Built {
  const many = comparisons.length > 1
  const groups = resolveGroups(style, 'curveMad')
  const data: Record<string, unknown>[] = []
  const xs: number[] = []
  // Every residual on show (thinned to `maxPoints`).
  const total = pts.reduce((n, ps) => n + ps.filter((q) => q.fitted > 0).length, 0)
  pts.forEach((ps, i) => {
    const usable = ps.filter((q) => q.fitted > 0)
    for (const key of ['control', 'dose'] as const) {
      const g = groups.get(key)!
      const sel = usable.filter((q) => (q.x == null) === (key === 'control'))
      if (!sel.length) continue
      const dots: DotPoint[] = sel.map((q) => ({
        x: Math.log2(q.fitted),
        y: q.residual,
        id: q.id,
        where: tooltip(
          {
            conds: [
              [axis, q.x == null ? 'control' : doseLabel(q.x, sc)],
              ...(q.rep == null ? [] : [['rep', q.rep] as [string, number]])
            ]
          },
          p.textMuted
        )
      }))
      for (const d of dots) xs.push(d.x)
      const drawn = thinPoints(dots, capShare(dots.length, total, maxPoints), (q) => Math.abs(q.y))
      data.push(
        pointTrace(
          drawn,
          g,
          markColor(style, g, i, many),
          many ? `${comparisons[i]} · ${g.name}` : g.name,
          {
            scope: 'fitted',
            hover: `<b>%{text}</b><br>%{hovertext}${cmpLine(comparisons, i, p)}<br>${valueLine('log₂ fitted', '%{x:.2f}')}<br>${valueLine('residual', '%{y:.3f}')}<extra></extra>`,
            displayMap,
            p
          }
        )
      )
    }
    // The spread's trend: ±median |residual| in 20 equal-count bins of the fitted value.
    const all = [...usable].sort((a, b) => a.fitted - b.fitted)
    const BINS = 20
    const bx: number[] = []
    const by: number[] = []
    for (let b = 0; b < BINS; b++) {
      const part = all.slice(
        Math.floor((all.length * b) / BINS),
        Math.floor((all.length * (b + 1)) / BINS)
      )
      if (part.length < 5) continue
      const a = part.map((q) => Math.abs(q.residual)).sort((x, y) => x - y)
      bx.push(part.reduce((s, q) => s + Math.log2(q.fitted), 0) / part.length)
      by.push(a[a.length >> 1])
    }
    // Drawn over the dots, so it must read against a dense cloud: solid, in the text colour (or the
    // comparison's), smoothed through the bins (spline) so it reads as a trend, not a zigzag.
    const ink = many ? CATEGORICAL[i % CATEGORICAL.length] : p.text
    for (const sign of [1, -1])
      data.push({
        type: 'scatter',
        mode: 'lines',
        name: 'median |residual|',
        showlegend: sign === 1 && i === 0,
        legendgroup: 'trend',
        x: bx,
        y: by.map((v) => sign * v),
        line: { color: ink, width: 2, shape: 'spline' },
        hovertemplate: tooltip(
          {
            values: [
              ['log₂ fitted', '%{x:.2f}'],
              ['median |residual|', '%{y:.3f}']
            ]
          },
          p.textMuted,
          { template: true }
        )
      })
  })
  const res = pts
    .flat()
    .filter((q) => q.fitted > 0)
    .map((q) => q.residual)
  const yRange = yScale === 'fit' ? fitSym(res) : padded(res)
  const xRange = padded(xs)
  return {
    data,
    layout: {
      ...plotBase(p),
      showlegend: legendOn(style),
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      xaxis: {
        ...axisBase(p),
        title: 'log₂ fitted ratio',
        zeroline: false,
        ...(xRange ? { range: xRange, autorange: false } : {})
      },
      yaxis: {
        ...axisBase(p),
        title: 'residual (ratio − fit)',
        zeroline: true,
        ...(yRange ? { range: yRange, autorange: false } : {})
      }
    }
  }
}

/** Normality — a Q–Q plot of the standardised residuals (each over its own curve's residual SD,
 *  so curves of every noise level pool) against the normal's quantiles: on the diagonal (the
 *  guide-line style) when the errors are normal, as the F-test assumes; tails bending away are
 *  heavier (outliers) or lighter than normal. Drawn at 400 quantiles, not every residual — so they
 *  carry no genes, and take the dosed group's look. */
function normalityCheck(
  pts: ResidualPoint[][],
  comparisons: string[],
  p: Palette,
  style: PointStyle | undefined
): Built {
  const many = comparisons.length > 1
  const g = resolveGroups(style, 'curveMad').get('dose')!
  const K = 400
  const data: Record<string, unknown>[] = []
  const all: number[] = []
  pts.forEach((ps, i) => {
    const z = ps
      .map((q) => q.std)
      .filter(Number.isFinite)
      .sort((a, b) => a - b)
    if (z.length < 3) return
    const n = Math.min(K, z.length)
    const tx: number[] = []
    const ty: number[] = []
    for (let k = 0; k < n; k++) {
      const pr = (k + 0.5) / n
      const at = pr * (z.length - 1)
      const j = Math.floor(at)
      ty.push(z[j] + (z[Math.min(j + 1, z.length - 1)] - z[j]) * (at - j))
      tx.push(normalPpf(pr))
    }
    all.push(...tx, ...ty)
    data.push({
      type: 'scatter',
      mode: 'markers',
      name: many ? comparisons[i] : 'residuals',
      showlegend: g.legend,
      x: tx,
      y: ty,
      hovertemplate: tooltip(
        {
          conds: comparisons.length > 1 ? [['comparison', comparisons[i]]] : [],
          values: [
            ['normal quantile', '%{x:.2f}'],
            ['standardised residual', '%{y:.2f}']
          ]
        },
        p.textMuted,
        { template: true }
      ),
      marker: {
        color: markColor(style, g, i, many),
        size: g.size,
        opacity: g.opacity,
        line: { width: g.outline, color: g.outlineColor ?? p.text }
      }
    })
  })
  // One range for both axes, so the diagonal runs corner to corner at 45°.
  const r = padded(all)
  return {
    data,
    layout: {
      ...plotBase(p),
      showlegend: many && legendOn(style),
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      xaxis: {
        ...axisBase(p),
        title: 'normal quantile',
        zeroline: false,
        ...(r ? { range: r, autorange: false } : {})
      },
      yaxis: {
        ...axisBase(p),
        title: 'standardised residual',
        zeroline: false,
        ...(r ? { range: r, autorange: false } : {})
      },
      shapes: r
        ? [
            {
              type: 'line',
              xref: 'x',
              yref: 'y',
              x0: r[0],
              y0: r[0],
              x1: r[1],
              y1: r[1],
              line: guideLine(p, style?.guideWidth)
            }
          ]
        : []
    }
  }
}

/** One metric's distribution over the curves (the metrics check with the other axis none): a
 *  histogram along `along` — the metric's own axis — stacked by call, the groups sharing one set of
 *  bins; the other axis is the frequency (curves per bin). */
function metricDistribution(
  by: Record<'up' | 'down' | 'none', { x: number; y: number }[]>,
  groups: Map<string, ResolvedGroup>,
  along: 'x' | 'y',
  metric: CurveQcAxis,
  o: { style?: PointStyle; p: Palette }
): Built {
  const { p } = o
  const label = metric === 'none' ? '' : CURVE_QC_METRIC_LABEL[metric]
  const vals = (k: 'up' | 'down' | 'none'): number[] => by[k].map((q) => q[along])
  const all = [...vals('none'), ...vals('down'), ...vals('up')]
  let lo = Infinity
  let hi = -Infinity
  for (const v of all) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  // √n bins (10–50), over the values' span; one bin's width when they're all equal.
  const nBins = Math.min(50, Math.max(10, Math.ceil(Math.sqrt(all.length))))
  const size = hi > lo ? (hi - lo) / nBins : 1
  const bins = {
    start: hi > lo ? lo : lo - size / 2,
    end: hi > lo ? hi + size * 1e-9 : lo + size / 2,
    size
  }
  const count = along === 'x' ? 'y' : 'x'
  const data = (['none', 'down', 'up'] as const)
    .filter((k) => by[k].length)
    .map((k) => {
      const g = groups.get(k)!
      return {
        type: 'histogram',
        name: `${g.name} (${by[k].length})`,
        showlegend: true,
        [along]: vals(k),
        [`${along}bins`]: bins,
        autobin: false,
        orientation: along === 'x' ? 'v' : 'h',
        marker: { color: g.color, line: { width: 0.5, color: p.panel } },
        hovertemplate: `${valueLine(label, `%{${along}}`)}<br>${valueLine('frequency', `%{${count}}`)}<extra>${g.name}</extra>`
      }
    })
  const none = !all.length
  const metricAxis = {
    ...axisBase(p),
    title: label,
    zeroline: false,
    ...(none ? { showticklabels: false, showgrid: false } : null)
  }
  const countAxis = { ...axisBase(p), title: 'frequency', zeroline: false, rangemode: 'tozero' }
  return {
    data,
    layout: {
      ...plotBase(p),
      barmode: 'stack',
      bargap: 0.05,
      ...(none
        ? {
            annotations: [
              {
                text: `No curve here has ${label}.`,
                xref: 'paper',
                yref: 'paper',
                x: 0.5,
                y: 0.5,
                showarrow: false,
                font: { size: 12, color: p.textMuted }
              }
            ]
          }
        : null),
      showlegend: legendOn(o.style),
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      xaxis: along === 'x' ? metricAxis : countAxis,
      yaxis: along === 'y' ? metricAxis : countAxis
    }
  }
}

/** The metrics only a curve with dose replicates has (curveLackOfFit). */
const LOF_METRICS: ReadonlySet<CurveQcMetric> = new Set(['F_lof', 'pP_lof'])

/** The curves' metrics, one against another — each curve a dot, coloured by its call (as on the
 *  volcano), its gene in the hover and linked to the other plots' pins. Finds the curves a
 *  summary hides: a "hit" with a poor fit (low R², high RMSE), a midpoint at the edge of the
 *  tested doses, a plateau far from the control. Curves missing either metric are left out. With
 *  one axis none, the other metric's distribution instead (metricDistribution). */
function metricsCheck(
  rows: CompareResultRow[],
  comparisons: string[],
  mx: CurveQcAxis,
  my: CurveQcAxis,
  o: {
    threshold?: ThresholdConfig
    doseScale: number
    displayMap: Record<string, string>
    style?: PointStyle
    effectLabels: EffectLabels
    effectColors?: EffectColors
    p: Palette
  }
): Built {
  const { p } = o
  const groups = resolveGroups(
    o.style,
    'potency',
    { up: o.effectLabels.up, down: o.effectLabels.down, none: o.effectLabels.none },
    o.effectColors
  )
  type Pt = { x: number; y: number; id: string; cmp: string }
  const by: Record<'up' | 'down' | 'none', Pt[]> = { up: [], down: [], none: [] }
  for (const r of rows) {
    if (!r.curve) continue
    const m: Record<string, number | null | undefined> = {
      ...curveMetrics(r.log2FC, r.curve, o.threshold, o.doseScale),
      log2FC: r.log2FC,
      pP: r.pP
    }
    // A none axis takes no metric: 0 stands in (unused).
    const x = mx === 'none' ? 0 : m[mx]
    const y = my === 'none' ? 0 : m[my]
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue
    const eff = r.signf && (r.effect === 'up' || r.effect === 'down') ? r.effect : 'none'
    by[eff].push({ x, y, id: r.uniqID, cmp: r.comparison })
  }
  if (mx === 'none' || my === 'none')
    return metricDistribution(by, groups, mx === 'none' ? 'y' : 'x', mx === 'none' ? my : mx, o)
  const many = comparisons.length > 1
  const lx = CURVE_QC_METRIC_LABEL[mx]
  const ly = CURVE_QC_METRIC_LABEL[my]
  const data = (['none', 'down', 'up'] as const)
    .filter((k) => by[k].length)
    .map((k) => {
      const g = groups.get(k)!
      const pts = by[k]
      return {
        type: 'scatter',
        mode: 'markers',
        name: `${g.name} (${pts.length})`,
        showlegend: true,
        __oeEmph: g.highlight,
        x: pts.map((q) => q.x),
        y: pts.map((q) => q.y),
        text: pts.map((q) => o.displayMap[q.id] || q.id),
        customdata: pts.map((q) => q.id),
        hovertext: pts.map((q) =>
          many ? `<br>${condLine('comparison', q.cmp, p.textMuted)}` : ''
        ),
        hovertemplate: `<b>%{text}</b>%{hovertext}<br>${valueLine(lx, '%{x:.3g}')}<br>${valueLine(ly, '%{y:.3g}')}<extra></extra>`,
        marker: {
          color: g.color,
          size: g.size,
          opacity: g.opacity,
          line: { width: g.outline, color: g.outlineColor ?? p.text }
        }
      }
    })
  const all = [...by.none, ...by.down, ...by.up]
  const xr = padded(all.map((q) => q.x))
  const yr = padded(all.map((q) => q.y))
  // No curve has both metrics (e.g. lack of fit, without replicates): still the axes — their
  // titles pick the metrics — and why it's empty.
  const none = !all.length
  return {
    data,
    layout: {
      ...plotBase(p),
      ...(none
        ? {
            annotations: [
              {
                text: `No curve here has both ${lx} and ${ly}.`,
                xref: 'paper',
                yref: 'paper',
                x: 0.5,
                y: 0.5,
                showarrow: false,
                font: { size: 12, color: p.textMuted }
              }
            ]
          }
        : null),
      showlegend: legendOn(o.style),
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      xaxis: {
        ...axisBase(p),
        title: lx,
        zeroline: false,
        ...(none ? { showticklabels: false, showgrid: false } : null),
        ...(xr ? { range: xr, autorange: false } : {})
      },
      yaxis: {
        ...axisBase(p),
        title: ly,
        zeroline: false,
        ...(none ? { showticklabels: false, showgrid: false } : null),
        ...(yr ? { range: yr, autorange: false } : {})
      }
    }
  }
}
