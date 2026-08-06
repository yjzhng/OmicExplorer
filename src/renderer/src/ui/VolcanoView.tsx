import { useMemo } from 'react'

import type { VolcanoData, VolcanoPoint } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, PALETTES, plotBase } from './theme'
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
  const yLabel = volcano.statType === 'pP' ? '−log₁₀ p' : '−log₁₀ q'

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const focusSet = new Set(focus ?? [])
    const hasFocus = focusSet.size > 0
    const hover = `%{text}<br>log2FC=%{x:.3f}<br>${yLabel}=%{y:.3f}<extra></extra>`

    let traces: Array<Record<string, unknown>>
    if (hasFocus) {
      // Two layers: a greyed background of every non-focus point, then the focus genes
      // drawn LAST so they sit on top — effect-colored, enlarged, outlined, and labelled.
      const bg = volcano.points.filter((pt) => !focusSet.has(pt.uniqID))
      const fg = volcano.points.filter((pt) => focusSet.has(pt.uniqID))
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
          marker: { color: p.textMuted, size: 5, opacity: 0.5 }
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
            size: 11,
            opacity: 0.98,
            line: { width: 0 }
          }
        }
      ]
    } else {
      const byEffect: Record<Eff, VolcanoPoint[]> = { up: [], down: [], none: [] }
      for (const pt of volcano.points) byEffect[pt.effect].push(pt)
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
          marker: { color: EFFECT_COLOR[eff], size: 7, opacity: 0.85 }
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

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axisBase(p), title: 'log₂ fold change', zeroline: false },
      yaxis: { ...axisBase(p), title: yLabel, rangemode: 'tozero', zeroline: false },
      shapes: [
        line(volcano.fcLow, volcano.fcLow, 0, yMax),
        line(volcano.fcHigh, volcano.fcHigh, 0, yMax),
        line(0, 1, volcano.statMin, volcano.statMin, 'paper')
      ]
    }
    return { data: traces, layout: lay }
  }, [volcano, title, yLabel, mode, focus])

  return <PlotlyChart data={data} layout={layout} />
}
