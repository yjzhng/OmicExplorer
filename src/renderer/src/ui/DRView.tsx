import { useMemo } from 'react'

import type { DRData, DRSeries } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, CATEGORICAL, HIGHLIGHT, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/**
 * Response curves: log2FC vs dose (or time). Every gene is drawn as a faint grey line,
 * merged into ONE Plotly trace (null-separated) so thousands of genes stay a single
 * trace and never freeze the renderer. The top-`highlight` most-differential genes are
 * colored on top as individual traces (these carry the linked-selection identity).
 *
 * A hovered/pinned gene (from any plot or the table) is pulled out of the grey
 * background and coloured too, ALONGSIDE the top-N — so linked selection highlights any
 * curve, not only the pre-chosen ones.
 */
export function DRView({ dr, title }: { dr: DRData; title?: string }) {
  const mode = useUiTheme((s) => s.mode)
  const hoverId = useSelection((s) => s.hoverId)
  const pinnedIds = useSelection((s) => s.pinnedIds)

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const active = new Set(pinnedIds)
    if (hoverId) active.add(hoverId)

    // Discrete x: the axis (dose/time) levels are spaced evenly as categories, not by their
    // numeric value, so a dose series like 1.25…80 reads at equal intervals. Categories are the
    // distinct axis values, numerically sorted; x is emitted as strings to match.
    const cats = [...new Set(dr.series.flatMap((s) => s.points.map((pt) => pt.x)))]
      .sort((a, b) => a - b)
      .map(String)

    // Background: all genes as one faint grey trace, null-separated between genes.
    const bx: (string | null)[] = []
    const by: (number | null)[] = []
    const btext: (string | null)[] = []
    for (const s of dr.series) {
      for (const pt of s.points) {
        bx.push(String(pt.x))
        by.push(pt.y)
        btext.push(s.label)
      }
      bx.push(null)
      by.push(null)
      btext.push(null)
    }
    const background = {
      type: 'scatter',
      mode: 'lines',
      name: `all (${dr.total})`,
      x: bx,
      y: by,
      text: btext,
      hovertemplate: `%{text}<br>${dr.axis}=%{x}<br>log2FC=%{y:.3f}<extra></extra>`,
      line: { color: p.textMuted, width: 1 },
      opacity: 0.22,
      showlegend: false
    }

    const line = (s: DRSeries, color: string, width: number) => ({
      type: 'scatter',
      mode: 'lines',
      name: s.label,
      x: s.points.map((pt) => String(pt.x)),
      y: s.points.map((pt) => pt.y),
      customdata: s.points.map(() => s.uniqID),
      hovertemplate: `${s.label}<br>${dr.axis}=%{x}<br>log2FC=%{y:.3f}<extra></extra>`,
      line: { color, width }
    })

    // Foreground: top-N differential genes, colored, with identity for linked highlight.
    // Clamp the colored count so a huge N can't re-explode the trace count.
    const top = dr.series.slice(0, Math.min(dr.highlight, 100))
    const colored = top.map((s, i) => line(s, CATEGORICAL[i % CATEGORICAL.length], 2))
    // Active (hovered/pinned) genes are ALWAYS redrawn on top in the bright accent colour, a touch
    // thicker — even if they're already a top-N curve — so the linked selection is unmistakable
    // (a top-N gene would otherwise only differ by the subtle dimming of its neighbours).
    const extra = dr.series.filter((s) => active.has(s.uniqID))
    for (const s of extra) colored.push(line(s, HIGHLIGHT, 3.5))

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: top.length > 0 && colored.length <= 12,
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: {
        ...axisBase(p),
        title: dr.axis,
        type: 'category',
        categoryorder: 'array',
        categoryarray: cats
      },
      yaxis: { ...axisBase(p), title: 'log₂ fold change', zeroline: true }
    }
    return { data: [background, ...colored], layout: lay }
  }, [dr, title, mode, hoverId, pinnedIds])

  return <PlotlyChart data={data} layout={layout} />
}
