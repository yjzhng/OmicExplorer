/** One way every plot answers the pointer, whatever its marks are:
 *
 *  - Clicking a legend entry SELECTS its group — the group stays at full strength and the others
 *    fade — rather than Plotly's default of hiding it. Clicking more adds or removes groups; a
 *    double-click clears. (A gene legend's click pins its genes instead — PlotlyChart — and so
 *    reaches every linked view.)
 *  - Hovering a mark HIGHLIGHTS its group the same way while the pointer is on it. (A gene is
 *    highlighted by the shared gene hover — PlotlyChart — and a sample by the sample link —
 *    sampleLink.)
 *
 *  A group is a trace's `legendgroup`, else its name, so a group's unlisted traces (a violin's
 *  quartile box, a line's replicate points) fade with it. Traces of genes (customdata of uniqIDs)
 *  and of samples (sampleMeta) are left to their own links here; traces with neither a group nor a
 *  name (guides, backgrounds) never fade.
 *
 *  Fading is a trace-opacity restyle (a style edit — no recalc, so the tooltip under the pointer
 *  stays). Several sources fade the same trace — this selection, this hover, the sample link — so
 *  each records its factor here, and a trace's opacity is its own times every factor (`setFade`). */
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-dist-min'

type Trace = Record<string, unknown>

/** How faint a faded group goes (a fraction of its own opacity). */
export const FADE = 0.2

// ── combined fading ──────────────────────────────────────────────────────────────────────────

/** Each trace's own opacity before any fading, keyed by the trace object (Plotly keeps the passed
 *  objects as gd.data and a restyle mutates them in place, so a later read could see the faded
 *  value). */
const baseOpacity = new WeakMap<object, number>()
/** Per chart: each source's factor per trace object (absent = 1). */
const sources = new WeakMap<HTMLElement, Map<string, Map<object, number>>>()

/** A 3-D scene redraws on any restyle and puts its camera back to the layout's, which holds the
 *  user's turn or zoom only once Plotly has saved it — so a fade mid-way (a hover after a scroll
 *  zoom) snapped the view back. First write each scene's live camera into the layout — and, in
 *  an orthographic scene, its live aspect ratio: there a scroll zoom scales the aspect ratio,
 *  not the camera. */
export function keepCameras(el: PlotlyGraphDiv): void {
  const gd = el as unknown as {
    layout?: Record<string, unknown>
    _fullLayout?: Record<string, unknown>
  }
  const full = gd._fullLayout
  if (!full || !gd.layout) return
  for (const key of Object.keys(full)) {
    if (!/^scene\d*$/.test(key)) continue
    const sceneLayout = full[key] as { _scene?: { getCamera?: () => unknown } } | undefined
    const camera = sceneLayout?._scene?.getCamera?.()
    if (!camera) continue
    const ortho = (camera as { projection?: { type?: string } }).projection?.type === 'orthographic'
    const aspect = (full[key] as { aspectratio?: Record<string, number> }).aspectratio
    gd.layout[key] = {
      ...(gd.layout[key] as object | undefined),
      camera,
      ...(ortho && aspect ? { aspectmode: 'manual', aspectratio: { ...aspect } } : null)
    }
    ;(full[key] as Record<string, unknown>).camera = camera
  }
}

/** Set (or, with null, clear) one source's fading of a chart: a factor per trace index (< 1 fades;
 *  a trace left out is at 1). Rewrites the opacity of every trace any source touches, or touched. */
export function setFade(
  el: PlotlyGraphDiv,
  source: string,
  factors: Map<number, number> | null
): void {
  const data = (el.data ?? []) as Trace[]
  let bySource = sources.get(el)
  if (!bySource) sources.set(el, (bySource = new Map()))
  const before = bySource.get(source)
  const touched = new Set<object>(before?.keys() ?? [])
  if (factors && factors.size) {
    const m = new Map<object, number>()
    for (const [i, f] of factors) if (data[i]) m.set(data[i], f)
    bySource.set(source, m)
    for (const t of m.keys()) touched.add(t)
  } else bySource.delete(source)
  if (!touched.size) return
  const idx: number[] = []
  const opacity: number[] = []
  data.forEach((t, i) => {
    if (!touched.has(t)) return
    if (!baseOpacity.has(t)) baseOpacity.set(t, typeof t.opacity === 'number' ? t.opacity : 1)
    let o = baseOpacity.get(t)!
    for (const m of bySource!.values()) o *= m.get(t) ?? 1
    idx.push(i)
    opacity.push(o)
  })
  if (!idx.length) return
  keepCameras(el)
  void Plotly.restyle(el, { opacity }, idx)
}

/** Each per-point trace's own `marker.opacity` before any fading (a number, or one per point). */
const basePoint = new WeakMap<object, number | number[]>()
/** Per chart: each source's per-point factors per trace object. */
const pointSources = new WeakMap<HTMLElement, Map<string, Map<object, number[]>>>()

/** As setFade, per POINT (a scatter's or bar's `marker.opacity`): a factor per point of each trace
 *  index given. A point's opacity is its own times every source's factor. */
export function setPointFade(
  el: PlotlyGraphDiv,
  source: string,
  factors: Map<number, number[]> | null
): void {
  const data = (el.data ?? []) as Trace[]
  let bySource = pointSources.get(el)
  if (!bySource) pointSources.set(el, (bySource = new Map()))
  const touched = new Set<object>(bySource.get(source)?.keys() ?? [])
  if (factors && factors.size) {
    const m = new Map<object, number[]>()
    for (const [i, f] of factors) if (data[i]) m.set(data[i], f)
    bySource.set(source, m)
    for (const t of m.keys()) touched.add(t)
  } else bySource.delete(source)
  if (!touched.size) return
  const idx: number[] = []
  const opacity: number[][] = []
  data.forEach((t, i) => {
    if (!touched.has(t)) return
    if (!basePoint.has(t)) {
      const mo = (t.marker as { opacity?: number | number[] } | undefined)?.opacity
      basePoint.set(t, Array.isArray(mo) ? [...mo] : typeof mo === 'number' ? mo : 1)
    }
    const b = basePoint.get(t)!
    const n = Math.max(
      ...[...bySource!.values()].map((m) => m.get(t)?.length ?? 0),
      Array.isArray(b) ? b.length : 0
    )
    const row: number[] = []
    for (let k = 0; k < n; k++) {
      let o = Array.isArray(b) ? (b[k] ?? 1) : b
      for (const m of bySource!.values()) o *= m.get(t)?.[k] ?? 1
      row.push(o)
    }
    idx.push(i)
    opacity.push(row)
  })
  if (!idx.length) return
  keepCameras(el)
  void Plotly.restyle(el, { 'marker.opacity': opacity }, idx)
}

// ── legend selection and hover highlight ─────────────────────────────────────────────────────

/** A trace of genes (customdata of uniqIDs): PlotlyChart's own — its legend pins the genes, its
 *  hover is the shared gene hover, and it fades by the gene selection, never here. */
const geneTrace = (t: Trace): boolean => {
  const cd = t.customdata
  return Array.isArray(cd) && cd.length > 0 && typeof cd[0] === 'string'
}
/** A trace of samples (sampleMeta): its hover is the sample link's; its legend selects here. */
const sampleTrace = (t: Trace): boolean =>
  !!(t.meta as { oeSample?: unknown } | undefined)?.oeSample

/** A trace's group: its own focus group (`meta.oeGroup` — a sectioned legend's entry, whose
 *  legendgroup is its section; '' = takes no part), else its legendgroup, else its name; null for a
 *  trace that takes no part. */
export const groupOf = (t: Trace | undefined): string | null => {
  if (!t) return null
  const own = (t.meta as { oeGroup?: string } | undefined)?.oeGroup
  if (typeof own === 'string') return own || null
  return typeof t.legendgroup === 'string' && t.legendgroup
    ? t.legendgroup
    : typeof t.name === 'string' && t.name
      ? t.name
      : null
}

/** A trace's own groups, beyond its legendgroup/name: a mark may belong to several (a sample is in
 *  its cell's group AND its dose's — each a legend entry of its own). Keyed `cond=value`. */
const traceGroups = (t: Trace): string[] => {
  const g = (t.meta as { oeGroups?: string[] } | undefined)?.oeGroups
  const own = groupOf(t)
  return [...(own != null ? [own] : []), ...(g ?? [])]
}
/** Per-POINT groups, for a trace whose points are of different groups (a bar per condition): one
 *  list per point. Such a trace fades point by point. */
const pointGroups = (t: Trace): string[][] | undefined =>
  (t.meta as { oePointGroups?: string[][] } | undefined)?.oePointGroups

/** The `meta` fields giving a trace its groups (traceGroups / pointGroups); spread into a trace's
 *  meta beside any other (sampleMeta). */
export const groupMeta = (o: {
  groups?: string[]
  pointGroups?: string[][]
}): { oeGroups?: string[]; oePointGroups?: string[][] } => ({
  ...(o.groups ? { oeGroups: o.groups } : {}),
  ...(o.pointGroups ? { oePointGroups: o.pointGroups } : {})
})

/** Per chart: the selected groups (kept on the chart, so a redraw keeps them) and the hovered one. */
const selected = new WeakMap<HTMLElement, Set<string>>()
const hovered = new WeakMap<HTMLElement, string>()

/** Fade every grouped trace outside the selected groups and the hovered one; none of either → no
 *  fading. Groups no longer on the chart (a redraw dropped them) don't count. */
export function applyFocus(el: PlotlyGraphDiv): void {
  const data = (el.data ?? []) as Trace[]
  const present = new Set<string>()
  for (const t of data) {
    for (const g of traceGroups(t)) present.add(g)
    for (const gs of pointGroups(t) ?? []) for (const g of gs) present.add(g)
  }
  const on = new Set([...(selected.get(el) ?? [])].filter((g) => present.has(g)))
  const h = hovered.get(el)
  if (h != null && present.has(h)) on.add(h)
  if (!on.size) {
    setFade(el, 'focus', null)
    setPointFade(el, 'focus', null)
    return
  }
  const traces = new Map<number, number>()
  const points = new Map<number, number[]>()
  data.forEach((t, i) => {
    if (geneTrace(t)) return
    const tg = traceGroups(t)
    const pg = pointGroups(t)
    // A trace whose points hold an active group fades point by point: the rest of its points.
    if (pg?.some((gs) => gs.some((g) => on.has(g)))) {
      points.set(
        i,
        pg.map((gs) => (gs.some((g) => on.has(g)) ? 1 : FADE))
      )
      return
    }
    if ((tg.length || pg) && !tg.some((g) => on.has(g))) traces.set(i, FADE)
  })
  setFade(el, 'focus', traces)
  setPointFade(el, 'focus', points)
}

/** A legend entry's click: select / deselect its group. Returns whether this handled it (false =
 *  a gene legend — PlotlyChart pins its genes instead). */
export function legendSelect(el: PlotlyGraphDiv, curve: number): boolean {
  const t = ((el.data ?? []) as Trace[])[curve]
  const g = groupOf(t)
  if (!t || g == null || geneTrace(t)) return false
  const sel = new Set(selected.get(el) ?? [])
  if (sel.has(g)) sel.delete(g)
  else sel.add(g)
  selected.set(el, sel)
  applyFocus(el)
  return true
}

/** A legend double-click: clear the selection. */
export function legendClear(el: PlotlyGraphDiv): void {
  selected.delete(el)
  applyFocus(el)
}

/** A hover over trace `curve` (or off everything: null): highlight its group while it lasts. */
export function hoverFocus(el: PlotlyGraphDiv, curve: number | null): void {
  const t = curve == null ? undefined : ((el.data ?? []) as Trace[])[curve]
  const g = t && !geneTrace(t) && !sampleTrace(t) ? groupOf(t) : null
  if ((hovered.get(el) ?? null) === g) return
  if (g == null) hovered.delete(el)
  else hovered.set(el, g)
  applyFocus(el)
}
