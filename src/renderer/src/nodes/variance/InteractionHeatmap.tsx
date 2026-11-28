import { useMemo } from 'react'

import type { InteractionGene, ValueScale } from '../../engine'
import { tooltip } from '../../ui/condTooltip'
import { paletteScale } from '../../ui/palettes'
import { PlotlyChart } from '../../ui/PlotlyChart'
import { fmtQuantity, plainTicks, rangeOf } from '../../ui/quantityAxis'
import { axisBase, PALETTES, plotBase } from '../../ui/theme'
import { useRolePalette } from '../../ui/useAppSettings'
import { useUiTheme } from '../../ui/useUiTheme'

/**
 * The interaction plot as a grid, one gene: the x factor's levels across, the line factor's down,
 * each tile the model's cell mean (the line plot's points, any further factors averaged the same
 * way), coloured on the data palette and labelled with its value. Both factors' effects read at
 * once: a gradient along one direction only is that factor alone; a pattern that changes from row
 * to row is the interaction. A cell not measured stays blank.
 */
export function InteractionHeatmap({
  gene,
  xName,
  xLevels,
  lineName,
  lineLevels,
  valueLabel,
  displayMap,
  plainScale
}: {
  gene?: InteractionGene
  /** the abundance shown plain on a log colour scale (ui/quantityAxis): the logged scale it's on */
  plainScale?: ValueScale
  xName: string
  xLevels: string[]
  lineName: string
  lineLevels: string[]
  /** the colour bar's title: the abundance scale (quantityLabel) */
  valueLabel: string
  displayMap: Record<string, string>
}) {
  const mode = useUiTheme((s) => s.mode)
  const palette = useRolePalette('data')
  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      xaxis: { ...axisBase(p), title: xName, type: 'category', automargin: true, showgrid: false },
      // the first line level on top, as the line plot's legend lists them
      yaxis: {
        ...axisBase(p),
        title: lineName,
        type: 'category',
        // factor 2 none: one row, no label
        showticklabels: !!lineName,
        autorange: 'reversed',
        automargin: true,
        showgrid: false
      }
    }
    if (!gene) return { data: [], layout: lay }
    const name = displayMap[gene.uniqID] || gene.uniqID
    const z = gene.means.map((row) => row.map((v) => (Number.isFinite(v) ? v : null)))
    // per tile: ± its standard error (half the band, the scale's own) and its replicate count
    const se = gene.means.map((row, li) =>
      row.map((v, xi) =>
        Number.isFinite(v) ? ((gene.hi[li][xi] - gene.lo[li][xi]) / 2).toFixed(3) : ''
      )
    )
    const n = gene.reps.map((row) => row.map((vals) => vals.length))
    // shown plain: each tile's mean, and its band's ends for the hover (± a log SE isn't symmetric
    // in values), as formatted values
    const fq = (v: number): string => (plainScale ? fmtQuantity(v, plainScale, true) : '')
    const plainText = plainScale
      ? gene.means.map((row) => row.map((v) => (Number.isFinite(v) ? fq(v) : '')))
      : null
    return {
      data: [
        {
          type: 'heatmap',
          x: xLevels,
          y: lineName ? lineLevels : ['mean'],
          z,
          customdata: se.map((row, li) =>
            row.map((s, xi) =>
              plainScale
                ? [`${fq(gene.lo[li][xi])} – ${fq(gene.hi[li][xi])}`, n[li][xi]]
                : [s, n[li][xi]]
            )
          ),
          ...(plainText ? { text: plainText } : null),
          colorscale: paletteScale(palette),
          xgap: 2,
          ygap: 2,
          hoverongaps: false,
          texttemplate: plainText ? '%{text}' : '%{z:.2f}',
          textfont: { size: 11 },
          colorbar: {
            title: { text: valueLabel, side: 'right' },
            thickness: 12,
            ...(plainScale ? plainTicks(plainScale, rangeOf(gene.means.flat())) : null)
          },
          hovertemplate: tooltip(
            {
              title: name,
              conds: [
                [xName, '%{x}'],
                ...(lineName ? ([[lineName, '%{y}']] as Array<[string, string]>) : [])
              ],
              values: [
                plainText
                  ? ['mean', '%{text} (± SE %{customdata[0]})']
                  : ['mean', '%{z:.3f} ± %{customdata[0]}'],
                ['replicates', '%{customdata[1]}']
              ]
            },
            p.textMuted,
            { template: true }
          )
        }
      ],
      layout: lay
    }
  }, [
    mode,
    palette,
    gene,
    xName,
    xLevels,
    lineName,
    lineLevels,
    valueLabel,
    displayMap,
    plainScale
  ])
  return <PlotlyChart controls="none" data={data} layout={layout} />
}
