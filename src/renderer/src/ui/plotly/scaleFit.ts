/** Colour bars that fit the plot they're drawn beside.
 *
 *  Plotly draws a colour bar along a share of the plot area (`len`, a fraction of its height unless
 *  set in pixels), less its padding (`ypad`, both ends) and — with its title above or below it — the
 *  title's height. When the plot is too short for that, the bar's own axis comes out a negative
 *  length and Plotly throws "Something went wrong with axis scaling", taking the plot down (an
 *  enrichment dot plot's 30% bars once its plot area fell under ~70px tall; any plot's, in a small
 *  enough tile or facet cell). So before each draw, and as the plot is resized, every colour bar is
 *  checked against the plot area it will get: drawn whole when it fits, without its title when only
 *  the bar fits, and not at all when even that doesn't — and back as the room returns. */

/** The least bar, px, worth drawing (Plotly's ticks need a little run). */
const MIN_BAR = 10
/** Plotly's default colour-bar padding, px, each end. */
const DEFAULT_PAD = 10
/** Plotly's default colour-bar title size, px, where the bar's title sets none. */
const DEFAULT_TITLE_FS = 14

/** How much of a colour bar is drawn: 2 whole, 1 the bar without its title, 0 none. */
export type ScaleLevel = 0 | 1 | 2

/** One colour bar: on trace `trace` (at `path` — '' the trace's own, 'marker.' / 'line.'), or a
 *  layout colour axis (`trace` null, `path` 'coloraxis.' …). */
interface Bar {
  trace: number | null
  path: string
  colorbar: Record<string, unknown>
  /** its own `showscale`, as the view set it (undefined: Plotly's default) */
  showscale: unknown
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Whether a colour scale draws its bar: an explicit `showscale`, else — with a `colorbar` set —
 *  yes (the app gives one only to a scale it shows), else Plotly's default, taken as no. */
const showing = (o: Record<string, unknown>): boolean =>
  o.showscale === false ? false : o.showscale === true || !!obj(o.colorbar)

function barsOf(traces: unknown[], layout: Record<string, unknown>): Bar[] {
  const out: Bar[] = []
  traces.forEach((t, k) => {
    const tr = obj(t)
    if (!tr) return
    for (const [path, o] of [
      ['', tr],
      ['marker.', obj(tr.marker)],
      ['line.', obj(tr.line)]
    ] as const) {
      if (o && showing(o) && obj(o.colorbar))
        out.push({ trace: k, path, colorbar: obj(o.colorbar)!, showscale: o.showscale })
    }
  })
  for (const [key, v] of Object.entries(layout)) {
    const ax = obj(v)
    if (/^coloraxis\d*$/.test(key) && ax && ax.showscale !== false)
      out.push({
        trace: null,
        path: `${key}.`,
        colorbar: obj(ax.colorbar) ?? {},
        showscale: ax.showscale
      })
  }
  return out
}

const titleOf = (cb: Record<string, unknown>): { text: string; side: string; size: number } => {
  const t = cb.title
  const o = obj(t)
  const text = typeof t === 'string' ? t : typeof o?.text === 'string' ? o.text : ''
  const size = Number(obj(o?.font)?.size) || DEFAULT_TITLE_FS
  return { text, side: typeof o?.side === 'string' ? o.side : '', size }
}

/** How much of one colour bar fits a plot area of `plotW` × `plotH` px. */
export function scaleLevel(cb: Record<string, unknown>, plotW: number, plotH: number): ScaleLevel {
  const vertical = cb.orientation !== 'h'
  const run = vertical ? plotH : plotW
  const len = typeof cb.len === 'number' ? cb.len : cb.lenmode === 'pixels' ? run : 1
  const lenPx = cb.lenmode === 'pixels' ? len : len * run
  const pad = Number(vertical ? cb.ypad : cb.xpad)
  const bar = lenPx - 2 * (Number.isFinite(pad) && pad >= 0 ? pad : DEFAULT_PAD)
  const { text, side, size } = titleOf(cb)
  // A title takes from the bar's length when it sits along it: above or below a vertical bar
  // (Plotly's default side for one), beside a horizontal one.
  const along = vertical
    ? side === '' || side === 'top' || side === 'bottom'
    : side === 'left' || side === 'right'
  const lines = text ? text.split(/<br\s*\/?>/i).length : 0
  const titleRun =
    !text || !along ? 0 : vertical ? lines * size * 1.3 + 5 : text.length * size * 0.6 + 5
  if (bar - titleRun >= MIN_BAR) return 2
  if (titleRun > 0 && bar >= MIN_BAR) return 1
  return 0
}

/** One colour bar's fit: the level that fits, and the edits that give it that level — written in
 *  full (a bar that fits gets its own `showscale` and title back), so they apply whatever was drawn
 *  before. On trace `trace` (its edits keyed by Plotly attribute path), or the layout (null). */
export interface BarFit {
  trace: number | null
  level: ScaleLevel
  edits: Record<string, unknown>
}

/** Every colour bar's fit to a plot area of `plotW` × `plotH` px, in a fixed order (so two sizes'
 *  fits can be compared bar by bar). */
export function scaleFit(
  traces: unknown[],
  layout: Record<string, unknown>,
  plotW: number,
  plotH: number
): BarFit[] {
  return barsOf(traces, layout).map((b) => {
    const level = scaleLevel(b.colorbar, plotW, plotH)
    const edits: Record<string, unknown> = {
      [`${b.path}showscale`]: level === 0 ? false : (b.showscale ?? null)
    }
    const t = titleOf(b.colorbar)
    if (t.text) edits[`${b.path}colorbar.title.text`] = level === 1 ? '' : t.text
    return { trace: b.trace, level, edits }
  })
}

/** `o` with the value at a dotted `path` set (copying each object along it); null removes it. */
function setPath(o: Record<string, unknown>, path: string, v: unknown): Record<string, unknown> {
  const [head, ...rest] = path.split('.')
  const out = { ...o }
  if (rest.length === 0) {
    if (v === null) delete out[head]
    else out[head] = v
  } else out[head] = setPath(obj(o[head]) ?? {}, rest.join('.'), v)
  return out
}

/** The traces and layout with the fits' edits written in (copies; the inputs are untouched). */
export function withScaleFit(
  traces: unknown[],
  layout: Record<string, unknown>,
  fits: BarFit[]
): { traces: unknown[]; layout: Record<string, unknown> } {
  if (!fits.length) return { traces, layout }
  const apply = (
    o: Record<string, unknown>,
    edits: Record<string, unknown>
  ): Record<string, unknown> => Object.entries(edits).reduce((acc, [p, v]) => setPath(acc, p, v), o)
  let lay = layout
  const out = [...traces]
  for (const f of fits) {
    if (f.trace === null) lay = apply(lay, f.edits)
    else if (obj(out[f.trace]))
      out[f.trace] = apply(out[f.trace] as Record<string, unknown>, f.edits)
  }
  return { traces: out, layout: lay }
}
