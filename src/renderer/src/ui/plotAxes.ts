/** Per-tile axis overrides (graph/types `PlotAxes`) applied to a Plotly layout. The tile
 *  provides its config's `axes` through PlotAxesContext; PlotlyChart merges them over the view's
 *  own xaxis/yaxis just before rendering, so every Plotly-based plot honours the same settings
 *  without each view threading a prop. */
import { createContext } from 'react'

import type { AxisStyle, PlotAxes } from '../graph/types'

/** What one axis shows with NO override: the view's own title, and the range actually drawn
 *  (whether the view pinned it or Plotly autoranged). Reported back so the settings dialog can
 *  show them as its placeholders. */
export interface AxisDefault {
  title?: string
  min?: number
  max?: number
  /** what the view itself draws — each plot differs (a bubble grids by default, a volcano doesn't),
   *  so a switch shown without these would mis-state its own starting position */
  grid?: boolean
  zeroline?: boolean
  line?: boolean
}
export interface AxisDefaults {
  x?: AxisDefault
  y?: AxisDefault
}

/** What a tile provides to the charts inside it: the per-axis overrides to apply, and a channel
 *  for the chart to report the titles it would otherwise draw. */
export interface PlotAxesCtx {
  axes?: PlotAxes
  onDefaults?: (d: AxisDefaults) => void
}

export const PlotAxesContext = createContext<PlotAxesCtx | undefined>(undefined)

/** An axis's title text from a view's layout (Plotly accepts a string or { text }). */
export function axisTitleText(ax: unknown): string | undefined {
  const t = (ax as { title?: unknown } | undefined)?.title
  if (typeof t === 'string') return t
  const text = (t as { text?: unknown } | undefined)?.text
  return typeof text === 'string' ? text : undefined
}

type Trace = { x?: unknown; y?: unknown; __oeOverlay?: boolean }

/** Numeric extent of every trace's values on one axis (the fallback range base when the view
 *  leaves the axis on autorange and the user fixes only one bound). Padded 5%. */
function dataExtent(data: unknown[], axis: 'x' | 'y'): [number, number] | undefined {
  let lo = Infinity
  let hi = -Infinity
  for (const raw of data) {
    const t = raw as Trace
    if (!t || t.__oeOverlay) continue
    const vals = t[axis]
    if (!Array.isArray(vals)) continue
    for (const v of vals) {
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!(lo <= hi)) return undefined
  const pad = (hi - lo || 1) * 0.05
  return [lo - pad, hi + pad]
}

/** One axis's layout with a style merged over it. */
function applyAxis(
  ax: Record<string, unknown>,
  st: AxisStyle,
  extent: () => [number, number] | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...ax }
  // Title: the view's may be a string or { text, font }. Keep its text unless overridden; keep
  // its font, sized per the style.
  const t = ax.title
  const text = typeof t === 'string' ? t : ((t as { text?: string } | undefined)?.text ?? '')
  const font = (typeof t === 'object' && t ? (t as { font?: object }).font : undefined) ?? {}
  if (st.title?.trim() || st.titleSize) {
    out.title = {
      text: st.title?.trim() || text,
      font: { ...font, ...(st.titleSize ? { size: st.titleSize } : {}) }
    }
  }
  if (st.tickLabels != null) out.showticklabels = st.tickLabels
  if (st.tickSize) out.tickfont = { ...((ax.tickfont as object) ?? {}), size: st.tickSize }
  if (st.min != null || st.max != null) {
    const cur = Array.isArray(ax.range) ? (ax.range as [number, number]) : undefined
    const base = cur ?? extent()
    const lo = st.min ?? base?.[0]
    const hi = st.max ?? base?.[1]
    if (
      typeof lo === 'number' &&
      typeof hi === 'number' &&
      Number.isFinite(lo) &&
      Number.isFinite(hi)
    ) {
      out.range = [lo, hi]
      out.autorange = false
    }
  }
  if (st.ticks) out.ticks = st.ticks === 'none' ? '' : st.ticks
  if (st.interval && st.interval > 0) {
    // `dtick` only applies under the linear tick mode; set it explicitly rather than relying on
    // Plotly inferring the mode from dtick's presence.
    out.tickmode = 'linear'
    out.dtick = st.interval
  }
  if (st.grid != null) out.showgrid = st.grid
  if (st.gridStyle) out.griddash = st.gridStyle
  if (st.gridWidth != null) out.gridwidth = st.gridWidth
  // A styled axis line is drawn as a shape (Plotly's is solid-only), so Plotly's own is hidden.
  if (st.lineWidth != null || customLine(st)) {
    out.showline = (st.lineWidth ?? 1) > 0 && !customLine(st)
    if (st.lineWidth != null && st.lineWidth > 0) out.linewidth = st.lineWidth
  }
  // Plotly's mirror repeats the axis line exactly (no dash, same width), so a frame with a style
  // or width of its own is drawn as a shape instead — see frameShape.
  if (st.mirror != null) {
    const own = st.mirror && customFrame(st)
    // `true` mirrors the LINE alone; Plotly's 'ticks' would repeat the tick marks on the opposite
    // side too, which reads as a second, unlabelled axis (obvious on a bubble's dense gene ticks).
    out.mirror = st.mirror && !own
    if (st.mirror && !own && out.showline == null) out.showline = true
  }
  // Plotly's zero line is solid-only (there is no `zerolinedash`), so a dashed/dotted one is
  // turned off here and drawn as a shape by zeroLineShape.
  const dashed = st.zeroline !== false && !!st.zerolineStyle && st.zerolineStyle !== 'solid'
  if (st.zeroline != null || dashed) out.zeroline = dashed ? false : st.zeroline
  if (st.zerolineWidth != null) out.zerolinewidth = st.zerolineWidth
  return out
}

/** Whether the axis line is drawn by us rather than by Plotly's `showline` (a dash, which Plotly
 *  has no property for). */
function customLine(st: AxisStyle): boolean {
  return (st.lineWidth ?? 1) > 0 && !!st.lineStyle && st.lineStyle !== 'solid'
}

/** Whether the frame is drawn by us rather than by Plotly's `mirror` (a style or width of its
 *  own, which mirroring can't express — and mirroring copies the axis line, so a hand-drawn axis
 *  line means a hand-drawn frame too). */
function customFrame(st: AxisStyle): boolean {
  return (!!st.frameStyle && st.frameStyle !== 'solid') || st.frameWidth != null || customLine(st)
}

/** The axis line itself when it carries a dash: a paper-referenced line along the axis's own edge
 *  (x axis → the bottom, y axis → the left), in the axis's line colour. */
function axisLineShape(
  ax: Record<string, unknown>,
  st: AxisStyle,
  axis: 'x' | 'y'
): Record<string, unknown> | null {
  if (!customLine(st)) return null
  const line = {
    color: (ax.linecolor as string | undefined) ?? '#888',
    width: st.lineWidth ?? (ax.linewidth as number | undefined) ?? 1,
    dash: st.lineStyle ?? 'solid'
  }
  const edge = { xref: 'paper', yref: 'paper', line, layer: 'above' } as const
  return axis === 'x'
    ? { type: 'line', ...edge, x0: 0, x1: 1, y0: 0, y1: 0 }
    : { type: 'line', ...edge, x0: 0, x1: 0, y0: 0, y1: 1 }
}

/** The frame line for an axis whose mirror carries its own style/width: a paper-referenced line
 *  along the OPPOSITE edge of the plot area (x axis → the top, y axis → the right), in the axis
 *  line's colour. Returns null when Plotly's own mirror does the job (or there's no frame). */
function frameShape(
  ax: Record<string, unknown>,
  st: AxisStyle,
  axis: 'x' | 'y'
): Record<string, unknown> | null {
  if (!st.mirror || !customFrame(st)) return null
  const line = {
    color: (ax.linecolor as string | undefined) ?? '#888',
    width: st.frameWidth ?? st.lineWidth ?? (ax.linewidth as number | undefined) ?? 1,
    dash: st.frameStyle ?? 'solid'
  }
  const edge = { xref: 'paper', yref: 'paper', line, layer: 'above' } as const
  return axis === 'x'
    ? { type: 'line', ...edge, x0: 0, x1: 1, y0: 1, y1: 1 }
    : { type: 'line', ...edge, x0: 1, x1: 1, y0: 0, y1: 1 }
}

/** The stand-in zero line for a dashed/dotted style: a line shape at 0 spanning the plot, in the
 *  axis's own zero-line colour and width, drawn below the data. Returns null when the axis keeps
 *  Plotly's (solid) zero line, or has none. `axis` is which axis the line is perpendicular to:
 *  'y' → a horizontal line at y=0. */
function zeroLineShape(
  ax: Record<string, unknown>,
  st: AxisStyle,
  axis: 'x' | 'y'
): Record<string, unknown> | null {
  if (st.zeroline === false || !st.zerolineStyle || st.zerolineStyle === 'solid') return null
  const color = (ax.zerolinecolor as string | undefined) ?? (ax.linecolor as string | undefined)
  const line = {
    color: color ?? '#888',
    width: st.zerolineWidth ?? (ax.zerolinewidth as number | undefined) ?? 1,
    dash: st.zerolineStyle
  }
  // The cross axis is paper-referenced so the line spans the plot regardless of that axis's range;
  // the line's own coordinate is data, so it disappears when 0 falls outside the visible range —
  // matching Plotly's own zero line.
  return axis === 'y'
    ? { type: 'line', xref: 'paper', x0: 0, x1: 1, yref: 'y', y0: 0, y1: 0, line, layer: 'below' }
    : { type: 'line', yref: 'paper', y0: 0, y1: 1, xref: 'x', x0: 0, x1: 0, line, layer: 'below' }
}

/** The overrides with the two axes exchanged — for a plot that swaps which screen axis carries
 *  which data (the landscape/portrait toggle). Without this a fixed range, title or tick interval
 *  set for the genes would land on the levels after the flip. */
export function swapAxes(axes: PlotAxes | undefined): PlotAxes | undefined {
  if (!axes || (!axes.x && !axes.y)) return axes
  return { x: axes.y, y: axes.x }
}

/** The layout with the tile's axis overrides applied to `xaxis` / `yaxis`. */
export function applyPlotAxes(
  layout: Record<string, unknown>,
  axes: PlotAxes | undefined,
  data: unknown[]
): Record<string, unknown> {
  if (!axes || (!axes.x && !axes.y)) return layout
  const out = { ...layout }
  // Any stand-in zero lines are APPENDED to the view's shapes: draggable guides address shapes by
  // index (see GuideDrag.shapeIndex), so existing entries must keep their positions.
  const extra: Record<string, unknown>[] = []
  if (axes.x) {
    const base = (layout.xaxis as Record<string, unknown>) ?? {}
    out.xaxis = applyAxis(base, axes.x, () => dataExtent(data, 'x'))
    const z = zeroLineShape(base, axes.x, 'x')
    if (z) extra.push(z)
    const f = frameShape(base, axes.x, 'x')
    if (f) extra.push(f)
    const al = axisLineShape(base, axes.x, 'x')
    if (al) extra.push(al)
  }
  if (axes.y) {
    const base = (layout.yaxis as Record<string, unknown>) ?? {}
    out.yaxis = applyAxis(base, axes.y, () => dataExtent(data, 'y'))
    const z = zeroLineShape(base, axes.y, 'y')
    if (z) extra.push(z)
    const f = frameShape(base, axes.y, 'y')
    if (f) extra.push(f)
    const al = axisLineShape(base, axes.y, 'y')
    if (al) extra.push(al)
  }
  if (extra.length) {
    const own = Array.isArray(layout.shapes) ? (layout.shapes as unknown[]) : []
    out.shapes = [...own, ...extra]
  }
  return out
}
