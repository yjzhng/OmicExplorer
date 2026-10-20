import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import Plotly, { type PlotlyGraphDiv } from 'plotly.js-dist-min'

import type { CompareResultRow } from '../engine'
import {
  buildStringModel,
  stringNetFromResponse,
  stringQueryGenes,
  stringSendLimit,
  type StringGene,
  stringLevelsFromScore,
  stringVariant,
  type StringAll,
  type StringLevel
} from './stringModel'
import { useElementSize } from '../dashboard/useElementSize'
import { fitText, flowChips, measureText } from './legendChips'
import { tooltip } from './condTooltip'
import { PlotlyChart, type PlotLabel } from './PlotlyChart'
import { useSelection } from './useSelection'
import { ROLE_DEFAULTS, paletteScale, type PaletteRef } from './palettes'
import { axisBase, CATEGORICAL, plotBase, PALETTES, UI } from './theme'
import { useUiTheme } from './useUiTheme'
import { AUTO } from './ColorPicker'
import { STRING_OUTLINE, type StringConfig } from '../graph/types'

/** A cluster's own id — its hull's, as the hover and a click's selection see it (apart from any
 *  gene's id). */
const MODULE_KEY = 'module:'
const moduleKey = (ci: number): string => `${MODULE_KEY}${ci}`

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
  /** per-node name, and the ink a lit node is named in */
  name: string[]
  ink: string
  /** shared-hover id per node (uniqID for query genes, node key for context) */
  focusId: string[]
  /** shared-hover id → its node indices (a protein group's members are several nodes), for
   *  reacting to hover/selection from other views */
  indexByFocus: Map<string, number[]>
  /** trace point order → node index (context nodes first, query last, so query draw on top) */
  nodeOrder: number[]
  /** module (cluster) index per node, −1 = none; for bolding the cluster legend on hover */
  moduleByNode: number[]
  /** the cluster legend's chips, in annotation order (annotation i = chips[i]) */
  chips: LegChip[]
  /** a chip's text: bold + full colour when active, faded when another is active */
  chipText: (c: LegChip, active: boolean, anyActive: boolean) => string
  /** the folded clusters (behind "+N more") */
  restCis: number[]
  /** "+N more" while `n` of its folded clusters are active (and its list is closed) */
  moreActiveText: (n: number) => string
}

/** One cluster-legend chip: its module (−1 for the "+N more" chip), colour and shown label. */
interface LegChip {
  ci: number
  color: string
  label: string
  /** "+N more": how many clusters it folds */
  n?: number
}

/** Prefix of a cluster chip's annotation name (the rest is its module index). */
const CHIP = 'oe-mod:'
/** The "+N more" chip's annotation name: it opens the folded clusters' list. */
const MORE = 'oe-mod-more'
/** The legend's text size, row height and its most rows: past them the rest fold into a "+N more"
 *  chip, so a long list can't push the network out of the tile. */
const LEG_FS = 10
const LEG_ROW = LEG_FS + 5
const LEG_MAX_ROWS = 3
const LEG_FONT = `bold ${LEG_FS}px system-ui, sans-serif`
/** Space between chips. */
const LEG_PAD = 16

/** Resting opacity of the edge layer — deliberately faint so the network reads as a light mesh
 *  behind the (fully opaque) nodes. */
const EDGE_OPACITY = 0.15
/** Edge opacity while a node is focused: the base edges recede behind the bright incident ones. */
const EDGE_DIM_OPACITY = 0.05
/** Base-node opacity while a node is focused, so the rest recede. */
const NODE_DIM_OPACITY = 0.12
/** Extra px added to a node's radius when trimming edges back, so the line clears the outline. */
const NODE_INSET = 1

/**
 * STRING PPI network for the top differential genes, laid out force-directed and drawn as nodes
 * (log₂FC colour, degree size) over confidence-scored edges. Territories come from Markov clustering
 * of the interactions. Optionally pulls in first-shell interactors (proteins that connect to the
 * query set) as context; query genes get a black outline, interactors a background one (both
 * settable — `outlines`).
 * All data is read locally from the cached organism files (fetched in the import).
 */
export function StringView({
  rows,
  displayMap,
  annotationMap,
  all,
  level,
  maxGenes,
  capOptions,
  addInteractors = false,
  title,
  onLevels,
  palette,
  outlines
}: {
  rows: CompareResultRow[]
  displayMap?: Record<string, string>
  annotationMap?: Record<string, Record<string, string>>
  /** this facet's network for every setting, from the plot's run (graph/plotRun.ts); undefined
   *  when the run read none for it */
  all: StringAll | undefined
  /** the confidence level drawn */
  level: StringLevel
  maxGenes: number
  /** the gene caps the run covered (its result's caps) — switching between them only
   *  re-renders; unset = just `maxGenes` */
  capOptions?: number[]
  /** also pull in first-shell interactors of the query set; they count toward `maxGenes` */
  addInteractors?: boolean
  title?: string
  /** report the confidence levels at which this setting has any network (null = unknown, until
   *  the read is back), so the tile can grey out the empty ones and resolve its "auto" level.
   *  Omitted (e.g. export) = not reported. */
  onLevels?: (levels: Set<StringLevel> | null) => void
  /** the fold-change palette the nodes are coloured on (the plot's own, else the global one) */
  palette?: PaletteRef
  /** the nodes' outline widths and colours (the plot's config); unset = the defaults */
  outlines?: Pick<
    StringConfig,
    'queryOutline' | 'queryOutlineColor' | 'interactorOutline' | 'interactorOutlineColor'
  >
}) {
  const mode = useUiTheme((s) => s.mode)
  // The tile's width, so the cluster legend flows into what fits — and re-flows as the tile is
  // resized either way. The plot area is the width less its margins (6 left, 60 right); 20px steps
  // so dragging an edge rebuilds only when the flow could change.
  const { ref: boxRef, width: boxW } = useElementSize<HTMLDivElement>()
  const legendBudget = boxW > 0 ? Math.max(160, Math.floor((boxW - 74) / 20) * 20) : 520
  // The "+N more" chip's open list: where it opens, and the legend it belongs to.
  const [moreOpen, setMoreOpen] = useState<{ at: DOMRect; of: unknown } | null>(null)
  // Whether that list is open, for the legend's imperative re-texting (a closed list folding an
  // active cluster says so on its chip), and the mount's re-text, to call when it opens or closes.
  const moreOpenRef = useRef(false)
  const legendRefresh = useRef<(() => void) | null>(null)
  // The nodes' log₂FC on the fold-change palette (the plot's own, else the global one).
  const fcScale = useMemo(() => paletteScale(palette ?? ROLE_DEFAULTS.fcObject), [palette])

  // The caps one read covers (always including the one drawn), and the widest query among them —
  // significant genes, one per feature (max |log₂FC|), strongest first. A smaller cap's query is a
  // prefix of it. (A cap sends a multiple of itself — stringSendLimit — since only connected genes
  // are drawn.)
  const capKey = (capOptions ?? []).join(',')
  const caps = useMemo(
    () =>
      [...new Set([...(capKey ? capKey.split(',').map(Number) : []), maxGenes])].sort(
        (a, b) => a - b
      ),
    [capKey, maxGenes]
  )
  const widest = useMemo<StringGene[]>(
    () => stringQueryGenes(rows, displayMap, annotationMap, stringSendLimit(caps[caps.length - 1])),
    [rows, displayMap, annotationMap, caps]
  )
  // This setting's query: the drawn cap's prefix of the widest.
  const genes = useMemo(
    () => widest.slice(0, Math.max(2, stringSendLimit(maxGenes))),
    [widest, maxGenes]
  )

  // The setting drawn — and the best link score its kind of network draws from at any level
  // (query–query, or query–anything with interactors), which says the levels that have a network.
  const reply = useMemo(
    () => (all ? stringVariant(all, genes, caps, maxGenes, level, addInteractors) : null),
    [all, genes, caps, maxGenes, level, addInteractors]
  )
  const net = useMemo(() => (reply ? stringNetFromResponse(reply, genes) : null), [reply, genes])
  const best = reply ? ((addInteractors ? reply.maxLinkScore : reply.maxQueryScore) ?? null) : null

  // Which levels have a network: from the read's best score; none at all when there aren't 2
  // significant genes to make one (nothing is read); unknown until the read is back.
  const tooFew = genes.length < 2
  const levels = useMemo(
    () => (tooFew ? new Set<StringLevel>() : stringLevelsFromScore(best)),
    [tooFew, best]
  )
  useEffect(() => {
    onLevels?.(levels)
  }, [levels, onLevels])

  const qLine = outlines?.queryOutline ?? STRING_OUTLINE
  const qInk = outlines?.queryOutlineColor
  const iLine = outlines?.interactorOutline ?? STRING_OUTLINE
  const iInk = outlines?.interactorOutlineColor
  const { data, layout, nConnected, labels, labelColor, hover, moduleIds, more } = useMemo(() => {
    const p = PALETTES[mode]
    if (!net)
      return {
        data: [] as unknown[],
        layout: {} as Record<string, unknown>,
        nConnected: 0,
        labels: [] as PlotLabel[],
        labelColor: undefined as string | undefined,
        hover: undefined as HoverInfo | undefined,
        moduleIds: [] as string[][],
        more: { at: -1, items: [] as LegChip[] }
      }
    // The network's model — what's drawn, its modules and their labels — shared with the
    // background export of the tile's tables (stringModel.ts).
    const {
      vis,
      degree,
      eIdx,
      eScore,
      territoryGroups,
      moduleByNode,
      uniqByStringId,
      uniqByStringIdAll
    } = buildStringModel(net, genes, annotationMap, maxGenes)
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
          // Hovered as a whole, with no tooltip: its module's id (moduleKey) is the hover, which
          // lights the whole cluster (indexByFocus) and its chip; a click selects its genes, as
          // the chip does (PlotlyChart's pinIdsOf).
          hoveron: 'fills',
          hoverinfo: 'none',
          __oeId: moduleKey(ci)
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
      (n) =>
        (n.isQuery ? uniqByStringId.get(n.key) : undefined) ?? uniqByStringIdAll.get(n.key) ?? n.key
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
      text: nodeOrder.map((i) =>
        tooltip(
          {
            title: vis[i].name,
            values: [
              ['log₂FC', vis[i].isQuery ? vis[i].log2FC.toFixed(2) : '—'],
              ['links', degree[i]]
            ]
          },
          p.textMuted
        )
      ),
      hovertemplate: '%{text}<extra></extra>',
      marker: {
        size: nodeOrder.map((i) => sizeOf(degree[i])),
        // Fully opaque nodes at rest. Set explicitly because PlotlyChart's shared highlight layer
        // snapshots an unset marker.opacity as 0.85 (its dim/restore baseline), which would otherwise
        // leave the resting nodes faintly translucent.
        opacity: 1,
        color: nodeOrder.map((i) => vis[i].log2FC),
        colorscale: fcScale,
        cmid: 0,
        cmin: -maxAbs,
        cmax: maxAbs,
        // Differential (query) genes get a black outline; context genes a background one — unless
        // the config sets either.
        line: {
          width: nodeOrder.map((i) => (vis[i].isQuery ? qLine : iLine)),
          color: nodeOrder.map((i) =>
            vis[i].isQuery
              ? qInk && qInk !== AUTO
                ? qInk
                : '#000000'
              : iInk && iInk !== AUTO
                ? iInk
                : p.bg
          )
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
        // the node's shared id (as its hover and the highlight key it) so its label stays, bold,
        // while it's lit and the others hide (labelsInPlace)
        id: focusId[i],
        // marker radius (size is a diameter) + half the stroke, so the label clears large nodes.
        radius: sizeOf(degree[i]) / 2 + qLine / 2,
        // tight gap so the label hugs the node.
        margin: 1
      }))

    // Cluster legend (bottom, left-aligned): one chip per module — its colour ■ and ORA pathway
    // label — flowed into rows that fit the plot's width (legendBudget), at most LEG_MAX_ROWS of
    // them: a label longer than a row is shortened (the full one on hover), and modules past the
    // last row fold into a "+N more" chip (listing them on hover). Each slot is sized for the BOLD
    // text, so bolding one on hover never moves another. A chip is clickable: it selects its
    // module's genes (onAnnotationClick), as a volcano legend click selects its group's.
    const allChips: LegChip[] = territoryGroups.map((grp, ci) => ({
      ci,
      color: CATEGORICAL[ci % CATEGORICAL.length],
      label: fitText(grp.label, legendBudget - 20, LEG_FONT)
    }))
    // "… n modules" while folded clusters are active (moreActiveText).
    const moreActive = (n: number): string => `… ${n} module${n === 1 ? '' : 's'}`
    // A chip's slot, for its bold text — "+N more"'s for the wider of its two texts, so the swap
    // never moves a chip beside it.
    const slot = (c: LegChip): number =>
      Math.ceil(
        c.ci < 0
          ? Math.max(measureText(c.label, LEG_FONT), measureText(moreActive(c.n ?? 0), LEG_FONT))
          : measureText(`■ ${c.label}`, LEG_FONT)
      ) + LEG_PAD
    const flowOf = (cs: LegChip[]) =>
      flowChips(
        cs.map((c, k) => ({ c: String(k), width: slot(c) })),
        legendBudget
      )
    let chips = allChips
    let flow = flowOf(chips)
    if (flow.lines > LEG_MAX_ROWS) {
      // Keep the chips that fit the rows, then drop from the end until "+N more" fits too.
      let keep = flow.at.filter((a) => a.line < LEG_MAX_ROWS).length
      for (; keep >= 0; keep--) {
        const more: LegChip = {
          ci: -1,
          color: p.textMuted,
          label: `+${allChips.length - keep} more`,
          n: allChips.length - keep
        }
        const f = flowOf([...allChips.slice(0, keep), more])
        if (f.lines <= LEG_MAX_ROWS) {
          chips = [...allChips.slice(0, keep), more]
          flow = f
          break
        }
      }
    }
    const rest = allChips.slice(chips.filter((c) => c.ci >= 0).length)
    const chipText = (c: LegChip, active: boolean, anyActive: boolean): string => {
      const col = anyActive && !active ? hexA(c.color, 0.3) : c.color
      if (c.ci < 0) return `<span style="color:${col}">${c.label}</span>`
      return `<span style="color:${col}">■ ${active ? `<b>${c.label}</b>` : c.label}</span>`
    }
    const clusterLegend = flow.at.map(({ c, x, line }) => {
      const chip = chips[Number(c)]
      const full = chip.ci >= 0 ? territoryGroups[chip.ci].label : ''
      return {
        x: 0,
        xref: 'paper',
        xanchor: 'left',
        xshift: x,
        y: 0,
        yref: 'paper',
        yanchor: 'top',
        yshift: -6 - line * LEG_ROW,
        showarrow: false,
        text: chipText(chip, false, false),
        font: { size: LEG_FS },
        // the full label when shortened
        ...(chip.ci >= 0 && full !== chip.label ? { hovertext: full } : {}),
        // a module chip: click to select its genes; "+N more": click to list the folded ones
        name: chip.ci >= 0 ? `${CHIP}${chip.ci}` : MORE,
        captureevents: true
      }
    })
    // The folded clusters, for the "+N more" list: each with its full label, and the chip's
    // annotation index (where the list opens under).
    const more = {
      at: chips.findIndex((c) => c.ci < 0),
      items: rest.map((c) => ({ ...c, label: territoryGroups[c.ci].label }))
    }
    // Each module's genes (their shared ids), for a chip's click.
    const moduleIds = territoryGroups.map((grp) => [...new Set(grp.members.map((i) => focusId[i]))])

    const heading = title ?? ''
    const hidden = { ...axisBase(p), visible: false, showgrid: false, zeroline: false }
    const lay: Record<string, unknown> = {
      ...plotBase(p),
      showlegend: false,
      title: heading ? { text: heading, font: { size: 13 } } : undefined,
      margin: {
        l: 6,
        r: 60,
        t: heading ? 30 : 10,
        b: flow.lines ? 12 + flow.lines * LEG_ROW : 10
      },
      xaxis: hidden,
      yaxis: { ...hidden, scaleanchor: 'x', scaleratio: 1 },
      // A node answers the cursor only on (or just off) its own marker: Plotly's default reach
      // (20px) let the nearest node take the hover — and the click — anywhere in a cluster, so its
      // hull (hovered as a whole) rarely could.
      hoverdistance: 2,
      annotations: clusterLegend
    }
    // Data for the imperative neighbour-highlight on hover (see onGraphMount). The node trace is last;
    // edge traces sit between the territory traces and it.
    const adj: number[][] = vis.map(() => [])
    eIdx.forEach(([a, b]) => {
      adj[a].push(b)
      adj[b].push(a)
    })
    // Every node per shared id: a protein group's members are separate nodes but one gene, so they
    // highlight together.
    const indexByFocus = new Map<string, number[]>()
    focusId.forEach((f, i) => {
      const arr = indexByFocus.get(f)
      if (arr) arr.push(i)
      else indexByFocus.set(f, [i])
    })
    // …and a module's own id (its hull hovered) → every node of it
    territoryGroups.forEach((grp, ci) => indexByFocus.set(moduleKey(ci), grp.members))
    const hover = {
      nodeIdx: territoryTraces.length + edgeTraces.length,
      edgeIdxs: edgeTraces.map((_, i) => territoryTraces.length + i),
      edgeBuckets,
      adj,
      x: pos.x,
      y: pos.y,
      color: vis.map((g) => g.log2FC),
      size: vis.map((_, i) => sizeOf(degree[i])),
      colorscale: fcScale,
      cmin: -maxAbs,
      cmax: maxAbs,
      hi: p.textMuted,
      // each node's name, and the ink it's named in while lit
      name: vis.map((g) => g.name),
      ink: p.text,
      focusId,
      indexByFocus,
      nodeOrder,
      moduleByNode,
      chips,
      chipText,
      restCis: rest.map((c) => c.ci),
      moreActiveText: (n: number) => `<span style="color:${p.text}"><b>${moreActive(n)}</b></span>`
    }
    return {
      data: [...territoryTraces, ...edgeTraces, nodeTrace],
      layout: lay,
      nConnected: vis.length,
      labels,
      labelColor: p.textMuted,
      hover,
      moduleIds,
      more
    }
  }, [
    net,
    mode,
    title,
    genes,
    annotationMap,
    maxGenes,
    fcScale,
    legendBudget,
    qLine,
    qInk,
    iLine,
    iInk
  ])

  // Hover a node → highlight it + its neighbours + the connecting edges. Done imperatively (restyle
  // + overlay traces) so it never re-renders/resets the pan-zoom. Dims the base nodes/edges and draws
  // the incident edges and the node's closed neighbourhood on top.
  const onGraphMount = useCallback(
    (el: PlotlyGraphDiv) => {
      if (!hover) return
      const h = hover
      const P = Plotly as unknown as {
        restyle: (
          el: PlotlyGraphDiv,
          u: Record<string, unknown>,
          idx?: number[]
        ) => Promise<unknown>
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
        const ax = (el as unknown as { _fullLayout?: { xaxis?: { _m?: number } } })._fullLayout
          ?.xaxis
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
      // ONE restyle over every edge trace: each restyle of x/y redraws the whole figure, and a
      // network has up to 15 edge traces (one per line width).
      const trimEdges = (): void => {
        const pd = pxPerData()
        if (!pd || h.edgeIdxs.length === 0) return
        const allX: (number | null)[][] = []
        const allY: (number | null)[][] = []
        h.edgeIdxs.forEach((_, bi) => {
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
          allX.push(xs)
          allY.push(ys)
        })
        try {
          void P.restyle(el, { x: allX, y: allY }, h.edgeIdxs)
        } catch {
          /* cosmetic */
        }
      }
      const relayout = (u: Record<string, unknown>): void => {
        try {
          void (
            P as unknown as {
              relayout: (el: PlotlyGraphDiv, u: Record<string, unknown>) => Promise<unknown>
            }
          ).relayout(el, u)
        } catch {
          /* cosmetic */
        }
      }
      // Bold the given module(s)' chips (fade the rest); −1 / empty clears. Each chip is its own
      // annotation, so only its text is rewritten — nothing moves.
      const boldLegend = (active: number | Set<number>): void => {
        if (!h.chips.length) return
        const set =
          typeof active === 'number'
            ? active < 0
              ? null
              : new Set([active])
            : active.size
              ? active
              : null
        const u: Record<string, unknown> = {}
        h.chips.forEach((c, k) => {
          // "+N more", list closed, folding active clusters → "… n modules", highlighted
          const nOn =
            c.ci < 0 && !moreOpenRef.current ? h.restCis.filter((ci) => set?.has(ci)).length : 0
          u[`annotations[${k}].text`] = nOn
            ? h.moreActiveText(nOn)
            : h.chipText(c, set?.has(c.ci) ?? false, !!set)
        })
        relayout(u)
      }
      // Overlay a set of nodes (bright markers, a 1px outline) + the given edge segments, over the
      // dimmed base.
      const overlay = (idxs: number[], ex: (number | null)[], ey: (number | null)[]): void => {
        clearOverlay()
        dim(true)
        // the nodes with a label placed (the shared layer's, tagged with the node's id)
        const anns = (el as unknown as { layout?: { annotations?: { __oeLabelId?: string }[] } })
          .layout?.annotations
        const labelled = new Set((anns ?? []).map((a) => a.__oeLabelId).filter(Boolean))
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
              // A lit node keeps its own label where it sits, bold (labelsInPlace); one with none
              // placed — an interactor, or a gene crowded out — is named here, over it.
              mode: 'markers+text',
              x: idxs.map((i) => h.x[i]),
              y: idxs.map((i) => h.y[i]),
              text: idxs.map((i) => (labelled.has(h.focusId[i]) ? '' : `<b>${h.name[i]}</b>`)),
              textposition: 'top center',
              textfont: { size: 10, color: h.ink, family: 'system-ui, sans-serif' },
              hoverinfo: 'skip',
              marker: {
                size: idxs.map((i) => h.size[i]),
                color: idxs.map((i) => h.color[i]),
                colorscale: h.colorscale,
                cmid: 0,
                cmin: h.cmin,
                cmax: h.cmax,
                opacity: 1,
                line: { width: 1, color: '#000000' }
              }
            }
          ])
        } catch {
          /* cosmetic */
        }
      }
      // Highlight the given nodes — only them, never their neighbours (a lit neighbour reads as
      // the gene itself) — and their edges, bolding every involved module. `spread` = the nodes
      // whose every edge lights (a
      // hovered or selected gene); the rest (a hovered GROUP's members — an enrichment term's
      // genes, a cluster) light just the links among them: all of theirs would light most of the
      // network.
      const highlightNodes = (ks: number[], spread: Set<number>): void => {
        const inSet = new Set<number>(ks)
        const ex: (number | null)[] = []
        const ey: (number | null)[] = []
        const pd = pxPerData()
        for (const k of ks) {
          for (const j of h.adj[k] ?? []) {
            if (!spread.has(k) && !inSet.has(j)) continue
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
        overlay([...inSet], ex, ey)
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
        const { hoverId, hoverMembers, pinnedIds } = useSelection.getState()
        const ids = new Set<string>(pinnedIds)
        if (hoverId) ids.add(hoverId)
        // a group hovered elsewhere (an enrichment term): its member genes, as hovered genes
        for (const g of hoverMembers) ids.add(g)
        const sig = [...ids].sort().join('|')
        if (sig === last) return
        last = sig
        const at = (id: string): number[] => h.indexByFocus.get(id) ?? []
        const pinIdx = [...pinnedIds].flatMap(at)
        const hovIdx = hoverId != null ? at(hoverId) : []
        const memIdx = hoverMembers.flatMap(at)
        const idxs = [...pinIdx, ...hovIdx, ...memIdx]
        if (idxs.length === 0) return clear()
        // A hovered group (its members carried with it, or a hull's own id) lights only itself; a
        // hovered or selected gene lights its neighbourhood as well.
        const group = hoverMembers.length > 0
        const spread = new Set([...pinIdx, ...(group ? [] : hovIdx)])
        highlightNodes(idxs, spread)
      }
      trimEdges()
      applyFocus()
      // the re-text the "+N more" list calls as it opens or closes
      legendRefresh.current = () => {
        last = ' '
        applyFocus()
      }
      const unsub = useSelection.subscribe(applyFocus)
      // Re-trim the edges to the node radius whenever the axis scale changes — zoom/pan (relayout)
      // or a tile resize (Plotly.Plots.resize doesn't re-run this mount, so observe directly).
      let trimRaf = 0
      const scheduleTrim = (): void => {
        cancelAnimationFrame(trimRaf)
        trimRaf = requestAnimationFrame(trimEdges)
      }
      // Only on a real size change: an observer reports once as soon as it starts observing, which
      // re-trimmed (a full redraw) right after the trim above.
      const box = el as unknown as Element
      let seen = `${box.clientWidth}x${box.clientHeight}`
      const ro =
        typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => {
              const now = `${box.clientWidth}x${box.clientHeight}`
              if (now === seen) return
              seen = now
              scheduleTrim()
            })
          : null
      ro?.observe(box)
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
        const keys = Object.keys(ed ?? {})
        // Only the range keys (zoom/pan/autorange) change the scale — ignore our own cosmetic writes.
        if (keys.some((k) => k.includes('range'))) scheduleTrim()
        // The labels were (re)placed: the lit nodes' names follow (a lit node whose label is gone
        // is named by the overlay, one that gained a label isn't).
        if (keys.includes('annotations')) {
          last = ' '
          applyFocus()
        }
      }
      ev.on('plotly_hover', onHover as (...a: unknown[]) => void)
      ev.on('plotly_unhover', onUnhover)
      ev.on('plotly_relayout', onRelayout as (...a: unknown[]) => void)
      return () => {
        legendRefresh.current = null
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

  // Open only for the legend it was opened from: a new network (another level, cap, facet) has
  // other chips, so its list starts closed.
  const moreAt = moreOpen && moreOpen.of === more ? moreOpen.at : null
  const moreIsOpen = moreAt != null
  useEffect(() => {
    moreOpenRef.current = moreIsOpen
    legendRefresh.current?.()
  }, [moreIsOpen])
  // the selection, for the "not in view" count (the plot's own highlight reads the store itself)
  const pinnedIds = useSelection((s) => s.pinnedIds)

  if (genes.length < 2) return <Center>Need at least 2 significant genes for a network.</Center>
  if (!all) return <Center>No network read for this facet — re-run the plot.</Center>
  // No network at any level (a query-only read at the lowest one found no interaction at all).
  if (net != null && levels != null && levels.size === 0)
    return (
      <Center>
        No network — the query genes have no STRING interactions, even at low confidence. Raise max
        genes or add interactors.
      </Center>
    )
  if (net != null && nConnected === 0)
    return (
      <Center>
        No interacting genes at this confidence — lower the confidence or raise max genes.
      </Center>
    )

  // A cluster chip selects its module's genes (pins them, as a volcano legend click does); again
  // clears them. "+N more" opens (or closes) the folded clusters' list, under the chip.
  const toggleModule = (ci: number): void => {
    const ids = moduleIds[ci]
    if (ids?.length) useSelection.getState().togglePins(ids)
  }
  // A hull's module id → its genes, which a click on the hull selects (PlotlyChart's pinIdsOf).
  const pinIdsOf = (id: string): string[] | null =>
    id.startsWith(MODULE_KEY) ? (moduleIds[Number(id.slice(MODULE_KEY.length))] ?? []) : null
  const onAnnotationClick = (name: string): void => {
    if (name === MORE) {
      const el = boxRef.current?.querySelector(`.annotation[data-index="${more.at}"]`)
      setMoreOpen(moreAt || !el ? null : { at: el.getBoundingClientRect(), of: more })
      return
    }
    if (name.startsWith(CHIP)) toggleModule(Number(name.slice(CHIP.length)))
  }

  // Selected genes this network doesn't draw (filtered out by the confidence or the node cap, or
  // not in it at all) — said top-right, so a selection that lights nothing here explains itself.
  const notInView = hover ? [...pinnedIds].filter((id) => !hover.indexByFocus.has(id)).length : 0

  return (
    // Measured (for the legend's flow width) and otherwise invisible — the chart fills it.
    <div ref={boxRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <PlotlyChart
        data={data}
        layout={layout}
        labels={labels}
        labelColor={labelColor}
        onGraphMount={onGraphMount}
        onAnnotationClick={onAnnotationClick}
        pinIdsOf={pinIdsOf}
        labelsInPlace
      />
      {notInView > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 10,
            pointerEvents: 'none',
            fontSize: 11,
            fontFamily: 'system-ui, sans-serif',
            color: UI.textMuted
          }}
        >
          {notInView}/{pinnedIds.size} selected not in view
        </div>
      )}
      {moreAt && more.items.length > 0 && (
        <MoreClusters
          anchor={moreAt}
          items={more.items}
          moduleIds={moduleIds}
          onToggle={toggleModule}
          onClose={() => setMoreOpen(null)}
        />
      )}
    </div>
  )
}

/** The "+N more" chip's list: the folded clusters, in the legend's own look — ■ in the cluster's
 *  colour, its label (in full here), bold while active as a chip is (its genes selected, or the
 *  hovered gene one of them; the rest fade), tinted under the pointer — each clickable as a chip
 *  is. Opens under the chip; Escape or a click outside closes it (a click on the chip itself is
 *  the chip's own toggle). */
function MoreClusters({
  anchor,
  items,
  moduleIds,
  onToggle,
  onClose
}: {
  anchor: DOMRect
  items: LegChip[]
  moduleIds: string[][]
  onToggle: (ci: number) => void
  onClose: () => void
}): ReactNode {
  const pinnedIds = useSelection((s) => s.pinnedIds)
  const hoverId = useSelection((s) => s.hoverId)
  // the entry under the pointer (its tint)
  const [under, setUnder] = useState(-1)
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-oe-more-list]') || t?.closest?.('.annotation')) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  // Active as a legend chip is: its genes selected, the hovered gene (in any view) one of them, or
  // its hull hovered.
  const active = (ci: number): boolean =>
    ((moduleIds[ci]?.length ?? 0) > 0 && moduleIds[ci].every((id) => pinnedIds.has(id))) ||
    (hoverId != null && (moduleIds[ci]?.includes(hoverId) ?? false)) ||
    hoverId === moduleKey(ci)
  // any cluster at all — a visible chip's too — fades the others, as on the plot
  const anyActive = moduleIds.some((_, ci) => active(ci))
  return createPortal(
    <div
      data-oe-more-list
      className="oe-menu-in"
      style={{
        position: 'fixed',
        left: anchor.left,
        top: anchor.bottom + 4,
        zIndex: 4000,
        maxWidth: 360,
        maxHeight: Math.max(120, window.innerHeight - anchor.bottom - 16),
        overflowY: 'auto',
        background: UI.panel,
        border: `1px solid ${UI.border}`,
        borderRadius: 8,
        boxShadow: '0 8px 30px rgba(0,0,0,0.55)',
        padding: '6px 4px',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {items.map((c) => {
        const on = active(c.ci)
        return (
          <button
            key={c.ci}
            onClick={() => onToggle(c.ci)}
            onMouseEnter={() => setUnder(c.ci)}
            onMouseLeave={() => setUnder((u) => (u === c.ci ? -1 : u))}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: LEG_FS,
              fontFamily: 'system-ui, sans-serif',
              fontWeight: on ? 700 : 400,
              // as the chips: full colour when active (or nothing is), faded when another is
              color: anyActive && !on ? hexA(c.color, 0.3) : c.color,
              background: under === c.ci ? UI.panelRaised : 'transparent',
              lineHeight: 1.35
            }}
          >
            ■ {c.label}
          </button>
        )
      })}
    </div>,
    document.body
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
function layoutNetwork(
  n: number,
  edges: [number, number][],
  seed: number
): { x: number[]; y: number[] } {
  if (n === 0) return { x: [], y: [] }
  const c = fruchtermanReingold(n, edges, seed)
  const x = c.x.slice()
  const y = c.y.slice()
  scaleToGap(x, y)
  return { x, y }
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
