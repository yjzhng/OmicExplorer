/**
 * Potency plot (CurveCurator's): each fitted curve's potency, pEC50 (−log₁₀ EC50 in molar, from the
 * Compare's dose unit; over time or another axis, −log₁₀ EC50 in its own units), against its curve fold change (log₂), coloured by its call. More potent curves sit to
 * the right, larger responses further from 0. By default only the called curves are drawn — a flat
 * curve's EC50 is unconstrained, so its pEC50 just sits at a fitting bound.
 */
import { useMemo } from 'react'

import type { CompareResultRow } from '../engine'
import {
  DEFAULT_EFFECT_LABELS,
  type EffectColors,
  type EffectLabels,
  type PointStyle
} from '../graph/types'
import { useGraph } from '../graph/store'
import { PlotlyChart } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight } from './pointStyle'
import { axisBase, EFFECT_COLOR, guideLine, PALETTES, plotBase } from './theme'
import { useSelectedGeneSets } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

interface Point {
  uniqID: string
  label: string
  x: number
  y: number
  ec50: number
  effect: Eff
}

export function PotencyView({
  rows,
  displayMap,
  dose = { scale: 1 },
  show = 'called',
  fcLow,
  fcHigh,
  labelTop = 0,
  effectLabels = DEFAULT_EFFECT_LABELS,
  effectColors,
  style,
  title
}: {
  /** the curve-fit rows of the facet on show */
  rows: CompareResultRow[]
  displayMap: Record<string, string>
  /** the dose unit and its molar scale (see curveDoseUnit); no unit = the axis's own units */
  dose?: { unit?: string; scale: number; molar?: boolean }
  /** the called curves only, or every curve */
  show?: 'called' | 'all'
  /** the fold-change limits of the calls, drawn as guides (omitted = none) */
  fcLow?: number
  fcHigh?: number
  /** label only the top-N curves by |fold change| (0 = as many called curves as fit) */
  labelTop?: number
  effectLabels?: EffectLabels
  /** the upstream Compare's effect colours — what each group's automatic colour follows */
  effectColors?: EffectColors
  style?: PointStyle
  title?: string
}) {
  const mode = useUiTheme((s) => s.mode)
  const geneSets = useGraph((s) => s.geneSets)
  const selSets = useSelectedGeneSets(geneSets)
  const upName = effectLabels.up
  const downName = effectLabels.down
  const noneName = effectLabels.none
  const upColor = effectColors?.up ?? EFFECT_COLOR.up
  const downColor = effectColors?.down ?? EFFECT_COLOR.down
  const noneColor = effectColors?.none ?? EFFECT_COLOR.none
  const groups = useMemo(
    () =>
      resolveGroups(
        style,
        'potency',
        { up: upName, down: downName, none: noneName },
        { up: upColor, down: downColor, none: noneColor }
      ),
    [style, upName, downName, noneName, upColor, downColor, noneColor]
  )
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const showLegend = legendOn(style)

  const points = useMemo(() => {
    const out: Point[] = []
    for (const r of rows) {
      const c = r.curve
      if (!c || r.log2FC == null || !Number.isFinite(r.log2FC) || !Number.isFinite(c.pec50))
        continue
      const effect = (r.effect ?? 'none') as Eff
      if (show === 'called' && !r.signf) continue
      out.push({
        uniqID: r.uniqID,
        label: displayMap[r.uniqID] || r.uniqID,
        x: c.pec50 - Math.log10(dose.scale),
        y: r.log2FC,
        ec50: 10 ** -c.pec50,
        effect
      })
    }
    return out
  }, [rows, displayMap, show, dose.scale])

  const { data, layout, labels } = useMemo(() => {
    const p = PALETTES[mode]
    const cmp = rows[0]?.comparison
    const fcLabel = cmp ? `curve log₂FC · ${cmp}` : 'curve log₂FC'
    const unitSfx = dose.unit ? ` ${dose.unit}` : ''
    // Per point (hovertemplate takes an array), with its EC50 in the dose's units written in.
    const hover = (pt: Point, named = !emphasis.label): string =>
      `${named ? '%{text}<br>' : ''}pEC50=%{x:.2f} (EC50 ${Number(pt.ec50.toPrecision(3))}${unitSfx})<br>${fcLabel}=%{y:.3f}<extra></extra>`
    const look = (eff: Eff) => groups.get(eff)!
    const byEffect: Record<Eff, Point[]> = { up: [], down: [], none: [] }
    for (const pt of points) byEffect[pt.effect].push(pt)
    const traces: Array<Record<string, unknown>> = ORDER.filter(
      (eff) => show === 'all' || eff !== 'none'
    ).map((eff) => {
      const pts = byEffect[eff]
      const g = look(eff)
      return {
        type: 'scatter',
        mode: 'markers',
        name: `${g.name} (${pts.length})`,
        showlegend: g.legend,
        __oeEmph: g.highlight,
        x: pts.map((pt) => pt.x),
        y: pts.map((pt) => pt.y),
        text: pts.map((pt) => pt.label),
        customdata: pts.map((pt) => pt.uniqID),
        hovertemplate: pts.map((pt) => hover(pt)),
        marker: {
          color: g.color,
          size: g.size,
          opacity: g.opacity,
          line: { width: g.outline, color: g.outlineColor ?? p.text }
        }
      }
    })
    for (const set of selSets) {
      const sel = points.filter((pt) => set.ids.has(pt.uniqID))
      if (!sel.length) continue
      traces.push({
        type: 'scatter',
        mode: 'markers',
        name: `${set.name} (${sel.length})`,
        x: sel.map((pt) => pt.x),
        y: sel.map((pt) => pt.y),
        text: sel.map((pt) => pt.label),
        customdata: sel.map((pt) => pt.uniqID),
        hovertemplate: sel.map((pt) => hover(pt, true)),
        marker: {
          color: set.color ?? sel.map((pt) => look(pt.effect).color),
          size: sel.map((pt) => look(pt.effect).size),
          opacity: 1
        }
      })
    }

    // Explicit ranges (padded) so the emphasis overlay on an edge point doesn't re-pad the axes.
    let xLo = Infinity
    let xHi = -Infinity
    let yLo = Math.min(0, fcLow ?? 0)
    let yHi = Math.max(0, fcHigh ?? 0)
    for (const pt of points) {
      if (pt.x < xLo) xLo = pt.x
      if (pt.x > xHi) xHi = pt.x
      if (pt.y < yLo) yLo = pt.y
      if (pt.y > yHi) yHi = pt.y
    }
    if (!Number.isFinite(xLo) || !Number.isFinite(xHi)) [xLo, xHi] = [0, 1]
    const xPad = (xHi - xLo || 2) * 0.05
    const yPad = (yHi - yLo || 2) * 0.06
    // The calls' fold-change limits, as the volcano's wall (not draggable here).
    const guide = (y: number) => ({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      y0: y,
      y1: y,
      line: guideLine(p)
    })
    const shapes = [fcLow, fcHigh].filter((v): v is number => v != null && v !== 0).map(guide)

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: showLegend,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        title: dose.molar ? 'pEC50 (−log₁₀ EC50 [M])' : '−log₁₀ EC50',
        range: [xLo - xPad, xHi + xPad],
        autorange: false
      },
      yaxis: {
        ...axisBase(p),
        title: fcLabel,
        zeroline: true,
        range: [yLo - yPad, yHi + yPad],
        autorange: false
      },
      shapes
    }
    // Labels for the groups whose label switch is on, the largest responses first.
    let lab = points
      .filter((pt) => look(pt.effect).label)
      .map((pt) => ({ x: pt.x, y: pt.y, text: pt.label, priority: Math.abs(pt.y), id: pt.uniqID }))
    if (labelTop > 0) lab = lab.sort((a, b) => b.priority - a.priority).slice(0, labelTop)
    return { data: traces, layout: lay, labels: lab }
  }, [
    points,
    rows,
    show,
    dose.unit,
    dose.molar,
    fcLow,
    fcHigh,
    labelTop,
    title,
    mode,
    selSets,
    groups,
    showLegend,
    emphasis.label
  ])

  if (!points.length)
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted, #888)' }}>
        {show === 'called' ? 'No significant curves here.' : 'No fitted curves here.'}
      </div>
    )
  return (
    <PlotlyChart
      data={data}
      layout={layout}
      labels={labels}
      labelColor={PALETTES[mode].text}
      emphasis={emphasis}
    />
  )
}
