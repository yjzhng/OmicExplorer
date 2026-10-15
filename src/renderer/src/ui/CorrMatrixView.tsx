import { useMemo } from 'react'

import type { CorrData } from '../engine'
import { condsOf } from './clusterPlan'
import { condTooltip, valueLine } from './condTooltip'
import { ROLE_DEFAULTS, paletteScale, type PaletteRef } from './palettes'
import { bindCorrFocus } from './heatmapFocus'
import { PlotlyChart } from './PlotlyChart'
import { sampleKey } from './sampleLink'
import { axisBase, PALETTES, plotBase, withAlpha } from './theme'
import { useUiTheme } from './useUiTheme'

/** How strongly a hovered matrix veils the cells outside the hovered row and column. */
const HOVER_VEIL = 0.65

/** All-samples × all-samples correlation heatmap. Along the palette (Greens by default) from
 *  the colour floor (lowest observed r) to 1, so the diagonal and tight replicate blocks read as
 *  its darkest end. The y-axis is reversed so the matrix reads top-left → bottom-right like a table. */
export function CorrMatrixView({
  data,
  title,
  palette = ROLE_DEFAULTS.corr
}: {
  data: CorrData
  title?: string
  /** low r → r = 1 along this palette (default Greens: pale → deepest green) */
  palette?: PaletteRef
}) {
  const mode = useUiTheme((s) => s.mode)

  const { data: traces, layout } = useMemo(() => {
    const p = PALETTES[mode]
    // A cell is a pair of samples: the row's identity, then the column's, then r — the shared
    // Clean data tooltip (condTooltip), with the two samples apart by a faint rule.
    const conds = condsOf(data.metas)
    const idents = data.metas.map((m, i) => condTooltip(m, conds, p.textMuted) || data.labels[i])
    const rule = `<span style="color:${p.textMuted}">────</span>`
    const trace: Record<string, unknown> = {
      type: 'heatmap',
      z: data.z,
      x: data.labels,
      y: data.labels,
      colorscale: paletteScale(palette),
      // Floor the scale a touch below the lowest r so the range isn't dominated by the 1.0
      // diagonal; keeps between-sample differences visible.
      zmin: Math.min(data.min, 0.99),
      zmax: 1,
      colorbar: { title: { text: 'r', side: 'right' }, thickness: 12 },
      // the pair as text, not customdata: a string customdata reads as a gene id (PlotlyChart)
      text: idents.map((row) => idents.map((col) => `${row}<br>${rule}<br>${col}`)),
      hovertemplate: `%{text}<br>${valueLine('r', '%{z:.3f}')}<extra></extra>`
    }
    const axis = {
      ...axisBase(p),
      type: 'category',
      tickfont: { size: 8 },
      automargin: true
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: { ...axis, tickangle: -45 },
      // Reverse y so the first sample sits top-left (matrix convention).
      yaxis: { ...axis, autorange: 'reversed' }
    }
    return { data: [trace], layout: lay }
  }, [data, title, mode, palette])

  // each sample's link key, for the sample link with the other plots
  const sampleKeys = useMemo(() => data.metas.map((m) => sampleKey(m, m.rep)), [data.metas])

  return (
    <PlotlyChart
      data={traces}
      layout={layout}
      // the hovered cell's row and column (or a sample hovered elsewhere) — see bindCorrFocus
      onGraphMount={(el) =>
        bindCorrFocus(
          el,
          withAlpha(PALETTES[mode].panel, HOVER_VEIL),
          sampleKeys,
          PALETTES[mode].text
        )
      }
    />
  )
}
