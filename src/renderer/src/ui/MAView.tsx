import { useMemo } from 'react'

import type { MAData, MAPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

type Eff = 'up' | 'down' | 'none'
const ORDER: Eff[] = ['none', 'down', 'up']

/** MA plot: mean log2 abundance (A) vs log2 fold change (M), colored by effect.
 *  `focus` genes stay emphasized while the rest dims to a grey background. */
export function MAView({ ma, title, focus }: { ma: MAData; title?: string; focus?: string[] }) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const focusSet = new Set(focus ?? [])
    const hasFocus = focusSet.size > 0
    const hover = '%{text}<br>A=%{x:.2f}<br>log2FC=%{y:.3f}<extra></extra>'

    let traces: Array<Record<string, unknown>>
    if (hasFocus) {
      // Greyed background of every non-focus point, then focus genes drawn LAST (on top):
      // effect-colored, enlarged, outlined, labelled.
      const bg = ma.points.filter((pt) => !focusSet.has(pt.uniqID))
      const fg = ma.points.filter((pt) => focusSet.has(pt.uniqID))
      traces = [
        {
          type: 'scatter',
          mode: 'markers',
          name: `other (${bg.length})`,
          x: bg.map((pt) => pt.x),
          y: bg.map((pt) => pt.y),
          text: bg.map((pt) => pt.label),
          customdata: bg.map((pt) => pt.uniqID),
          hovertemplate: hover,
          marker: { color: p.textMuted, size: 4, opacity: 0.5 }
        },
        {
          type: 'scatter',
          mode: 'markers+text',
          name: `focus (${fg.length})`,
          x: fg.map((pt) => pt.x),
          y: fg.map((pt) => pt.y),
          text: fg.map((pt) => pt.label),
          textposition: 'top center',
          textfont: { size: 10, color: p.text },
          customdata: fg.map((pt) => pt.uniqID),
          hovertemplate: hover,
          marker: {
            color: fg.map((pt) => EFFECT_COLOR[pt.effect]),
            size: 10,
            opacity: 0.98,
            line: { color: p.text, width: 1.2 }
          }
        }
      ]
    } else {
      const byEffect: Record<Eff, MAPoint[]> = { up: [], down: [], none: [] }
      for (const pt of ma.points) byEffect[pt.effect].push(pt)
      traces = ORDER.map((eff) => {
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

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: 'mean log₂ abundance (A)' },
      yaxis: { ...axisBase(p), title: 'log₂ fold change (M)', zeroline: true },
      shapes: [guide(ma.fcLow), guide(ma.fcHigh)]
    }
    return { data: traces, layout: lay }
  }, [ma, title, mode, focus])

  return <PlotlyChart data={data} layout={layout} />
}
