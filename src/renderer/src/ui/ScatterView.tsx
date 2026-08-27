import { useMemo } from 'react'

import type { ScatterData, ScatterPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, PALETTES, plotBase } from './theme'
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
  labelTop = 0
}: {
  scatter: ScatterData
  title?: string
  labelTop?: number
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    // Colour the significance groups with the same scheme as volcano/MA: up (red) / down (blue) /
    // none (grey). For a contrast/compare the `effect` already encodes signf + direction (up/down =
    // significant & divergent, none = not). The significant points (up+down) are the "divergent" set.
    const byEffect: Record<Eff, ScatterPoint[]> = { up: [], down: [], none: [] }
    for (const pt of scatter.points) {
      const e: Eff = pt.effect === 'up' || pt.effect === 'down' ? pt.effect : 'none'
      byEffect[e].push(pt)
    }
    const sig = [...byEffect.down, ...byEffect.up]

    const hover = `%{text}<br>${scatter.xLabel}=%{x:.3f}<br>${scatter.yLabel}=%{y:.3f}<extra></extra>`
    const trace = (pts: ScatterPoint[], name: string, color: string, size: number) => ({
      type: 'scatter',
      mode: 'markers',
      name: `${name} (${pts.length})`,
      x: pts.map((pt) => pt.x),
      y: pts.map((pt) => pt.y),
      text: pts.map((pt) => pt.label),
      customdata: pts.map((pt) => pt.uniqID),
      hovertemplate: hover,
      marker: { color, size, opacity: 0.85 }
    })

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
    const guideLine = { color: p.border, width: 1, dash: 'dash' }
    const curve = (d: { x: number[]; y: number[] }, dashed: boolean) => ({
      type: 'scatter',
      mode: 'lines',
      hoverinfo: 'skip',
      showlegend: false,
      x: d.x,
      y: d.y,
      line: { color: p.border, width: 1, dash: dashed ? 'dash' : 'solid' },
      opacity: dashed ? 0.6 : 0.4
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
      line: guideLine
    })
    const vLine = (x: number) => ({
      type: 'line',
      yref: 'paper',
      y0: 0,
      y1: 1,
      x0: x,
      x1: x,
      line: guideLine
    })
    const identity = { type: 'line', x0: lo, x1: hi, y0: lo, y1: hi, line: guideLine }
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

    // label the top-N most divergent significant genes
    const labels = [...sig]
      .sort((a, b) => Math.abs(b.fcdiff) - Math.abs(a.fcdiff))
      .slice(0, Math.max(0, labelTop))
      .map((pt) => ({
        x: pt.x,
        y: pt.y,
        text: pt.label,
        showarrow: false,
        yshift: 8,
        font: { size: 9, color: p.text }
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
      annotations: labels,
      shapes: guideShapes
    }
    // One trace per effect group (none/down/up), coloured like volcano/MA. Empty groups are
    // dropped so the legend doesn't show "(0)" entries (e.g. a value scatter is all `none`).
    const pointTraces = EFF_ORDER.filter((e) => byEffect[e].length > 0).map((e) =>
      trace(byEffect[e], e, EFFECT_COLOR[e], e === 'none' ? 6 : 8)
    )
    return { data: [...guideTraces, ...pointTraces], layout: lay }
  }, [scatter, title, labelTop, mode])

  return <PlotlyChart data={data} layout={layout} />
}
