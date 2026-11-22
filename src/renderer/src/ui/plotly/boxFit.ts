/** Fitting a plot to its box before Plotly draws it, and again as the box is resized: margins
 *  that leave the plot room (plotAxes.fitMargins) and colour bars that fit the plot (scaleFit).
 *  Either, too big for the box, makes Plotly throw "Something went wrong with axis scaling". */
import Plotly from 'plotly.js-strict-dist-min'

import { fitMargins } from '../plotAxes'
import { scaleFit, withScaleFit, type BarFit, type ScaleLevel } from './scaleFit'

/** What a draw fitted: its unfitted traces and layout (for a resize to refit from), each colour
 *  bar's level, and the margins. */
export interface FitState {
  traces: unknown[]
  layout: Record<string, unknown>
  levels: ScaleLevel[]
  margin: Record<string, unknown> | undefined
}

type Div = HTMLElement & { _fullLayout?: { width?: number; height?: number } }

/** Plotly's own margins, px, for a side a layout leaves unset. */
const PLOTLY_MARGIN = { l: 80, r: 80, t: 100, b: 80 }

/** The plot area a box of `w` × `h` leaves inside a layout's margins. */
function plotArea(layout: Record<string, unknown>, w: number, h: number): [number, number] {
  const m = (layout.margin ?? {}) as Record<string, unknown>
  const side = (k: keyof typeof PLOTLY_MARGIN): number =>
    typeof m[k] === 'number' ? (m[k] as number) : PLOTLY_MARGIN[k]
  return [w - side('l') - side('r'), h - side('t') - side('b')]
}

/** Margins and colour bars for a box of `w` × `h`. */
function fitTo(
  traces: unknown[],
  layout: Record<string, unknown>,
  w: number,
  h: number
): { layout: Record<string, unknown>; fits: BarFit[] } {
  const margined = fitMargins(layout, w, h)
  return { layout: margined, fits: scaleFit(traces, margined, ...plotArea(margined, w, h)) }
}

/** The traces and layout fitted for this draw: to the smaller of the box and the size Plotly will
 *  lay it out at (once autosized, Plotly keeps its last size through a re-render until a resize
 *  reaches it). */
export function fitToBox(
  el: Div,
  traces: unknown[],
  layout: Record<string, unknown>
): {
  traces: unknown[]
  layout: Record<string, unknown>
  levels: ScaleLevel[]
  margin: Record<string, unknown> | undefined
} {
  const at = el._fullLayout
  const w = at?.width ? Math.min(el.clientWidth, at.width) : el.clientWidth
  const h = at?.height ? Math.min(el.clientHeight, at.height) : el.clientHeight
  const { layout: margined, fits } = fitTo(traces, layout, w, h)
  const out = withScaleFit(traces, margined, fits)
  return {
    ...out,
    levels: fits.map((f) => f.level),
    margin: margined.margin as Record<string, unknown> | undefined
  }
}

const R = Plotly as unknown as {
  restyle: (el: unknown, u: Record<string, unknown>, idx: number[]) => Promise<unknown>
  relayout: (el: unknown, u: Record<string, unknown>) => Promise<unknown>
}

function applyFits(el: Div, fits: BarFit[]): void {
  for (const f of fits)
    void (f.trace === null ? R.relayout(el, f.edits) : R.restyle(el, f.edits, [f.trace])).catch(
      () => {}
    )
}

/** Before a resize of `el` to its box: refit the last draw's margins and colour bars to the new
 *  size. Bars the new size has less room for change now, at the old size; the returned step —
 *  for once Plotly has resized — gives back bars that now fit and the margins. */
export function refitForResize(el: Div, fitRef: { current: FitState | null }): () => void {
  const last = fitRef.current
  if (!last || !(el.clientWidth > 0) || !(el.clientHeight > 0)) return () => {}
  const { layout: margined, fits } = fitTo(
    last.traces,
    last.layout,
    el.clientWidth,
    el.clientHeight
  )
  const was = (k: number): ScaleLevel => last.levels[k] ?? 2
  const less = fits.filter((f, k) => f.level < was(k))
  const more = fits.filter((f, k) => f.level > was(k))
  const margin = (margined.margin ?? {}) as Record<string, unknown>
  const prior = last.margin ?? {}
  // only the sides the fit changed: a view's own margins stay as they are (a pinned one included)
  const marginEdits = Object.fromEntries(
    (['l', 'r', 't', 'b'] as const)
      .filter((k) => margin[k] !== prior[k])
      .map((k) => [`margin.${k}`, margin[k]])
  )
  applyFits(el, less)
  fitRef.current = {
    ...last,
    levels: fits.map((f) => f.level),
    margin: margined.margin as Record<string, unknown> | undefined
  }
  return () => {
    if (Object.keys(marginEdits).length) void R.relayout(el, marginEdits).catch(() => {})
    applyFits(el, more)
  }
}
