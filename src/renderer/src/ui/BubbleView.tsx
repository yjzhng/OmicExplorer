import { useMemo } from 'react'

import { buildBubble, type CompareResultRow } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/** Bubble grid: genes (x) × dose/time (y). Dot fill = log2FC (diverging), size =
 *  |log2FC|; no outline. Genes are pre-ordered by max log2FC. The base
 *  set is top-N (or the GOI subset); hovered/pinned genes are appended to the axis so a
 *  linked selection shows up alongside rather than replacing the list. */
export function BubbleView({
  rows,
  axis,
  topGenes,
  displayMap,
  focus,
  title,
  orient = 'landscape'
}: {
  rows: CompareResultRow[]
  axis: 'dose' | 'time'
  topGenes: number
  displayMap?: Record<string, string>
  focus?: string[]
  title?: string
  /** landscape = genes along x (wide); portrait = genes along y (tall). */
  orient?: 'landscape' | 'portrait'
}) {
  const mode = useUiTheme((s) => s.mode)
  // Only PINNED genes are appended to the axis (they need a permanent column). Deliberately NOT
  // subscribed to hoverId: re-rendering on hover would re-run Plotly.react and rebuild the axis
  // every hover — which reset the discrete (category) spacing to quantitative. The hovered point
  // is highlighted imperatively by the overlay in PlotlyChart instead (no re-plot).
  const pinnedIds = useSelection((s) => s.pinnedIds)

  const { data, layout, boldTicks } = useMemo(() => {
    const p = PALETTES[mode]
    const extra = [...pinnedIds]
    const bubble = buildBubble(rows, { axis, topGenes, displayMap, focus, extra })
    const maxAbsFC = Math.max(1e-9, ...bubble.points.map((pt) => Math.abs(pt.log2FC)))
    // Discrete dose/time levels. Placed at evenly-spaced INDEX positions on a LINEAR axis
    // (ticked with the real values), NOT a category axis: a category axis with numeric-looking
    // values gets auto-flipped to quantitative when Plotly restyles the hover overlay. A linear
    // axis with fixed tick positions never re-types, so the discrete spacing is stable.
    const distinctLevels = [...new Set(bubble.points.map((pt) => pt.x))].sort((a, b) => a - b)
    const levelIdx = new Map(distinctLevels.map((v, i) => [v, i]))
    const landscape = orient !== 'portrait'
    // Axis category = uniqID (unique), so two features sharing a display name stay distinct rows.
    const geneVals = bubble.points.map((pt) => pt.uniqID)
    const levelVals = bubble.points.map((pt) => levelIdx.get(pt.x) ?? 0)
    const trace = {
      type: 'scatter',
      mode: 'markers',
      // Genes already sit on the (category) gene axis, so a hovered dot doesn't need a
      // name label floating above it (unlike the scatter/volcano) — opt the overlay out.
      __oeNoLabel: true,
      // Genes and levels swap axes with the orientation toggle.
      x: landscape ? geneVals : levelVals,
      y: landscape ? levelVals : geneVals,
      customdata: bubble.points.map((pt) => pt.uniqID),
      // Level index is not human-readable, so carry the real value in the hover text.
      text: bubble.points.map((pt) => `${pt.gene}<br>${bubble.axis}=${pt.x}`),
      hovertemplate: `%{text}<br>log2FC=%{marker.color:.3f}<extra></extra>`,
      marker: {
        size: bubble.points.map((pt) => 6 + (Math.abs(pt.log2FC) / maxAbsFC) * 22),
        color: bubble.points.map((pt) => pt.log2FC),
        // Same diverging sense as the volcano: −log2FC → blue (down), +log2FC → red (up).
        colorscale: [
          [0, EFFECT_COLOR.down],
          [0.5, EFFECT_COLOR.none],
          [1, EFFECT_COLOR.up]
        ],
        cmid: 0,
        opacity: 0.9,
        line: { width: 0 },
        // Portrait (genes down a tall y axis): the dose/time axis moves to the TOP (see levelAxis),
        // so the log₂FC colourbar goes horizontally along the BOTTOM. Landscape keeps it vertical
        // on the right.
        colorbar: landscape
          ? { title: { text: 'log₂FC', side: 'right' }, thickness: 12 }
          : {
              orientation: 'h',
              // Horizontal colourbar tick labels sit BELOW the bar, so keep the title there too.
              title: { text: 'log₂FC', side: 'bottom' },
              thickness: 12,
              len: 1, // span the full plot width
              x: 0.5,
              xanchor: 'center',
              y: -0.02, // just below the plot bottom
              yanchor: 'top'
            }
      }
    }
    const heading = title ?? ''
    const geneAxis = {
      ...axisBase(p),
      title: '',
      type: 'category',
      categoryorder: 'array',
      // Landscape (genes on x) reads left→right, so appended (hovered/pinned) genes land
      // on the RIGHT. Portrait puts genes on y, which runs bottom→up, so reverse the order
      // to keep the appended genes at the BOTTOM (and the top-N reading top→down).
      categoryarray: landscape ? bubble.genes : [...bubble.genes].reverse(),
      // Category values are uniqIDs; show the display names as tick labels (value→label by pairing).
      tickmode: 'array',
      tickvals: bubble.genes,
      ticktext: bubble.geneLabels,
      showgrid: true, // grid helps track genes across the row/column
      tickangle: landscape ? -45 : 0,
      automargin: true,
      // Pin the range to a half-gap past the first/last gene so the category axis doesn't add
      // large default padding before the first and after the last gene.
      range: [-0.5, bubble.genes.length - 0.5],
      autorange: false
    }
    const levelAxis = {
      ...axisBase(p),
      title: bubble.axis,
      // Linear axis with fixed, evenly-spaced ticks at each level's index (labelled with the
      // real value). Range mirrors the category convention ([-0.5, n-0.5]) so the dots keep
      // half-a-gap of padding at each end.
      type: 'linear',
      tickmode: 'array',
      tickvals: distinctLevels.map((_, i) => i),
      ticktext: distinctLevels.map(String),
      range: [-0.5, distinctLevels.length - 0.5],
      autorange: false,
      showgrid: true,
      automargin: true,
      // Portrait puts this (the x axis) along the TOP, leaving the bottom for the colourbar.
      ...(landscape ? {} : { side: 'top' })
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      xaxis: landscape ? geneAxis : levelAxis,
      yaxis: landscape ? levelAxis : geneAxis
    }
    // Bold the tick label of a hovered/pinned gene on the gene axis (x in landscape, y in portrait).
    const boldTicks = {
      genesByTick: bubble.genes.map((g) => [g]),
      tickLabel: (i: number, active: boolean): string =>
        active ? `<b>${bubble.geneLabels[i]}</b>` : bubble.geneLabels[i],
      axis: (landscape ? 'x' : 'y') as 'x' | 'y'
    }
    return { data: [trace], layout: lay, boldTicks }
  }, [rows, axis, topGenes, displayMap, focus, orient, pinnedIds, title, mode])

  return <PlotlyChart data={data} layout={layout} boldTicks={boldTicks} />
}
