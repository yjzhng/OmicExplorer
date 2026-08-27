import { useMemo } from 'react'

import type { VolcanoData, VolcanoPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, HIGHLIGHT, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

/** Interactive volcano: log2FC vs significance, colored by effect, with threshold guides.
 *  When `focus` genes are set, they keep full effect color + an outline while the rest
 *  of the cloud dims to a grey background (omicViz's background/highlight split). */
export function VolcanoView({
  volcano,
  title,
  focus
}: {
  volcano: VolcanoData
  title?: string
  focus?: string[]
}) {
  const mode = useUiTheme((s) => s.mode)
  // Pinned (linked-selection) genes become their own "Selected" legend group. Subscribe to
  // pinnedIds only (not hoverId), so the plot rebuilds on a click-select, not on every hover.
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const yLabel = volcano.statType === 'pP' ? '−log₁₀ p' : '−log₁₀ q'

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const focusSet = new Set(focus ?? [])
    const hasFocus = focusSet.size > 0
    const hover = `%{text}<br>log2FC=%{x:.3f}<br>${yLabel}=%{y:.3f}<extra></extra>`

    // Always colour EVERY point by effect (up/down/none), so the significance groups stay
    // visible whether or not GOI is active — never grey the cloud out.
    const byEffect: Record<Eff, VolcanoPoint[]> = { up: [], down: [], none: [] }
    for (const pt of volcano.points) byEffect[pt.effect].push(pt)
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
        marker: { color: EFFECT_COLOR[eff], size: 7, opacity: 0.85 }
      }
    })
    // With focus (GOI) genes set, draw them ON TOP as an emphasis layer — same effect colour,
    // enlarged, outlined and labelled — so they stand out without hiding everyone else's
    // significance. Shown in the legend as its own "GOI" group (the outline marks the group).
    if (hasFocus) {
      const fg = volcano.points.filter((pt) => focusSet.has(pt.uniqID))
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
        marker: {
          color: fg.map((pt) => EFFECT_COLOR[pt.effect]),
          size: 12,
          opacity: 1,
          line: { width: 1.5, color: p.text }
        }
      })
    }
    // Pinned genes → a "Selected" legend group, drawn on top with a bright highlight ring so
    // they read distinctly from GOI (dark outline) and from the effect groups.
    const sel = volcano.points.filter((pt) => pinnedIds.has(pt.uniqID))
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
        marker: {
          color: sel.map((pt) => EFFECT_COLOR[pt.effect]),
          size: 14,
          opacity: 1,
          line: { width: 2.5, color: HIGHLIGHT }
        }
      })
    }

    const line = (x0: number, x1: number, y0: number, y1: number, xref?: string) => ({
      type: 'line',
      x0,
      x1,
      y0,
      y1,
      ...(xref ? { xref } : {}),
      line: { color: p.border, width: 1, dash: 'dash' }
    })
    const yMax = Math.max(1, ...volcano.points.map((pt) => pt.y))
    // Pin explicit axis ranges (with padding) so the range never re-pads on hover — otherwise
    // the enlarged overlay marker on an edge point shifts the whole cloud, sliding the point
    // out from under the cursor and bouncing between hover/unhover.
    const xs = volcano.points.map((pt) => pt.x)
    const xLo = Math.min(volcano.fcLow, 0, ...xs)
    const xHi = Math.max(volcano.fcHigh, 0, ...xs)
    const xPad = (xHi - xLo || 2) * 0.05

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
        title: 'log₂ fold change',
        zeroline: false,
        range: [xLo - xPad, xHi + xPad],
        autorange: false
      },
      yaxis: {
        ...axisBase(p),
        title: yLabel,
        zeroline: false,
        range: [0, yMax * 1.08],
        autorange: false
      },
      shapes: [
        line(volcano.fcLow, volcano.fcLow, 0, yMax),
        line(volcano.fcHigh, volcano.fcHigh, 0, yMax),
        line(0, 1, volcano.statMin, volcano.statMin, 'paper')
      ]
    }
    return { data: traces, layout: lay }
  }, [volcano, title, yLabel, mode, focus, pinnedIds])

  return <PlotlyChart data={data} layout={layout} />
}
