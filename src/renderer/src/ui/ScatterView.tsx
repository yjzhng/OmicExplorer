import { useMemo } from 'react'

import type { ScatterData, ScatterPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, EFFECT_COLOR, guideLine, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const EFF_ORDER: Eff[] = ['none', 'down', 'up']

// Marginal (independent) contrasts label each significant gene by which quadrant it falls in —
// the composite "<FC1 dir>, <FC2 dir>" effect, where an em-dash means that axis wasn't itself
// significant. This is the order the quadrant legend groups are listed in.
const QUAD_ORDER = ['up, up', 'down, down', 'up, down', 'down, up', 'up, —', 'down, —', '—, up', '—, down']

// Quadrant palette as an 8-hue wheel: the four CORNERS are a tetrad, rotated so the main diagonal
// runs RED (up, up — top-right) ↔ BLUE (down, down — bottom-left) with magenta (up, down — top-left)
// ↔ green (down, up — bottom-right) on the other diagonal. Each single-axis EDGE sits between two
// corners on the plane and takes the TETRADIC INTERMEDIATE hue of those two corners:
//   up, — (top)    = red↔magenta   → rose      —, up (right) = red↔green    → yellow
//   down, — (bot)  = blue↔green    → teal      —, down (left)= magenta↔blue → violet
// Edges are a touch lighter so the both-axes corners still read as the strongest. Fixed hexes.
const QUAD_COLORS: Record<string, string> = {
  'up, up': '#d1495b', // red      (top-right)
  'down, down': '#3b7fb5', // blue     (bottom-left)
  'up, down': '#b45fae', // magenta  (top-left)
  'down, up': '#4fa05a', // green    (bottom-right)
  'up, —': '#d2798f', // rose   (between red & magenta, pushed toward red to clear magenta)
  '—, up': '#caca73', // yellow (between red & green)
  'down, —': '#73cab7', // teal   (between blue & green)
  '—, down': '#7f70cd' // violet (between magenta & blue, pushed toward blue to clear magenta)
}

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

  const { data, layout, labels } = useMemo(() => {
    const p = PALETTES[mode]

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

    // Point groups depend on the relationship. A correlated (OLS) contrast colours genes by
    // whether they sit above/below the line of identity — up (red) / down (blue) / none (grey),
    // matching volcano/MA. An independent (marginal) contrast instead colours by QUADRANT: the
    // composite "<FC1 dir>, <FC2 dir>" effect, so each significant corner reads as its own group.
    const marginal = scatter.guide?.kind === 'marginal'
    let pointTraces: object[]
    let sig: ScatterPoint[]
    if (marginal) {
      const groups = new Map<string, ScatterPoint[]>()
      for (const pt of scatter.points) {
        const key = pt.effect && pt.effect !== 'none' ? pt.effect : 'none'
        const arr = groups.get(key)
        if (arr) arr.push(pt)
        else groups.set(key, [pt])
      }
      sig = scatter.points.filter((pt) => !!pt.effect && pt.effect !== 'none')
      // Known quadrants in QUAD_ORDER first (stable colours), then any unexpected extras.
      const keys = [...groups.keys()].filter((k) => k !== 'none')
      keys.sort((a, b) => {
        const ia = QUAD_ORDER.indexOf(a)
        const ib = QUAD_ORDER.indexOf(b)
        return (ia < 0 ? QUAD_ORDER.length + 1 : ia) - (ib < 0 ? QUAD_ORDER.length + 1 : ib)
      })
      const noneGrp = groups.get('none')
      // Colour each quadrant by its FIXED identity (the tetradic QUAD_COLORS map), not by its
      // position among the quadrants that happen to have points — so a given quadrant always reads
      // as the same colour regardless of which others are populated. Unknown extras fall back to the
      // categorical palette.
      const colorForQuad = (k: string): string =>
        QUAD_COLORS[k] ?? CATEGORICAL[keys.indexOf(k) % CATEGORICAL.length]
      pointTraces = [
        ...(noneGrp ? [trace(noneGrp, 'none', EFFECT_COLOR.none, 6)] : []),
        ...keys.map((k) => trace(groups.get(k)!, k, colorForQuad(k), 8))
      ]
    } else {
      const byEffect: Record<Eff, ScatterPoint[]> = { up: [], down: [], none: [] }
      for (const pt of scatter.points) {
        const e: Eff = pt.effect === 'up' || pt.effect === 'down' ? pt.effect : 'none'
        byEffect[e].push(pt)
      }
      sig = [...byEffect.down, ...byEffect.up]
      // One trace per effect group (none/down/up). Empty groups are dropped so the legend
      // doesn't show "(0)" entries (e.g. a value scatter is all `none`).
      pointTraces = EFF_ORDER.filter((e) => byEffect[e].length > 0).map((e) =>
        trace(byEffect[e], e, EFFECT_COLOR[e], e === 'none' ? 6 : 8)
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

    // Collision-managed labels for the significant (divergent) genes, most divergent first.
    // labelTop > 0 caps the candidate pool; 0 (the default) offers them all and lets the
    // placement layer keep as many as fit — more appear as you zoom in.
    const ranked = [...sig].sort((a, b) => Math.abs(b.fcdiff) - Math.abs(a.fcdiff))
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
      // would steal plot width and shift as group names change. Forced always-on so it never
      // appears/disappears and reflows the layout.
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 }
    }
    return { data: [...guideTraces, ...pointTraces], layout: lay, labels }
  }, [scatter, title, labelTop, mode])

  return (
    <PlotlyChart data={data} layout={layout} labels={labels} labelColor={PALETTES[mode].text} />
  )
}
