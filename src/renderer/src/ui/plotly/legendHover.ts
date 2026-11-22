import { type PlotlyGraphDiv } from 'plotly.js-strict-dist-min'
import { useSelection } from '../useSelection'
import { type Trace } from './highlight'

/** Wire the (native-eventless) legend so hovering a per-gene legend entry drives the linked
 *  hover-highlight — used by DR/TR, whose legend items each stand for ONE gene. Maps the k-th
 *  legend item to the k-th legend-visible trace and, when that trace carries a single uniqID
 *  (all its points are one gene), hover/leave set/clear the selection hover. Group legends
 *  (volcano effects, cluster swatches, …) carry mixed or no ids, so they're left inert.
 *  Returns a cleanup that detaches the listeners. */
export function bindLegendHover(el: PlotlyGraphDiv): () => void {
  const items = (el as unknown as Element).querySelectorAll?.('g.legend g.traces')
  if (!items || !items.length) return () => {}
  const live = (el as unknown as { data?: Trace[] }).data ?? []
  const legendTraces = live.filter((t) => {
    const tt = t as Trace & { showlegend?: boolean; visible?: unknown }
    return tt.showlegend !== false && tt.visible !== false
  })
  const uniformId = (t: Trace): string | null => {
    const cd = t.customdata
    if (!Array.isArray(cd) || cd.length === 0) return null
    const first = cd[0]
    if (typeof first !== 'string') return null
    for (const v of cd) if (v !== first) return null
    return first
  }
  const cleanups: Array<() => void> = []
  items.forEach((node, k) => {
    // The item's own trace, as Plotly bound it — the legend's order needn't be the data's (a plot
    // with filled areas lists its traces reversed); by position only where that's unavailable.
    const bound = (node as unknown as { __data__?: Array<{ trace?: { index?: number } }> })
      .__data__?.[0]?.trace?.index
    const t = typeof bound === 'number' ? live[bound] : legendTraces[k]
    const id = t ? uniformId(t) : null
    if (!id) return
    const enter = (): void => useSelection.getState().setHover(id)
    const leave = (): void => useSelection.getState().clearHover()
    node.addEventListener('mouseenter', enter)
    node.addEventListener('mouseleave', leave)
    ;(node as HTMLElement).style.cursor = 'pointer'
    cleanups.push(() => {
      node.removeEventListener('mouseenter', enter)
      node.removeEventListener('mouseleave', leave)
    })
  })
  return () => {
    for (const c of cleanups) c()
  }
}
