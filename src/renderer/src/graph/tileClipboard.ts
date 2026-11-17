/** Copy / paste of canvas tiles, between workflows, windows and projects — through the system
 *  clipboard, as text (see the canvas's copy / paste handlers).
 *
 *  A copy is the selected tiles' configs and places, the links between them, the canvas groups
 *  wholly inside the selection (each tile's group, nested ones too) and the plot groups' results
 *  layouts. Never results: a pasted tile arrives not run, as the data it's pasted onto may differ.
 *  A link to a tile left out is dropped, as Duplicate drops them. Pure — no store, no DOM. */
import type { Edge } from '@xyflow/react'

import { childPanelId } from './groups'
import { frameTiles } from './frames'
import {
  isStep,
  type CanvasFrame,
  type GraphNode,
  type NodeConfig,
  type NodeKind,
  type PanelLayoutItem,
  type PlotChild,
  type PlotGroupConfig,
  type StepNode
} from './types'

/** Tells a copy of ours from any other text on the clipboard. */
export const CLIP_FORMAT = 'omicexplorer/tiles'

/** Where a workflow's files are (its data folder and own folder) — see store.locationOf. */
export interface ClipLocation {
  dir: string
  scope: { base: string; legacy: string }
}

export interface TileClip {
  format: typeof CLIP_FORMAT
  v: 1
  nodes: Array<{
    id: string
    kind: NodeKind
    config: NodeConfig
    position: { x: number; y: number }
  }>
  edges: Array<{
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
  frames: CanvasFrame[]
  /** results layouts, by the copied tile's id (a plot group's tab) */
  layouts: Record<string, PanelLayoutItem[]>
  /** the copied workflow's files — a Load tile's converted inputs are copied over from there */
  from: ClipLocation | null
  /** the workflow copied from: a paste back into it lands beside the originals */
  origin: string | null
}

/** Config fields naming another tile by id (a Contrast's inputs): remapped on paste, dropped when
 *  that tile wasn't copied (each falls back to the wiring). */
const ID_FIELDS = ['pairA', 'pairB', 'selectFrom'] as const

/** The copy of these tiles (any frame ids among `ids` are ignored — a group comes with its
 *  tiles); null when none of them is a tile. */
export function copyTiles(
  g: {
    nodes: GraphNode[]
    edges: Edge[]
    frames: CanvasFrame[]
    groupLayouts: Record<string, PanelLayoutItem[]>
  },
  ids: string[],
  from: ClipLocation | null,
  origin: string | null
): TileClip | null {
  const want = new Set(ids)
  const steps = g.nodes.filter((n): n is StepNode => isStep(n) && want.has(n.id))
  if (!steps.length) return null
  const on = new Set(steps.map((n) => n.id))
  // The groups whose every tile is copied, each with its members cut to what's copied.
  const whole = g.frames.filter((f) => {
    const tiles = frameTiles(g.frames, f.id)
    return tiles.length > 0 && tiles.every((t) => on.has(t))
  })
  const kept = new Set([...on, ...whole.map((f) => f.id)])
  const layouts: Record<string, PanelLayoutItem[]> = {}
  for (const n of steps) if (g.groupLayouts[n.id]) layouts[n.id] = g.groupLayouts[n.id]
  return {
    format: CLIP_FORMAT,
    v: 1,
    nodes: steps.map((n) => ({
      id: n.id,
      kind: n.data.kind,
      config: n.data.config,
      position: n.position
    })),
    edges: g.edges
      .filter((e) => on.has(e.source) && on.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      })),
    frames: whole.map((f) => ({ ...f, members: f.members.filter((m) => kept.has(m)) })),
    layouts,
    from,
    origin
  }
}

/** A copy of ours read back from clipboard text; null for anything else. */
export function parseClip(text: string | null | undefined): TileClip | null {
  if (!text || !text.includes(CLIP_FORMAT)) return null
  try {
    const c = JSON.parse(text) as TileClip
    return c?.format === CLIP_FORMAT && c.v === 1 && Array.isArray(c.nodes) && c.nodes.length
      ? c
      : null
  } catch {
    return null
  }
}

/** The copy's tiles, links, groups and layouts under fresh ids for the graph pasted into
 *  (`taken`: every id it has; `nextId`: its id counter), moved so their top-left corner is `at`.
 *  The tiles come selected and not run. */
export function pasteTiles(
  clip: TileClip,
  target: { taken: Set<string>; nextId: number },
  at: { x: number; y: number }
): {
  nodes: StepNode[]
  edges: Edge[]
  frames: CanvasFrame[]
  layouts: Record<string, PanelLayoutItem[]>
  /** copied id → its pasted id */
  ids: Map<string, string>
  nextId: number
} {
  let next = target.nextId
  const mint = (prefix: string): string => {
    let id = `${prefix}-${next++}`
    while (target.taken.has(id)) id = `${prefix}-${next++}`
    target.taken.add(id)
    return id
  }
  const ids = new Map<string, string>()
  for (const n of clip.nodes) ids.set(n.id, mint(n.kind))
  const x0 = Math.min(...clip.nodes.map((n) => n.position.x))
  const y0 = Math.min(...clip.nodes.map((n) => n.position.y))
  const layouts: Record<string, PanelLayoutItem[]> = {}
  const nodes = clip.nodes.map((n): StepNode => {
    const id = ids.get(n.id)!
    let config = structuredClone(n.config) as Record<string, unknown>
    for (const f of ID_FIELDS) {
      if (typeof config[f] !== 'string') continue
      const to = ids.get(config[f] as string)
      if (to) config[f] = to
      else delete config[f]
    }
    // A plot group's plots get fresh ids, as on Duplicate — and its layout's panels follow them.
    const panels = new Map<string, string>([[n.id, id]])
    if (n.kind === 'plotGroup') {
      const src = (config as unknown as PlotGroupConfig).children
      const children = src.map((c): PlotChild => ({
        id: mint('sub'),
        kind: c.kind,
        config: c.config
      }))
      config = { ...config, children }
      src.forEach((c, i) => panels.set(childPanelId(n.id, c.id), childPanelId(id, children[i].id)))
    }
    const layout = clip.layouts[n.id]
    if (layout) layouts[id] = layout.map((it) => ({ ...it, i: panels.get(it.i) ?? it.i }))
    return {
      id,
      type: 'step',
      position: { x: at.x + n.position.x - x0, y: at.y + n.position.y - y0 },
      selected: true,
      data: { kind: n.kind, config: config as NodeConfig, status: 'idle' }
    }
  })
  const edges: Edge[] = clip.edges.flatMap((e) => {
    const source = ids.get(e.source)
    const target = ids.get(e.target)
    return source && target
      ? [
          {
            id: `e-${source}-${target}`,
            source,
            target,
            sourceHandle: e.sourceHandle ?? null,
            targetHandle: e.targetHandle ?? null
          }
        ]
      : []
  })
  for (const f of clip.frames) ids.set(f.id, mint('frame'))
  const frames = clip.frames.map((f) => ({
    ...f,
    id: ids.get(f.id)!,
    members: f.members.flatMap((m) => (ids.has(m) ? [ids.get(m)!] : []))
  }))
  return { nodes, edges, frames, layouts, ids, nextId: next }
}

/** Where the copy's tiles sat (their top-left corner). */
export function clipCorner(clip: TileClip): { x: number; y: number } {
  return {
    x: Math.min(...clip.nodes.map((n) => n.position.x)),
    y: Math.min(...clip.nodes.map((n) => n.position.y))
  }
}
