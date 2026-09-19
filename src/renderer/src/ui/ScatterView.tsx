import { useMemo } from 'react'

import type { ScatterData, ScatterPoint } from '../engine'
import { DEFAULT_EFFECT_LABELS, type EffectLabels, type PointStyle } from '../graph/types'
import { useGraph } from '../graph/store'
import { PlotlyChart } from './PlotlyChart'
import {
  legendOn,
  QUAD_ORDER,
  resolveGroups,
  resolveHighlight,
  type ResolvedGroup
} from './pointStyle'
import { axisBase, CATEGORICAL, guideLine, PALETTES, plotBase } from './theme'
import { matchingGeneSet, useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const EFF_ORDER: Eff[] = ['none', 'down', 'up']

/**
 * Contrast scatter: FC1 (y) vs FC2 (x). The significance boundary follows the contrast's
 * relationship — an OLS fit + prediction band when correlated, a 9-zone per-axis box when
 * independent (see ScatterGuide). Divergent genes are highlighted; the top few by |FCdiff|
 * are labelled.
 */
export function ScatterView({
  scatter,
  title,
  labelTop = 0,
  effectLabels = DEFAULT_EFFECT_LABELS,
  style
}: {
  scatter: ScatterData
  title?: string
  labelTop?: number
  /** per-tile marker / highlight / legend look (unset fields use the scatter defaults) */
  style?: PointStyle
  /** display names for the down/up classes (from the upstream Compare/Contrast config) */
  effectLabels?: EffectLabels
}) {
  const mode = useUiTheme((s) => s.mode)
  // Pinned (linked-selection) genes become their own trace, as on volcano/MA: kept fully opaque,
  // with a legend entry (and the set's own colour) only when they form a saved geneset. Subscribe
  // to pinnedIds only (not hoverId), so the plot rebuilds on a click-select, not on every hover.
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const geneSets = useGraph((s) => s.geneSets)
  const selSet = matchingGeneSet(pinnedIds, geneSets)
  const selName = selSet?.name ?? null
  const selColor = selSet?.color ?? null
  // Point groups depend on the relationship. A correlated (OLS) contrast colours genes by
  // whether they sit above/below the line of identity — up (red) / down (blue) / none (grey),
  // matching volcano/MA. An independent (marginal) contrast instead colours by QUADRANT: the
  // composite "<FC1 dir>, <FC2 dir>" effect, so each significant corner reads as its own group.
  const marginal = scatter.guide?.kind === 'marginal'
  // Resolved once per config change (stable objects, so PlotlyChart doesn't re-render per hover).
  // Memo inputs kept primitive (the parent hands a fresh `effectLabels` object per render).
  const upName = effectLabels.up
  const downName = effectLabels.down
  const groups = useMemo(
    () =>
      resolveGroups(style, marginal ? 'scatterQuad' : 'scatter', { up: upName, down: downName }),
    [style, marginal, upName, downName]
  )
  const emphasis = useMemo(() => resolveHighlight(style), [style])
  const showLegend = legendOn(style)

  const { data, layout, labels } = useMemo(() => {
    const p = PALETTES[mode]

    // The tooltip names the gene only when the highlight's own label is off (else it's a duplicate).
    const hover = `${emphasis.label ? '' : '%{text}<br>'}${scatter.xLabel}=%{x:.3f}<br>${scatter.yLabel}=%{y:.3f}<extra></extra>`
    const trace = (pts: ScatterPoint[], g: ResolvedGroup) => ({
      type: 'scatter',
      mode: 'markers',
      name: `${g.name} (${pts.length})`,
      showlegend: g.legend,
      x: pts.map((pt) => pt.x),
      y: pts.map((pt) => pt.y),
      text: pts.map((pt) => pt.label),
      customdata: pts.map((pt) => pt.uniqID),
      hovertemplate: hover,
      marker: { color: g.color, size: g.size, opacity: g.opacity }
    })
    // A point's group key: its quadrant (marginal) or effect class; anything unknown is 'none'.
    const keyOf = (pt: ScatterPoint): string =>
      marginal
        ? pt.effect && pt.effect !== 'none'
          ? pt.effect
          : 'none'
        : pt.effect === 'up' || pt.effect === 'down'
          ? pt.effect
          : 'none'
    // Unknown quadrant keys (extras beyond QUAD_ORDER) get a categorical fallback colour.
    const look = (key: string, fallbackIdx = 0): ResolvedGroup =>
      groups.get(key) ?? {
        ...groups.get('none')!,
        key,
        name: key,
        size: 8,
        color: CATEGORICAL[fallbackIdx % CATEGORICAL.length],
        label: true
      }

    let pointTraces: object[]
    if (marginal) {
      const byQuad = new Map<string, ScatterPoint[]>()
      for (const pt of scatter.points) {
        const key = keyOf(pt)
        const arr = byQuad.get(key)
        if (arr) arr.push(pt)
        else byQuad.set(key, [pt])
      }
      // Known quadrants in QUAD_ORDER first (stable colours), then any unexpected extras.
      const keys = [...byQuad.keys()].filter((k) => k !== 'none')
      keys.sort((a, b) => {
        const ia = QUAD_ORDER.indexOf(a)
        const ib = QUAD_ORDER.indexOf(b)
        return (ia < 0 ? QUAD_ORDER.length + 1 : ia) - (ib < 0 ? QUAD_ORDER.length + 1 : ib)
      })
      const noneGrp = byQuad.get('none')
      // Each quadrant is styled by its FIXED identity (the resolved group for its key), not by its
      // position among the quadrants that happen to have points — so a given quadrant always reads
      // the same regardless of which others are populated.
      pointTraces = [
        ...(noneGrp ? [trace(noneGrp, look('none'))] : []),
        ...keys.map((k) => trace(byQuad.get(k)!, look(k, keys.indexOf(k))))
      ]
    } else {
      const byEffect: Record<Eff, ScatterPoint[]> = { up: [], down: [], none: [] }
      for (const pt of scatter.points) byEffect[keyOf(pt) as Eff].push(pt)
      // One trace per effect group (none/down/up). Empty groups are dropped so the legend
      // doesn't show "(0)" entries (e.g. a value scatter is all `none`).
      pointTraces = EFF_ORDER.filter((e) => byEffect[e].length > 0).map((e) =>
        trace(byEffect[e], look(e))
      )
    }

    // One shared square spanning both axes and the origin (looped rather than spread —
    // these arrays run to thousands of genes). A little padding keeps extreme points off
    // the border.
    const all = scatter.points
    let lo0 = 0
    let hi0 = 0
    for (const pt of all) {
      lo0 = Math.min(lo0, pt.x, pt.y)
      hi0 = Math.max(hi0, pt.x, pt.y)
    }
    const pad = (hi0 - lo0) * 0.03 || 0.5
    const lo = lo0 - pad
    const hi = hi0 + pad

    // A *correlated* contrast gets the line of identity plus a prediction-band envelope
    // around it — dissonant genes sit outside. An *independent* one gets two thresholds on
    // each axis, carving the plane into 9 zones, and no line of identity.
    const g = scatter.guide
    const gLine = guideLine(p)
    const curve = (d: { x: number[]; y: number[] }, dashed: boolean) => ({
      type: 'scatter',
      mode: 'lines',
      hoverinfo: 'skip',
      showlegend: false,
      x: d.x,
      y: d.y,
      line: { color: p.textMuted, width: 1.5, dash: dashed ? 'dash' : 'solid' },
      opacity: dashed ? 0.7 : 0.55
    })
    // Curves must be traces (shapes can't follow a band); drawn first so points sit above.
    const guideTraces =
      g?.kind === 'ols' && g.fit && g.upper && g.lower
        ? [curve(g.fit, false), curve(g.upper, true), curve(g.lower, true)]
        : []
    const hLine = (y: number) => ({
      type: 'line',
      xref: 'paper',
      x0: 0,
      x1: 1,
      y0: y,
      y1: y,
      line: gLine
    })
    const vLine = (x: number) => ({
      type: 'line',
      yref: 'paper',
      y0: 0,
      y1: 1,
      x0: x,
      x1: x,
      line: gLine
    })
    const identity = { type: 'line', x0: lo, x1: hi, y0: lo, y1: hi, line: gLine }
    const guideShapes =
      g?.kind === 'marginal'
        ? [
            hLine(g.yLo as number),
            hLine(g.yHi as number),
            vLine(g.xLo as number),
            vLine(g.xHi as number)
          ]
        : g?.kind === 'ols'
          ? []
          : [identity] // no guide (e.g. too few points) — fall back to the line of identity

    // Collision-managed labels for the genes of every group whose label switch is on (by default
    // the significant / divergent ones), most divergent first. labelTop > 0 caps the candidate
    // pool; 0 (the default) offers them all and lets the placement layer keep as many as fit —
    // more appear as you zoom in.
    const ranked = scatter.points
      .filter((pt) => look(keyOf(pt)).label)
      .sort((a, b) => Math.abs(b.fcdiff) - Math.abs(a.fcdiff))
    const labels = (labelTop > 0 ? ranked.slice(0, labelTop) : ranked).map((pt) => ({
      x: pt.x,
      y: pt.y,
      text: pt.label,
      priority: Math.abs(pt.fcdiff),
      id: pt.uniqID
    }))

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      // The builder owns the axis text — a contrast scatter reads "log₂FC · <side>",
      // a value scatter "log₁₀ <level>".
      // Both axes share one range that always spans the origin, so the square is
      // symmetric and the line of identity runs corner-to-corner through (0,0).
      xaxis: { ...axisBase(p), title: scatter.xLabel, zeroline: false, range: [lo, hi] },
      yaxis: {
        ...axisBase(p),
        title: scatter.yLabel,
        zeroline: false,
        scaleanchor: 'x',
        range: [lo, hi]
      },
      shapes: guideShapes,
      // Legend centered ABOVE the plot (horizontal), matching volcano/MA — a right-side legend
      // would steal plot width and shift as group names change. Fixed per config (never toggled
      // by the data) so it doesn't appear/disappear and reflow the layout.
      showlegend: showLegend,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 }
    }
    // Pinned genes on top: markers only (the overlay names them), sized/coloured per their group
    // unless the selection is a geneset with a colour of its own.
    const sel = scatter.points.filter((pt) => pinnedIds.has(pt.uniqID))
    const selTrace = sel.length
      ? [
          {
            type: 'scatter',
            mode: 'markers',
            name: selName ? `${selName} (${sel.length})` : `Selected (${sel.length})`,
            showlegend: selName !== null,
            x: sel.map((pt) => pt.x),
            y: sel.map((pt) => pt.y),
            text: sel.map((pt) => pt.label),
            customdata: sel.map((pt) => pt.uniqID),
            hovertemplate: hover,
            marker: {
              color: selColor ?? sel.map((pt) => look(keyOf(pt)).color),
              size: sel.map((pt) => look(keyOf(pt)).size),
              opacity: 1
            }
          }
        ]
      : []
    return { data: [...guideTraces, ...pointTraces, ...selTrace], layout: lay, labels }
  }, [
    scatter,
    title,
    labelTop,
    mode,
    marginal,
    groups,
    showLegend,
    emphasis.label,
    pinnedIds,
    selName,
    selColor
  ])

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
