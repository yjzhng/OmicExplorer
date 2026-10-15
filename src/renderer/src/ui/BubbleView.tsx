import { useMemo } from 'react'

import { buildBubble, type CompareResultRow } from '../engine'
import { tooltip } from './condTooltip'
import { sizeKeyLevels } from './sizeKey'
import { PlotlyChart } from './PlotlyChart'
import { truncateLabel } from './plotAxes'
import {
  BUBBLE_SIG_PALETTE,
  ROLE_DEFAULTS,
  paletteAt,
  paletteScale,
  type PaletteRef
} from './palettes'
import { axisBase, PALETTES, plotBase } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/** Bubble grid: genes (x) × dose/time (y). Each bubble's size, colour and outline width show
 *  its log₂FC or its significance (−log₁₀ of the Compare's P or Q) as configured — by default a
 *  log₂FC fill, sized by |log₂FC|, no outline — and a ∗ can mark the significant ones. Genes are
 *  pre-ordered by their rank score. The base set is top-N (or the selected subset); hovered/pinned
 *  genes are appended to the axis so a linked selection shows up alongside rather than replacing
 *  the list. */
/** A bubble's diameter range, px: smallest + the span its measure scales over. */
const SIZE_MIN = 6
const SIZE_SPAN = 22
/** An outline's widest, px: its width is this × the measure's fraction squared (0 at 0), so the
 *  strongest bubbles stand out and the rest stay fine. */
const LINE_MAX = 5
/** The significance asterisk's size and stroke, px. */
const STAR_SIZE = 8
const STAR_LINE = 1.5
/** How far the automatic outline darkens its bubble's colour toward black. */
const OUTLINE_DARKEN = 0.4

/** A hex colour mixed toward black by `k`. */
function darker(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number): number => Math.round(v * (1 - k))
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

/** Black or white, whichever reads on a hex colour: by its relative luminance (WCAG). */
function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const lin = (v: number): number => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  // the luminance where black and white contrast alike
  return l > 0.179 ? '#000000' : '#ffffff'
}

export type BubbleMeasure = 'fc' | 'sig'

/** The share of the colour bar's column the bar keeps; the size key takes the rest. */
const KEY_SPLIT = 0.55
/** How far right of the plot's edge the colour bar's column starts (the bar's own xpad,
 *  and the key's offset to match), px. */
const KEY_PAD = 10
/** The left margin before automargin, px: the axis there (dose/time in landscape, the genes in
 *  portrait) widens it for its labels. */
const SIDE_GUTTER = 10
/** The top margin, px: clear of Plotly's control bar (top right, on hover); the title and
 *  portrait's top axis widen it as they need. */
const TOP_GUTTER = 30
/** Portrait's top margin, px: its dose/time axis runs along the top, so the margin holds that
 *  axis's labels and title AND clears the control bar above them (automargin only widens a margin
 *  to fit the axis, leaving the bar over it). */
const PORTRAIT_TOP = 64
/** The key's name line, px. */
const KEY_HEAD = 18

/** A value as a key label: two significant figures, no trailing zeros. */
const keyLabel = (v: number): string => String(Number(v.toPrecision(2)))

/**
 * The bubble size key: two circles (sizeKeyLevels — round values, multiples of 1 or 0.5) drawn at
 * the size a bubble of that value is (SIZE_MIN + its fraction of the largest × SIZE_SPAN), each
 * labelled with its value, under the measure's name. Plotly's own legend caps a marker's size, so the circles are layout shapes
 * sized in PIXELS (xsizemode/ysizemode), placed under the colour bar in its column on the right
 * (either orientation).
 */
function sizeKey(
  max: number,
  name: string,
  ink: string
): {
  shapes: Record<string, unknown>[]
  annotations: Record<string, unknown>[]
  /** the key's height and width, px (its column, name included) */
  height: number
  width: number
} {
  const shapes: Record<string, unknown>[] = []
  const annotations: Record<string, unknown>[] = []
  const text = (t: string, more: Record<string, unknown>): void => {
    annotations.push({
      text: t,
      showarrow: false,
      xref: 'paper',
      yref: 'paper',
      font: { size: 10, color: ink },
      ...more
    })
  }
  // circle centred `dx`, `dy` px from the paper point (x, y) — dy up
  const circle = (x: number, y: number, dx: number, dy: number, d: number): void => {
    shapes.push({
      type: 'circle',
      xref: 'paper',
      yref: 'paper',
      xsizemode: 'pixel',
      ysizemode: 'pixel',
      xanchor: x,
      yanchor: y,
      x0: dx - d / 2,
      x1: dx + d / 2,
      y0: dy - d / 2,
      y1: dy + d / 2,
      line: { color: ink, width: 1 },
      fillcolor: 'rgba(0,0,0,0)',
      layer: 'above'
    })
  }
  // largest first, as the bubbles it reads against
  const steps = sizeKeyLevels(max)
    .reverse()
    .map((v) => ({ v, d: SIZE_MIN + (v / max) * SIZE_SPAN }))
  const big = SIZE_MIN + SIZE_SPAN
  const GAP = 6
  // A column — the name, then the circles top-down, labels to their right — under the colour bar
  // in its column on the right, from the plot's right edge past the colour bar's padding.
  const x = 1
  const pad = KEY_PAD
  const y = 1 - KEY_SPLIT - 0.06
  text(name, { x, y, xshift: pad, xanchor: 'left', yanchor: 'top' })
  let top = -KEY_HEAD
  for (const st of steps) {
    const cy = top - st.d / 2
    circle(x, y, pad + big / 2, cy, st.d)
    text(keyLabel(st.v), {
      x,
      y,
      xshift: pad + big + GAP,
      yshift: cy,
      xanchor: 'left',
      yanchor: 'middle'
    })
    top -= st.d + GAP
  }
  // its width from `x`: the name, or a circle and its label, whichever is wider (~6px a character)
  const width =
    pad +
    Math.max(name.length * 6, big + GAP + Math.max(...steps.map((st) => keyLabel(st.v).length)) * 6)
  return { shapes, annotations, height: -top, width }
}

export function BubbleView({
  rows,
  axis,
  axisLabel,
  topGenes,
  rank = 'fc',
  over = 'peak',
  stat = 'pQ',
  sizeBy = 'fc',
  colorBy = 'fc',
  outlineBy = 'none',
  outlineColor,
  asterisk = false,
  displayMap,
  focus,
  title,
  orient = 'landscape',
  palette = ROLE_DEFAULTS.fcObject,
  sigPalette = BUBBLE_SIG_PALETTE
}: {
  rows: CompareResultRow[]
  axis: 'dose' | 'time'
  /** the dose/time axis's title, with its unit (absent = the bare axis name) */
  axisLabel?: string
  topGenes: number
  /** what ranks the top genes (see BubbleOptions.rank) */
  rank?: 'fc' | 'pP' | 'pQ'
  /** that score's peak or total over the levels (see BubbleOptions.over) */
  over?: 'peak' | 'total'
  /** the significance column the Compare calls by — what 'sig' shows (−log₁₀ of it) */
  stat?: 'pP' | 'pQ'
  /** what a bubble's size, colour and outline width show (outline 'none' = no outline) */
  sizeBy?: BubbleMeasure
  colorBy?: BubbleMeasure
  outlineBy?: 'none' | BubbleMeasure
  /** the outline's colour; unset = a darker shade of each bubble's own colour */
  outlineColor?: string
  /** a ∗ at the centre of each significant bubble */
  asterisk?: boolean
  displayMap?: Record<string, string>
  focus?: string[]
  title?: string
  /** landscape = genes along x (wide); portrait = genes along y (tall). */
  orient?: 'landscape' | 'portrait'
  /** the fold-change palette (colour by log₂FC: the plot's own, else the global one) */
  palette?: PaletteRef
  /** the significance palette (colour by −log₁₀ P/Q: the plot's own, else Purples) */
  sigPalette?: PaletteRef
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
    const bubble = buildBubble(rows, {
      axis,
      topGenes,
      rank,
      over,
      stat,
      displayMap,
      focus,
      extra
    })
    const pts = bubble.points
    const maxAbsFC = Math.max(1e-9, ...pts.map((pt) => Math.abs(pt.log2FC)))
    const maxSig = Math.max(1e-9, ...pts.map((pt) => pt.sig))
    const sigName = `−log₁₀ ${stat === 'pP' ? 'P' : 'Q'}`
    // A measure as a fraction of its largest here (0 … 1): |log₂FC|, or −log₁₀ P/Q.
    const frac = (m: BubbleMeasure, pt: (typeof pts)[number]): number =>
      m === 'fc' ? Math.abs(pt.log2FC) / maxAbsFC : Math.max(0, pt.sig) / maxSig
    // Colour: log₂FC on the diverging FC palette (centred on 0), or −log₁₀ P/Q on the sequential
    // one from 0. Each bubble's own colour too, for the automatic outline's darker shade.
    const byFc = colorBy === 'fc'
    const colorPalette = byFc ? palette : sigPalette
    const colorVals = pts.map((pt) => (byFc ? pt.log2FC : pt.sig))
    const [cmin, cmax] = byFc ? [-maxAbsFC, maxAbsFC] : [0, maxSig]
    const fills = colorVals.map((v) => paletteAt(colorPalette, (v - cmin) / (cmax - cmin)))
    const outlined = outlineBy !== 'none'
    // Each bubble's outline width, and its marker grown by that much: a stroke is centred on the
    // circle's edge, so the larger circle's stroke ends, inside, at the bubble's own edge — the
    // outline grows outward and the bubble keeps its size.
    const lineW = pts.map((pt) => (outlineBy === 'none' ? 0 : LINE_MAX * frac(outlineBy, pt) ** 2))
    const auto = !outlineColor || outlineColor === 'auto'
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
      text: pts.map((pt) =>
        tooltip(
          {
            title: pt.gene,
            conds: [[bubble.axis, pt.x]],
            values: [
              ['log₂FC', pt.log2FC.toFixed(3)],
              [sigName, pt.sig.toFixed(2)]
            ]
          },
          p.textMuted
        )
      ),
      hovertemplate: '%{text}<extra></extra>',
      marker: {
        size: pts.map((pt, i) => SIZE_MIN + frac(sizeBy, pt) * SIZE_SPAN + lineW[i]),
        color: colorVals,
        // log₂FC: the same diverging sense as the volcano (−log2FC → blue, +log2FC → red).
        colorscale: paletteScale(colorPalette),
        cmin,
        cmax,
        opacity: 0.9,
        line: outlined
          ? {
              width: lineW,
              color: auto ? fills.map((c) => darker(c, OUTLINE_DARKEN)) : outlineColor
            }
          : { width: 0 },
        // Vertical on the right in either orientation; the size key sits under it (sizeKey).
        colorbar: {
          orientation: 'v',
          title: { text: byFc ? 'log₂FC' : sigName, side: 'right' },
          thickness: 12,
          // the column's top part: the size key sits under it (sizeKey)
          len: KEY_SPLIT,
          x: 1,
          xpad: KEY_PAD,
          xanchor: 'left',
          y: 1,
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
      // Capped in length (the full name is in the hover); the values stay uniqIDs, so two genes
      // whose names cut short alike remain separate rows.
      ticktext: bubble.geneLabels.map((l) => truncateLabel(l)),
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
      // held next to its tick labels: with automargin and no standoff Plotly sets the title out at
      // the margin's edge — portrait's top, under the control bar
      title: { text: axisLabel ?? bubble.axis, standoff: 6 },
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
      // Portrait puts this (the x axis) along the TOP, next to the genes' first rows; landscape
      // names its own side rather than omitting the key — Plotly.react merges nested objects, so
      // an omitted key keeps the other orientation's value.
      side: landscape ? 'left' : 'top'
    }
    const key = sizeKey(
      sizeBy === 'fc' ? maxAbsFC : maxSig,
      sizeBy === 'fc' ? '|log₂FC|' : sigName,
      p.textMuted
    )
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      // the title reserves its own room (automargin), as the top axis's labels do theirs
      title: heading ? { text: heading, font: { size: 13 }, automargin: true } : undefined,
      xaxis: landscape ? geneAxis : levelAxis,
      yaxis: landscape ? levelAxis : geneAxis,
      shapes: key.shapes,
      annotations: key.annotations,
      // room for the key right of the colour bar's column, for its labels; the colour bar still
      // widens it as it needs (automargin). Nothing is over the plot but what reserves its own
      // room (Plotly's default top margin leaves 100px), save portrait's top axis (PORTRAIT_TOP).
      // Both spell out the bottom too, so a switch doesn't keep the other's: landscape's is
      // Plotly's default (its slanted gene labels widen it), portrait's only a gutter.
      margin: {
        r: key.width + 8,
        l: SIDE_GUTTER,
        t: landscape ? TOP_GUTTER : PORTRAIT_TOP,
        b: landscape ? 80 : 16
      }
    }
    // Bold the tick label of a hovered/pinned gene on the gene axis (x in landscape, y in portrait).
    const boldTicks = {
      genesByTick: bubble.genes.map((g) => [g]),
      tickLabel: (i: number, active: boolean): string =>
        active
          ? `<b>${truncateLabel(bubble.geneLabels[i])}</b>`
          : truncateLabel(bubble.geneLabels[i]),
      axis: (landscape ? 'x' : 'y') as 'x' | 'y'
    }
    // ∗ at the centre of each bubble significant at its level: Plotly's asterisk marker (a text ∗
    // is centred by its font box, so it sat high), stroked black on a light bubble and white on a
    // dark one — no ids, so the highlight passes it by, and inert to the cursor so the bubble
    // under it takes the hover.
    const sig = pts.flatMap((pt, i) => (pt.signf ? [i] : []))
    const stars =
      asterisk && sig.length
        ? [
            {
              type: 'scatter',
              mode: 'markers',
              x: sig.map((i) => (landscape ? geneVals[i] : levelVals[i])),
              y: sig.map((i) => (landscape ? levelVals[i] : geneVals[i])),
              // an open symbol strokes in the MARKER colour (line.color alone left Plotly's own)
              marker: {
                symbol: 'asterisk-open',
                size: STAR_SIZE,
                color: sig.map((i) => inkOn(fills[i])),
                line: { width: STAR_LINE, color: sig.map((i) => inkOn(fills[i])) }
              },
              hoverinfo: 'skip',
              showlegend: false,
              cliponaxis: false
            }
          ]
        : []
    return { data: [trace, ...stars], layout: lay, boldTicks }
  }, [
    rows,
    axis,
    axisLabel,
    topGenes,
    rank,
    over,
    stat,
    sizeBy,
    colorBy,
    outlineBy,
    outlineColor,
    asterisk,
    sigPalette,
    displayMap,
    focus,
    orient,
    pinnedIds,
    title,
    mode,
    palette
  ])

  return <PlotlyChart data={data} layout={layout} boldTicks={boldTicks} />
}
