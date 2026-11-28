import { useMemo } from 'react'

import type { InteractionGene, ValueScale } from '../../engine'
import type { DRLook } from '../../graph/types'
import { AUTO } from '../../ui/ColorPicker'
import { tooltip } from '../../ui/condTooltip'
import { errorTraces } from '../../ui/errorTraces'
import { PlotlyChart } from '../../ui/PlotlyChart'
import { fmtQuantity, plainTicks, rangeOf } from '../../ui/quantityAxis'
import { axisBase, CATEGORICAL, PALETTES, plotBase, withAlpha } from '../../ui/theme'
import { useUiTheme } from '../../ui/useUiTheme'

/**
 * An ANOVA's interaction plot, one gene: its cell means — the model's fit, in abundance —
 * across one factor's levels (x), a line per level of the other factor (the legend, on the right,
 * as the dose-response plot's), each cell's replicates as points on its level and each mean's
 * standard error as a band or whiskers. Parallel lines read as no interaction; lines that diverge
 * or cross, as one. A slope along x places its levels on its axis (log₁₀ or its units), so its
 * fitted lines are straight, to scale; in the vehicle design each line starts from the vehicle. Its look is the dose-response plot's (DRLook): an automatic colour is one per
 * line, the points and error taking the line's. (No gene identity on the traces, as the
 * dose-response plot's: they're one gene's lines and points, not gene points — the linked
 * selection mustn't emphasise them.)
 */
export function InteractionView({
  gene,
  xName,
  xLevels,
  lineName,
  lineLevels,
  yLabel,
  displayMap,
  look,
  plainScale
}: {
  gene?: InteractionGene
  /** the abundance shown plain on a log axis (ui/quantityAxis): the logged scale it's on */
  plainScale?: ValueScale
  xName: string
  xLevels: string[]
  lineName: string
  lineLevels: string[]
  /** the abundance axis's title, on the plots' scale */
  yLabel: string
  displayMap: Record<string, string>
  look: DRLook
}) {
  const mode = useUiTheme((s) => s.mode)
  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const pos = gene?.xPositions ?? xLevels.map((_, i) => i)
    const lo = Math.min(...pos)
    const hi = Math.max(...pos)
    const pad = gene?.xPositions ? Math.max((hi - lo) * 0.06, 0.1) : 0.5
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      // factor 2's levels on the right (plotBase's legend), headed by the factor
      legend: { ...(plotBase(p).legend as object), title: { text: lineName } },
      // factor 2 none: one line, nothing to tell apart
      showlegend: !!lineName,
      // the levels at positions 0 … n−1, named — or, a slope along x, at their places on its axis
      // (the fitted straight lines to scale)
      xaxis: {
        ...axisBase(p),
        title: xName,
        type: 'linear',
        tickmode: 'array',
        tickvals: pos,
        ticktext: xLevels,
        range: [lo - pad, hi + pad],
        zeroline: false,
        automargin: true
      },
      yaxis: {
        ...axisBase(p),
        title: yLabel,
        zeroline: false,
        automargin: true,
        ...(plainScale
          ? plainTicks(
              plainScale,
              rangeOf([
                ...(gene?.lo.flat() ?? []),
                ...(gene?.hi.flat() ?? []),
                ...(gene?.reps.flat(2) ?? [])
              ])
            )
          : null)
      }
    }
    if (!gene) return { data: [], layout: lay }
    const name = displayMap[gene.uniqID] || gene.uniqID
    // shown plain, each value rides formatted in its hovertext (Plotly can't exponentiate)
    const valueAt = plainScale ? '%{hovertext}' : '%{y:.3f}'
    const plainText = (vs: number[]) =>
      plainScale ? { hovertext: vs.map((v) => fmtQuantity(v, plainScale, true)) } : null
    // factor 2's level, when there is a factor 2
    const lineCond = (lv: string): Array<[string, string]> => (lineName ? [[lineName, lv]] : [])
    const xs = pos
    const behind: Array<Record<string, unknown>> = []
    const front: Array<Record<string, unknown>> = []
    lineLevels.forEach((lv, li) => {
      const auto = CATEGORICAL[li % CATEGORICAL.length]
      const col = look.lineColor === AUTO ? auto : look.lineColor
      const ptCol = look.pointColor === AUTO ? col : look.pointColor
      const errCol = look.errorColor === AUTO ? col : look.errorColor
      // the error under everything, the points under the line
      if (look.errors)
        behind.push(
          ...errorTraces(
            xs,
            gene.means[li],
            gene.lo[li],
            gene.hi[li],
            withAlpha(errCol, look.errorOpacity),
            look.errorStyle
          ).map((t) => ({ ...t, legendgroup: lv }))
        )
      if (look.points) {
        const rx: number[] = []
        const ry: number[] = []
        const rl: string[] = []
        gene.reps[li].forEach((vals, xi) =>
          vals.forEach((v) => {
            rx.push(pos[xi])
            ry.push(v)
            rl.push(xLevels[xi])
          })
        )
        if (rx.length)
          behind.push({
            type: 'scatter',
            mode: 'markers',
            name: `${lv} (replicates)`,
            legendgroup: lv,
            showlegend: false,
            x: rx,
            y: ry,
            text: rl,
            ...plainText(ry),
            marker: { color: ptCol, size: look.pointSize, opacity: look.pointOpacity },
            hovertemplate: tooltip(
              {
                title: name,
                conds: [[xName, '%{text}'], ...lineCond(lv)],
                values: [['replicate', valueAt]]
              },
              p.textMuted,
              { template: true }
            )
          })
      }
      front.push({
        type: 'scatter',
        mode: 'lines+markers',
        name: lv,
        legendgroup: lv,
        x: xs,
        y: gene.means[li],
        text: xLevels,
        ...plainText(gene.means[li]),
        line: { color: col, width: look.lineWidth },
        marker: { color: col, size: look.lineWidth * 3 + 2 },
        opacity: look.lineOpacity,
        hovertemplate: tooltip(
          {
            title: name,
            conds: [[xName, '%{text}'], ...lineCond(lv)],
            values: [['cell mean', valueAt]]
          },
          p.textMuted,
          { template: true }
        )
      })
    })
    return { data: [...behind, ...front], layout: lay }
  }, [gene, xName, xLevels, lineName, lineLevels, yLabel, displayMap, look, mode, plainScale])
  return <PlotlyChart controls="none" data={data} layout={layout} />
}
