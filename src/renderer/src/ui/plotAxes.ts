/** Per-tile axis overrides (graph/types `PlotAxes`) applied to a Plotly layout. The tile
 *  provides its config's `axes` through PlotAxesContext; PlotlyChart merges them over the view's
 *  own xaxis/yaxis just before rendering, so every Plotly-based plot honours the same settings
 *  without each view threading a prop. */
import { createContext } from 'react'

import type { AxisStyle, PlotAxes } from '../graph/types'

export const PlotAxesContext = createContext<PlotAxes | undefined>(undefined)

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
  if (st.nticks && st.nticks > 0) out.nticks = st.nticks
  if (st.grid != null) out.showgrid = st.grid
  if (st.lineWidth != null) {
    out.showline = st.lineWidth > 0
    if (st.lineWidth > 0) out.linewidth = st.lineWidth
  }
  if (st.mirror != null) {
    out.mirror = st.mirror ? 'ticks' : false
    if (st.mirror && out.showline == null) out.showline = true
  }
  if (st.zeroline != null) out.zeroline = st.zeroline
  return out
}

/** The layout with the tile's axis overrides applied to `xaxis` / `yaxis`. */
export function applyPlotAxes(
  layout: Record<string, unknown>,
  axes: PlotAxes | undefined,
  data: unknown[]
): Record<string, unknown> {
  if (!axes || (!axes.x && !axes.y)) return layout
  const out = { ...layout }
  if (axes.x)
    out.xaxis = applyAxis((layout.xaxis as Record<string, unknown>) ?? {}, axes.x, () =>
      dataExtent(data, 'x')
    )
  if (axes.y)
    out.yaxis = applyAxis((layout.yaxis as Record<string, unknown>) ?? {}, axes.y, () =>
      dataExtent(data, 'y')
    )
  return out
}
