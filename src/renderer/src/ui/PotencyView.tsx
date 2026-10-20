/**
 * Potency plot (CurveCurator's): each fitted curve's potency, pEC50 (−log₁₀ EC50 in molar, from the
 * Compare's dose unit; in another unit, −log₁₀ EC50 in its own units) — or, on a linear axis (see
 * axisModel.ts), EC50 itself in the axis's units — against its curve fold change (log₂), coloured by
 * its call. Portrait (the default): the potency up the side, the fold change across; landscape the
 * other way round (CurveCurator's own layout). On a log axis more potent curves sit further along
 * the potency axis; larger responses further from 0. By default only the called curves are drawn —
 * a flat curve's EC50 is unconstrained, so its pEC50 just sits at a fitting bound.
 */
import { useMemo } from 'react'

import {
  comparisonOf,
  condLabel,
  curveDescribed,
  fcName,
  PEC50_DELTA,
  xUnits,
  Y_LIMITS_LOG2,
  type CompareResultRow
} from '../engine'
import {
  DEFAULT_EFFECT_LABELS,
  type PlotOrient,
  type EffectColors,
  type EffectLabels,
  type PointStyle
} from '../graph/types'
import { useGraph } from '../graph/store'
import { tooltip } from './condTooltip'
import { PlotlyChart } from './PlotlyChart'
import { legendOn, resolveGroups, resolveHighlight } from './pointStyle'
import { axisBase, EFFECT_COLOR, GUIDE_WIDTH, guideLine, PALETTES, plotBase } from './theme'
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
  title,
  orient = 'portrait'
}: {
  /** the curve-fit rows of the facet on show */
  rows: CompareResultRow[]
  /** portrait: the potency (EC50 / pEC50) on y, the fold change on x; landscape: the reverse */
  orient?: PlotOrient
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
  const gw = style?.guideWidth ?? GUIDE_WIDTH

  // A surface's curves for its potency: testing changes, those along its response axis (one per
  // level of the other); else its dose curves along the first axis (one per level of the second).
  // 1: along the second axis.
  const curveAxisOf = (r: CompareResultRow): 0 | 1 =>
    r.rs?.shift && r.rs.shift.response === (r.rs.pair?.[1] ?? 'time') ? 1 : 0
  // a linear axis: its EC50 as it is (the run's curves share their scale) — a one-axis curve's
  // scale, or the axis a surface's curves run along
  const linear = rows.some(
    (r) =>
      r.curve?.scale === 'linear' ||
      r.rs?.scale === 'linear' ||
      (r.rs?.axis === 'surface' && r.rs.maps?.[curveAxisOf(r)]?.scale === 'linear')
  )
  const { points, offBound } = useMemo(() => {
    const out: Point[] = []
    // surfaces whose dose curve at the peak ran into a fitting bound (see below): not placed,
    // counted
    let off = 0
    // A point from its EC50 (in the axis's units) and its fold change: pEC50 = −log₁₀ EC50 in
    // molar (the unit's scale), as CurveCurator reports it; on a linear axis the EC50 itself.
    const add = (r: CompareResultRow, ec50: number, y: number, at?: string): void => {
      if (!Number.isFinite(ec50) || (!linear && !(ec50 > 0)) || !Number.isFinite(y)) return
      out.push({
        uniqID: r.uniqID,
        label: (displayMap[r.uniqID] || r.uniqID) + (at ? ` · ${at}` : ''),
        x: linear ? ec50 : -Math.log10(ec50 * dose.scale),
        y,
        ec50,
        effect: (r.effect ?? 'none') as Eff
      })
    }
    for (const r of rows) {
      if (show === 'called' && !r.signf) continue
      const c = r.curve
      if (c) {
        // an undescribed curve (its run described responders only) has no EC50 to place
        if (curveDescribed(c) && r.log2FC != null && Number.isFinite(c.pec50))
          add(r, xUnits(c, -c.pec50), r.log2FC)
        continue
      }
      // The response surface method: a curve's description midpoint against its peak; a
      // surface's likewise — the curve through its peak along the axis its curves run along, at
      // its midpoint, against the peak. (A line has no midpoint.)
      if (r.rs?.desc && r.log2FC != null && Number.isFinite(r.rs.desc.mid))
        add(r, r.rs.desc.mid, r.log2FC)
      const rs = r.rs
      const d = rs?.surface
      if (!rs || !d || r.log2FC == null) continue
      const k = curveAxisOf(r)
      const slices = k === 1 ? d.byDose : d.byTime
      // which of them: at the peak's level of the other axis — tested for changes, the cell with
      // the largest departure; else the largest fitted effect
      const sh = rs.shift
      let at: number | undefined = sh ? (k === 1 ? sh.peakA : sh.peakB) : undefined
      if (!sh) {
        let best = 0
        for (const cell of rs.cells ?? [])
          if (Math.abs(cell.fitted) > best) {
            best = Math.abs(cell.fitted)
            at = cell.time
          }
      }
      const sl = slices.find((x) => x.at === at)
      if (!sl || !Number.isFinite(sl.mid)) continue
      // Placed only where its 4PL found a midpoint: a top on a plateau limit, or (a log axis) a
      // midpoint at the edge of the range it may take (the tested levels ± PEC50_DELTA), is the fit
      // running off on a flat or still-rising curve.
      const atTop = sl.back <= Y_LIMITS_LOG2[0] + 1e-6 || sl.back >= Y_LIMITS_LOG2[1] - 1e-6
      const tested = (rs.cells ?? []).map((x) => (k === 1 ? x.time : x.dose)).filter((x) => x > 0)
      const lm = Math.log10(sl.mid)
      const atEdge =
        rs.maps?.[k]?.scale !== 'linear' &&
        tested.length > 0 &&
        (!(lm > Math.log10(Math.min(...tested)) - PEC50_DELTA + 0.05) ||
          !(lm < Math.log10(Math.max(...tested)) + PEC50_DELTA - 0.05))
      if (atTop || atEdge) {
        off++
        continue
      }
      const [a0, a1] = rs.pair ?? ['dose', 'time']
      add(r, sl.mid, r.log2FC, `${condLabel(k === 1 ? a0 : a1)} ${sl.at}`)
    }
    return { points: out, offBound: off }
  }, [rows, displayMap, show, dose.scale, linear])

  const doseUnit = dose.unit
  const doseMolar = dose.molar
  const { data, layout, labels } = useMemo(() => {
    const p = PALETTES[mode]
    const cmp = comparisonOf(rows)
    // which screen axis carries the potency (pt.x) and which the fold change (pt.y)
    const flip = orient === 'portrait'
    const pa = flip ? 'y' : 'x'
    const fa = flip ? 'x' : 'y'
    const sx = (pts: Point[]): number[] => pts.map((pt) => (flip ? pt.y : pt.x))
    const sy = (pts: Point[]): number[] => pts.map((pt) => (flip ? pt.x : pt.y))
    // CurveCurator's curve fold change (its range); the response surface method's peak (a curve's
    // or a surface's).
    const what = fcName(rows)
    const fcLabel = cmp ? `${what} · ${cmp}` : what
    const unitSfx = doseUnit ? ` ${doseUnit}` : ''
    // Per point (hovertemplate takes an array), with its EC50 in the dose's units written in.
    const hover = (pt: Point): string =>
      tooltip(
        {
          title: '%{text}',
          values: [
            ...(linear ? [] : [['pEC50', `%{${pa}:.2f}`] as [string, string]]),
            ['EC50', `${Number(pt.ec50.toPrecision(3))}${unitSfx}`],
            [fcLabel, `%{${fa}:.3f}`]
          ]
        },
        p.textMuted,
        { template: true }
      )
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
        x: sx(pts),
        y: sy(pts),
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
        x: sx(sel),
        y: sy(sel),
        text: sel.map((pt) => pt.label),
        customdata: sel.map((pt) => pt.uniqID),
        hovertemplate: sel.map((pt) => hover(pt)),
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
    // The calls' fold-change limits, as the volcano's wall (not draggable here) — across the
    // plot, or up it in portrait.
    const guide = (v: number) =>
      flip
        ? { type: 'line', yref: 'paper', y0: 0, y1: 1, x0: v, x1: v, line: guideLine(p, gw) }
        : { type: 'line', xref: 'paper', x0: 0, x1: 1, y0: v, y1: v, line: guideLine(p, gw) }
    const shapes = [fcLow, fcHigh].filter((v): v is number => v != null && v !== 0).map(guide)

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: showLegend,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      [flip ? 'yaxis' : 'xaxis']: {
        ...axisBase(p),
        title: linear
          ? `EC50${doseUnit ? ` (${doseUnit})` : ''}`
          : doseMolar
            ? 'pEC50 (M)'
            : '−log₁₀ EC50',
        range: [xLo - xPad, xHi + xPad],
        autorange: false
      },
      [flip ? 'xaxis' : 'yaxis']: {
        ...axisBase(p),
        title: fcLabel,
        zeroline: true,
        range: [yLo - yPad, yHi + yPad],
        autorange: false
      },
      shapes,
      // the dose curves left out for running into a fitting bound, said in a corner
      ...(offBound
        ? {
            annotations: [
              {
                xref: 'paper',
                yref: 'paper',
                x: 1,
                y: 0,
                xanchor: 'right',
                yanchor: 'bottom',
                showarrow: false,
                text: `${offBound.toLocaleString()} curve${offBound === 1 ? '' : 's'} at a fitting bound (no midpoint found) not shown`,
                font: { size: 10, color: p.textMuted }
              }
            ]
          }
        : null)
    }
    // Labels for the groups whose label switch is on, the largest responses first.
    let lab = points
      .filter((pt) => look(pt.effect).label)
      .map((pt) => ({
        x: flip ? pt.y : pt.x,
        y: flip ? pt.x : pt.y,
        text: pt.label,
        priority: Math.abs(pt.y),
        id: pt.uniqID
      }))
    if (labelTop > 0) lab = lab.sort((a, b) => b.priority - a.priority).slice(0, labelTop)
    return { data: traces, layout: lay, labels: lab }
  }, [
    points,
    offBound,
    rows,
    linear,
    show,
    doseUnit,
    doseMolar,
    fcLow,
    fcHigh,
    labelTop,
    title,
    mode,
    selSets,
    groups,
    showLegend,
    orient,
    gw
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
