import { useMemo } from 'react'

import { buildBubble, type CompareResultRow } from '../engine'
import { PlotlyChart } from './PlotlyChart'
import { axisBase, EFFECT_COLOR, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/** Bubble grid: genes (x) × dose/time (y). Dot fill = log2FC (diverging), size =
 *  significance (−log10 p); no outline. Genes are pre-ordered by max log2FC. The base
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

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const extra = [...pinnedIds]
    const bubble = buildBubble(rows, { axis, topGenes, displayMap, focus, extra })
    const maxSig = Math.max(1e-9, ...bubble.points.map((pt) => pt.sig))
    // Discrete dose/time levels. Placed at evenly-spaced INDEX positions on a LINEAR axis
    // (ticked with the real values), NOT a category axis: a category axis with numeric-looking
    // values gets auto-flipped to quantitative when Plotly restyles the hover overlay. A linear
    // axis with fixed tick positions never re-types, so the discrete spacing is stable.
    const distinctLevels = [...new Set(bubble.points.map((pt) => pt.x))].sort((a, b) => a - b)
    const levelIdx = new Map(distinctLevels.map((v, i) => [v, i]))
    const landscape = orient !== 'portrait'
    const geneVals = bubble.points.map((pt) => pt.gene)
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
      hovertemplate:
        `%{text}<br>log2FC=%{marker.color:.3f}<br>−log10 p=%{marker.size:.2f}<extra></extra>`,
      marker: {
        size: bubble.points.map((pt) => 6 + (pt.sig / maxSig) * 22),
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
        colorbar: { title: { text: 'log₂FC', side: 'right' }, thickness: 12 }
      }
    }
    const note =
      bubble.total > bubble.genes.length
        ? `top ${bubble.genes.length} of ${bubble.total} genes`
        : ''
    const heading = [title, note].filter(Boolean).join(' · ')
    const geneAxis = {
      ...axisBase(p),
      title: '',
      type: 'category',
      categoryorder: 'array',
      // Landscape (genes on x) reads left→right, so appended (hovered/pinned) genes land
      // on the RIGHT. Portrait puts genes on y, which runs bottom→up, so reverse the order
      // to keep the appended genes at the BOTTOM (and the top-N reading top→down).
      categoryarray: landscape ? bubble.genes : [...bubble.genes].reverse(),
      showgrid: true, // grid helps track genes across the row/column
      tickangle: landscape ? -45 : 0,
      automargin: true
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
      automargin: true
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      xaxis: landscape ? geneAxis : levelAxis,
      yaxis: landscape ? levelAxis : geneAxis
    }
    return { data: [trace], layout: lay }
  }, [rows, axis, topGenes, displayMap, focus, orient, pinnedIds, title, mode])

  return <PlotlyChart data={data} layout={layout} />
}
