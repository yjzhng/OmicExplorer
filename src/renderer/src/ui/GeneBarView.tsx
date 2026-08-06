import { useMemo } from 'react'

import type { GeneBarData } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
import { useUiTheme } from './useUiTheme'

/** Focus genes' standardized value across every condition — grouped bars (mean ± sd),
 *  one series per gene. Landscape draws vertical bars (conditions across x); portrait
 *  draws horizontal bars (conditions down y). */
export function GeneBarView({
  bar,
  title,
  orient = 'landscape'
}: {
  bar: GeneBarData
  title?: string
  orient?: 'landscape' | 'portrait'
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const horizontal = orient === 'portrait'
    const err = (gb: { sd: number }[]) => ({
      type: 'data',
      array: gb.map((b) => b.sd),
      visible: true,
      color: p.border,
      thickness: 1,
      width: 2
    })
    const traces = bar.genes.map((g, i) => {
      const gb = bar.bars.filter((b) => b.uniqID === g.uniqID)
      const conds = gb.map((b) => b.cond)
      const means = gb.map((b) => b.mean)
      return {
        type: 'bar',
        name: g.label,
        orientation: horizontal ? 'h' : 'v',
        x: horizontal ? means : conds,
        y: horizontal ? conds : means,
        [horizontal ? 'error_x' : 'error_y']: err(gb),
        marker: { color: CATEGORICAL[i % CATEGORICAL.length] }
      }
    })
    const condAxis = {
      ...axisBase(p),
      title: 'condition',
      automargin: true,
      ...(horizontal ? {} : { tickangle: -40 })
    }
    const valAxis = { ...axisBase(p), title: 'value' }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      barmode: 'group',
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: horizontal ? valAxis : condAxis,
      yaxis: horizontal ? condAxis : valAxis
    }
    return { data: traces, layout: lay }
  }, [bar, title, orient, mode])

  return <PlotlyChart data={data} layout={layout} />
}
