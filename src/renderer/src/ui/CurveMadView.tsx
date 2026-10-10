/**
 * Residual plots — curve-fit QC, after CurveCurator's MAD analysis: at each dose (the control
 * first), the distribution of every protein's residual from its own curve's fit (ratio − fitted
 * ratio), the dose's replicates together — a violin with its quartile box, and the dose's most
 * extreme residuals (the top OUTLIER_SHARE by |residual|) as dots (hover: the gene and its
 * replicate). Side by side per comparison on
 * show. A violin off zero is high or low on most curves (a normalisation, loading or sample
 * problem); a wide one misses them either way.
 */
import { useMemo } from 'react'

import {
  curvePointsFromStd,
  curveResidualMad,
  stdByGene,
  type CompareResultRow,
  type StandardRow
} from '../engine'
import type { PointStyle } from '../graph/types'
import { PlotlyChart } from './PlotlyChart'
import { legendOn, resolveGroups } from './pointStyle'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** The share of each dose's residuals marked as outlier dots: the most extreme by |residual|
 *  (at least one per dose). */
const OUTLIER_SHARE = 0.0005

/** A log₁₀ dose as the dose itself, three significant figures. */
const doseLabel = (x: number): string => String(Number((10 ** x).toPrecision(3)))

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
  title
}: {
  /** the curve-fit rows of the facet on show */
  rows: CompareResultRow[]
  /** gene names, for the hover */
  displayMap: Record<string, string>
  /** the Clean data rows the Compare ran on — the points of curves fitted before they were kept
   *  are rebuilt from them */
  std?: StandardRow[]
  /** the curve axis's unit (a dose unit), for the axis title */
  unit?: string
  /** the control / dosed violins' and outliers' look (unset fields use the defaults) */
  style?: PointStyle
  title?: string
}) {
  const mode = useUiTheme((s) => s.mode)
  const byGene = useMemo(() => (std ? stdByGene(std) : undefined), [std])
  // Each curve with its points: kept with the fit, else rebuilt from the Clean data.
  const curves = useMemo(
    () =>
      rows.map((r) => {
        const c = r.curve
        if (!c || (c.x && c.rep) || !byGene) return r
        const axis = c.axis === 'time' ? 'time' : 'dose'
        const got = curvePointsFromStd(r, byGene.get(r.uniqID) ?? [], axis)
        return got ? { ...r, curve: { ...c, ...got } } : r
      }),
    [rows, byGene]
  )
  const { data, layout, missing } = useMemo(() => {
    const p = PALETTES[mode]
    const comparisons = [...new Set(curves.map((r) => r.comparison))]
    const axis = curves.find((r) => r.curve)?.curve?.axis ?? 'dose'
    const perCmp = comparisons.map((c) =>
      curveResidualMad(
        curves
          .filter((r) => r.comparison === c && r.curve)
          .map((r) => ({ ...r.curve!, id: r.uniqID })),
        true
      )
    )
    // Every dose any comparison has, in order (the control first), one category each.
    const xs = [...new Set(perCmp.flatMap((m) => m.flatMap((d) => (d.x == null ? [] : [d.x]))))]
    xs.sort((a, b) => a - b)
    const cat = (x: number | null): string => (x == null ? 'control' : doseLabel(x))
    const many = comparisons.length > 1
    const groups = resolveGroups(style, 'curveMad')
    const traces: Record<string, unknown>[] = []
    perCmp.forEach((m, i) => {
      for (const key of ['control', 'dose'] as const) {
        const g = groups.get(key)!
        // Several comparisons: each its own colour, unless the group's colour was set.
        const color =
          many && !style?.groups?.[key]?.color ? CATEGORICAL[i % CATEGORICAL.length] : g.color
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
            x.push(c)
            y.push(r)
          }
          const n = Math.max(1, Math.round(d.residuals.length * OUTLIER_SHARE))
          const top = d.residuals
            .map((r, j) => j)
            .sort((a, b) => Math.abs(d.residuals[b]) - Math.abs(d.residuals[a]))
            .slice(0, n)
          for (const j of top) {
            ox.push(c)
            oy.push(d.residuals[j])
            const id = d.ids[j]
            ids.push(id)
            text.push((id && displayMap[id]) || id || '')
            const rep = d.reps[j]
            where.push(`${axis} ${c}${rep == null ? '' : ` · rep ${rep}`}`)
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
          x: qs.map((d) => cat(d.x)),
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
          hovertemplate: `%{text}<br>%{hovertext}<br>residual=%{y:.4f}<extra>${comparisons[i]}</extra>`,
          marker: {
            color,
            size: g.size,
            opacity: g.opacity,
            line: { width: g.outline, color: g.outlineColor ?? p.text }
          }
        })
      }
    })
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
      xaxis: {
        ...axisBase(p),
        title: unit ? `${axis} (${unit})` : axis,
        type: 'category',
        categoryorder: 'array',
        categoryarray: ['control', ...xs.map(doseLabel)]
      },
      yaxis: { ...axisBase(p), title: 'residual (ratio − fit)', zeroline: true }
    }
    return {
      data: traces,
      layout: lay,
      missing: curves.some((r) => r.curve && !r.curve.x)
    }
  }, [curves, displayMap, unit, style, title, mode])

  if (!data.length)
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted, #888)' }}>
        {missing
          ? 'These curves’ points aren’t kept and the Clean data isn’t available — re-run the Compare.'
          : 'No fitted curves here.'}
      </div>
    )
  return <PlotlyChart data={data} layout={layout} />
}
