/** Cross-plot linked hover for SAMPLES (the gene link is useSelection): hovering a sample — a PCA
 *  point, a QC violin/box/bar, a bar plot's condition bar or replicate dot — highlights the same
 *  sample, or its condition, in every open sample-level plot (PCA, QC, bar), dimming the rest.
 *
 *  A mark is keyed by its condition identity plus its replicate (`sampleKey`). A mark without a
 *  replicate (a bar's condition, a PCA centroid or condition mean, a QC CV group) stands for every
 *  replicate of its condition: hovering it lights them all, and hovering any one of them lights it.
 *
 *  Views tag each trace with its keys in Plotly's `meta` (`sampleMeta`) and pass `bindSampleLink`
 *  as PlotlyChart's `onGraphMount`. Highlighting is an opacity restyle — per point (`marker.opacity`)
 *  for scatter and bar traces, per trace for a violin/box or a set of box points — through the
 *  shared fading layer (traceFocus), so it combines with a legend selection and nothing re-renders
 *  (a QC violin's density is never recomputed on hover). */
import type { PlotlyGraphDiv, PlotlyMouseEvent } from 'plotly.js-dist-min'
import { create } from 'zustand'

import { setFade, setPointFade } from './traceFocus'

interface SampleHoverState {
  /** the hovered sample's key (sampleKey, or samplesKey for several), or null */
  hover: string | null
  setHover: (key: string | null) => void
}

export const useSampleHover = create<SampleHoverState>((set) => ({
  hover: null,
  setHover: (key) => set((s) => (s.hover === key ? s : { hover: key }))
}))

/** A sample's link key: its conditions (cell, cmpd, dose, time, then the customs by slug) and its
 *  replicate ('' when the mark has none — a condition rather than one sample). */
export function sampleKey(
  m: {
    cell: string
    cmpd: string
    dose: number | null
    time: number | null
    extra?: Record<string, string>
  },
  rep?: number | null
): string {
  const extra = Object.keys(m.extra ?? {})
    .sort()
    .map((k) => `${k}=${m.extra![k]}`)
  const cond = [m.cell, m.cmpd, m.dose ?? '', m.time ?? '', ...extra].join('|')
  return `${cond}#${rep ?? ''}`
}

/** A trace's `meta` carrying its link keys: one for the whole trace (a violin/box), or one per
 *  point (null = a point that isn't a sample). Per-point keys only on scatter/bar traces (their
 *  `marker.opacity` takes an array); a box's points take one trace-level key. */
export const sampleMeta = (keys: string | Array<string | null>): { oeSample: typeof keys } => ({
  oeSample: keys
})

/** Between the samples of a hover that stands for several at once (a correlation cell is a pair). */
const MANY = '\u0002'

/** A hover key for several samples at once: a mark answering any of them is lit. */
export const samplesKey = (keys: string[]): string => [...new Set(keys)].join(MANY)

/** Whether mark `k` answers hovered `h`: same condition, and the same replicate unless either
 *  side has none — or, for a hover of several samples (samplesKey), any one of them. */
export function sampleMatches(h: string, k: string): boolean {
  if (h.includes(MANY)) return h.split(MANY).some((one) => sampleMatches(one, k))
  const i = h.lastIndexOf('#')
  const j = k.lastIndexOf('#')
  if (h.slice(0, i) !== k.slice(0, j)) return false
  const hr = h.slice(i + 1)
  const kr = k.slice(j + 1)
  return hr === '' || kr === '' || hr === kr
}

/** How faint a mark that isn't the hovered sample goes (a fraction of its own opacity). */
const DIM = 0.2

type Keys = string | Array<string | null>
const keysOf = (t: Record<string, unknown>): Keys | undefined =>
  (t.meta as { oeSample?: Keys } | undefined)?.oeSample

/** One chart's link state: whether it is dimmed now. */
interface LinkState {
  dimmed: boolean
}

/** Apply the hover to one chart. Nothing matching here (another dataset, or nothing hovered) →
 *  every mark back to normal, rather than all of them dimmed. Only style edits (opacity), never a
 *  recalc: a recalc redraws the chart under the cursor and drops its tooltip. */
function apply(el: PlotlyGraphDiv, hover: string | null, st: LinkState): void {
  const data = el.data ?? []
  const any =
    hover != null &&
    data.some((t) => {
      const k = keysOf(t)
      if (k == null) return false
      return typeof k === 'string'
        ? sampleMatches(hover, k)
        : k.some((x) => x != null && sampleMatches(hover, x))
    })
  if (!any && !st.dimmed) return
  st.dimmed = any
  const on = (k: string | null): boolean => !any || (k != null && sampleMatches(hover!, k))
  const pointIdx: number[] = []
  const pointOpacity: number[][] = []
  const traceIdx: number[] = []
  const traceOpacity: number[] = []
  data.forEach((t, i) => {
    const k = keysOf(t)
    if (k == null) return
    if (typeof k === 'string') {
      // a factor on its own opacity (setFade multiplies it in)
      traceIdx.push(i)
      traceOpacity.push(on(k) ? 1 : DIM)
    } else {
      // per point, factors on their own opacity (setPointFade multiplies them in)
      pointIdx.push(i)
      pointOpacity.push(k.map((x) => (on(x) ? 1 : DIM)))
    }
  })
  // Both through the shared layer, which a legend selection fades through too.
  setPointFade(
    el,
    'sample',
    pointIdx.length ? new Map(pointIdx.map((i, k) => [i, pointOpacity[k]])) : null
  )
  // A whole violin/box fades through the shared layer, as a legend selection may fade it too.
  setFade(
    el,
    'sample',
    traceIdx.length ? new Map(traceIdx.map((i, k) => [i, traceOpacity[k]])) : null
  )
}

/** The hover each chart set, kept on the chart rather than the binding: a redraw mid-hover
 *  re-binds, and the new binding must still clear it when the cursor leaves. */
const ownHover = new WeakMap<HTMLElement, string>()

/** PlotlyChart `onGraphMount` for a sample-level plot: hovering a tagged mark sets the linked
 *  sample hover, and every change to it (from this chart or another) restyles this one. Re-run
 *  after each render (PlotlyChart does), so a redraw picks the current hover straight back up. */
export function bindSampleLink(el: PlotlyGraphDiv): () => void {
  const ev = el as unknown as {
    on: (e: string, cb: (...a: unknown[]) => void) => void
    removeListener?: (e: string, cb: (...a: unknown[]) => void) => void
  }
  // A redraw re-binds, maybe over trace objects a restyle left dimmed — so the first apply always
  // writes every opacity (restoring it when nothing here matches the hover).
  const st: LinkState = { dimmed: true }
  const onHover = (e: PlotlyMouseEvent): void => {
    const pt = e.points?.[0]
    if (!pt) return
    const k = keysOf(((el.data ?? [])[pt.curveNumber] ?? {}) as Record<string, unknown>)
    const key = typeof k === 'string' ? k : (k?.[pt.pointNumber] ?? null)
    if (!key) return
    ownHover.set(el, key)
    useSampleHover.getState().setHover(key)
  }
  const clear = (): void => {
    const own = ownHover.get(el)
    if (own != null && useSampleHover.getState().hover === own)
      useSampleHover.getState().setHover(null)
    ownHover.delete(el)
  }
  ev.on('plotly_hover', onHover as (...a: unknown[]) => void)
  ev.on('plotly_unhover', clear)
  // plotly_unhover can be skipped when the cursor leaves the plot fast; leaving the div clears too.
  el.addEventListener('mouseleave', clear)
  apply(el, useSampleHover.getState().hover, st)
  const unsub = useSampleHover.subscribe((s, prev) => {
    if (s.hover !== prev.hover) apply(el, s.hover, st)
  })
  return () => {
    unsub()
    ev.removeListener?.('plotly_hover', onHover as (...a: unknown[]) => void)
    ev.removeListener?.('plotly_unhover', clear)
    el.removeEventListener('mouseleave', clear)
  }
}
