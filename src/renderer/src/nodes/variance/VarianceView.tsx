import { useMemo } from 'react'

import { distShape, VIOLIN_CAP, type GeneShares } from '../../engine'
import { tooltip } from '../../ui/plot/condTooltip'
import { PlotlyChart } from '../../ui/plot/PlotlyChart'
import { axisBase, CATEGORICAL, PALETTES, plotBase, withAlpha } from '../../ui/app/theme'
import { useUiTheme } from '../../ui/app/useUiTheme'

/** q as the plots print it: two significant figures, small ones in exponent form. */
const fmtQ = (q: number): string =>
  !Number.isFinite(q) ? '–' : q < 1e-3 ? q.toExponential(1) : q.toPrecision(2)

/**
 * An ANOVA's variance plot: how each gene's variation splits among the model's factors (main
 * effects and their interaction) and the residual — each factor's share of the gene's sum of
 * squares. Three views, as the dose-response plot's:
 *
 *  - global: every gene at once — one violin per factor (and the residual) of the genes' shares,
 *    with its box and mean: which factor drives this dataset.
 *  - detailed: a stacked bar per gene, the genes along x (the selected genes, else the most
 *    significant ones).
 *  - focused: one gene — a bar per factor along x, its q above it (a share says how the change
 *    splits, the q whether it's above noise).
 *
 * The share is on y, the factors (or genes) along x, the legend on the right — as the
 * dose-response plot's. No gene identity on the traces (as its): the bars are shares, not gene
 * points, so the linked selection doesn't emphasise them.
 */
export function VarianceView({
  view,
  terms,
  genes,
  displayMap
}: {
  view: 'overview' | 'detail' | 'focus'
  /** the model's factors, in its order (main effects, then the interaction) */
  terms: string[]
  genes: GeneShares[]
  displayMap: Record<string, string>
}) {
  const mode = useUiTheme((s) => s.mode)
  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const names = [...terms, 'residual']
    const colorOf = (i: number): string =>
      i < terms.length ? CATEGORICAL[i % CATEGORICAL.length] : p.textMuted
    const shareOf = (g: GeneShares, i: number): number =>
      100 * (i < terms.length ? g.shares[i] : g.residual)
    const label = (g: GeneShares): string => displayMap[g.uniqID] || g.uniqID
    // the legend on the right (plotBase's), as the dose-response plot's
    // One legend in every view: titled, the factors in the model's order then the residual — kept
    // in that order even for stacked bars (which Plotly lists reversed by default).
    const base: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: true,
      legend: {
        ...(plotBase(p).legend as object),
        title: { text: 'factor' },
        traceorder: 'normal'
      }
    }
    const pctAxis = (title: string): Record<string, unknown> => ({
      ...axisBase(p),
      title,
      range: [0, 100],
      zeroline: false,
      ticksuffix: '%',
      automargin: true
    })
    const catAxis = (title?: string): Record<string, unknown> => ({
      ...axisBase(p),
      ...(title ? { title } : null),
      type: 'category',
      automargin: true
    })
    const fill = (i: number): string =>
      i < terms.length ? colorOf(i) : withAlpha(p.textMuted, 0.45)

    if (view === 'overview') {
      // Past VIOLIN_CAP genes, each violin is drawn from its shares' quantiles with the bandwidth
      // for all of them (engine/plot/distShape): the same shape, without Plotly smoothing every gene's
      // share at each draw.
      const violinOf = (i: number, name: string): Record<string, unknown> => {
        const all = genes.map((g) => shareOf(g, i))
        const d = all.length > VIOLIN_CAP ? distShape(all) : null
        const y = d ? d.sample : all
        return { x: y.map(() => name), y, ...(d ? { bandwidth: d.bandwidth } : null) }
      }
      const data = names.map((name, i) => ({
        type: 'violin',
        name,
        ...violinOf(i, name),
        box: { visible: true, width: 0.12 },
        meanline: { visible: true },
        points: false,
        spanmode: 'hard',
        line: { color: colorOf(i), width: 1.2 },
        // the bars' colour, lighter so the box and mean line read over it
        fillcolor: withAlpha(colorOf(i), i < terms.length ? 0.5 : 0.3),
        hoveron: 'violins+kde',
        hovertemplate: tooltip({ title: name, values: [['share', '%{y:.0f}%']] }, p.textMuted, {
          template: true
        })
      }))
      return {
        data,
        layout: { ...base, xaxis: catAxis('factor'), yaxis: pctAxis('share of variation') }
      }
    }

    if (view === 'detail') {
      // a stacked bar per gene, the genes along x in their order (selected, or most significant)
      const data = names.map((name, i) => ({
        type: 'bar',
        name,
        x: genes.map(label),
        y: genes.map((g) => shareOf(g, i)),
        marker: { color: fill(i) },
        hovertemplate: tooltip({ title: '%{x}', values: [[name, '%{y:.0f}%']] }, p.textMuted, {
          template: true
        })
      }))
      return {
        data,
        layout: {
          ...base,
          barmode: 'stack',
          bargap: 0.25,
          xaxis: catAxis(),
          yaxis: pctAxis('share of variation')
        }
      }
    }

    // focused: one gene, a bar per factor and the residual along x, each factor's q above it
    const g = genes[0]
    if (!g) return { data: [], layout: base }
    const data = names.map((name, i) => {
      const share = shareOf(g, i)
      return {
        type: 'bar',
        name,
        x: [name],
        y: [share],
        text: [i < terms.length ? `q ${fmtQ(g.q[i])}` : ''],
        textposition: 'outside',
        cliponaxis: false,
        marker: { color: fill(i) },
        hovertemplate: tooltip(
          {
            title: label(g),
            values: [
              [name, `${share.toFixed(0)}%`],
              ...(i < terms.length ? ([['q', fmtQ(g.q[i])]] as Array<[string, string]>) : [])
            ]
          },
          p.textMuted,
          { template: true }
        )
      }
    })
    return {
      data,
      layout: {
        ...base,
        bargap: 0.35,
        xaxis: catAxis('factor'),
        yaxis: pctAxis(`share of ${label(g)}’s variation`)
      }
    }
  }, [view, terms, genes, displayMap, mode])
  return <PlotlyChart controls="none" data={data} layout={layout} />
}
