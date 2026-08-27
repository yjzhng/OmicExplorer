import { useMemo } from 'react'

import type { MAData, MAPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, HIGHLIGHT, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

/** MA plot: mean log2 abundance (A) vs log2 fold change (M), colored by effect.
 *  `focus` genes stay emphasized while the rest dims to a grey background. */
export function MAView({ ma, title, focus }: { ma: MAData; title?: string; focus?: string[] }) {
  const mode = useUiTheme((s) => s.mode)
  // Pinned genes become a "Selected" legend group. Subscribe to pinnedIds only (not hoverId),
  // so the plot rebuilds on a click-select, not on every hover.
  const pinnedIds = useSelection((s) => s.pinnedIds)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const focusSet = new Set(focus ?? [])
    const hasFocus = focusSet.size > 0
    const hover = '%{text}<br>A=%{x:.2f}<br>log2FC=%{y:.3f}<extra></extra>'

    // Always colour EVERY point by effect (up/down/none), so the significance groups stay
    // visible whether or not GOI is active — never grey the cloud out.
    const byEffect: Record<Eff, MAPoint[]> = { up: [], down: [], none: [] }
    for (const pt of ma.points) byEffect[pt.effect].push(pt)
    const traces: Array<Record<string, unknown>> = ORDER.map((eff) => {
      const pts = byEffect[eff]
      return {
        type: 'scatter',
        mode: 'markers',
        name: `${eff} (${pts.length})`,
        x: pts.map((pt) => pt.x),
        y: pts.map((pt) => pt.y),
        text: pts.map((pt) => pt.label),
        customdata: pts.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: { color: EFFECT_COLOR[eff], size: 6, opacity: 0.8 }
      }
    })
    // With focus (GOI) genes set, draw them ON TOP as an emphasis layer — same effect colour,
    // enlarged, outlined and labelled — so they stand out without hiding everyone else's
    // significance. Shown in the legend as its own "GOI" group (the outline marks the group).
    if (hasFocus) {
      const fg = ma.points.filter((pt) => focusSet.has(pt.uniqID))
      traces.push({
        type: 'scatter',
        mode: 'markers+text',
        name: `GOI (${fg.length})`,
        showlegend: true,
        x: fg.map((pt) => pt.x),
        y: fg.map((pt) => pt.y),
        text: fg.map((pt) => pt.label),
        textposition: 'top center',
        textfont: { size: 10, color: p.text },
        customdata: fg.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: { color: fg.map((pt) => EFFECT_COLOR[pt.effect]), size: 11, opacity: 1, line: { color: p.text, width: 1.2 } }
      })
    }
    // Pinned genes → a "Selected" legend group, drawn on top with a bright highlight ring so
    // they read distinctly from GOI (dark outline) and from the effect groups.
    const sel = ma.points.filter((pt) => pinnedIds.has(pt.uniqID))
    if (sel.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers+text',
        name: `Selected (${sel.length})`,
        showlegend: true,
        x: sel.map((pt) => pt.x),
        y: sel.map((pt) => pt.y),
        text: sel.map((pt) => pt.label),
        textposition: 'top center',
        textfont: { size: 10, color: p.text },
        customdata: sel.map((pt) => pt.uniqID),
        hovertemplate: hover,
        marker: { color: sel.map((pt) => EFFECT_COLOR[pt.effect]), size: 13, opacity: 1, line: { color: HIGHLIGHT, width: 2.5 } }
      })
    }

    const xs = ma.points.map((pt) => pt.x)
    const lo = Math.min(0, ...xs)
    const hi = Math.max(1, ...xs)
    const guide = (y: number) => ({
      type: 'line',
      x0: lo,
      x1: hi,
      y0: y,
      y1: y,
      line: { color: p.border, width: 1, dash: 'dash' }
    })
    // Pin explicit axis ranges (with padding) so the range never re-pads on hover — otherwise
    // the enlarged overlay marker on an edge point shifts the whole cloud and bounces the hover.
    const ys = ma.points.map((pt) => pt.y)
    const yLo = Math.min(ma.fcLow, 0, ...ys)
    const yHi = Math.max(ma.fcHigh, 0, ...ys)
    const xPad = (hi - lo || 2) * 0.05
    const yPad = (yHi - yLo || 2) * 0.06

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      // Legend centered ABOVE the plot (horizontal), not on the right: a right-side legend
      // reserves horizontal room that shifts as its content changes, moving the cloud sideways
      // on hover and bouncing the point. A top legend never affects the plot width. Forced
      // always-on (showlegend) so it never appears/disappears and reflows the layout.
      showlegend: true,
      legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        title: 'mean log₂ abundance (A)',
        range: [lo - xPad, hi + xPad],
        autorange: false
      },
      yaxis: {
        ...axisBase(p),
        title: 'log₂ fold change (M)',
        zeroline: true,
        range: [yLo - yPad, yHi + yPad],
        autorange: false
      },
      shapes: [guide(ma.fcLow), guide(ma.fcHigh)]
    }
    return { data: traces, layout: lay }
  }, [ma, title, mode, focus, pinnedIds])

  return <PlotlyChart data={data} layout={layout} />
}
