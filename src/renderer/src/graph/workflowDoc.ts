/** Serialize/deserialize a single workflow's graph + dashboard layout.
 *  A leaf module (no store import) so both the store and the project layer can use
 *  it without a cycle. Object-level build/parse feed the project bundle; the string
 *  wrappers preserve the standalone `.json` round-trip.
 *
 *  Reads the CURRENT form only: a document from an older release is brought up to date by
 *  upgrades.ts (upgradeWorkflowDoc) when its project file is read, before it gets here. */
import type { Edge } from '@xyflow/react'

import { withoutTiles } from './frames'

import {
  isStep,
  type CanvasFrame,
  type FavGene,
  type GeneSet,
  type GraphNode,
  type GroupMeta,
  type NodeConfig,
  type NodeKind,
  type PanelLayoutItem
} from './types'

/** The workflow document's current form: 1 = no dashboard layout; 2 added groupLayouts /
 *  groupMeta; 3 doubled the grid both ways; 4 doubled its columns (see upgrades.ts). */
export const WORKFLOW_DOC_VERSION = 4

export interface WorkflowDoc {
  /** see WORKFLOW_DOC_VERSION */
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
  /** legacy (before 0.3.6): this workflow's own genesets — they're the project's now, and are
   *  gathered from here into the project file on open (see project.ts) */
  geneSets?: GeneSet[]
  /** canvas frames (labelled areas grouping tiles) */
  frames?: CanvasFrame[]
  /** legacy: a single flat favourites list, migrated to a "Favourites" geneset on load */
  favourites?: FavGene[]
}

export interface SerializeInput {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
  groupLayouts: Record<string, PanelLayoutItem[]>
  groupMeta: Record<string, GroupMeta>
  frames?: CanvasFrame[]
}

/** The undoable graph snapshot plus its (non-undoable) layout maps. */
export interface LoadedWorkflow {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
  groupLayouts: Record<string, PanelLayoutItem[]>
  groupMeta: Record<string, GroupMeta>
  frames: CanvasFrame[]
}

const pruneByRoot = <T>(m: Record<string, T>, live: Set<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(m).filter(([rootId]) => live.has(rootId)))

/** Build the plain workflow doc object (graph + layout), pruned to live nodes. */
export function buildWorkflowDoc(s: SerializeInput): WorkflowDoc {
  // placeholders are transient UI — never persist them or edges touching them
  const steps = s.nodes.filter(isStep)
  const stepIds = new Set(steps.map((n) => n.id))
  const groupLayouts = pruneByRoot(s.groupLayouts, stepIds)
  const groupMeta = pruneByRoot(s.groupMeta, stepIds)
  // A frame keeps only tiles that still exist (and the frames nested in it); one left empty goes.
  const frameIds = new Set((s.frames ?? []).map((f) => f.id))
  const gone = new Set(
    (s.frames ?? []).flatMap((f) => f.members).filter((m) => !stepIds.has(m) && !frameIds.has(m))
  )
  const frames = withoutTiles(s.frames ?? [], gone)
  return {
    version: WORKFLOW_DOC_VERSION,
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
    ...(Object.keys(groupMeta).length ? { groupMeta } : {}),
    ...(frames.length ? { frames } : {})
  }
}

/** A current-form workflow doc (see upgrades.ts) as graph nodes/edges + layout maps. */
export function parseWorkflowDoc(doc: WorkflowDoc): LoadedWorkflow {
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
  const maxIdx = nodes.reduce((m, n) => {
    const k = Number(n.id.split('-').pop())
    return Number.isFinite(k) ? Math.max(m, k) : m
  }, 1)
  return {
    nodes,
    edges: doc.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    nextId: doc.nextId ?? maxIdx + 1,
    groupLayouts: doc.groupLayouts ?? {},
    groupMeta: doc.groupMeta ?? {},
    frames: doc.frames ?? []
  }
}

/** Serializable workflow = graph + per-node config + dashboard layout (string form). */
export function serializeWorkflow(s: SerializeInput): string {
  return JSON.stringify(buildWorkflowDoc(s), null, 2)
}

/** An empty workflow doc (fresh tab in a project). */
export function emptyWorkflowDoc(): WorkflowDoc {
  return { version: WORKFLOW_DOC_VERSION, nextId: 1, nodes: [], edges: [] }
}
