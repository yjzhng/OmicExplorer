import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-dist-min'

import { useSelection } from './useSelection'

interface PlotlyChartProps {
  data: unknown[]
  layout?: Record<string, unknown>
  style?: CSSProperties
}

// Softened so a gene's existing highlight stays visible alongside the hovered/pinned
// one, rather than the plot fading almost to nothing (linked-selection is additive).
const DIM_OPACITY = 0.28
/** Marks the emphasis trace so it can be found again on the live graph div. */
const OVERLAY_FLAG = '__oeOverlay'
/** Selected points are redrawn a few px larger in an overlay trace (see buildOverlay). */
const EMPH_BUMP = 3

type Trace = Record<string, unknown> & {
  customdata?: unknown
  mode?: unknown
  opacity?: number
  x?: unknown
  y?: unknown
  text?: unknown
  marker?: {
    opacity?: number | number[]
    size?: number | number[]
    color?: string | number | (string | number)[]
    line?: { width?: number | number[]; color?: string | string[] }
    // Diverging/continuous colour map (e.g. the bubble's log2FC scale).
    colorscale?: unknown
    cmid?: number
    cmin?: number
    cmax?: number
  }
}

/** Reproduce a colorscale trace's exact normalization so an overlay of a SUBSET of its
 *  points maps the same values to the same colours (Plotly would otherwise re-fit
 *  cmin/cmax to the subset). Mirrors Plotly's symmetric range when `cmid` is set. */
function colorScaleOf(mk: NonNullable<Trace['marker']>): Record<string, unknown> {
  const nums = ((mk.color as (string | number)[]) ?? []).filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
  let cmin = mk.cmin
  let cmax = mk.cmax
  if ((cmin == null || cmax == null) && nums.length) {
    let lo = Math.min(...nums)
    let hi = Math.max(...nums)
    if (mk.cmid != null) {
      const r = Math.max(Math.abs(lo - mk.cmid), Math.abs(hi - mk.cmid))
      lo = mk.cmid - r
      hi = mk.cmid + r
    }
    cmin = cmin ?? lo
    cmax = cmax ?? hi
  }
  return { colorscale: mk.colorscale, cmid: mk.cmid, cmin, cmax }
}

interface BaseOpacity {
  marker: number
  line: number
}

/** Read a possibly-per-point attribute at point `k`. */
const at = <T,>(v: T | T[] | undefined, k: number, fallback: T): T =>
  Array.isArray(v) ? ((v[k] ?? fallback) as T) : (v ?? fallback)

/** A trace is highlightable if it carries a per-point uniqID array in `customdata`. */
function traceIds(t: Trace): string[] | null {
  return Array.isArray(t.customdata) ? (t.customdata as string[]) : null
}
// A trace that draws a line is one series per feature → dim it wholesale (line +
// its markers together). Pure marker traces dim per point.
const isLine = (t: Trace): boolean => typeof t.mode === 'string' && t.mode.includes('lines')

/** Snapshot each trace's configured opacity BEFORE any restyle. Plotly reuses the
 *  passed trace objects as gd.data and restyle mutates them in place, so reading the
 *  "base" opacity back off a trace after a dim would return the dimmed value — the
 *  reset must restore from this snapshot instead. */
function snapshotBases(data: unknown[]): BaseOpacity[] {
  return data.map((raw) => {
    const t = raw as Trace
    // A view may set a per-point marker.opacity array; the hover restore needs a scalar
    // base (restyle would otherwise treat an array as a per-trace value list). Views that
    // want per-point emphasis use marker.color/size instead, which this layer never touches.
    const mo = t.marker?.opacity
    return { marker: typeof mo === 'number' ? mo : 0.85, line: t.opacity ?? 1 }
  })
}

/**
 * Redraw the active points as one extra trace appended after all the others.
 * Plotly paints traces in array order, so this is what puts the selection *above*
 * the dimmed cloud — restyling the point in place would leave it painted under
 * whichever neighbours came later in the same trace. Slightly enlarged and fully
 * opaque, keeping each point's own colour (no outline).
 */
function buildOverlay(data: unknown[], active: Set<string>): Trace | null {
  const x: unknown[] = []
  const y: unknown[] = []
  const size: number[] = []
  const color: (string | number)[] = []
  const text: string[] = []
  // When the emphasised points come from a colorscale trace (the bubble's diverging
  // log2FC map), reuse that scale + range so the enlarged point keeps the SAME colour.
  let cmap: Record<string, unknown> | null = null
  for (const raw of data) {
    const t = raw as Trace
    const ids = traceIds(t)
    if (!ids || isLine(t) || !Array.isArray(t.x) || !Array.isArray(t.y)) continue
    const mk = t.marker
    const numeric = Array.isArray(mk?.color) && typeof (mk.color as unknown[])[0] === 'number'
    if (numeric && mk && !cmap) cmap = colorScaleOf(mk)
    ids.forEach((id, k) => {
      if (!active.has(id)) return
      x.push((t.x as unknown[])[k])
      y.push((t.y as unknown[])[k])
      size.push(at(t.marker?.size, k, 6) + EMPH_BUMP)
      // Numeric → keep the raw value so the overlay's colorscale maps it; else the
      // point's own colour string.
      color.push(
        numeric ? at(mk?.color as number[], k, 0) : at(mk?.color as string | string[], k, '#888')
      )
      // Carry the point's own label so the emphasised gene is named in place — this is
      // what surfaces a name on hover in the scatter/etc. A trace can opt out (bubble,
      // whose gene names already sit on the axis) via __oeNoLabel.
      text.push(
        (t as { __oeNoLabel?: boolean }).__oeNoLabel
          ? ''
          : at(t.text as string | string[] | undefined, k, '')
      )
    })
  }
  if (!x.length) return null
  return {
    [OVERLAY_FLAG]: true,
    x,
    y,
    type: 'scatter',
    // markers+text so the selected point is both enlarged and named.
    mode: 'markers+text',
    text,
    textposition: 'top center',
    textfont: { size: 10 },
    cliponaxis: false,
    // The underlying point still answers hover/click (Plotly matches on data
    // proximity), so the overlay stays inert to avoid doubled tooltips.
    hoverinfo: 'skip',
    showlegend: false,
    marker: { size, color, opacity: 1, line: { width: 0 }, ...(cmap ?? {}) }
  }
}

/**
 * Apply the active feature selection to a rendered plot by restyling opacity in
 * place (never a full re-render). Marker traces dim non-selected points; line
 * traces (one series per feature) dim the whole trace. Traces without customdata
 * (guides, PCA) are left untouched. Restores from `bases` (see snapshotBases).
 */
function applyHighlight(
  el: PlotlyGraphDiv,
  data: unknown[],
  active: Set<string>,
  bases: BaseOpacity[],
  applied: { current: string[] }
): void {
  // A chart in a hidden tab is still mounted and still subscribed to the selection.
  // Restyling it would cost as much as a visible one for nothing, so skip — and leave
  // `applied` untouched so the work happens when the tab is shown again.
  if (el.offsetParent === null) return
  // A restyle is a full redraw of that trace, so first work out which traces would
  // actually LOOK different. Moving the hover between two genes leaves every trace
  // that contains neither one already-dimmed and unchanged — on a dashboard of
  // seven plots that turns N redraws per mouse move into (usually) one.
  // Marker traces dim WHOLESALE (a scalar opacity), not per point: the selected points
  // are redrawn opaque by the overlay on top anyway. That makes the big traces depend
  // only on *whether* something is selected, so moving the hover from one gene to the
  // next leaves them untouched and only the handful of overlay points get restyled —
  // the cost stops scaling with the size of the dataset.
  const sigs = data.map((raw) => {
    const t = raw as Trace
    const ids = traceIds(t)
    if (!ids) return ''
    if (active.size === 0) return 'off'
    return isLine(t) ? (ids.some((id) => active.has(id)) ? 'on' : 'dim') : 'dim'
  })
  const changed = sigs.some((s, i) => s !== applied.current[i])

  if (changed) {
    data.forEach((raw, i) => {
      const t = raw as Trace
      if (!traceIds(t) || sigs[i] === applied.current[i]) return
      const base = bases[i] ?? { marker: 0.85, line: 1 }
      const key = isLine(t) ? 'opacity' : 'marker.opacity'
      const on = sigs[i] === 'off' || sigs[i] === 'on'
      void Plotly.restyle(el, { [key]: on ? (isLine(t) ? base.line : base.marker) : DIM_OPACITY }, [
        i
      ])
    })
    applied.current = sigs
  }
  // Locate the overlay on the LIVE trace list rather than tracking its index: both
  // Plotly.react and a concurrent selection change can reshuffle gd.data, and a stale
  // index would make deleteTraces throw (which would unmount the whole tree).
  const live = (el as unknown as { data?: Trace[] }).data ?? []
  const found: number[] = []
  live.forEach((t, i) => {
    if (t && (t as Record<string, unknown>)[OVERLAY_FLAG]) found.push(i)
  })
  const top = buildOverlay(data, active)
  try {
    // Adding/removing a trace forces a structural redraw of the whole plot, which is
    // far too expensive to do on every mouse move — once the overlay exists, move it
    // by restyling its (tiny) coordinate arrays instead.
    if (found.length === 1 && top) {
      void Plotly.restyle(
        el,
        {
          x: [top.x],
          y: [top.y],
          text: [top.text],
          'marker.size': [(top.marker as { size: number[] }).size],
          'marker.color': [(top.marker as { color: (string | number)[] }).color]
        },
        found
      )
    } else if (found.length && !top) {
      Plotly.deleteTraces(el, found)
    } else if (found.length > 1 || (found.length && top)) {
      Plotly.deleteTraces(el, found)
      if (top) Plotly.addTraces(el, top)
    } else if (top) {
      Plotly.addTraces(el, top)
    }
  } catch {
    // A highlight is cosmetic — never let a Plotly hiccup take the panel down.
  }
}

/** Thin React wrapper over plotly.js-dist-min (bundled locally — CSP-safe, no CDN). */
export function PlotlyChart({ data, layout, style }: PlotlyChartProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Latest data/active read imperatively so event handlers bind once (no stale closures).
  const dataRef = useRef(data)
  dataRef.current = data
  // Base opacities captured per render (Plotly mutates the trace objects on restyle).
  const basesRef = useRef<BaseOpacity[]>([])
  // Per-trace signature of the highlight last pushed to Plotly (see applyHighlight).
  const appliedRef = useRef<string[]>([])

  const hoverId = useSelection((s) => s.hoverId)
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const active = useMemo(() => {
    const s = new Set(pinnedIds)
    if (hoverId) s.add(hoverId)
    return s
  }, [hoverId, pinnedIds])
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    let cancelled = false
    // Snapshot base opacities from this render's fresh (un-dimmed) trace objects.
    basesRef.current = snapshotBases(data)
    // New traces carry no highlight yet, so the next apply must not skip them.
    appliedRef.current = []
    void Plotly.react(
      el,
      data,
      { autosize: true, margin: { l: 55, r: 20, t: 30, b: 45 }, ...layout },
      { responsive: true, displaylogo: false }
    ).then(() => {
      if (cancelled) return
      // Bind linked-selection events once per graph div (idempotent).
      const div = el as PlotlyGraphDiv & { __oeBound?: boolean }
      if (!div.__oeBound) {
        div.__oeBound = true
        const idAt = (e: { points?: Array<{ customdata?: unknown }> }): string | null => {
          const cd = e.points?.[0]?.customdata
          return typeof cd === 'string' ? cd : null
        }
        el.on('plotly_hover', (e) => {
          const id = idAt(e)
          if (id) useSelection.getState().setHover(id)
        })
        el.on('plotly_unhover', () => useSelection.getState().clearHover())
        el.on('plotly_click', (e) => {
          const id = idAt(e)
          if (id) useSelection.getState().togglePin(id)
        })
        el.on('plotly_doubleclick', () => useSelection.getState().clearPins())
      }
      applyHighlight(el, dataRef.current, activeRef.current, basesRef.current, appliedRef)
    })
    return () => {
      cancelled = true
    }
  }, [data, layout])

  // Re-apply highlight on selection change (restyle only, no re-render). Coalesced
  // into a frame: a mouse sweep across a dense plot emits a hover per point, and
  // without this each one would queue its own redraw.
  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    if (!el) return
    const raf = requestAnimationFrame(() =>
      applyHighlight(el, dataRef.current, active, basesRef.current, appliedRef)
    )
    return () => cancelAnimationFrame(raf)
  }, [active])

  // Plotly's `plotly_unhover` doesn't reliably fire when the cursor leaves the plot
  // (e.g. exits fast), which would leave points stuck dimmed. Clear on native leave.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onLeave = (): void => useSelection.getState().clearHover()
    el.addEventListener('mouseleave', onLeave)
    return () => el.removeEventListener('mouseleave', onLeave)
  }, [])

  // Plotly's `responsive:true` only reacts to window resize, not container resize.
  // In the reconfigurable dashboard a tile resizes without the window changing, so
  // observe the element and tell Plotly to re-fit (rAF-debounced against drag churn).
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (el.offsetParent === null) return
        Plotly.Plots.resize(el)
        // Also the moment a hidden tab is revealed (0×0 → sized): flush the highlight
        // that was skipped while it was hidden.
        applyHighlight(
          el as unknown as PlotlyGraphDiv,
          dataRef.current,
          activeRef.current,
          basesRef.current,
          appliedRef
        )
      })
    })
    ro.observe(el)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = ref.current as PlotlyGraphDiv | null
    return () => {
      if (el) {
        el.removeAllListeners?.('plotly_hover')
        el.removeAllListeners?.('plotly_unhover')
        el.removeAllListeners?.('plotly_click')
        el.removeAllListeners?.('plotly_doubleclick')
        Plotly.purge(el)
      }
    }
  }, [])

  return <div ref={ref} style={{ width: '100%', height: '100%', ...style }} />
}
