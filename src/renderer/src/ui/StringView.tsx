import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-dist-min'

import { benjaminiHochberg, type CompareResultRow } from '../engine'
import { PlotlyChart, type PlotLabel } from './PlotlyChart'
import { useSelection } from './useSelection'
import { axisBase, CATEGORICAL, EFFECT_COLOR, plotBase, PALETTES } from './theme'
import { useUiTheme } from './useUiTheme'

/** Pixel width of `text` at `font` via a memoised offscreen canvas (for wrapping the cluster legend). */
let measureCtx: CanvasRenderingContext2D | null = null
function measureText(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return text.length * 6
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/** ln Γ(z) via Lanczos, for the hypergeometric log-binomials in the per-module ORA. */
function lnGamma(z: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7
  ]
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  z -= 1
  let x = c[0]
  for (let i = 1; i < 9; i++) x += c[i] / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}
const lnChoose = (n: number, k: number): number =>
  k < 0 || k > n ? -Infinity : lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)
/** P(X ≥ k) for X ~ Hypergeometric(N, K, n) — the one-tailed Fisher over-representation test. */
function hyperTail(k: number, K: number, n: number, N: number): number {
  if (n === 0 || N === 0) return 1
  const denom = lnChoose(N, n)
  let p = 0
  for (let i = k; i <= Math.min(K, n); i++) p += Math.exp(lnChoose(K, i) + lnChoose(N - K, n - i) - denom)
  return Math.min(1, Math.max(0, p))
}

/** One differential gene from the compare result. */
interface Gene {
  uniqID: string
  name: string
  log2FC: number
  /** STRING id from the annotation fetch (preferred query identifier when present) */
  stringId?: string
}
/** A network node used by the renderer. */
interface NetNode {
  key: string
  name: string
  /** true = a differential (query) gene; false = a first-shell interactor pulled in for context */
  isQuery: boolean
  log2FC: number
}
interface Net {
  nodes: NetNode[]
  edges: { a: string; b: string; score: number }[]
}
/** Precomputed geometry/adjacency for the imperative hover neighbour-highlight (see onGraphMount). */
interface HoverInfo {
  /** trace index of the node markers, and of the edge traces */
  nodeIdx: number
  edgeIdxs: number[]
  /** node-index pairs per edge trace (parallel to edgeIdxs), for re-trimming edges to the node rim */
  edgeBuckets: [number, number][][]
  /** per-node neighbour node indices */
  adj: number[][]
  x: number[]
  y: number[]
  /** per-node log₂FC (marker colour) and marker size, for the highlight overlay */
  color: number[]
  size: number[]
  colorscale: [number, string][]
  cmin: number
  cmax: number
  /** highlight colour for incident edges */
  hi: string
  /** shared-hover id per node (uniqID for query genes, node key for context) */
  focusId: string[]
  /** shared-hover id → node index, for reacting to hover from other views */
  indexByFocus: Map<string, number>
  /** trace point order → node index (context nodes first, query last, so query draw on top) */
  nodeOrder: number[]
  /** module (cluster) index per node, −1 = none; for bolding the cluster legend on hover */
  moduleByNode: number[]
  /** flat legend items (module colour ■ + label), pre-measured, for width-aware wrapping on mount */
  legItems: LegItem[]
  /** wrap the flat items onto lines that fit `budgetPx` (measured bold width so bolding never reflows) */
  legWrap: (budgetPx: number) => LegItem[][]
  /** render wrapped lines to annotation HTML, bolding the given module(s) (−1 / empty set = none) */
  legRender: (active: number | Set<number>, lines: LegItem[][]) => string
  /** annotation index of the cluster legend (−1 when absent) */
  legendIdx: number
}

/** One cluster-legend entry: a module's index, colour swatch, ORA label, and measured bold width. */
interface LegItem {
  ci: number
  label: string
  color: string
  w: number
}

/** Resting opacity of the edge layer — deliberately faint so the network reads as a light mesh
 *  behind the (fully opaque) nodes. */
const EDGE_OPACITY = 0.15
/** Edge opacity while a node is focused: the base edges recede behind the bright incident ones. */
const EDGE_DIM_OPACITY = 0.05
/** Base-node opacity while a node is focused, so non-neighbour nodes recede. */
const NODE_DIM_OPACITY = 0.12
/** Neighbour-node opacity in the highlight overlay, so the focused node reads as the centre. */
const NEIGHBOUR_OPACITY = 0.45
/** Extra px added to a node's radius when trimming edges back, so the line clears the outline. */
const NODE_INSET = 1

/**
 * STRING PPI network for the top differential genes, laid out force-directed and drawn as nodes
 * (log₂FC colour, degree size) over confidence-scored edges. Territories come from Markov clustering
 * of the interactions. Optionally pulls in first-shell interactors (proteins that connect to the
 * query set) as context; query genes get a black outline, interactors a thin one.
 * All data is read locally from the cached organism files (fetched in the import).
 */
export function StringView({
  rows,
  displayMap,
  annotationMap,
  species,
  requiredScore,
  maxGenes,
  addInteractors = false,
  title
}: {
  rows: CompareResultRow[]
  displayMap?: Record<string, string>
  annotationMap?: Record<string, Record<string, string>>
  species: number
  requiredScore: number
  maxGenes: number
  /** also pull in first-shell interactors of the query set (up to maxGenes of them) */
  addInteractors?: boolean
  title?: string
}) {
  const mode = useUiTheme((s) => s.mode)

  // Significant genes, one per feature (max |log₂FC|), strongest first, capped to maxGenes.
  const genes = useMemo<Gene[]>(() => {
    const dm = displayMap ?? {}
    const am = annotationMap ?? {}
    const best = new Map<string, number>()
    for (const r of rows) {
      if (!r.signf || r.log2FC == null || !Number.isFinite(r.log2FC)) continue
      const prev = best.get(r.uniqID)
      if (prev == null || Math.abs(r.log2FC) > Math.abs(prev)) best.set(r.uniqID, r.log2FC)
    }
    return [...best.entries()]
      .map(([uniqID, log2FC]) => ({
        uniqID,
        name: dm[uniqID] ?? uniqID,
        log2FC,
        stringId: (am[uniqID]?.stringId ?? '').trim() || undefined
      }))
      .sort((a, b) => Math.abs(b.log2FC) - Math.abs(a.log2FC))
      .slice(0, Math.max(2, maxGenes))
  }, [rows, displayMap, annotationMap, maxGenes])

  const sendIds = useMemo(() => genes.map((g) => g.stringId || g.name), [genes])
  // Stable key so the fetch effect only re-runs when the query (or interactor setting) changes.
  const key = useMemo(
    () => `${addInteractors ? maxGenes : 0}|${[...sendIds].sort().join('|')}`,
    [sendIds, addInteractors, maxGenes]
  )
  // log₂FC of the query genes, keyed by STRING id.
  const fcByKey = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of genes) if (g.stringId) m.set(g.stringId, g.log2FC)
    return m
  }, [genes])

  const [net, setNet] = useState<Net | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (genes.length < 2 || !species) return
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
    })
    const done = (n: Net | null, err: string | null): void => {
      if (cancelled) return
      setNet(n)
      setError(err)
    }
    const fail = (e: unknown): void => {
      if (cancelled) return
      setError(e instanceof Error ? e.message : 'STRING read failed')
      setNet(null)
    }
    // Query nodes read with the app's display name (keyed by STRING id); first-shell interactors
    // (when enabled) have no app-side name, so they keep STRING's canonical name.
    const dispByStringId = new Map(
      genes.filter((g) => g.stringId).map((g) => [g.stringId as string, g.name])
    )
    window.api
      .fetchStringNetwork(sendIds, species, requiredScore, addInteractors ? maxGenes : 0)
      .then((res) => {
        const nodes: NetNode[] = res.nodes.map((n) => ({
          key: n.id,
          name: (n.isQuery ? dispByStringId.get(n.id) : undefined) ?? n.name,
          isQuery: n.isQuery,
          log2FC: n.isQuery ? (fcByKey.get(n.id) ?? 0) : 0
        }))
        const edges = res.edges.map((e) => ({ a: e.aId, b: e.bId, score: e.score }))
        done({ nodes, edges }, res.error ?? null)
      })
      .catch(fail)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, species, requiredScore, genes, sendIds, fcByKey, maxGenes, addInteractors])

  const { data, layout, nConnected, labels, labelColor, hover } = useMemo(() => {
    const p = PALETTES[mode]
    if (!net)
      return {
        data: [] as unknown[],
        layout: {} as Record<string, unknown>,
        nConnected: 0,
        labels: [] as PlotLabel[],
        labelColor: undefined as string | undefined,
        hover: undefined as HoverInfo | undefined
      }
    // Index nodes by key; build edge index pairs + degree.
    const idxByKey = new Map(net.nodes.map((n, i) => [n.key, i]))
    const degAll = new Array(net.nodes.length).fill(0)
    const eAll: { a: number; b: number; score: number }[] = []
    for (const e of net.edges) {
      const a = idxByKey.get(e.a)
      const b = idxByKey.get(e.b)
      if (a == null || b == null || a === b) continue
      eAll.push({ a, b, score: e.score })
      degAll[a]++
      degAll[b]++
    }
    // Hide singletons; re-index to the kept set.
    const keep = net.nodes.map((_, i) => i).filter((i) => degAll[i] > 0)
    const newIdx = new Map(keep.map((gi, ni) => [gi, ni]))
    const vis = keep.map((i) => net.nodes[i])
    const degree = keep.map((i) => degAll[i])
    const eIdx: [number, number][] = eAll.map((e) => [newIdx.get(e.a)!, newIdx.get(e.b)!])
    const eScore = eAll.map((e) => e.score)

    // Territories from Markov clustering of the interaction scores.
    const wEdges = eIdx.map(([a, b], k) => ({ a, b, w: eScore[k] ?? 0 }))
    const cid = mclClusters(vis.length, wEdges)
    const byCluster = new Map<number, number[]>()
    cid.forEach((c, i) => {
      const arr = byCluster.get(c)
      if (arr) arr.push(i)
      else byCluster.set(c, [i])
    })
    // uniqID per node key (stringId), for pulling each query gene's KEGG pathways from the annotations.
    const uniqByStringId = new Map(
      genes.filter((g) => g.stringId).map((g) => [g.stringId as string, g.uniqID])
    )
    const am = annotationMap ?? {}
    // stringId → uniqID over EVERY comparison gene (not just the query set), so an interactor node
    // that is itself a comparison gene still resolves to its uniqID and highlights when selected.
    const uniqByStringIdAll = new Map<string, string>()
    for (const uid in am) {
      const sid = (am[uid]?.stringId ?? '').trim()
      if (sid && !uniqByStringIdAll.has(sid)) uniqByStringIdAll.set(sid, uid)
    }
    const splitPaths = (raw: string | undefined): string[] =>
      (raw ?? '')
        .split(/[;|]/)
        .map((s) => s.trim())
        .filter(Boolean)
    // KEGG pathways per query gene, and the background: query genes that carry ≥1 pathway.
    const pathsByNode = new Map<number, string[]>() // vis node index → its pathways (query only)
    const termGenes = new Map<string, Set<number>>() // pathway → query node indices (background)
    let bgN = 0
    vis.forEach((n, i) => {
      if (!n.isQuery) return
      const uid = uniqByStringId.get(n.key)
      const paths = uid ? [...new Set(splitPaths(am[uid]?.keggPathway))] : []
      if (paths.length === 0) return
      bgN++
      pathsByNode.set(i, paths)
      for (const t of paths) (termGenes.get(t) ?? termGenes.set(t, new Set()).get(t)!).add(i)
    })
    // Label each module by ORA of its query gene set: hypergeometric over-representation of pathways
    // vs the background (all annotated query genes), BH-corrected. Name = the significant pathways.
    const moduleLabel = (mem: number[]): string => {
      const setGenes = mem.filter((m) => pathsByNode.has(m))
      const n = setGenes.length
      if (n < 2 || bgN < 2) return ''
      const kByTerm = new Map<string, number>()
      for (const m of setGenes) for (const t of pathsByNode.get(m)!) kByTerm.set(t, (kByTerm.get(t) ?? 0) + 1)
      const staged = [...kByTerm.entries()]
        .filter(([, k]) => k >= 2)
        .map(([term, k]) => ({ term, k, K: termGenes.get(term)?.size ?? k }))
      if (staged.length === 0) return ''
      const padj = benjaminiHochberg(staged.map((s) => hyperTail(s.k, s.K, n, bgN)))
      const sig = staged
        .map((s, i) => ({ term: s.term, padj: padj[i], k: s.k }))
        .filter((s) => s.padj < 0.05)
        .sort((a, b) => a.padj - b.padj || b.k - a.k)
      return sig.slice(0, 3).map((s) => s.term).join(' / ')
    }
    const territoryGroups = [...byCluster.entries()]
      .filter(([, mem]) => mem.length >= 2)
      .map(([id, mem]) => {
        const paths = moduleLabel(mem)
        return { members: mem, label: `module ${id + 1}${paths ? ` (${paths})` : ''}` }
      })
    // Which module (territoryGroups index) each visible node belongs to (−1 = none).
    const moduleByNode = new Array<number>(vis.length).fill(-1)
    territoryGroups.forEach((grp, gi) => grp.members.forEach((m) => (moduleByNode[m] = gi)))
    const pos = layoutNetwork(vis.length, eIdx, 0x1a2b3c)

    // Territories: a rounded outward offset (Minkowski sum with a disk) of each group's hull, so a
    // 2-node group reads as a capsule and a near-collinear group as a padded blob — both still
    // covering their nodes, instead of a degenerate sliver.
    const territoryTraces = territoryGroups
      .map((grp, ci) => {
        const hull = convexHull(grp.members.map((i) => [pos.x[i], pos.y[i]] as [number, number]))
        if (hull.length === 0) return null
        const ring = offsetHull(hull, NODE_GAP * 0.6)
        const color = CATEGORICAL[ci % CATEGORICAL.length]
        return {
          type: 'scatter',
          mode: 'lines',
          __oeNoLabel: true,
          x: ring.map((q) => q[0]),
          y: ring.map((q) => q[1]),
          fill: 'toself',
          fillcolor: hexA(color, 0.12),
          line: { color: hexA(color, 0.45), width: 1, shape: 'linear' },
          hoverinfo: 'skip'
        }
      })
      .filter(Boolean)

    // Edge thickness scales continuously with the STRING combined score (quantised into levels).
    const EDGE_MIN = 0.5
    const EDGE_MAX = 4
    const STEP = 0.25
    const widthOf = (s: number): number => {
      const w = EDGE_MIN + Math.max(0, Math.min(1, s)) * (EDGE_MAX - EDGE_MIN)
      return Math.round(w / STEP) * STEP
    }
    const byWidth = new Map<
      number,
      { x: (number | null)[]; y: (number | null)[]; pairs: [number, number][] }
    >()
    eIdx.forEach(([a, b], k) => {
      const w = widthOf(eScore[k] ?? 0)
      let g = byWidth.get(w)
      if (!g) byWidth.set(w, (g = { x: [], y: [], pairs: [] }))
      g.x.push(pos.x[a], pos.x[b], null)
      g.y.push(pos.y[a], pos.y[b], null)
      g.pairs.push([a, b])
    })
    const widthGroups = [...byWidth.entries()]
    const edgeTraces = widthGroups.map(([w, g]) => ({
      type: 'scatter',
      mode: 'lines',
      __oeNoLabel: true,
      x: g.x,
      y: g.y,
      hoverinfo: 'skip',
      opacity: EDGE_OPACITY,
      line: { color: p.textMuted, width: w }
    }))
    // Node-index pairs per edge trace (parallel to edgeTraces), so the imperative layer can re-trim
    // each edge back to the node rim as the axis scale changes (see onGraphMount → trimEdges).
    const edgeBuckets = widthGroups.map(([, g]) => g.pairs)

    const maxDeg = Math.max(1, ...degree)
    const sizeOf = (d: number): number => 10 + Math.pow(d / maxDeg, 3) * 20
    const maxAbs = Math.max(1e-9, ...vis.map((g) => Math.abs(g.log2FC)))
    // Shared id per node → its uniqID, so external selection/hover (which is uniqID-keyed) can find
    // it. Query genes resolve via the query map; an interactor node that is itself a comparison gene
    // resolves via the full annotation map (so it highlights when selected, not just query nodes).
    // Pure interactors (no uniqID) fall back to the node key (local-only linking).
    const focusId = vis.map(
      (n) => (n.isQuery ? uniqByStringId.get(n.key) : undefined) ?? uniqByStringIdAll.get(n.key) ?? n.key
    )
    // Draw order: context (added) nodes first, then query genes — so query markers sit ON TOP.
    // `nodeOrder[traceIndex] = visIndex`, used to map a hovered point back to its logical node.
    const nodeOrder = [
      ...vis.map((_, i) => i).filter((i) => !vis[i].isQuery),
      ...vis.map((_, i) => i).filter((i) => vis[i].isQuery)
    ]
    const nodeTrace = {
      type: 'scatter',
      mode: 'markers',
      __oeNoLabel: true,
      // customdata = shared uniqID so the generic layer's click toggles selection and hover links to
      // the other views; __oeNoOverlay keeps that layer from dimming/emphasising the nodes, since
      // StringView draws its own hover/selection highlight imperatively (see onGraphMount).
      __oeNoOverlay: true,
      customdata: nodeOrder.map((i) => focusId[i]),
      x: nodeOrder.map((i) => pos.x[i]),
      y: nodeOrder.map((i) => pos.y[i]),
      text: nodeOrder.map(
        (i) =>
          `${vis[i].name}<br>log₂FC ${vis[i].isQuery ? vis[i].log2FC.toFixed(2) : '—'}<br>${degree[i]} links`
      ),
      hovertemplate: '%{text}<extra></extra>',
      marker: {
        size: nodeOrder.map((i) => sizeOf(degree[i])),
        // Fully opaque nodes at rest. Set explicitly because PlotlyChart's shared highlight layer
        // snapshots an unset marker.opacity as 0.85 (its dim/restore baseline), which would otherwise
        // leave the resting nodes faintly translucent.
        opacity: 1,
        color: nodeOrder.map((i) => vis[i].log2FC),
        colorscale: [
          [0, EFFECT_COLOR.down],
          [0.5, EFFECT_COLOR.none],
          [1, EFFECT_COLOR.up]
        ],
        cmid: 0,
        cmin: -maxAbs,
        cmax: maxAbs,
        // Differential (query) genes get a black outline; context genes a thin background outline.
        line: {
          width: nodeOrder.map((i) => (vis[i].isQuery ? 1.8 : 0.6)),
          color: nodeOrder.map((i) => (vis[i].isQuery ? '#000000' : p.bg))
        },
        colorbar: { title: { text: 'log₂FC', side: 'right' }, thickness: 12 }
      }
    }

    // Density-managed labels for QUERY genes only — first-shell interactors are context and stay
    // unlabelled (their names appear on hover). PlotlyChart's collision layer places the highest-
    // priority ones that fit the CURRENT view (crowded labels hide; zooming in surfaces more).
    const labels: PlotLabel[] = vis
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => g.isQuery)
      .map(({ g, i }) => ({
        x: pos.x[i],
        y: pos.y[i],
        text: g.name,
        priority: degree[i],
        // shared-selection id (uniqID for query genes) so non-selected labels fade with the selection.
        id: uniqByStringId.get(g.key) ?? g.key,
        // marker radius (size is a diameter) + half the stroke, so the label clears large nodes.
        radius: sizeOf(degree[i]) / 2 + 1.8 / 2,
        // tight gap so the label hugs the node.
        margin: 1
      }))

    // Cluster legend (centre-bottom): the module's colour ■ + its ORA pathway label. Wrapped onto
    // lines by measured BOLD width so bolding one on hover never reflows. Wrapping is width-aware:
    // laid out here with a conservative budget, then reflowed to the live plot width on mount so the
    // items never crop against a narrow tile's edges.
    const LEG_FS = 10
    const LEG_GAP = 20
    const legItems: LegItem[] = territoryGroups.map((grp, ci) => ({
      ci,
      label: grp.label,
      color: CATEGORICAL[ci % CATEGORICAL.length],
      w: measureText(`■ ${grp.label}`, `bold ${LEG_FS}px sans-serif`)
    }))
    // Greedy line-wrap: pack items until the next one would exceed the pixel budget.
    const legWrap = (budgetPx: number): LegItem[][] => {
      const lines: LegItem[][] = []
      let cur: LegItem[] = []
      let w = 0
      for (const it of legItems) {
        if (cur.length && w + LEG_GAP + it.w > budgetPx) {
          lines.push(cur)
          cur = []
          w = 0
        }
        w += (cur.length ? LEG_GAP : 0) + it.w
        cur.push(it)
      }
      if (cur.length) lines.push(cur)
      return lines
    }
    // `active` is either a single module index (−1 = none) or a set of active modules (for a
    // multi-gene selection). Active modules bold at full colour; the rest fade when anything is active.
    const legRender = (active: number | Set<number>, lines: LegItem[][]): string => {
      const set =
        typeof active === 'number' ? (active < 0 ? null : new Set([active])) : active.size ? active : null
      return lines
        .map((line) =>
          line
            .map((it) => {
              const on = set?.has(it.ci) ?? false
              const col = !set || on ? it.color : hexA(it.color, 0.3)
              return `<span style="color:${col}">■ ${on ? `<b>${it.label}</b>` : it.label}</span>`
            })
            .join('   ')
        )
        .join('<br>')
    }
    const legLines = legWrap(620) // conservative initial wrap; onGraphMount reflows to actual width
    const clusterLegend = territoryGroups.length
      ? [
          {
            x: 0.5,
            xref: 'paper',
            xanchor: 'center',
            y: 0,
            yref: 'paper',
            yanchor: 'top',
            yshift: -6,
            showarrow: false,
            text: legRender(-1, legLines),
            font: { size: LEG_FS },
            captureevents: false
          }
        ]
      : []

    const heading = title ?? ''
    const hidden = { ...axisBase(p), visible: false, showgrid: false, zeroline: false }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      margin: { l: 6, r: 60, t: heading ? 30 : 10, b: legLines.length ? 12 + legLines.length * 15 : 10 },
      xaxis: hidden,
      yaxis: { ...hidden, scaleanchor: 'x', scaleratio: 1 },
      annotations: clusterLegend
    }
    // Data for the imperative neighbour-highlight on hover (see onGraphMount). The node trace is last;
    // edge traces sit between the territory traces and it.
    const adj: number[][] = vis.map(() => [])
    eIdx.forEach(([a, b]) => {
      adj[a].push(b)
      adj[b].push(a)
    })
    const indexByFocus = new Map<string, number>()
    focusId.forEach((f, i) => {
      if (!indexByFocus.has(f)) indexByFocus.set(f, i)
    })
    const hover = {
      nodeIdx: territoryTraces.length + edgeTraces.length,
      edgeIdxs: edgeTraces.map((_, i) => territoryTraces.length + i),
      edgeBuckets,
      adj,
      x: pos.x,
      y: pos.y,
      color: vis.map((g) => g.log2FC),
      size: vis.map((_, i) => sizeOf(degree[i])),
      colorscale: [
        [0, EFFECT_COLOR.down],
        [0.5, EFFECT_COLOR.none],
        [1, EFFECT_COLOR.up]
      ] as [number, string][],
      cmin: -maxAbs,
      cmax: maxAbs,
      hi: p.textMuted,
      focusId,
      indexByFocus,
      nodeOrder,
      moduleByNode,
      legItems,
      legWrap,
      legRender,
      legendIdx: territoryGroups.length ? 0 : -1
    }
    return {
      data: [...territoryTraces, ...edgeTraces, nodeTrace],
      layout: lay,
      nConnected: vis.length,
      labels,
      labelColor: p.textMuted,
      hover
    }
  }, [net, mode, title, genes, annotationMap])

  // Hover a node → highlight it + its neighbours + the connecting edges. Done imperatively (restyle
  // + overlay traces) so it never re-renders/resets the pan-zoom. Dims the base nodes/edges and draws
  // the incident edges and the node's closed neighbourhood on top.
  const onGraphMount = useCallback(
    (el: PlotlyGraphDiv) => {
      if (!hover) return
      const h = hover
      const P = Plotly as unknown as {
        restyle: (el: PlotlyGraphDiv, u: Record<string, unknown>, idx?: number[]) => Promise<unknown>
        addTraces: (el: PlotlyGraphDiv, t: unknown[]) => Promise<unknown>
        deleteTraces: (el: PlotlyGraphDiv, idx: number[]) => Promise<unknown>
      }
      const clearOverlay = (): void => {
        const live = (el as unknown as { data?: { __oeHoverOverlay?: boolean }[] }).data ?? []
        const idxs: number[] = []
        live.forEach((t, i) => {
          if (t?.__oeHoverOverlay) idxs.push(i)
        })
        if (idxs.length) {
          try {
            void P.deleteTraces(el, idxs)
          } catch {
            /* cosmetic */
          }
        }
      }
      const dim = (on: boolean): void => {
        try {
          void P.restyle(el, { opacity: on ? NODE_DIM_OPACITY : 1 }, [h.nodeIdx])
          if (h.edgeIdxs.length)
            void P.restyle(el, { opacity: on ? EDGE_DIM_OPACITY : EDGE_OPACITY }, h.edgeIdxs)
        } catch {
          /* cosmetic */
        }
      }
      // Pixels-per-data-unit → data-units-per-pixel (0 until the plot has a computed scale). x and y
      // share it (scaleanchor + scaleratio 1), so the x-axis slope covers both.
      const pxPerData = (): number => {
        const ax = (el as unknown as { _fullLayout?: { xaxis?: { _m?: number } } })._fullLayout?.xaxis
        const m = Math.abs(ax?._m ?? 0)
        return m > 0 ? 1 / m : 0
      }
      // Trim an edge back at each end by that node's radius (converted to data units), so the line
      // stops at the node rim instead of crossing through the transparent fills. Null when the two
      // nodes overlap (no visible edge between them).
      const trimSeg = (
        a: number,
        b: number,
        pxToData: number
      ): [number, number, number, number] | null => {
        const ax = h.x[a]
        const ay = h.y[a]
        const bx = h.x[b]
        const by = h.y[b]
        const dx = bx - ax
        const dy = by - ay
        const d = Math.hypot(dx, dy)
        if (!(d > 0)) return null
        const ux = dx / d
        const uy = dy / d
        const rA = (h.size[a] / 2 + NODE_INSET) * pxToData
        const rB = (h.size[b] / 2 + NODE_INSET) * pxToData
        if (rA + rB >= d) return null
        return [ax + ux * rA, ay + uy * rA, bx - ux * rB, by - uy * rB]
      }
      // Re-lay the base edge traces with each segment trimmed to the node radius at the live scale.
      const trimEdges = (): void => {
        const pd = pxPerData()
        if (!pd) return
        h.edgeIdxs.forEach((ti, bi) => {
          const xs: (number | null)[] = []
          const ys: (number | null)[] = []
          for (const [a, b] of h.edgeBuckets[bi] ?? []) {
            const s = trimSeg(a, b, pd)
            if (s) {
              xs.push(s[0], s[2], null)
              ys.push(s[1], s[3], null)
            } else {
              xs.push(null)
              ys.push(null)
            }
          }
          try {
            void P.restyle(el, { x: [xs], y: [ys] }, [ti])
          } catch {
            /* cosmetic */
          }
        })
      }
      const relayout = (u: Record<string, unknown>): void => {
        try {
          void (P as unknown as {
            relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
          }).relayout(el, u)
        } catch {
          /* cosmetic */
        }
      }
      // Reflow the legend to the LIVE plot width so items never crop against a narrow tile's edge.
      // The legend is centred on the plot area (l=6 margin), so its safe span is ~the plot width;
      // pad in a little. Also grow the bottom margin to fit however many lines the reflow produced.
      let legLinesLive = h.legWrap(620)
      const reflowLegend = (): void => {
        if (h.legendIdx < 0) return
        const size = (el as unknown as { _fullLayout?: { _size?: { w: number } } })._fullLayout?._size
        if (!size || size.w <= 0) return
        legLinesLive = h.legWrap(Math.max(120, size.w - 8))
        relayout({
          [`annotations[${h.legendIdx}].text`]: h.legRender(-1, legLinesLive),
          'margin.b': 12 + legLinesLive.length * 15
        })
      }
      // Bold the given module(s) in the cluster legend (fade the rest); −1 / empty clears.
      const boldLegend = (active: number | Set<number>): void => {
        if (h.legendIdx < 0) return
        relayout({ [`annotations[${h.legendIdx}].text`]: h.legRender(active, legLinesLive) })
      }
      // Overlay a set of nodes (bright markers) + the given edge segments, over the dimmed base.
      // `focus` (optional) gets a heavier outline.
      const overlay = (idxs: number[], ex: (number | null)[], ey: (number | null)[], focus = -1): void => {
        clearOverlay()
        dim(true)
        try {
          void P.addTraces(el, [
            {
              __oeHoverOverlay: true,
              type: 'scatter',
              mode: 'lines',
              x: ex,
              y: ey,
              hoverinfo: 'skip',
              opacity: 0.55,
              line: { color: h.hi, width: 2 }
            },
            {
              __oeHoverOverlay: true,
              type: 'scatter',
              mode: 'markers',
              x: idxs.map((i) => h.x[i]),
              y: idxs.map((i) => h.y[i]),
              hoverinfo: 'skip',
              marker: {
                size: idxs.map((i) => h.size[i]),
                color: idxs.map((i) => h.color[i]),
                colorscale: h.colorscale,
                cmid: 0,
                cmin: h.cmin,
                cmax: h.cmax,
                // When one node is the focus (a hover), fade its neighbours so it reads as the centre;
                // for a selection with no single focus, keep every highlighted node at full strength.
                opacity: idxs.map((i) => (focus < 0 || i === focus ? 1 : NEIGHBOUR_OPACITY)),
                line: { width: idxs.map((i) => (i === focus ? 2.4 : 1.4)), color: '#000000' }
              }
            }
          ])
        } catch {
          /* cosmetic */
        }
      }
      // Highlight the given nodes: their closed neighbourhoods + incident edges, bolding every
      // involved module. `focus` (the hovered node, if any) gets the heavier outline.
      const highlightNodes = (ks: number[], focus: number): void => {
        const nb = new Set<number>(ks)
        const ex: (number | null)[] = []
        const ey: (number | null)[] = []
        const pd = pxPerData()
        for (const k of ks) {
          for (const j of h.adj[k] ?? []) {
            nb.add(j)
            const s = pd ? trimSeg(k, j, pd) : null
            if (s) {
              ex.push(s[0], s[2], null)
              ey.push(s[1], s[3], null)
            } else {
              ex.push(h.x[k], h.x[j], null)
              ey.push(h.y[k], h.y[j], null)
            }
          }
        }
        overlay([...nb], ex, ey, focus)
        const mods = new Set<number>()
        for (const k of ks) {
          const m = h.moduleByNode[k] ?? -1
          if (m >= 0) mods.add(m)
        }
        boldLegend(mods)
      }
      const clear = (): void => {
        clearOverlay()
        dim(false)
        boldLegend(-1)
      }
      // React to the SHARED hover (from any view): highlight the node for the hovered gene.
      let last = ' '
      const applyFocus = (): void => {
        const { hoverId, pinnedIds } = useSelection.getState()
        const ids = new Set<string>(pinnedIds)
        if (hoverId) ids.add(hoverId)
        const sig = [...ids].sort().join('|')
        if (sig === last) return
        last = sig
        const idxs = [...ids]
          .map((id) => h.indexByFocus.get(id))
          .filter((i): i is number => i != null)
        if (idxs.length === 0) return clear()
        const focus = hoverId != null ? (h.indexByFocus.get(hoverId) ?? -1) : -1
        highlightNodes(idxs, focus)
      }
      reflowLegend()
      trimEdges()
      applyFocus()
      const unsub = useSelection.subscribe(applyFocus)
      // Re-trim the edges to the node radius whenever the axis scale changes — zoom/pan (relayout)
      // or a tile resize (Plotly.Plots.resize doesn't re-run this mount, so observe directly).
      let trimRaf = 0
      const scheduleTrim = (): void => {
        cancelAnimationFrame(trimRaf)
        trimRaf = requestAnimationFrame(trimEdges)
      }
      const ro =
        typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleTrim) : null
      ro?.observe(el as unknown as Element)
      // Broadcast this network's node hover to the shared store (round-trips to applyFocus above).
      const onHover = (e: { points?: { curveNumber?: number; pointNumber?: number }[] }): void => {
        const pt = e.points?.[0]
        if (!pt || pt.curveNumber !== h.nodeIdx || pt.pointNumber == null) return
        const k = h.nodeOrder[pt.pointNumber] // trace point → logical node index
        if (k != null) useSelection.getState().setHover(h.focusId[k])
      }
      const onUnhover = (): void => useSelection.getState().clearHover()
      const ev = el as unknown as {
        on: (e: string, cb: (...a: unknown[]) => void) => void
        removeListener?: (e: string, cb: (...a: unknown[]) => void) => void
      }
      const onRelayout = (ed: Record<string, unknown>): void => {
        // Only the range keys (zoom/pan/autorange) change the scale — ignore our own cosmetic writes.
        if (Object.keys(ed ?? {}).some((k) => k.includes('range'))) scheduleTrim()
      }
      ev.on('plotly_hover', onHover as (...a: unknown[]) => void)
      ev.on('plotly_unhover', onUnhover)
      ev.on('plotly_relayout', onRelayout as (...a: unknown[]) => void)
      return () => {
        unsub()
        clear()
        cancelAnimationFrame(trimRaf)
        ro?.disconnect()
        ev.removeListener?.('plotly_hover', onHover as (...a: unknown[]) => void)
        ev.removeListener?.('plotly_unhover', onUnhover)
        ev.removeListener?.('plotly_relayout', onRelayout as (...a: unknown[]) => void)
      }
    },
    [hover]
  )

  if (genes.length < 2) return <Center>Need at least 2 significant genes for a network.</Center>
  if (loading && net == null) return <Center>Reading STRING data…</Center>
  if (error === 'NO_LOCAL_DATA')
    return (
      <Center>
        No local STRING data for this organism. In the interactive import, tick <b>STRING</b> in the
        Metadata fetch to download it, then re-run Standardize and Compare.
      </Center>
    )
  if (error && (net == null || net.nodes.length === 0)) return <Center>{error}</Center>
  if (net != null && nConnected === 0)
    return (
      <Center>No interacting genes at this confidence — lower the confidence or raise max genes.</Center>
    )

  return (
    <PlotlyChart
      data={data}
      layout={layout}
      labels={labels}
      labelColor={labelColor}
      onGraphMount={onGraphMount}
    />
  )
}

/** Small centered message, matching the dashboard's empty-state look. */
function Center({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--text-muted)'
      }}
    >
      {children}
    </div>
  )
}

/** Deterministic PRNG (mulberry32) so a network's layout is stable across re-renders. */
function rng32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Data-space gap between neighbouring nodes (uniform post-layout scale). */
const NODE_GAP = 0.5

/** Layout dials for the force sim. After the median-nearest-neighbour rescale these act on the
 *  RATIO of intra- to inter-cluster distance, so they behave like:
 *   - TIGHTNESS: edge-attraction strength — higher packs each cluster tighter (and pulls linked
 *     clusters closer). 1 = neutral.
 *   - SPARSENESS: node-repulsion strength — higher pushes nodes (and clusters) further apart. 1 = neutral. */
const TIGHTNESS = 0.1
const SPARSENESS = 0.1

/** Centre points on the origin and scale so their median nearest-neighbour distance == NODE_GAP
 *  (consistent node spacing). Mutates the arrays in place. */
function scaleToGap(x: number[], y: number[]): void {
  const n = x.length
  if (n === 0) return
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    cx += x[i]
    cy += y[i]
  }
  cx /= n
  cy /= n
  for (let i = 0; i < n; i++) {
    x[i] -= cx
    y[i] -= cy
  }
  const nn: number[] = []
  for (let i = 0; i < n; i++) {
    let best = Infinity
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const d = Math.hypot(x[i] - x[j], y[i] - y[j])
      if (d < best) best = d
    }
    if (Number.isFinite(best)) nn.push(best)
  }
  const sorted = nn.slice().sort((a, b) => a - b)
  const medNN = sorted.length ? sorted[sorted.length >> 1] : 1
  const scale = medNN > 1e-6 ? NODE_GAP / medNN : 1
  for (let i = 0; i < n; i++) {
    x[i] *= scale
    y[i] *= scale
  }
}

/**
 * Strength-mode layout for the (already singleton-free) node set: ONE global Fruchterman–Reingold
 * over ALL edges, so every edge (weak inter-cluster bridges included) pulls its endpoints together
 * and connected clusters stay adjacent with no overstretched links.
 */
function layoutNetwork(n: number, edges: [number, number][], seed: number): { x: number[]; y: number[] } {
  if (n === 0) return { x: [], y: [] }
  const c = fruchtermanReingold(n, edges, seed)
  const x = c.x.slice()
  const y = c.y.slice()
  scaleToGap(x, y)
  return { x, y }
}

/**
 * Markov Clustering (MCL) on a weighted graph — the algorithm STRING uses to find interaction
 * modules. Repeatedly expands (matrix square) and inflates (element-wise power + column renormalise)
 * a column-stochastic matrix until it converges to an idempotent one whose non-zero pattern's weak
 * components are the clusters. Self-loops are added so every node attracts itself. Small n only.
 * Returns a cluster id per node.
 */
function mclClusters(n: number, edges: { a: number; b: number; w: number }[], inflation = 2): number[] {
  if (n === 0) return []
  let M = Array.from({ length: n }, () => new Float64Array(n))
  for (const { a, b, w } of edges) {
    M[a][b] = w
    M[b][a] = w
  }
  for (let i = 0; i < n; i++) M[i][i] = 1 // self-loops
  const normCols = (m: Float64Array[]): void => {
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let i = 0; i < n; i++) s += m[i][j]
      if (s > 0) for (let i = 0; i < n; i++) m[i][j] /= s
    }
  }
  normCols(M)
  for (let iter = 0; iter < 60; iter++) {
    // Expand: M·M.
    const E = Array.from({ length: n }, () => new Float64Array(n))
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        const v = M[i][k]
        if (v === 0) continue
        for (let j = 0; j < n; j++) E[i][j] += v * M[k][j]
      }
    // Inflate: element-wise power, then renormalise columns.
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) E[i][j] = Math.pow(E[i][j], inflation)
    normCols(E)
    // Convergence: Frobenius change.
    let diff = 0
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) diff += Math.abs(E[i][j] - M[i][j])
    M = E
    if (diff < 1e-4) break
  }
  // Clusters = weak components of the converged matrix's non-zero pattern.
  const adj: number[][] = Array.from({ length: n }, () => [])
  const T = 1e-3
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i !== j && M[i][j] > T) {
        adj[i].push(j)
        adj[j].push(i)
      }
  const cid = new Array<number>(n).fill(-1)
  let c = 0
  for (let s = 0; s < n; s++) {
    if (cid[s] !== -1) continue
    const st = [s]
    cid[s] = c
    while (st.length) {
      const u = st.pop()!
      for (const v of adj[u])
        if (cid[v] === -1) {
          cid[v] = c
          st.push(v)
        }
    }
    c++
  }
  return cid
}

/** Convex hull (Andrew's monotone chain), returned counter-clockwise. Points ≤2 pass through. */
function convexHull(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: number[], a: number[], b: number[]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/**
 * Rounded outward offset of a convex hull by `R` — the Minkowski sum of the (CCW) hull with a disk
 * of radius R. Every vertex becomes an arc of radius R spanning its exterior angle, joined by
 * straight sides offset R outward. Handles degenerate hulls: 1 point → circle, 2 points → capsule,
 * so tiny/near-collinear clusters still read as a rounded blob covering their nodes. Closed ring.
 */
function offsetHull(hull: [number, number][], R: number, steps = 6): [number, number][] {
  const n = hull.length
  if (n === 0) return []
  if (n === 1) {
    const [cx, cy] = hull[0]
    const out: [number, number][] = []
    const m = steps * 4
    for (let i = 0; i <= m; i++) {
      const a = (i / m) * 2 * Math.PI
      out.push([cx + R * Math.cos(a), cy + R * Math.sin(a)])
    }
    return out
  }
  // Outward normal of edge i (v[i]→v[i+1]); for a CCW hull that's the edge dir rotated −90°.
  const norm = (i: number): [number, number] => {
    const a = hull[i]
    const b = hull[(i + 1) % n]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const d = Math.hypot(dx, dy) || 1e-6
    return [dy / d, -dx / d]
  }
  const out: [number, number][] = []
  for (let i = 0; i < n; i++) {
    const nPrev = norm((i - 1 + n) % n) // edge into vertex i
    const nCur = norm(i) // edge out of vertex i
    const a0 = Math.atan2(nPrev[1], nPrev[0])
    let a1 = Math.atan2(nCur[1], nCur[0])
    while (a1 < a0) a1 += 2 * Math.PI // sweep CCW (outward) from the incoming to the outgoing normal
    const span = a1 - a0
    const segs = Math.max(1, Math.ceil((span / (Math.PI / 2)) * steps))
    const [vx, vy] = hull[i]
    for (let s = 0; s <= segs; s++) {
      const a = a0 + (span * s) / segs
      out.push([vx + R * Math.cos(a), vy + R * Math.sin(a)])
    }
  }
  if (out.length) out.push(out[0])
  return out
}

/** `#rrggbb` → `rgba(r,g,b,a)`. */
function hexA(hex: string, a: number): string {
  const m = hex.replace('#', '')
  return `rgba(${parseInt(m.slice(0, 2), 16)}, ${parseInt(m.slice(2, 4), 16)}, ${parseInt(m.slice(4, 6), 16)}, ${a})`
}

/** Fruchterman–Reingold force layout with a light pull toward the origin for compactness. Seeded +
 *  fixed iterations for a stable result. Run once over the whole graph. */
function fruchtermanReingold(
  n: number,
  edges: [number, number][],
  seed: number
): { x: number[]; y: number[] } {
  const rand = rng32(seed)
  const k = Math.sqrt(1 / Math.max(1, n))
  const x = Array.from({ length: n }, () => rand() - 0.5)
  const y = Array.from({ length: n }, () => rand() - 0.5)
  let temp = 0.1
  const iters = 500
  const gravity = 0.4
  for (let it = 0; it < iters; it++) {
    const dx = new Array(n).fill(0)
    const dy = new Array(n).fill(0)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const ddx = x[i] - x[j]
        const ddy = y[i] - y[j]
        const dist = Math.hypot(ddx, ddy) || 1e-4
        const rep = ((k * k) / dist) * SPARSENESS
        const ux = ddx / dist
        const uy = ddy / dist
        dx[i] += ux * rep
        dy[i] += uy * rep
        dx[j] -= ux * rep
        dy[j] -= uy * rep
      }
    for (const [a, b] of edges) {
      const ddx = x[a] - x[b]
      const ddy = y[a] - y[b]
      const dist = Math.hypot(ddx, ddy) || 1e-4
      const att = ((dist * dist) / k) * TIGHTNESS
      const ux = ddx / dist
      const uy = ddy / dist
      dx[a] -= ux * att
      dy[a] -= uy * att
      dx[b] += ux * att
      dy[b] += uy * att
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * gravity
      dy[i] -= y[i] * gravity
      const d = Math.hypot(dx[i], dy[i]) || 1e-4
      const lim = Math.min(d, temp)
      x[i] += (dx[i] / d) * lim
      y[i] += (dy[i] / d) * lim
    }
    temp *= 0.98
  }
  return { x, y }
}
