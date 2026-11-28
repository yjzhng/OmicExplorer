import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { condLabel, type DendroLink, type FcHeatmapData } from '../../engine'
import { ROLE_DEFAULTS, paletteRange, paletteScale, type PaletteRef } from '../../ui/color/palettes'
import { tooltip } from '../../ui/plot/condTooltip'
import { PlotlyChart } from '../../ui/plot/PlotlyChart'
import { truncatedTicks } from '../../ui/plot/plotAxes'
import {
  bindHeatmapFocus,
  type PickedSamples,
  GENE_TICK_PX,
  LINK_DELAY
} from '../../ui/plot/heatmapFocus'
import { axisBase, CATEGORICAL, PALETTES, PLOT_TEXT, plotBase, withAlpha } from '../../ui/app/theme'
import { useSelection } from '../../ui/plot/useSelection'
import { useUiTheme } from '../../ui/app/useUiTheme'
import { levelPalette, type LevelPalettes, trackColours } from './trackColours'

/** How strongly a hovered heatmap veils the cells outside the hovered row and column. */
const HOVER_VEIL = 0.65
/** ms after its first draw a heatmap that hasn't settled (see `settled`) is shown anyway. */
const SETTLE_MS = 1000

/** A dendrogram strip's depth (px), the same on both sides — at most DENDRO_MAX_FRAC of the
 *  plot's shorter side, so a small tile still leaves room for the cells. */
const DENDRO_PX = 76
const DENDRO_MAX_FRAC = 0.2
/** The gap between the cells and the cluster bars (or, uncut, the tree) — px, the same on both
 *  sides. */
const DENDRO_GAP_PX = 16

/** A tree's heights as drawn: by topology alone, evenly — a leaf (or a collapsed clade) at 0, a
 *  merge one level above the taller of its two children, the root at 1. The merge distances only
 *  pick the clusters (cutTree); they don't set branch lengths. Links come children-first (merge
 *  order), and a child is known by the rows it spans (a subtree's rows are one block). */
function evenHeights(links: DendroLink[]): DendroLink[] {
  const level = new Map<string, number>()
  const key = (s: [number, number]): string => `${s[0]}:${s[1]}`
  const lv = links.map((l) => {
    const n = 1 + Math.max(level.get(key(l.sa)) ?? 0, level.get(key(l.sb)) ?? 0)
    level.set(`${Math.min(l.sa[0], l.sb[0])}:${Math.max(l.sa[1], l.sb[1])}`, n)
    return n
  })
  const top = Math.max(1, ...lv)
  return links.map((l, i) => ({
    ...l,
    ha: (level.get(key(l.sa)) ?? 0) / top,
    hb: (level.get(key(l.sb)) ?? 0) / top,
    h: lv[i] / top
  }))
}

/** The cluster bars' thickness (px), the same on both sides. */
const CLUSTER_BAR_PX = 8

/** A tree cut into at most `max` clusters — `max`, or every row when it has fewer: its `k − 1`
 *  highest merges kept, every child below the cut collapsed — its branch run down to the leaves.
 *  `clusters` are the groups at the cut (each a collapsed subtree or a lone row), by their first
 *  and last row, in row order. `max` 0 (or below 2), or a tree with no merge to cut: the whole
 *  tree, no clusters. Ties at the cut keep every merge of that height. */
function cutTree(
  links: DendroLink[],
  max: number
): { links: DendroLink[]; clusters: Array<[number, number]> } {
  if (max < 2 || links.length < 1) return { links, clusters: [] }
  // a tree of n rows has n − 1 merges: at most n clusters
  const clades = Math.min(max, links.length + 1)
  const cut = clades <= 1 ? Infinity : [...links].sort((p, q) => q.h - p.h)[clades - 2].h
  const clusters: Array<[number, number]> = []
  const kept: DendroLink[] = []
  // a child below the cut: a leaf, or a subtree (more than one row) that collapses
  const below = (h: number, sp: [number, number]): boolean => h < cut || sp[1] === sp[0]
  for (const l of links) {
    if (l.h < cut) continue
    const ca = below(l.ha, l.sa)
    const cb = below(l.hb, l.sb)
    if (ca) clusters.push(l.sa)
    if (cb) clusters.push(l.sb)
    kept.push(ca || cb ? { ...l, ha: ca ? 0 : l.ha, hb: cb ? 0 : l.hb } : l)
  }
  clusters.sort((p, q) => p[0] - q[0])
  return { links: kept, clusters }
}

/** A tree's links as one polyline (null-separated): each child's branch up to its merge's height,
 *  then the bar joining the two. `alongX`:
 *  positions along x, heights up y (a tree above the cells); else positions along y, heights
 *  across x (a tree to their right). */
function treeLine(
  links: DendroLink[],
  alongX: boolean
): { x: Array<number | null>; y: Array<number | null> } {
  const x: Array<number | null> = []
  const y: Array<number | null> = []
  const path = (pts: number[][]): void => {
    for (const [pos, h] of pts) {
      x.push(alongX ? pos : h)
      y.push(alongX ? h : pos)
    }
    x.push(null)
    y.push(null)
  }
  for (const l of links)
    path([
      [l.a, l.ha],
      [l.a, l.h],
      [l.b, l.h],
      [l.b, l.hb]
    ])
  return { x, y }
}

/** Where a side's cluster bars sit, for clicking one: along x (above the cells) or along y (to
 *  their right); the cells' end on the other axis (paper share), the row (or column) count, and
 *  each cluster's first and last row. */
interface GeneBars {
  alongX: boolean
  /** the cells' far edge across the bars: xEnd for bars on the right, yEnd for bars on top */
  edge: number
  /** the cells' end along the bars (paper share): yEnd on the right, xEnd on top */
  span: number
  n: number
  clusters: Array<[number, number]>
}

/** The gene cluster under a pointer, by its rows (first, last), or null. `px`/`py`: the pointer
 *  in the plot area's pixels (y down); `w`/`h`: the plot area's size. */
function barAt(b: GeneBars, px: number, py: number, w: number, h: number): [number, number] | null {
  const SLOP = 2
  const near = DENDRO_GAP_PX - SLOP
  const far = DENDRO_GAP_PX + CLUSTER_BAR_PX + SLOP
  // across: the pointer's distance out from the cells' edge; along: its share along the rows
  const across = b.alongX ? h - py - b.edge * h : px - b.edge * w
  const along = b.alongX ? px / w : 1 - py / h
  if (across < near || across > far || along < 0 || along > b.span) return null
  const row = Math.min(b.n - 1, Math.floor((along / b.span) * b.n))
  return b.clusters.find(([s0, s1]) => row >= s0 && row <= s1) ?? null
}

/** The colour bar's shortest length (px): Plotly pads it 10px at each end and throws ("axis
 *  scaling") on one shorter than that. */
const COLORBAR_MIN_PX = 40

/** A condition track's depth (px) across the comparison columns, the gap between two tracks, and
 *  the gap between the tracks and the cells. */
const TRACK_PX = 10
const TRACK_GAP = 1
const TRACK_BAND_GAP_PX = 6
/** The most of the cells' side (their share of the plot) the tracks may take. */
const TRACK_MAX_FRAC = 0.2

/** The condition tracks along the comparison columns — what tells them apart: the comparison, then
 *  each context condition (FcHeatmapData.colConds), a track constant over every column left out
 *  (unless it's the only one). A heatmap trace on its own axis across the columns (`y4` in
 *  portrait, `x4` in landscape), coloured as the Clean-data heatmap's condition bar is (a numeric
 *  condition along its level palette, the rest categorical), with a gap in the panel's colour
 *  where a track's value changes. Null when the data carries none. */
function buildFcTracks(
  data: FcHeatmapData,
  landscape: boolean,
  bg: string,
  levels: LevelPalettes
): { trace: Record<string, unknown>; shapes: Record<string, unknown>[]; n: number } | null {
  const all = (data.colConds ?? []).map((c, t) => ({
    c,
    label: c === 'comparison' ? 'comparison' : condLabel(c),
    vals: data.colValues.map((v) => v[t] ?? '')
  }))
  const varying = all.filter((t) => new Set(t.vals).size > 1)
  const kept = varying.length ? varying : all.slice(0, 1)
  if (!kept.length || !data.columns.length) return null
  const nC = data.columns.length
  // colours: numbered in the data's track order, so both orientations colour alike
  const palette: string[] = []
  const idxOf = new Map<string, number>()
  const colourIndex = (col: string): number => {
    let i = idxOf.get(col)
    if (i == null) {
      i = palette.length
      idxOf.set(col, i)
      palette.push(col)
    }
    return i
  }
  let catIndex = 0
  const colourOf = kept.map((t) => {
    const ramp = t.c === 'comparison' ? null : levelPalette(t.c, levels)
    return trackColours(t.vals, ramp, ramp ? 0 : catIndex++)
  })
  // each track's group per column for the hover focus: its value with every outer track's, so a
  // hover lights the column's nested group in each track
  const groups: string[][] = []
  kept.forEach((t, k) =>
    groups.push(t.vals.map((v, i) => (k > 0 ? `${groups[k - 1][i]}\u0001${v}` : v)))
  )
  // Portrait stacks the tracks up y, row 0 at the bottom: reversed, so they read top-down.
  const order = kept.map((_, k) => k)
  if (!landscape) order.reverse()
  const z = order.map((k) =>
    kept[k].vals.map((v) => (v === '' ? null : colourIndex(colourOf[k].get(v)!) + 0.5))
  )
  const text = order.map((k) =>
    kept[k].vals.map((v, i) => `${data.columns[i]}<br>${kept[k].label}: ${v || '—'}`)
  )
  const focusKeys = order.map((k) => groups[k])
  const labels = order.map((k) => kept[k].label)
  const K = palette.length
  const colorscale: Array<[number, string]> = []
  for (let i = 0; i < K; i++) colorscale.push([i / K, palette[i]], [(i + 1) / K, palette[i]])
  const shapes: Record<string, unknown>[] = []
  order.forEach((k, t) => {
    const vals = kept[k].vals
    for (let i = 0; i < nC - 1; i++) {
      if (vals[i] === vals[i + 1]) continue
      shapes.push(
        landscape
          ? {
              type: 'line',
              xref: 'x4',
              yref: 'y',
              x0: t - 0.5,
              x1: t + 0.5,
              y0: i + 0.5,
              y1: i + 0.5,
              line: { color: bg, width: 2 },
              layer: 'above'
            }
          : {
              type: 'line',
              xref: 'x',
              yref: 'y4',
              x0: i + 0.5,
              x1: i + 0.5,
              y0: t - 0.5,
              y1: t + 0.5,
              line: { color: bg, width: 2 },
              layer: 'above'
            }
      )
    }
  })
  const trace: Record<string, unknown> = {
    type: 'heatmap',
    z: landscape ? transpose(z) : z,
    x: landscape ? labels : data.columns,
    y: landscape ? data.columns : labels,
    // the column and its value as text, not customdata: a string customdata reads as a gene id
    text: landscape ? transpose(text) : text,
    hovertemplate: '%{text}<extra></extra>',
    meta: { focusKeys: landscape ? transpose(focusKeys) : focusKeys },
    colorscale,
    zmin: 0,
    zmax: Math.max(K, 1),
    showscale: false,
    // no gap along the columns (a run of one value reads as one bar); a small one between tracks
    xgap: landscape ? TRACK_GAP : 0,
    ygap: landscape ? 0 : TRACK_GAP,
    xaxis: landscape ? 'x4' : 'x',
    yaxis: landscape ? 'y' : 'y4'
  }
  return { trace, shapes, n: kept.length }
}

/** m[i][j] → m[j][i] (generic; preserves cell values incl. null). */
function transpose<T>(m: T[][]): T[][] {
  const rows = m.length
  const cols = m[0]?.length ?? 0
  const out: T[][] = Array.from({ length: cols }, () => new Array<T>(rows))
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = m[i][j]
  return out
}

/** One side's clustering look (the gene rows', or the condition columns'). */
export interface ClusterSide {
  /** the tree cut into at most this many clusters (see cutTree) — for `modules` */
  max: number
  /** a coloured bar per cluster along its rows / columns, with or without the tree */
  modules: boolean
  /** the clustering tree, beside the cells (leaves facing them) */
  tree: boolean
  /** the cluster bars' colours, cycled in row order */
  colors: readonly string[]
}
const NO_CLUSTER_SIDE: ClusterSide = { max: 0, modules: false, tree: false, colors: CATEGORICAL }

/** log₂FC heatmap of genes × comparison columns on a diverging red/blue scale centred at 0
 *  (red = up, blue = down). Portrait keeps genes down y (comparisons across the top); landscape
 *  transposes so genes run across x. */
export function FcHeatmapView({
  data,
  title,
  orient = 'portrait',
  palette = ROLE_DEFAULTS.fc,
  geneSide = NO_CLUSTER_SIDE,
  condSide = NO_CLUSTER_SIDE,
  unsigned = false,
  condBar = false,
  levels
}: {
  data: FcHeatmapData
  /** the cells are unsigned effect sizes (a two-way ANOVA's terms): drawn from 0 on the palette's
   *  upper half */
  unsigned?: boolean
  title?: string
  orient?: 'landscape' | 'portrait'
  /** the fold-change palette (its low end down, its middle 0, its high end up) */
  palette?: PaletteRef
  /** the gene rows' and the condition (comparison) columns' clustering looks. A side's tree sits
   *  to the cells' right when it runs along y, above them along x — clear of the labels. */
  geneSide?: ClusterSide
  condSide?: ClusterSide
  /** draw the condition tracks along the comparison columns (see buildFcTracks) */
  condBar?: boolean
  /** the numeric conditions' track palettes (and which conditions are numeric) */
  levels?: LevelPalettes
}) {
  const mode = useUiTheme((s) => s.mode)
  // The tile's size, for how many gene labels fit along the gene axis.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // The plot area as Plotly last laid it out (the tile less its margins, which the gene labels
  // size) — what the dendrogram strips are shared out of, so the pixel-drawn cluster bars and the
  // trees behind them meet where intended — and the gene axis's own length, which the gene ticks
  // are spaced along. Null until the first draw: a rough guess stands in.
  const [area, setArea] = useState<{ w: number; h: number; gene: number } | null>(null)
  // Hidden until it settles: the first draw lays the gene ticks out along a guessed axis, and the
  // labels the measured one takes move the margin — the plot would jump sideways as it opened.
  // Shown at the first draw whose ticks are the measured axis's and whose area held still (the
  // spinner stays up meanwhile), or SETTLE_MS after the first draw if it never does.
  const [settled, setSettled] = useState(false)
  const lastReadRef = useRef<{ w: number; h: number; gene: number } | null>(null)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(settleTimerRef.current), [])
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    // hidden (its tab left, 0×0): keep the last size rather than redraw for nobody (HeatmapView)
    const measure = (): void => {
      if (el.clientWidth === 0 && el.clientHeight === 0) return
      setSize({ w: el.clientWidth, h: el.clientHeight })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  // The cells' arrays (the genes × columns part) and the trees' cuts and lines don't depend on the
  // tile's size: built once per data/look, so a resize — or the area settling after a draw —
  // hands Plotly the same arrays, and it re-lays the plot out instead of recalculating every cell.
  const cells = useMemo(() => {
    const landscape = orient === 'landscape'
    return {
      z: landscape ? transpose(data.z) : data.z,
      // each cell's gene uniqID: PlotlyChart's linked hover and click-to-pin read it
      customdata: landscape
        ? data.columns.map(() => data.geneIds)
        : data.geneIds.map((id) => data.columns.map(() => id))
    }
  }, [data, orient])
  const trees = useMemo(() => {
    const landscape = orient === 'landscape'
    // The trees, each in a strip on its own axes (a category axis can't take positions), its
    // position axis spanning the cells' range so the leaves line up with the rows / columns.
    // The side along y (to the cells' right) and along x (above them).
    const yLook = landscape ? condSide : geneSide
    const xLook = landscape ? geneSide : condSide
    const shown = (l: ClusterSide): boolean => l.tree || l.modules
    const yTree = shown(yLook) ? (landscape ? data.colTree : data.rowTree) : undefined
    const xTree = shown(xLook) ? (landscape ? data.rowTree : data.colTree) : undefined
    // Each tree's cut: the genes' and the comparisons' own.
    const yCut = yLook.modules ? yLook.max : 0
    const xCut = xLook.modules ? xLook.max : 0
    const yCl = yTree ? cutTree(yTree, yCut) : null
    const xCl = xTree ? cutTree(xTree, xCut) : null
    return {
      yLook,
      xLook,
      yCl,
      xCl,
      yLine: yCl && yLook.tree ? treeLine(evenHeights(yCl.links), false) : null,
      xLine: xCl && xLook.tree ? treeLine(evenHeights(xCl.links), true) : null
    }
  }, [data, orient, geneSide, condSide])
  const tracks = useMemo(
    () =>
      condBar && levels
        ? buildFcTracks(data, orient === 'landscape', PALETTES[mode].panel, levels)
        : null,
    [data, orient, condBar, levels, mode]
  )

  const {
    data: traces,
    layout,
    geneBars,
    condBars
  } = useMemo((): {
    data: Record<string, unknown>[]
    layout: Record<string, unknown>
    geneBars: GeneBars | null
    condBars: GeneBars | null
  } => {
    let geneBars: GeneBars | null = null
    let condBars: GeneBars | null = null
    const p = PALETTES[mode]
    const landscape = orient === 'landscape'
    // the colour limit (the 99th percentile of |log₂FC|); beyond it the colour saturates, and
    // the colour bar's ends say so (≥ / ≤) — the hover still gives each cell's own value
    const m = data.colorMax
    const capped = data.absMax > m
    const r = (v: number): string => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1))
    const capTicks = capped
      ? unsigned
        ? {
            tickmode: 'array',
            tickvals: [0, m / 2, m],
            ticktext: ['0', r(m / 2), `≥ ${r(m)}`]
          }
        : {
            tickmode: 'array',
            tickvals: [-m, -m / 2, 0, m / 2, m],
            ticktext: [`≤ ${r(-m)}`, r(-m / 2), '0', r(m / 2), `≥ ${r(m)}`]
          }
      : {}
    const trace: Record<string, unknown> = {
      type: 'heatmap',
      z: cells.z,
      x: landscape ? data.genes : data.columns,
      y: landscape ? data.columns : data.genes,
      customdata: cells.customdata,
      // The fold-change palette, symmetric about 0: down its low end, up its high end. Unsigned
      // effect sizes (a two-way ANOVA's terms): its upper half, from its centre (0) out.
      ...(unsigned
        ? { colorscale: paletteRange(palette, 0.5, 1), zmin: 0, zmax: m }
        : { colorscale: paletteScale(palette), zmid: 0, zmin: -m, zmax: m }),
      // 30% of the tile's height, centred on the plot — in px, never shorter than COLORBAR_MIN_PX.
      // Not a share of the plot area: long comparison labels (angled under the cells) can leave a
      // small tile a plot area of a few dozen px, a bar 30% of it shorter than Plotly's 10px
      // padding at each end, and Plotly throws ("axis scaling") — the tile shows its error box.
      colorbar: {
        title: { text: unsigned ? 'effect (log₂)' : 'log₂FC', side: 'right' },
        thickness: 12,
        lenmode: 'pixels',
        len: Math.max(COLORBAR_MIN_PX, 0.3 * size.h),
        y: 0.5,
        yanchor: 'middle',
        ...capTicks
      },
      hovertemplate: tooltip(
        {
          title: landscape ? '%{x}' : '%{y}',
          conds: [['condition', landscape ? '%{y}' : '%{x}']],
          values: [[unsigned ? 'effect (log₂)' : 'log₂FC', '%{z:.2f}']]
        },
        p.textMuted,
        { template: true }
      )
    }
    const geneAxis = {
      ...axisBase(p),
      title: 'gene',
      automargin: true,
      tickfont: { size: PLOT_TEXT.dense },
      // Gene names cut short like every plot's (the full name is in the hover), spaced along the
      // gene axis as last laid out — the same ticks heatmapFocus draws there. A guess at its
      // length (before the first draw) gave other ticks than heatmapFocus's: each render put the
      // guessed ones back, their labels moved the margin, the margin moved the area, and the
      // area re-rendered — the gene-side edge shook.
      ...truncatedTicks(
        data.genes,
        area?.gene ?? (landscape ? size.w - 140 : size.h - 75),
        GENE_TICK_PX
      ),
      ...(landscape ? { tickangle: -45 } : {})
    }
    const compAxis = {
      ...axisBase(p),
      title: data.columnsTitle ?? 'comparison',
      automargin: true,
      tickfont: { size: PLOT_TEXT.dense },
      ...(landscape ? {} : { tickangle: -45 })
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: PLOT_TEXT.heading } } : undefined,
      xaxis: landscape ? geneAxis : compAxis,
      yaxis: landscape ? compAxis : geneAxis
    }
    const traces: Record<string, unknown>[] = [trace]
    // The trees (cut and drawn above): each in a strip on its own axes.
    const { yLook, xLook, yCl, xCl, yLine, xLine } = trees
    const nX = landscape ? data.genes.length : data.columns.length
    const nY = landscape ? data.columns.length : data.genes.length
    // The strips are laid out in shares of the plot (from its rough size); the bars are drawn
    // in pixels off the cells' edge (paper-anchored shapes), so their gap and thickness match
    // exactly on both sides. A strip starts just past its bars — the bars sit on top, so a
    // rough size never shows the stems short of them or through them.
    const plotW = area?.w ?? size.w - 140
    const plotH = area?.h ?? size.h - 120
    const share = (px: number, len: number): number => (len > 0 ? px / len : 0.01)
    // One depth in px for both strips (the shorter side's cap applies to both), as a share of
    // each side's length.
    const depthPx =
      plotW > 0 && plotH > 0
        ? Math.min(DENDRO_PX, DENDRO_MAX_FRAC * Math.min(plotW, plotH))
        : DENDRO_PX
    const frac = (len: number): number => (len > 0 ? depthPx / len : DENDRO_MAX_FRAC / 2)
    const offPx = (cl: ReturnType<typeof cutTree> | null): number =>
      DENDRO_GAP_PX + (cl?.clusters.length ? CLUSTER_BAR_PX - 1 : 0)
    const offX = share(offPx(yCl), plotW)
    const offY = share(offPx(xCl), plotH)
    // A side shows when it has a tree to draw or bars (modules alone: no tree strip).
    const ySide = !!yCl && (yLook.tree || yCl.clusters.length > 0)
    const xSide = !!xCl && (xLook.tree || xCl.clusters.length > 0)
    // Where the cells and the tracks end — the edge the cluster bars and trees stand off.
    const xEnd = ySide ? 1 - (yLook.tree ? frac(plotW) : 0) - offX : 1
    const yEnd = xSide ? 1 - (xLook.tree ? frac(plotH) : 0) - offY : 1
    // The condition tracks: a band along the comparison columns between the cells and the
    // comparisons' cluster bars and tree — above the cells in portrait, right of them in landscape.
    // Sized in px off the plot's length — but never more than TRACK_MAX_FRAC of the cells' side: a
    // short tile (or a rough size before the first draw) would otherwise give the tracks more than
    // the whole side, and the cells a negative domain (Plotly: "axis scaling" error).
    const trackLen = landscape ? plotW : plotH
    const cellsEnd = landscape ? xEnd : yEnd
    const wantGap = tracks ? share(TRACK_BAND_GAP_PX, trackLen) : 0
    const wantBand = tracks ? share(tracks.n * TRACK_PX, trackLen) + wantGap : 0
    const fit = wantBand > 0 ? Math.min(1, (TRACK_MAX_FRAC * cellsEnd) / wantBand) : 1
    const bandGap = wantGap * fit
    const band = wantBand * fit
    // the cells' own ends: short of the tracks on the columns' cross axis
    const xCells = landscape ? xEnd - band : xEnd
    const yCells = landscape ? yEnd : yEnd - band
    const shapes: Record<string, unknown>[] = []
    if (tracks) {
      traces.push(tracks.trace)
      shapes.push(...tracks.shapes)
      const trackAxis = {
        ...axisBase(p),
        automargin: true,
        showgrid: false,
        zeroline: false,
        fixedrange: true,
        // every track named (Plotly thins a category axis's labels when the tracks are short)
        dtick: 1,
        tickfont: { size: PLOT_TEXT.dense }
      }
      if (landscape)
        lay.xaxis4 = {
          ...trackAxis,
          domain: [xCells + bandGap, xEnd],
          anchor: 'y',
          tickangle: -45
        }
      else lay.yaxis4 = { ...trackAxis, domain: [yCells + bandGap, yEnd], anchor: 'x' }
    }
    if (tracks || yCl || xCl) {
      lay.xaxis = { ...(lay.xaxis as object), domain: [0, xCells] }
      lay.yaxis = { ...(lay.yaxis as object), domain: [0, yCells] }
    }
    if (yCl || xCl) {
      const bare = {
        visible: false,
        fixedrange: true,
        showgrid: false,
        zeroline: false
      }
      // heights on 0–1 (evenHeights), with a little headroom for the root's bar
      const top = 1.02
      // A bar per cluster along its rows, DENDRO_GAP_PX off the edge, the colours cycling. The
      // cells span their axis's domain exactly ([-0.5, n − 0.5]), so a row maps onto paper.
      const bars = (
        cl: ReturnType<typeof cutTree>,
        alongX: boolean,
        n: number,
        colors: readonly string[]
      ): void =>
        cl.clusters.forEach(([s0, s1], i) => {
          const end = alongX ? xCells : yCells
          const at = (pos: number): number => (pos / n) * end
          const from = at(s0)
          const to = at(s1 + 1)
          const across = alongX
            ? {
                ysizemode: 'pixel',
                yanchor: yEnd,
                y0: DENDRO_GAP_PX,
                y1: DENDRO_GAP_PX + CLUSTER_BAR_PX
              }
            : {
                xsizemode: 'pixel',
                xanchor: xEnd,
                x0: DENDRO_GAP_PX,
                x1: DENDRO_GAP_PX + CLUSTER_BAR_PX
              }
          shapes.push({
            type: 'rect',
            xref: 'paper',
            yref: 'paper',
            ...(alongX ? { x0: from, x1: to } : { y0: from, y1: to }),
            ...across,
            fillcolor: colors[i % colors.length],
            line: { width: 0.5, color: p.panel },
            layer: 'above'
          })
        })
      const line = (
        xy: ReturnType<typeof treeLine>,
        xa: string,
        ya: string
      ): Record<string, unknown> => ({
        type: 'scatter',
        mode: 'lines',
        ...xy,
        xaxis: xa,
        yaxis: ya,
        line: { color: p.textMuted, width: 1 },
        hoverinfo: 'skip',
        showlegend: false
      })
      if (ySide && yCl) {
        if (yLine) {
          lay.xaxis2 = { ...bare, domain: [xEnd + offX, 1], range: [0, top], anchor: 'y2' }
          lay.yaxis2 = { ...bare, domain: [0, yCells], range: [-0.5, nY - 0.5], anchor: 'x2' }
          traces.push(line(yLine, 'x2', 'y2'))
        }
        bars(yCl, false, nY, yLook.colors)
      }
      if (xSide && xCl) {
        if (xLine) {
          lay.xaxis3 = { ...bare, domain: [0, xCells], range: [-0.5, nX - 0.5], anchor: 'y3' }
          lay.yaxis3 = { ...bare, domain: [yEnd + offY, 1], range: [0, top], anchor: 'x3' }
          traces.push(line(xLine, 'x3', 'y3'))
        }
        bars(xCl, true, nX, xLook.colors)
      }
      // The gene side: on the right in portrait (rows along y), on top in landscape.
      const geneCl = landscape ? xCl : yCl
      const condCl = landscape ? yCl : xCl
      const onX = (cl: { clusters: Array<[number, number]> }): GeneBars => ({
        alongX: true,
        edge: yEnd,
        span: xCells,
        n: nX,
        clusters: cl.clusters
      })
      const onY = (cl: { clusters: Array<[number, number]> }): GeneBars => ({
        alongX: false,
        edge: xEnd,
        span: yCells,
        n: nY,
        clusters: cl.clusters
      })
      if (geneCl?.clusters.length && (landscape ? xLook : yLook).modules)
        geneBars = landscape ? onX(geneCl) : onY(geneCl)
      if (condCl?.clusters.length && (landscape ? yLook : xLook).modules)
        condBars = landscape ? onY(condCl) : onX(condCl)
    }
    if (shapes.length) lay.shapes = shapes
    return { data: traces, layout: lay, geneBars, condBars }
  }, [data, cells, trees, tracks, title, orient, mode, size, area, palette, unsigned])

  // Clicking a gene cluster's bar selects its genes (a second click unselects them) — as a legend
  // group does. Clicking a condition cluster's bar picks its columns, adding to any picked already
  // (again: unpicks them): they light, and with genes selected only the block the two make does
  // (heatmapFocus). Shapes take no
  // Plotly events, so the bars are found by the pointer's position.
  const barsRef = useRef<{ bars: GeneBars | null; cond: GeneBars | null; ids: string[] }>({
    bars: null,
    cond: null,
    ids: []
  })
  useLayoutEffect(() => {
    barsRef.current = { bars: geneBars, cond: condBars, ids: data.geneIds }
  }, [geneBars, condBars, data.geneIds])
  // The picked columns (each picked condition cluster's first and last), read by the focus at
  // each draw.
  const pickRef = useRef<{ spans: Array<[number, number]>; redraw: Set<() => void> }>({
    spans: [],
    redraw: new Set()
  })
  const picked = useMemo(
    (): PickedSamples => ({
      get: () => {
        const out = new Set<number>()
        for (const [a, b] of pickRef.current.spans) for (let i = a; i <= b; i++) out.add(i)
        return out
      },
      subscribe: (redraw) => {
        pickRef.current.redraw.add(redraw)
        return () => pickRef.current.redraw.delete(redraw)
      }
    }),
    []
  )
  const pick = (spans: Array<[number, number]>): void => {
    pickRef.current.spans = spans
    for (const redraw of pickRef.current.redraw) redraw()
  }
  // new columns (a re-run, a re-cluster, the bars switched or cut otherwise): the pick no longer
  // stands for them
  useEffect(() => pick([]), [data, orient, condSide])
  const bindBars = (el: HTMLElement & { _fullLayout?: unknown }): (() => void) => {
    const hitOn = (bars: GeneBars | null, e: MouseEvent): [number, number] | null => {
      const sz = (el._fullLayout as { _size?: { l: number; t: number; w: number; h: number } })
        ?._size
      if (!bars || !sz) return null
      const r = el.getBoundingClientRect()
      return barAt(bars, e.clientX - r.left - sz.l, e.clientY - r.top - sz.t, sz.w, sz.h)
    }
    const hit = (e: MouseEvent): boolean =>
      !!hitOn(barsRef.current.bars, e) || !!hitOn(barsRef.current.cond, e)
    const onClick = (e: MouseEvent): void => {
      const g = hitOn(barsRef.current.bars, e)
      if (g) return useSelection.getState().togglePins(barsRef.current.ids.slice(g[0], g[1] + 1))
      const c = hitOn(barsRef.current.cond, e)
      if (!c) return
      const now = pickRef.current.spans
      const on = now.some(([a, b]) => a === c[0] && b === c[1])
      pick(on ? now.filter(([a, b]) => a !== c[0] || b !== c[1]) : [...now, c])
    }
    // a pointer over a bar says it can be clicked (Plotly's drag layer sets its own elsewhere)
    let over = false
    const onMove = (e: MouseEvent): void => {
      const now = hit(e)
      if (now === over) return
      over = now
      const drag = el.querySelector<HTMLElement>('.nsewdrag')
      el.style.cursor = now ? 'pointer' : ''
      if (drag) drag.style.cursor = now ? 'pointer' : ''
    }
    el.addEventListener('click', onClick)
    el.addEventListener('mousemove', onMove)
    return () => {
      el.removeEventListener('click', onClick)
      el.removeEventListener('mousemove', onMove)
    }
  }

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <PlotlyChart
        controls="none"
        data={traces}
        layout={layout}
        style={settled ? undefined : { opacity: 0 }}
        // the other plots follow a hover once it rests (a sweep down the rows redraws none)
        linkDelay={LINK_DELAY}
        // the lit genes (hovered here or elsewhere, pinned) and hovered column — see heatmapFocus
        onGraphMount={(el) => {
          const unbind = bindHeatmapFocus(el, withAlpha(PALETTES[mode].panel, HOVER_VEIL), {
            landscape: orient === 'landscape',
            geneLabels: data.genes,
            tickPx: GENE_TICK_PX,
            labelInk: PALETTES[mode].text,
            labelBg: PALETTES[mode].panel,
            geneIds: data.geneIds,
            picked
          })
          // After each draw, the plot area Plotly settled on (kept unless it moved a pixel, so a
          // relayout from it doesn't loop).
          const ev = el as unknown as {
            on: (e: string, cb: () => void) => void
            removeListener?: (e: string, cb: () => void) => void
            _fullLayout?: {
              _size?: { w: number; h: number }
              xaxis?: { _length?: number; tickvals?: unknown[] }
              yaxis?: { _length?: number; tickvals?: unknown[] }
            }
          }
          const read = (): void => {
            const fl = ev._fullLayout
            const sz = fl?._size
            const ga = orient === 'landscape' ? fl?.xaxis : fl?.yaxis
            const gene = ga?._length
            if (!sz || !gene) return
            if (!settled) {
              settleTimerRef.current ??= setTimeout(() => setSettled(true), SETTLE_MS)
              const last = lastReadRef.current
              const still =
                !!last &&
                Math.abs(last.w - sz.w) < 1 &&
                Math.abs(last.h - sz.h) < 1 &&
                Math.abs(last.gene - gene) < 1
              lastReadRef.current = { w: sz.w, h: sz.h, gene }
              const want = truncatedTicks(data.genes, gene, GENE_TICK_PX).tickvals
              const live = ga.tickvals ?? []
              if (still && live.length === want.length && want.every((v, i) => live[i] === v))
                setSettled(true)
            }
            setArea((a) =>
              a &&
              Math.abs(a.w - sz.w) < 1 &&
              Math.abs(a.h - sz.h) < 1 &&
              Math.abs(a.gene - gene) < 1
                ? a
                : { w: sz.w, h: sz.h, gene }
            )
          }
          ev.on('plotly_afterplot', read)
          read()
          const unbindBars = bindBars(el as unknown as HTMLElement)
          return () => {
            unbind()
            unbindBars()
            ev.removeListener?.('plotly_afterplot', read)
          }
        }}
      />
    </div>
  )
}
