import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { DendroLink, FcHeatmapData } from '../engine'
import { ROLE_DEFAULTS, paletteScale, type PaletteRef } from './palettes'
import { tooltip } from './condTooltip'
import { PlotlyChart } from './PlotlyChart'
import { truncatedTicks } from './plotAxes'
import { bindHeatmapFocus, GENE_TICK_PX, LINK_DELAY } from './heatmapFocus'
import { axisBase, CATEGORICAL, PALETTES, plotBase, withAlpha } from './theme'
import { useSelection } from './useSelection'
import { useUiTheme } from './useUiTheme'

/** How strongly a hovered heatmap veils the cells outside the hovered row and column. */
const HOVER_VEIL = 0.65

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

/** Where the gene clusters' bars sit, for clicking one: along x (above the cells, landscape) or
 *  along y (to their right, portrait); the cells' end on the other axis (paper share), the gene
 *  count, and each cluster's first and last row. */
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
  condSide = NO_CLUSTER_SIDE
}: {
  data: FcHeatmapData
  title?: string
  orient?: 'landscape' | 'portrait'
  /** the fold-change palette (its low end down, its middle 0, its high end up) */
  palette?: PaletteRef
  /** the gene rows' and the condition (comparison) columns' clustering looks. A side's tree sits
   *  to the cells' right when it runs along y, above them along x — clear of the labels. */
  geneSide?: ClusterSide
  condSide?: ClusterSide
}) {
  const mode = useUiTheme((s) => s.mode)
  // The tile's size, for how many gene labels fit along the gene axis.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // The plot area as Plotly last laid it out (the tile less its margins, which the gene labels
  // size) — what the dendrogram strips are shared out of, so the pixel-drawn cluster bars and the
  // trees behind them meet where intended. Null until the first draw: a rough guess stands in.
  const [area, setArea] = useState<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  const {
    data: traces,
    layout,
    geneBars
  } = useMemo((): {
    data: Record<string, unknown>[]
    layout: Record<string, unknown>
    geneBars: GeneBars | null
  } => {
    let geneBars: GeneBars | null = null
    const p = PALETTES[mode]
    const landscape = orient === 'landscape'
    // the colour limit (the 99th percentile of |log₂FC|); beyond it the colour saturates, and
    // the colour bar's ends say so (≥ / ≤) — the hover still gives each cell's own value
    const m = data.colorMax
    const capped = data.absMax > m
    const r = (v: number): string => (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1))
    const capTicks = capped
      ? {
          tickmode: 'array',
          tickvals: [-m, -m / 2, 0, m / 2, m],
          ticktext: [`≤ ${r(-m)}`, r(-m / 2), '0', r(m / 2), `≥ ${r(m)}`]
        }
      : {}
    const trace: Record<string, unknown> = {
      type: 'heatmap',
      z: landscape ? transpose(data.z) : data.z,
      x: landscape ? data.genes : data.columns,
      y: landscape ? data.columns : data.genes,
      // each cell's gene uniqID: PlotlyChart's linked hover and click-to-pin read it
      customdata: landscape
        ? data.columns.map(() => data.geneIds)
        : data.geneIds.map((id) => data.columns.map(() => id)),
      // The fold-change palette, symmetric about 0: down its low end, up its high end.
      colorscale: paletteScale(palette),
      zmid: 0,
      zmin: -m,
      zmax: m,
      // 30% of the tile's height, centred on the plot
      colorbar: {
        title: { text: 'log₂FC', side: 'right' },
        thickness: 12,
        ...(size.h > 0 ? { lenmode: 'pixels', len: 0.3 * size.h } : { len: 0.3 }),
        y: 0.5,
        yanchor: 'middle',
        ...capTicks
      },
      hovertemplate: tooltip(
        {
          title: landscape ? '%{x}' : '%{y}',
          conds: [['condition', landscape ? '%{y}' : '%{x}']],
          values: [['log₂FC', '%{z:.2f}']]
        },
        p.textMuted,
        { template: true }
      )
    }
    const geneAxis = {
      ...axisBase(p),
      title: 'gene',
      automargin: true,
      tickfont: { size: 9 },
      // Gene names cut short like every plot's (the full name is in the hover): a first guess at
      // the axis's length, which heatmapFocus redraws to the axis as laid out.
      ...truncatedTicks(data.genes, landscape ? size.w - 140 : size.h - 75, GENE_TICK_PX),
      ...(landscape ? { tickangle: -45 } : {})
    }
    const compAxis = {
      ...axisBase(p),
      title: 'comparison',
      automargin: true,
      tickfont: { size: 9 },
      ...(landscape ? {} : { tickangle: -45 })
    }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      title: title ? { text: title, font: { size: 13 } } : undefined,
      xaxis: landscape ? geneAxis : compAxis,
      yaxis: landscape ? compAxis : geneAxis
    }
    const traces: Record<string, unknown>[] = [trace]
    // The trees, each in a strip on its own axes (a category axis can't take positions), its
    // position axis spanning the cells' range so the leaves line up with the rows / columns.
    // The side along y (to the cells' right) and along x (above them).
    const yLook = landscape ? condSide : geneSide
    const xLook = landscape ? geneSide : condSide
    const shown = (l: ClusterSide): boolean => l.tree || l.modules
    const yTree = shown(yLook) ? (landscape ? data.colTree : data.rowTree) : undefined
    const xTree = shown(xLook) ? (landscape ? data.rowTree : data.colTree) : undefined
    if (yTree || xTree) {
      const nX = landscape ? data.genes.length : data.columns.length
      const nY = landscape ? data.columns.length : data.genes.length
      // Each tree's cut: the genes' and the comparisons' own.
      const yCut = yLook.modules ? yLook.max : 0
      const xCut = xLook.modules ? xLook.max : 0
      const yCl = yTree ? cutTree(yTree, yCut) : null
      const xCl = xTree ? cutTree(xTree, xCut) : null
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
      const xEnd = ySide ? 1 - (yLook.tree ? frac(plotW) : 0) - offX : 1
      const yEnd = xSide ? 1 - (xLook.tree ? frac(plotH) : 0) - offY : 1
      const bare = {
        visible: false,
        fixedrange: true,
        showgrid: false,
        zeroline: false
      }
      // heights on 0–1 (evenHeights), with a little headroom for the root's bar
      const top = 1.02
      const shapes: Record<string, unknown>[] = []
      // A bar per cluster along its rows, DENDRO_GAP_PX off the cells, the colours cycling. The
      // cells span their axis's domain exactly ([-0.5, n − 0.5]), so a row maps onto paper.
      const bars = (
        cl: ReturnType<typeof cutTree>,
        alongX: boolean,
        n: number,
        colors: readonly string[]
      ): void =>
        cl.clusters.forEach(([s0, s1], i) => {
          const end = alongX ? xEnd : yEnd
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
        cl: ReturnType<typeof cutTree>,
        alongX: boolean,
        xa: string,
        ya: string
      ): Record<string, unknown> => ({
        type: 'scatter',
        mode: 'lines',
        ...treeLine(evenHeights(cl.links), alongX),
        xaxis: xa,
        yaxis: ya,
        line: { color: p.textMuted, width: 1 },
        hoverinfo: 'skip',
        showlegend: false
      })
      lay.xaxis = { ...(lay.xaxis as object), domain: [0, xEnd] }
      lay.yaxis = { ...(lay.yaxis as object), domain: [0, yEnd] }
      if (ySide && yCl) {
        if (yLook.tree) {
          lay.xaxis2 = { ...bare, domain: [xEnd + offX, 1], range: [0, top], anchor: 'y2' }
          lay.yaxis2 = { ...bare, domain: [0, yEnd], range: [-0.5, nY - 0.5], anchor: 'x2' }
          traces.push(line(yCl, false, 'x2', 'y2'))
        }
        bars(yCl, false, nY, yLook.colors)
      }
      if (xSide && xCl) {
        if (xLook.tree) {
          lay.xaxis3 = { ...bare, domain: [0, xEnd], range: [-0.5, nX - 0.5], anchor: 'y3' }
          lay.yaxis3 = { ...bare, domain: [yEnd + offY, 1], range: [0, top], anchor: 'x3' }
          traces.push(line(xCl, true, 'x3', 'y3'))
        }
        bars(xCl, true, nX, xLook.colors)
      }
      if (shapes.length) lay.shapes = shapes
      // The gene side: on the right in portrait (rows along y), on top in landscape.
      const geneCl = landscape ? xCl : yCl
      if (geneCl?.clusters.length)
        geneBars = landscape
          ? { alongX: true, edge: yEnd, span: xEnd, n: nX, clusters: geneCl.clusters }
          : { alongX: false, edge: xEnd, span: yEnd, n: nY, clusters: geneCl.clusters }
    }
    return { data: traces, layout: lay, geneBars }
  }, [data, title, orient, mode, size, area, palette, geneSide, condSide])

  // Clicking a gene cluster's bar selects its genes (a second click unselects them) — as a legend
  // group does. Shapes take no Plotly events, so the bars are found by the pointer's position.
  const barsRef = useRef<{ bars: GeneBars | null; ids: string[] }>({ bars: null, ids: [] })
  useLayoutEffect(() => {
    barsRef.current = { bars: geneBars, ids: data.geneIds }
  }, [geneBars, data.geneIds])
  const bindBars = (el: HTMLElement & { _fullLayout?: unknown }): (() => void) => {
    const hit = (e: MouseEvent): [number, number] | null => {
      const { bars } = barsRef.current
      const sz = (el._fullLayout as { _size?: { l: number; t: number; w: number; h: number } })
        ?._size
      if (!bars || !sz) return null
      const r = el.getBoundingClientRect()
      return barAt(bars, e.clientX - r.left - sz.l, e.clientY - r.top - sz.t, sz.w, sz.h)
    }
    const onClick = (e: MouseEvent): void => {
      const c = hit(e)
      if (c) useSelection.getState().togglePins(barsRef.current.ids.slice(c[0], c[1] + 1))
    }
    // a pointer over a bar says it can be clicked (Plotly's drag layer sets its own elsewhere)
    let over = false
    const onMove = (e: MouseEvent): void => {
      const now = !!hit(e)
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
        data={traces}
        layout={layout}
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
            geneIds: data.geneIds
          })
          // After each draw, the plot area Plotly settled on (kept unless it moved a pixel, so a
          // relayout from it doesn't loop).
          const ev = el as unknown as {
            on: (e: string, cb: () => void) => void
            removeListener?: (e: string, cb: () => void) => void
            _fullLayout?: { _size?: { w: number; h: number } }
          }
          const read = (): void => {
            const sz = ev._fullLayout?._size
            if (!sz) return
            setArea((a) =>
              a && Math.abs(a.w - sz.w) < 1 && Math.abs(a.h - sz.h) < 1 ? a : { w: sz.w, h: sz.h }
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
