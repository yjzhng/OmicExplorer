/** How much taller the figure must be for every legend to show whole (0: none scrolls). Plotly
 *  caps a legend beside the plot at the plot area's height, and one above or below it at half the
 *  figure's — past that it scrolls, and a capture would keep only the part in view. Each legend's
 *  own full height (`_height`) against what it shows (`_effHeight`). */
export function legendOverflow(fullLayout: Record<string, unknown> | undefined): number {
  let extra = 0
  for (const [key, v] of Object.entries(fullLayout ?? {})) {
    if (!/^legend\d*$/.test(key) || !v || typeof v !== 'object') continue
    const lg = v as { _height?: number; _effHeight?: number; y?: number; yanchor?: string }
    const over = (lg._height ?? 0) - (lg._effHeight ?? lg._height ?? 0)
    if (!(over > 0)) continue
    const y = lg.y ?? 1
    const outside =
      y < 0 || y > 1 || (y === 0 && lg.yanchor === 'top') || (y === 1 && lg.yanchor === 'bottom')
    // (above or below: capped at half the figure, so the figure grows by twice what's cut)
    extra = Math.max(extra, Math.ceil(outside ? 2 * over : over))
  }
  return extra
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Make room under the plot for a legend that scrolls on screen, the plot itself left exactly as
 * drawn: the figure is `extra` px taller, and everything placed by paper fraction (each subplot's
 * domain, paper-referenced annotations, shapes and images, legends, colour bars, 3-D scenes) is
 * re-placed to stay at the same pixels from the top. The new room is empty paper under the plot,
 * which a legend beside it — capped at the plot area's height, which now includes it — runs into.
 *
 * `layout`/`data` are the capture's own copies (changed in place); `full` is the live plot's full
 * layout (each subplot's actual domain, its plot area's height in `_size.h`).
 */
export function extendPaperDown(
  layout: Obj,
  data: Obj[],
  full: Obj | undefined,
  extra: number
): void {
  const plotH = (full?._size as { h?: number } | undefined)?.h ?? 0
  if (!(extra > 0) || !(plotH > 0)) return
  const k = plotH / (plotH + extra)
  // a paper fraction (0 bottom … 1 top) at the same pixels from the top in the taller plot area
  const y = (v: unknown): unknown => (typeof v === 'number' ? 1 - (1 - v) * k : v)
  const dom = (d: unknown): unknown => (Array.isArray(d) && d.length === 2 ? [y(d[0]), y(d[1])] : d)
  const own = (key: string): Obj => {
    const cur = layout[key]
    const copy: Obj = isObj(cur) ? { ...cur } : {}
    layout[key] = copy
    return copy
  }
  for (const [key, f] of Object.entries(full ?? {})) {
    if (!isObj(f)) continue
    // subplots: their drawn domain (a grid's, too), re-placed
    if (/^yaxis\d*$/.test(key)) {
      const ax = own(key)
      ax.domain = dom(f.domain ?? [0, 1])
    } else if (/^xaxis\d*$/.test(key) && f.anchor === 'free' && typeof f.position === 'number') {
      own(key).position = y(f.position)
    } else if (/^(scene|polar|ternary|geo|smith)\d*$/.test(key) && isObj(f.domain)) {
      const sc = own(key)
      sc.domain = { ...(f.domain as Obj), y: dom((f.domain as Obj).y) }
    } else if (/^legend\d*$/.test(key)) {
      own(key).y = y(f.y ?? 1)
    }
  }
  const paperY = (item: Obj): Obj => (item.yref === 'paper' ? { ...item, y: y(item.y) } : item)
  if (Array.isArray(layout.annotations))
    layout.annotations = layout.annotations.map((a) => (isObj(a) ? paperY(a) : a))
  if (Array.isArray(layout.shapes))
    layout.shapes = layout.shapes.map((s) =>
      isObj(s) && s.yref === 'paper' ? { ...s, y0: y(s.y0), y1: y(s.y1) } : s
    )
  if (Array.isArray(layout.images))
    layout.images = layout.images.map((im) =>
      isObj(im) && im.yref === 'paper'
        ? { ...im, y: y(im.y), ...(typeof im.sizey === 'number' ? { sizey: im.sizey * k } : null) }
        : im
    )
  if (isObj(layout.title) && layout.title.yref === 'paper') layout.title = paperY(layout.title)
  // colour bars: placed and sized by plot-area fraction (unless sized in pixels)
  const bar = (cb: unknown): unknown => {
    if (!isObj(cb)) return cb
    const len = cb.lenmode === 'pixels' ? cb.len : ((cb.len as number | undefined) ?? 1) * k
    return { ...cb, y: y(cb.y ?? 0.5), len }
  }
  for (let i = 0; i < data.length; i++) {
    const t = data[i]
    if (!isObj(t)) continue
    let next = t
    if (isObj(t.colorbar) || t.showscale === true)
      next = { ...next, colorbar: bar(t.colorbar ?? {}) }
    if (isObj(t.marker) && (isObj(t.marker.colorbar) || t.marker.showscale === true))
      next = { ...next, marker: { ...t.marker, colorbar: bar(t.marker.colorbar ?? {}) } }
    // a pie's / table's own domain
    if (isObj(t.domain) && Array.isArray(t.domain.y))
      next = { ...next, domain: { ...t.domain, y: dom(t.domain.y) } }
    data[i] = next
  }
}
