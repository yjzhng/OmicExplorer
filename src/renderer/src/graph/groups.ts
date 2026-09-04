/** Analysis grouping: derive dashboard tabs from the pipeline DAG.
 *
 *  An "analysis group" is a compare/contrast/standardize step (its root) together
 *  with the downstream view tiles it feeds. Groups are DERIVED from nodes+edges,
 *  never stored (mirroring the `categoryOf` convention) — only user overrides
 *  (rename/hide) and per-group layouts are persisted, elsewhere.
 */
import type { Edge } from '@xyflow/react'

import { categoryOf, NODE_SPECS } from './registry'
import { isStep, type GraphNode, type NodeKind, type PlotGroupConfig } from './types'

/** Separator between a group id and a subcard id in an expanded panel id. */
export const CHILD_SEP = '::'

/** A dashboard panel is either a whole node or one subcard of a group tile. */
export type PanelRef = { nodeId: string; childId?: string }

/** Encode/decode the `${groupId}::${childId}` panel id used by the dashboard layout. */
export const childPanelId = (groupId: string, childId: string): string =>
  `${groupId}${CHILD_SEP}${childId}`
export function parsePanelId(panelId: string): PanelRef {
  const i = panelId.indexOf(CHILD_SEP)
  return i < 0
    ? { nodeId: panelId }
    : { nodeId: panelId.slice(0, i), childId: panelId.slice(i + 2) }
}

/**
 * Expand analysis members into dashboard panel ids: a plot group is transparent here,
 * contributing one panel per subcard (`${groupId}::${childId}`); every other member maps
 * to itself. Members whose node is gone are dropped. Processing steps (the group root:
 * standardize/compare/contrast) produce NO tile — their results are viewed via a separate
 * Data table (or plot) node, so the root would only be an empty tile.
 */
export function expandMembers(memberIds: string[], nodes: GraphNode[]): string[] {
  const byId = new Map(nodes.filter(isStep).map((n) => [n.id, n]))
  const out: string[] = []
  for (const id of memberIds) {
    const n = byId.get(id)
    if (!n) continue
    if (categoryOf(n.data.kind) === 'processing') continue
    if (n.data.kind === 'plotGroup') {
      for (const c of (n.data.config as PlotGroupConfig).children) out.push(childPanelId(id, c.id))
    } else {
      out.push(id)
    }
  }
  return out
}

/**
 * Order the step nodes by workflow flow for the results tabs: by topological LEVEL first (a node's
 * longest path from a source — so upstream analyses come first), then, within one level, by the
 * tile's canvas position top→bottom (y), then left→right (x). Not creation order.
 */
export function topoStepOrder(nodes: GraphNode[], edges: Edge[]): string[] {
  const steps = nodes.filter(isStep)
  const byId = new Map(steps.map((n) => [n.id, n]))
  const ids = new Set(steps.map((n) => n.id))
  const indeg = new Map<string, number>()
  const out = new Map<string, string[]>()
  const level = new Map<string, number>()
  for (const n of steps) {
    indeg.set(n.id, 0)
    out.set(n.id, [])
    level.set(n.id, 0)
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    out.get(e.source)!.push(e.target)
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
  }
  // Kahn's algorithm in topological order; each node's level = max(pred level) + 1 (longest path).
  const queue = steps.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const seen = new Set<string>()
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id)) continue
    seen.add(id)
    for (const t of out.get(id) ?? []) {
      level.set(t, Math.max(level.get(t) ?? 0, (level.get(id) ?? 0) + 1))
      const d = (indeg.get(t) ?? 0) - 1
      indeg.set(t, d)
      if (d <= 0) queue.push(t)
    }
  }
  // Sort every step by (level, y, x). Cycle members keep level 0 and fall back to position.
  return [...ids].sort((a, b) => {
    const la = level.get(a) ?? 0
    const lb = level.get(b) ?? 0
    if (la !== lb) return la - lb
    const na = byId.get(a)!
    const nb = byId.get(b)!
    return na.position.y - nb.position.y || na.position.x - nb.position.x
  })
}

export interface AnalysisGroup {
  /** stable id — equal to the root node's id */
  id: string
  rootId: string
  kind: 'compare' | 'contrast' | 'standardize'
  /** default label; a user override may replace it at a higher layer */
  label: string
  /** root tile first, then its downstream view tiles */
  memberIds: string[]
}

/** The step kinds that root an analysis. A group stops at the next root, so a
 *  contrast never swallows its parent compares' plots. */
const ROOT_KINDS: readonly NodeKind[] = ['standardize', 'compare', 'contrast']

/**
 * Group the graph into analyses. For each root, members are the nodes reachable
 * downstream without passing through another root (BFS over out-edges, halting at
 * and excluding any further root). Groups are returned in node order.
 */
export function deriveGroups(nodes: GraphNode[], edges: Edge[]): AnalysisGroup[] {
  const steps = nodes.filter(isStep)
  const byId = new Map(steps.map((n) => [n.id, n]))
  const isRoot = (id: string): boolean => {
    const n = byId.get(id)
    return !!n && ROOT_KINDS.includes(n.data.kind)
  }

  // Out-adjacency, restricted to real steps (dangling/placeholder edges ignored).
  const out = new Map<string, string[]>()
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue
    const arr = out.get(e.source)
    if (arr) arr.push(e.target)
    else out.set(e.source, [e.target])
  }

  const groups: AnalysisGroup[] = []
  for (const root of steps) {
    if (!ROOT_KINDS.includes(root.data.kind)) continue
    const members: string[] = [root.id]
    const seen = new Set<string>([root.id])
    const queue = [...(out.get(root.id) ?? [])]
    while (queue.length) {
      const id = queue.shift() as string
      if (seen.has(id) || isRoot(id)) continue // halt at the next analysis root
      seen.add(id)
      members.push(id)
      for (const t of out.get(id) ?? []) if (!seen.has(t)) queue.push(t)
    }
    groups.push({
      id: root.id,
      rootId: root.id,
      kind: root.data.kind as AnalysisGroup['kind'],
      label: `${NODE_SPECS[root.data.kind].label} · ${root.id}`,
      memberIds: members
    })
  }
  return groups
}
