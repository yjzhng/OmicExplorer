import { useMemo } from 'react'

import type { DRData, DRSeries } from '../engine'
import { drLook, type DRLook } from '../graph/types'
import { AUTO } from './ColorPicker'
import { tooltip } from './condTooltip'
import { PlotlyChart } from './PlotlyChart'
import { truncateLabel } from './plotAxes'
import { divergeColor } from './colormap'
import { ROLE_DEFAULTS, type PaletteRef } from './palettes'
import { axisBase, CATEGORICAL, PALETTES, plotBase } from './theme'
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
/** Fold-change axis title, naming the comparison ("log₂FC · A | B") when the rows share one. */
const fcLabel = (dr: DRData): string => (dr.comparison ? `log₂FC · ${dr.comparison}` : 'log₂FC')
/** A point's x as plotted: measured levels are categories (strings); fitted curves are numbers
 *  on a log axis. */
const xOf = (dr: DRData, x: number): string | number => (dr.continuous ? x : String(x))
const xHover = (dr: DRData): string => (dr.continuous ? '%{x:.3g}' : '%{x}')
const DEFAULT_LOOK = drLook({})

export function DRView({
  dr,
  title,
  axisLabel,
  look = DEFAULT_LOOK,
  palette = ROLE_DEFAULTS.fcObject
}: {
  dr: DRData
  title?: string
  /** the dose/time axis's title, with its unit (absent = the bare axis name) */
  axisLabel?: string
  /** the coloured curves' line look (the tile's settings; points/error are the focused view's) */
  look?: DRLook
  /** the fold-change palette an emphasised curve is coloured on, by its peak log₂FC */
  palette?: PaletteRef
}) {
  const mode = useUiTheme((s) => s.mode)
  const hoverId = useSelection((s) => s.hoverId)
  // a hovered group's genes (a STRING cluster, an enrichment term) are in focus as a hovered gene
  const hoverMembers = useSelection((s) => s.hoverMembers)
  const pinnedIds = useSelection((s) => s.pinnedIds)

  // The faint grey background (all genes, one null-separated trace) is BUILT ONCE per data/theme,
  // NOT per hover — it's thousands of points, and rebuilding+redrawing it on every mouse move is
  // what made hover laggy. Keeping a stable trace object means Plotly.react skips redrawing it,
  // so a hover only re-draws the handful of coloured curves on top.
  const background = useMemo(() => {
    const p = PALETTES[mode]
    const bx: (string | number | null)[] = []
    const by: (number | null)[] = []
    const btext: (string | null)[] = []
    const bid: (string | null)[] = []
    for (const s of dr.series) {
      for (const pt of s.points) {
        bx.push(xOf(dr, pt.x))
        by.push(pt.y)
        btext.push(s.label)
        bid.push(s.uniqID) // per-point uniqID → hovering/clicking a background line drives selection
      }
      bx.push(null)
      by.push(null)
      btext.push(null)
      bid.push(null)
    }
    return {
      type: 'scatter',
      // Stable uid so Plotly.react tracks this as the SAME trace on a hover re-render (with the
      // memoized reference unchanged) and skips redrawing it — the whole point of the split.
      uid: 'dr-background',
      mode: 'lines',
      name: `all (${dr.total})`,
      x: bx,
      y: by,
      text: btext,
      customdata: bid,
      hovertemplate: tooltip(
        {
          title: '%{text}',
          conds: [[dr.axis, xHover(dr)]],
          values: [[fcLabel(dr), '%{y:.3f}']]
        },
        p.textMuted,
        { template: true }
      ),
      line: { color: p.textMuted, width: 1 },
      opacity: 0.22,
      showlegend: false
    }
  }, [dr, mode])

  const { data, layout } = useMemo(() => {
    const p = PALETTES[mode]
    const active = new Set(pinnedIds)
    if (hoverId) active.add(hoverId)
    for (const g of hoverMembers) active.add(g)

    // Discrete x: the axis (dose/time) levels are spaced evenly as categories, not by their
    // numeric value, so a dose series like 1.25…80 reads at equal intervals. Categories are the
    // distinct axis values, numerically sorted; x is emitted as strings to match.
    const cats = [...new Set(dr.series.flatMap((s) => s.points.map((pt) => pt.x)))]
      .sort((a, b) => a - b)
      .map(String)

    // `showlegend:false` marks an emphasis-only overlay (a hovered gene that isn't one of the top-N).
    const line = (s: DRSeries, color: string, width: number, showlegend = true) => ({
      type: 'scatter',
      mode: 'lines',
      // The legend name is capped in length; the hover keeps the full one.
      name: truncateLabel(s.label),
      x: s.points.map((pt) => xOf(dr, pt.x)),
      y: s.points.map((pt) => pt.y),
      customdata: s.points.map(() => s.uniqID),
      hovertemplate: tooltip(
        {
          title: s.label,
          conds: [[dr.axis, xHover(dr)]],
          values: [[fcLabel(dr), '%{y:.3f}']]
        },
        p.textMuted,
        { template: true }
      ),
      line: { color, width },
      opacity: look.lineOpacity,
      showlegend
    })
    // One colour for every curve when set, else the palette (top-N) / the diverging scale (extra).
    const fixed = look.lineColor !== AUTO ? look.lineColor : null

    // Foreground: top-N differential genes, colored, with identity for linked highlight.
    // Clamp the colored count so a huge N can't re-explode the trace count.
    const top = dr.series.slice(0, Math.min(dr.highlight, 100))
    const topIds = new Set(top.map((s) => s.uniqID))
    // An ACTIVE (hovered/pinned) top-N gene is emphasized IN ITS OWN COLOUR with a thicker line
    // (which also thickens its legend swatch) — rather than spawning a separate highlight trace,
    // so it never duplicates its own legend item.
    const colored = top.map((s, i) => {
      const on = active.has(s.uniqID)
      return line(
        s,
        fixed ?? CATEGORICAL[i % CATEGORICAL.length],
        on ? look.lineWidth + 2 : look.lineWidth
      )
    })
    // A hovered/pinned gene that ISN'T a top-N curve has no colour of its own (it lives in the grey
    // background), so draw it as an emphasis overlay — coloured by its peak |log₂FC| on the shared
    // diverging (down→up) scale (not a flat accent), so it matches the bubble/heatmap palette.
    const extra = dr.series.filter((s) => active.has(s.uniqID) && !topIds.has(s.uniqID))
    // A loop, not Math.max(...points): spreading every point as an argument overflows the stack
    // once there are ~100k of them (fitted curves are sampled finely).
    let absMax = 1e-9
    for (const s of dr.series) for (const pt of s.points) absMax = Math.max(absMax, Math.abs(pt.y))
    const dcolor = divergeColor(absMax, palette)
    const peak = (s: DRSeries): number =>
      s.points.reduce((best, pt) => (Math.abs(pt.y) > Math.abs(best) ? pt.y : best), 0)
    for (const s of extra)
      colored.push(line(s, fixed ?? dcolor(peak(s)), look.lineWidth + 1.5, false))

    const lay: Record<string, unknown> = {
      ...plotBase(p),
      // Base this on the legend-visible (top-N) count, NOT total traces — the hover/pin emphasis
      // overlays are showlegend:false, so they must not tip the whole legend into hiding.
      showlegend: top.length > 0 && top.length <= 12,
      // Vertically centre the (right-side) legend rather than top-aligning it.
      legend: { yanchor: 'middle', y: 0.5 },
      title: title ? { text: title, font: { size: 13 } } : undefined,
      // Fitted curves run continuously over dose, on a log axis; measured levels are categories.
      // (a linear axis — see axisModel.ts — stays linear)
      xaxis: dr.continuous
        ? dr.linear
          ? { ...axisBase(p), title: axisLabel ?? dr.axis }
          : { ...axisBase(p), title: axisLabel ?? dr.axis, type: 'log', dtick: 1 }
        : {
            ...axisBase(p),
            title: axisLabel ?? dr.axis,
            type: 'category',
            categoryorder: 'array',
            categoryarray: cats
          },
      yaxis: { ...axisBase(p), title: fcLabel(dr), zeroline: true }
    }
    return { data: [background, ...colored], layout: lay }
  }, [dr, title, axisLabel, mode, hoverId, hoverMembers, pinnedIds, background, look, palette])

  return <PlotlyChart data={data} layout={layout} />
}
