/** Serialize/deserialize a single workflow's graph + dashboard layout.
 *  A leaf module (no store import) so both the store and the project layer can use
 *  it without a cycle. Object-level build/parse feed the project bundle; the string
 *  wrappers preserve the standalone `.json` round-trip. */
import type { Edge } from '@xyflow/react'

import {
  isStep,
  type GraphNode,
  type GroupMeta,
  type NodeConfig,
  type NodeKind,
  type PanelLayoutItem
} from './types'

export interface WorkflowDoc {
  /** absent/1 = legacy (no dashboard layout); 2 adds groupLayouts/groupMeta; 3 doubled
   *  the grid resolution (pre-3 layouts are scaled ×2 on load). */
  version?: number
  nextId?: number
  // `category` may be present in legacy files (v1) — read but ignore it.
  nodes: Array<{
    id: string
    type?: string
    position: { x: number; y: number }
    data: { kind: NodeKind; config: NodeConfig; name?: string }
  }>
  edges: Array<{ id: string; source: string; target: string }>
  groupLayouts?: Record<string, PanelLayoutItem[]>
  groupMeta?: Record<string, GroupMeta>
}

export interface SerializeInput {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
  groupLayouts: Record<string, PanelLayoutItem[]>
  groupMeta: Record<string, GroupMeta>
}

/** The undoable graph snapshot plus its (non-undoable) layout maps. */
export interface LoadedWorkflow {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
  groupLayouts: Record<string, PanelLayoutItem[]>
  groupMeta: Record<string, GroupMeta>
}

const pruneByRoot = <T>(m: Record<string, T>, live: Set<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(m).filter(([rootId]) => live.has(rootId)))

/** Doc version 3 doubled the dashboard grid resolution (12→24 cols, 40→20px rows). Scale
 *  every pre-v3 layout item ×2 so tiles keep their pixel footprint on the finer grid. */
function scaleLayouts(
  m: Record<string, PanelLayoutItem[]>,
  k: number
): Record<string, PanelLayoutItem[]> {
  const out: Record<string, PanelLayoutItem[]> = {}
  for (const [rootId, items] of Object.entries(m)) {
    out[rootId] = items.map((it) => ({ ...it, x: it.x * k, y: it.y * k, w: it.w * k, h: it.h * k }))
  }
  return out
}

/** Build the plain workflow doc object (graph + layout), pruned to live nodes. */
export function buildWorkflowDoc(s: SerializeInput): WorkflowDoc {
  // placeholders are transient UI — never persist them or edges touching them
  const steps = s.nodes.filter(isStep)
  const stepIds = new Set(steps.map((n) => n.id))
  const groupLayouts = pruneByRoot(s.groupLayouts, stepIds)
  const groupMeta = pruneByRoot(s.groupMeta, stepIds)
  return {
    version: 3,
    nextId: s.nextId,
    nodes: steps.map((n) => ({
      id: n.id,
      type: 'step',
      position: n.position,
      data: {
        kind: n.data.kind,
        config: n.data.config,
        ...(n.data.name ? { name: n.data.name } : {})
      }
    })),
    edges: s.edges
      .filter((e) => stepIds.has(e.source) && stepIds.has(e.target))
      .map((e) => ({ id: e.id, source: e.source, target: e.target })),
    ...(Object.keys(groupLayouts).length ? { groupLayouts } : {}),
    ...(Object.keys(groupMeta).length ? { groupMeta } : {})
  }
}

/** Parse a workflow doc object into graph nodes/edges + layout maps. */
export function parseWorkflowDoc(doc: WorkflowDoc): LoadedWorkflow {
  const version = doc.version ?? 1
  // v3 doubled the grid resolution; older layouts are scaled up so they still fit.
  const scale = version < 3 ? 2 : 1
  const nodes: GraphNode[] = doc.nodes.map((n) => ({
    id: n.id,
    type: 'step',
    position: n.position,
    data: {
      kind: n.data.kind,
      config: n.data.config,
      status: 'idle',
      ...(n.data.name ? { name: n.data.name } : {})
    }
  }))
  const edges: Edge[] = doc.edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
  const maxIdx = nodes.reduce((m, n) => {
    const k = Number(n.id.split('-').pop())
    return Number.isFinite(k) ? Math.max(m, k) : m
  }, 1)
  return {
    nodes,
    edges,
    nextId: doc.nextId ?? maxIdx + 1,
    groupLayouts:
      version >= 2
        ? scale === 1
          ? (doc.groupLayouts ?? {})
          : scaleLayouts(doc.groupLayouts ?? {}, scale)
        : {},
    groupMeta: version >= 2 ? (doc.groupMeta ?? {}) : {}
  }
}

/** Serializable workflow = graph + per-node config + dashboard layout (string form). */
export function serializeWorkflow(s: SerializeInput): string {
  return JSON.stringify(buildWorkflowDoc(s), null, 2)
}

export function deserializeWorkflow(text: string): LoadedWorkflow {
  return parseWorkflowDoc(JSON.parse(text) as WorkflowDoc)
}

/** An empty workflow doc (fresh tab in a project). */
export function emptyWorkflowDoc(): WorkflowDoc {
  return { version: 3, nextId: 1, nodes: [], edges: [] }
}
