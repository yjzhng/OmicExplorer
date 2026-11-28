import { useCallback, useMemo, useRef } from 'react'

import { useElementSize } from '../../dashboard/useElementSize'
import { moduleParts } from '../../engine'
import { fitText, measureText } from '../../ui/legendChips'
import { tooltip } from '../../ui/condTooltip'
import { PlotlyChart } from '../../ui/PlotlyChart'
import { FADE, useScrollEdges } from '../../ui/scrollEdges'
import { CATEGORICAL, PALETTES, PLOT_TEXT, plotBase, plotFontCss } from '../../ui/theme'
import { useUiTheme } from '../../ui/useUiTheme'
import { emptyLayout, hexA, moduleColorStart } from '../enrich/chrome'
import { groupIndexer } from '../enrich/groupOrder'
import {
  buildMap,
  layoutMap,
  type MapInput,
  type MapLink,
  type MapNode,
  type OverlapFallback
} from './layout'

/** The figure's inset, px, and the map's node width, gap and least slot (a label's line). */
const PAD = 10
const NODE_W = 10
const GAP = 6
const MIN_SLOT = PLOT_TEXT.tick + 3
/** A label's gap from its node, and the most the right-hand labels may take of the figure. */
const LABEL_GAP = 5
const RIGHT_MAX_SHARE = 0.4
/** How strong a ribbon is: faint, so ribbons laid over each other build up where genes overlap. */
const RIBBON_ALPHA = 0.28
/** Points along each of a ribbon's curved edges. */
const CURVE_STEPS = 24
/** Where a ribbon's strands meet into one band, as a share of its run from the end they're at. */
const FAN = 0.3

const NODE_PREFIX = 'map:node:'
const LINK_PREFIX = 'map:link:'

/** The enrichment map (layout.ts): nodes as bars as tall as their hit genes, ribbons between them
 *  carrying the genes they share, a label beside each node. Hovering a node focuses it and every
 *  node and ribbon it flows from or into; hovering a ribbon, it and its two ends; a click selects
 *  the genes, in every plot. */
export function MapView({
  input,
  groupOrder = [],
  categorical = CATEGORICAL,
  moduleCategorical,
  displayMap,
  fallback = 'stack'
}: {
  input: MapInput
  /** every top-level group the source has, in its fixed order (groupOrder.ts) — a group's colour
   *  is its place there, as in the enrichment plot */
  groupOrder?: readonly string[]
  categorical?: readonly string[]
  moduleCategorical?: readonly string[]
  /** uniqID → display name, for the hover's gene lists */
  displayMap?: Record<string, string>
  /** where a ribbon can't leave a node in one piece (layout.ts OverlapFallback) */
  fallback?: OverlapFallback
}) {
  const mode = useUiTheme((s) => s.mode)
  const { ref, width: boxW, height: boxH } = useElementSize<HTMLDivElement>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [edges] = useScrollEdges(scrollRef)
  // in 10px steps: a resize rebuilds the figure only as it crosses one
  const W = boxW > 0 ? Math.floor(boxW / 10) * 10 : 0
  const H = boxH > 0 ? Math.floor(boxH / 10) * 10 : 0
  const graph = useMemo(() => buildMap(input), [input])

  const { data, layout, genesOf, membersOf, mapHeight } = useMemo(() => {
    const p = PALETTES[mode]
    const none = {
      data: [] as Record<string, unknown>[],
      layout: emptyLayout(p),
      genesOf: new Map<string, string[]>(),
      membersOf: new Map<string, string[]>(),
      mapHeight: 0
    }
    if (!graph.nodes.size || W <= 0 || H <= 0) return none
    const font = `${PLOT_TEXT.tick}px ${plotFontCss()}`
    // every node's count is its genes (its height); a module's name is its top term and how many
    // more it holds — "glycolytic process +3"
    const nameOf = (n: MapNode): string => {
      const m = n.kind === 'module' ? moduleParts(n.label) : null
      return m ? `${m.rep} +${m.size - 1}` : n.label
    }
    const labelOf = (n: MapNode): string => `${nameOf(n)} (${n.genes.length})`
    // the right-most column's labels sit in the right margin; the rest beside their nodes, over the
    // ribbons, cut to the gap to the next column
    const last = graph.columns - 1
    const rightMax = Math.floor(W * RIGHT_MAX_SHARE)
    const rightW = Math.min(
      rightMax,
      Math.ceil(
        Math.max(
          0,
          ...[...graph.nodes.values()]
            .filter((n) => n.col === last)
            .map((n) => measureText(labelOf(n), font))
        )
      ) +
        LABEL_GAP +
        4
    )
    const plotW = Math.max(NODE_W * graph.columns * 3, W - 2 * PAD - rightW)
    const geo = layoutMap(graph, {
      width: plotW,
      height: H - 2 * PAD,
      nodeW: NODE_W,
      gap: GAP,
      minSlot: MIN_SLOT,
      fallback
    })
    const step = graph.columns > 1 ? (plotW - NODE_W) / (graph.columns - 1) : plotW
    const innerMax = Math.max(40, step - NODE_W - 2 * LABEL_GAP)

    // colours: a group's by its place in the source's fixed order (as the enrichment plot's), a
    // module's from the modules' palette past the categories' colours
    const gi = groupIndexer(groupOrder)
    const tops = [
      ...new Set([...graph.nodes.values()].map((n) => n.top).filter(Boolean))
    ] as string[]
    const topColor = new Map(tops.map((c, i) => [c, categorical[gi(c, i) % categorical.length]]))
    const modPal = moduleCategorical ?? categorical
    const modStart = moduleColorStart(modPal, categorical, groupOrder.length)
    const mods = [...graph.nodes.values()]
      .filter((n) => n.kind === 'module')
      .sort((a, b) => a.y0 - b.y0)
    const modColor = new Map(mods.map((m, i) => [m.id, modPal[(modStart + i) % modPal.length]]))
    const colorOf = (n: MapNode): string =>
      (n.kind === 'module' ? modColor.get(n.id) : n.top ? topColor.get(n.top) : undefined) ??
      p.textMuted

    // focus: a node lights its whole lineage (what flows into it and out of it), a ribbon itself
    // and its two ends; a click selects the genes
    const genesOf = new Map<string, string[]>()
    const membersOf = new Map<string, string[]>()
    const linksInto = new Map<string, MapLink[]>()
    const linksOut = new Map<string, MapLink[]>()
    for (const l of graph.links) {
      ;(linksInto.get(l.target) ?? linksInto.set(l.target, []).get(l.target)!).push(l)
      ;(linksOut.get(l.source) ?? linksOut.set(l.source, []).get(l.source)!).push(l)
    }
    const lineage = (id: string): string[] => {
      const out = new Set<string>([NODE_PREFIX + id])
      const walk = (n: string, dir: 'up' | 'down'): void => {
        for (const l of (dir === 'up' ? linksInto : linksOut).get(n) ?? []) {
          out.add(LINK_PREFIX + l.id)
          const next = dir === 'up' ? l.source : l.target
          if (!out.has(NODE_PREFIX + next)) {
            out.add(NODE_PREFIX + next)
            walk(next, dir)
          }
        }
      }
      walk(id, 'up')
      walk(id, 'down')
      return [...out]
    }
    const names = (ids: readonly string[]): string => {
      const ns = ids.map((g) => displayMap?.[g] ?? g)
      return ns.length <= 12
        ? ns.join(', ')
        : `${ns.slice(0, 12).join(', ')} +${ns.length - 12} more`
    }

    const data: Record<string, unknown>[] = []
    // ribbons first, under the nodes: a band between the two spans, its edges eased curves
    for (const l of graph.links) {
      const s = graph.nodes.get(l.source)!
      const t = graph.nodes.get(l.target)!
      const x0 = s.x + NODE_W
      const x1 = t.x
      const xs: number[] = []
      const ys: number[] = []
      // an eased curve from (xa, ya) to (xb, yb): flat at both ends (smoothstep in y)
      const curve = (xa: number, ya: number, xb: number, yb: number): void => {
        for (let i = 0; i <= CURVE_STEPS; i++) {
          const u = i / CURVE_STEPS
          const e = u * u * (3 - 2 * u)
          xs.push(xa + (xb - xa) * u)
          ys.push(ya + (yb - ya) * e)
        }
      }
      // A ribbon is a band, its strands fanning into it near an end where its genes lie apart on
      // that edge (layout.ts): one outline round it all — the first strands' top edges, the band's,
      // down the target's strands and back through the notches between them, the band's bottom,
      // then back through the source's notches — so strands meeting show no seam.
      const { src, tgt } = l
      const widthOf = (ss: { a: number; b: number }[]): number =>
        ss.reduce((w, st) => w + (st.b - st.a), 0)
      const centreOf = (ss: { a: number; b: number }[]): number => {
        const w = widthOf(ss)
        return w ? ss.reduce((c, st) => c + ((st.a + st.b) / 2) * (st.b - st.a), 0) / w : ss[0].a
      }
      const ws = widthOf(src)
      const wt = widthOf(tgt)
      const xm = src.length > 1 ? x0 + (x1 - x0) * FAN : x0
      const xn = tgt.length > 1 ? x1 - (x1 - x0) * FAN : x1
      const bs = centreOf(src) - ws / 2
      const bt = centreOf(tgt) - wt / 2
      // each strand's slot in the band where it fans in
      const slots = (ss: { a: number; b: number }[], b0: number): number[] => {
        const out: number[] = []
        let y = b0
        for (const st of ss) {
          out.push(y)
          y += st.b - st.a
        }
        out.push(y)
        return out
      }
      const ss = slots(src, bs)
      const ts = slots(tgt, bt)
      curve(x0, src[0].a, xm, ss[0])
      curve(xm, bs, xn, bt)
      curve(xn, ts[0], x1, tgt[0].a)
      for (let j = 0; j < tgt.length; j++) {
        curve(x1, tgt[j].b, xn, ts[j + 1])
        if (j + 1 < tgt.length) curve(xn, ts[j + 1], x1, tgt[j + 1].a)
      }
      curve(xn, bt + wt, xm, bs + ws)
      for (let i = src.length - 1; i >= 0; i--) {
        curve(xm, ss[i + 1], x0, src[i].b)
        if (i > 0) curve(x0, src[i].a, xm, ss[i])
      }
      const id = LINK_PREFIX + l.id
      genesOf.set(id, l.genes)
      membersOf.set(id, [id, NODE_PREFIX + l.source, NODE_PREFIX + l.target])
      data.push({
        type: 'scatter',
        mode: 'lines',
        __oeNoLabel: true,
        x: xs,
        y: ys,
        fill: 'toself',
        fillcolor: hexA(colorOf(s), RIBBON_ALPHA),
        line: { width: 0 },
        hoveron: 'fills',
        hoverinfo: 'text',
        text:
          tooltip(
            {
              title: `${nameOf(s)} → ${nameOf(t)}`,
              values: [['shared genes', l.genes.length]]
            },
            p.textMuted
          ) + `<br>${names(l.genes)}`,
        __oeOwnIds: true,
        __oeId: id,
        customdata: xs.map(() => id),
        showlegend: false
      })
    }
    const annotations: Record<string, unknown>[] = []
    for (const n of graph.nodes.values()) {
      const id = NODE_PREFIX + n.id
      genesOf.set(id, n.genes)
      membersOf.set(id, lineage(n.id))
      const x0 = n.x
      const x1 = n.x + NODE_W
      const t = n.term
      const values: [string, string | number][] = [['genes', n.genes.length]]
      if (t) {
        values.push(['p.adj', t.pAdjust.toExponential(2)])
        if (t.direction !== 'both') values.push(['direction', t.direction])
      }
      data.push({
        type: 'scatter',
        mode: 'lines',
        __oeNoLabel: true,
        x: [x0, x1, x1, x0, x0],
        y: [n.y0, n.y0, n.y1, n.y1, n.y0],
        fill: 'toself',
        fillcolor: colorOf(n),
        line: { width: 0 },
        hoveron: 'fills',
        hoverinfo: 'text',
        text:
          tooltip(
            {
              title: nameOf(n),
              conds: [[n.kind === 'level' ? (input.levels[n.level ?? 0] ?? 'level') : n.kind, '']],
              values
            },
            p.textMuted
          ) + `<br>${names(n.genes)}`,
        __oeOwnIds: true,
        __oeId: id,
        customdata: [id, id, id, id, id],
        showlegend: false
      })
      const right = n.col === last
      annotations.push({
        text: fitText(labelOf(n), right ? rightW - LABEL_GAP : innerMax, font),
        x: x1,
        y: (n.y0 + n.y1) / 2,
        xref: 'x',
        yref: 'y',
        xanchor: 'left',
        xshift: LABEL_GAP,
        yanchor: 'middle',
        showarrow: false,
        // straight over the ribbons (faint enough to read through) — a backing box hid where a
        // ribbon leaves its node
        font: { size: PLOT_TEXT.tick, color: p.text }
      })
    }
    const layout: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      margin: { l: PAD, r: PAD + rightW, t: PAD, b: PAD },
      xaxis: { visible: false, range: [0, plotW], fixedrange: true },
      yaxis: { visible: false, range: [geo.height, 0], fixedrange: true },
      annotations,
      hovermode: 'closest'
    }
    return { data, layout, genesOf, membersOf, mapHeight: Math.ceil(geo.height) + 2 * PAD }
  }, [
    graph,
    W,
    H,
    mode,
    groupOrder,
    categorical,
    moduleCategorical,
    input.levels,
    displayMap,
    fallback
  ])

  const pinIdsOf = useCallback((id: string) => genesOf.get(id) ?? null, [genesOf])
  const memberIdsOf = useCallback((id: string) => membersOf.get(id) ?? null, [membersOf])
  return (
    // the box measured is what's visible; the map inside it is as tall as it lays out — taller
    // than the box (it scrolls) when its labels or its bars need the room. (Sizing the measured box
    // from the map would feed back: a taller box, a bigger scale, a taller map.)
    // It scrolls within its own box — under the tile's switches, which stay put — with a short
    // fade on an edge with more past it, as the data tables have.
    <div ref={ref} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={scrollRef}
        style={{ width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden' }}
      >
        <div style={{ width: '100%', height: mapHeight > H ? mapHeight : '100%' }}>
          <PlotlyChart
            data={data}
            layout={layout}
            emptyNote={false}
            pinIdsOf={pinIdsOf}
            memberIdsOf={memberIdsOf}
            controls="none"
          />
        </div>
      </div>
      {edges.top && <div style={FADE.top} />}
      {edges.bottom && <div style={FADE.bottom} />}
    </div>
  )
}
