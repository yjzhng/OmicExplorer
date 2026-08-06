/** Zustand store backing the composable pipeline graph. */
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange
} from '@xyflow/react'
import { create } from 'zustand'

import { engine } from '../engine/client'
import type { CompareTableResult } from '../engine'
import { EXAMPLE_LOAD_CONFIG } from './example'
import {
  deserializeProject,
  emptyWorkflow,
  newFolder,
  newProjectFile,
  serializeProject,
  type ProjectFile,
  type ProjectFolder
} from './project'
import { loadRecents, pushRecent, removeRecent, saveRecents, type RecentProject } from './recents'
import { canConnect, categoryOf, NODE_SPECS } from './registry'
import {
  isStep,
  type CompareConfig,
  type ContrastConfig,
  type GraphNode,
  type GroupMeta,
  type LoadConfig,
  type NodeConfig,
  type NodeData,
  type NodeKind,
  type NodeResult,
  type PanelLayoutItem,
  type PlaceholderNode,
  type PlotChild,
  type PlotGroupConfig,
  type StandardizeConfig,
  type StepNode
} from './types'
import {
  buildWorkflowDoc,
  parseWorkflowDoc,
  type LoadedWorkflow,
  type WorkflowDoc
} from './workflowDoc'

/** Minimal objects → CSV for writing processed data to <dir>/temp. */
function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.join(',')
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n')
  return `${head}\n${body}\n`
}

const VEHICLE_NAMES = new Set([
  'dmso',
  'h2o',
  'etoh',
  'meoh',
  'vehicle',
  'veh',
  'water',
  'ethanol',
  'methanol'
])

interface GraphState {
  nodes: GraphNode[]
  edges: Edge[]
  results: Record<string, NodeResult>
  selectedId: string | null
  /** active subcard id within the selected group tile (null = whole tile / no group) */
  selectedSub: string | null
  /** ids of nodes in the canvas marquee selection; ephemeral (not in undo). Mirrors
   *  React Flow's own selection so header UI (e.g. Export plots) can read it. */
  canvasSelection: string[]
  setCanvasSelection: (ids: string[]) => void
  nextId: number

  onNodesChange: (changes: NodeChange<GraphNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  onReconnect: (oldEdge: Edge, conn: Connection) => void
  onEdgesDelete: (deleted: Edge[]) => void
  removeEdge: (id: string) => void
  isValidConnection: (conn: Connection | Edge) => boolean

  addNode: (
    op: NodeKind,
    opts?: { position?: { x: number; y: number }; connectFrom?: string }
  ) => string
  /** Drop a transient placeholder (optionally wired from `source`); resolve/cancel picks its op. */
  addPlaceholder: (
    source: string | null,
    ops: NodeKind[],
    position: { x: number; y: number }
  ) => string
  /** Materialize a placeholder into a real step (undoable). One op → a single node; two
   *  or more plotting ops → one `plotGroup` tile holding them as subcards. */
  resolvePlaceholder: (id: string, ops: NodeKind[]) => void
  /** Discard a placeholder and its pending edge (no history entry). */
  cancelPlaceholder: (id: string) => void
  deleteNode: (id: string) => void
  duplicateNode: (id: string) => void
  /** Duplicate several tiles at once; the copies land on top and become the selection. */
  duplicateNodes: (ids: string[]) => void
  selectNode: (id: string | null) => void
  /** Select a subcard within a group tile (opens that child's config). */
  selectChildCard: (groupId: string, childId: string) => void
  updateConfig: (id: string, partial: Record<string, unknown>) => void
  /** Patch one subcard's config inside a group tile (display-only keys don't invalidate). */
  updateChildConfig: (groupId: string, childId: string, partial: Record<string, unknown>) => void
  /** Fold plot tiles that share one upstream into a single group tile (undoable). */
  groupNodes: (ids: string[]) => void
  /** Explode each selected group tile back into standalone plot nodes (undoable). */
  ungroupNodes: (ids: string[]) => void
  /** Append a plot subcard to a group tile and select it (undoable). */
  addGroupChild: (groupId: string, kind: NodeKind) => void
  /** Remove a subcard; deletes the whole group tile when it was the last one (undoable). */
  removeGroupChild: (groupId: string, childId: string) => void
  /** Reorder subcards: drop `fromId` into the gap before/after `targetId` (undoable). */
  moveGroupChild: (
    groupId: string,
    fromId: string,
    targetId: string,
    place: 'before' | 'after'
  ) => void
  /** Auto-arrange the selected tiles in a neat cascade from the top-left-most (undoable). */
  cascadeNodes: (ids: string[]) => void
  /** Switch a node's operation within its category, resetting config + pruning now-invalid edges. */
  changeOp: (id: string, op: NodeKind) => void

  runNode: (id: string) => Promise<void>
  cancelNode: (id: string) => void
  /** True while `runAll` is executing the pipeline. */
  runningAll: boolean
  /** Run every runnable step once, in dependency (topological) order. */
  runAll: () => Promise<void>
  /** Abort an in-progress `runAll` and the step currently running. */
  stopAll: () => void

  /** Reset every strictly-downstream node to idle and clear its cached result. */
  invalidateDownstream: (id: string) => void
  /** Mark a node itself (and everything downstream) stale — used on edge changes. */
  markStale: (id: string) => void
  upstreamId: (id: string) => string | undefined
  /** All upstream source ids feeding `id`, in edge (connection) order. */
  upstreamIds: (id: string) => string[]
  nodeKind: (id: string) => NodeKind | undefined

  // ── project (.omicexplorer) → folders → workflows ────────────────────────
  projectPath: string | null
  projectName: string
  /** whether a project is open (false = show the home page) */
  projectOpen: boolean
  /** active folder's path, scanned for input files (kept in sync from folders) */
  dataDir: string | null
  dirty: boolean
  /** input files available in the active data folder */
  inputFiles: string[]
  /** the active folder has a path set, but it no longer exists on disk */
  dataDirMissing: boolean
  folders: ProjectFolder[]
  activeFolderId: string | null
  /** active workflow within the active folder; its live state is nodes/edges/results */
  activeWorkflowId: string | null
  /** recently opened/saved projects (persisted to localStorage) */
  recentProjects: RecentProject[]

  initProject: () => Promise<void>
  goHome: () => void
  newProject: () => void
  openProject: (path?: string) => Promise<void>
  /** returns true if written (false if cancelled at the save-as dialog) */
  saveProject: () => Promise<boolean>
  saveProjectAs: () => Promise<boolean>
  refreshDataFiles: () => Promise<void>

  /** folders (each a data location with its own workflows) */
  addFolder: () => Promise<void>
  switchFolder: (id: string) => void
  deleteFolder: (id: string) => void
  renameFolder: (id: string, name: string) => void
  /** re-point a folder at a new data directory (e.g. after the old path went missing) */
  repathFolder: (id: string) => Promise<void>

  /** recent projects: drop one entry, or prune entries whose file no longer exists */
  forgetRecent: (path: string) => void
  pruneMissingRecents: () => Promise<void>

  /** workflows within the active folder */
  addWorkflow: (name?: string) => void
  switchWorkflow: (id: string) => void
  renameWorkflow: (id: string, name: string) => void
  deleteWorkflow: (id: string) => void

  // ── dashboard layout (persisted with the workflow; keyed by analysis-group root id) ──
  groupLayouts: Record<string, PanelLayoutItem[]>
  groupMeta: Record<string, GroupMeta>
  /** Persist a group's tile layout (marks dirty; stays out of undo history). */
  setGroupLayout: (rootId: string, layout: PanelLayoutItem[]) => void
  /** Drop a group's saved layout so it falls back to the auto layout. */
  resetGroupLayout: (rootId: string) => void

  // ── undo / redo ────────────────────────────────────────────────────────────
  past: Snapshot[]
  future: Snapshot[]
  /** Push the current graph onto the undo stack (call before a structural edit). */
  commit: () => void
  undo: () => void
  redo: () => void
}

function makeNode(id: string, op: NodeKind, position: { x: number; y: number }): StepNode {
  return {
    id,
    type: 'step',
    position,
    data: { kind: op, config: NODE_SPECS[op].defaultConfig(), status: 'idle' }
  }
}

/** Mint stable subcard ids from the shared node counter, cloning each config. */
function toChildren(
  specs: Array<{ kind: NodeKind; config: NodeConfig }>,
  startId: number
): PlotChild[] {
  return specs.map((s, i) => ({
    id: `sub-${startId + i}`,
    kind: s.kind,
    config: structuredClone(s.config)
  }))
}

/** A group tile node holding the given subcards. */
function makeGroupNode(
  id: string,
  position: { x: number; y: number },
  children: PlotChild[]
): StepNode {
  return {
    id,
    type: 'step',
    position,
    data: { kind: 'plotGroup', config: { children }, status: 'idle' }
  }
}

function guessPair(compounds: string[]): { num: string; den: string } {
  const den = compounds.find((c) => VEHICLE_NAMES.has(c.toLowerCase())) ?? ''
  const num = compounds.find((c) => !VEHICLE_NAMES.has(c.toLowerCase())) ?? ''
  return { num, den }
}

// ── seed graph: a ready-to-run default chain the user can extend ────────────────
const seedLoad = makeNode('load-1', 'load', { x: 0, y: 80 })
seedLoad.data.config = { ...EXAMPLE_LOAD_CONFIG }
const SEED_NODES: GraphNode[] = [
  seedLoad,
  makeNode('std-1', 'standardize', { x: 290, y: 80 }),
  makeNode('cmp-1', 'compare', { x: 580, y: 40 }),
  makeNode('vol-1', 'volcano', { x: 900, y: 0 }),
  makeNode('heat-1', 'heatmap', { x: 900, y: 210 })
]
const SEED_EDGES: Edge[] = [
  { id: 'e-load-std', source: 'load-1', target: 'std-1' },
  { id: 'e-std-cmp', source: 'std-1', target: 'cmp-1' },
  { id: 'e-cmp-vol', source: 'cmp-1', target: 'vol-1' },
  { id: 'e-std-heat', source: 'std-1', target: 'heat-1' }
]

interface Snapshot {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
}

// ── project helpers (module scope; take the store's set/get) ──────────────────
type Setter = (partial: Partial<GraphState>) => void
type Getter = () => GraphState

function docFromLive(s: GraphState): WorkflowDoc {
  return buildWorkflowDoc({
    nodes: s.nodes,
    edges: s.edges,
    nextId: s.nextId,
    groupLayouts: s.groupLayouts,
    groupMeta: s.groupMeta
  })
}

const activeFolder = (s: GraphState): ProjectFolder | undefined =>
  s.folders.find((f) => f.id === s.activeFolderId)

/** Flush the live graph + results into the active folder's active workflow. */
function syncActiveSlot(get: Getter, set: Setter): void {
  const s = get()
  if (!s.activeFolderId || !s.activeWorkflowId) return
  const doc = docFromLive(s)
  set({
    folders: s.folders.map((f) =>
      f.id !== s.activeFolderId
        ? f
        : {
            ...f,
            workflows: f.workflows.map((w) =>
              w.id === s.activeWorkflowId ? { ...w, doc, results: s.results } : w
            )
          }
    )
  })
}

/** Check out a folder + workflow as the live graph (restoring embedded results). */
function loadSlot(get: Getter, set: Setter, folderId: string, workflowId?: string): void {
  const folder = get().folders.find((f) => f.id === folderId)
  if (!folder) return
  const wfId = workflowId ?? folder.activeWorkflowId ?? folder.workflows[0]?.id
  const slot = folder.workflows.find((w) => w.id === wfId) ?? folder.workflows[0]
  if (!slot) return
  const loaded: LoadedWorkflow = parseWorkflowDoc(slot.doc)
  const results = slot.results ?? {}
  // Restore run state so a resumed session shows results (Re-run, not Run).
  const nodes: GraphNode[] = loaded.nodes.map((n) =>
    isStep(n) && results[n.id] ? { ...n, data: { ...n.data, status: 'done' as const } } : n
  )
  set({
    nodes,
    edges: loaded.edges,
    nextId: loaded.nextId,
    groupLayouts: loaded.groupLayouts,
    groupMeta: loaded.groupMeta,
    results,
    activeFolderId: folderId,
    activeWorkflowId: slot.id,
    dataDir: folder.path || null,
    selectedId: null,
    past: [],
    future: []
  })
}

function buildProjectFile(get: Getter): ProjectFile {
  const s = get()
  return {
    format: 'omicexplorer-project',
    version: 2,
    name: s.projectName,
    folders: s.folders,
    activeFolderId: s.activeFolderId ?? s.folders[0]?.id ?? ''
  }
}

export const useGraph = create<GraphState>()((set, get) => ({
  nodes: SEED_NODES,
  edges: SEED_EDGES,
  results: {},
  selectedId: 'load-1',
  selectedSub: null,
  canvasSelection: [],
  nextId: 2,
  runningAll: false,

  projectPath: null,
  projectName: 'Untitled project',
  projectOpen: false,
  dataDir: null,
  dirty: false,
  inputFiles: [],
  dataDirMissing: false,
  folders: [],
  activeFolderId: null,
  activeWorkflowId: null,
  recentProjects: [],
  groupLayouts: {},
  groupMeta: {},
  past: [],
  future: [],

  onNodesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) get().commit()
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) }))
  },
  onEdgesChange: (changes) => {
    if (changes.some((c) => c.type === 'remove')) get().commit()
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) }))
  },

  onConnect: (conn) => {
    const { nodes, edges } = get()
    const src = nodes.find((n) => n.id === conn.source)
    const tgt = nodes.find((n) => n.id === conn.target)
    if (!src || !tgt || !conn.source || !conn.target) return
    if (!isStep(src) || !isStep(tgt) || !canConnect(src.data.kind, tgt.data.kind)) return
    // contrast takes two inputs; every other node takes one.
    const maxInputs = tgt.data.kind === 'contrast' ? 2 : 1
    const existing = edges.filter((e) => e.target === conn.target)
    if (existing.some((e) => e.source === conn.source)) return // no duplicate input
    get().commit()
    // keep the most recent (maxInputs-1) inputs; drop older ones so we stay at capacity
    const keep = maxInputs > 1 ? existing.slice(existing.length - (maxInputs - 1)) : []
    const pruned = edges.filter((e) => e.target !== conn.target || keep.includes(e))
    set({ edges: addEdge({ ...conn, id: `e-${conn.source}-${conn.target}` }, pruned) })
    get().invalidateDownstream(conn.source) // new wiring ⇒ downstream stale
  },

  onReconnect: (oldEdge, conn) => {
    const { nodes, edges } = get()
    const src = nodes.find((n) => n.id === conn.source)
    const tgt = nodes.find((n) => n.id === conn.target)
    if (!src || !tgt || !conn.source || !conn.target) return
    if (!isStep(src) || !isStep(tgt) || !canConnect(src.data.kind, tgt.data.kind)) return
    const maxInputs = tgt.data.kind === 'contrast' ? 2 : 1
    const others = edges.filter((e) => e.id !== oldEdge.id && e.target === conn.target)
    if (others.some((e) => e.source === conn.source)) return // no duplicate input
    get().commit()
    // keep the moved edge + the most recent (maxInputs-1) other inputs to the new target
    const keep = maxInputs > 1 ? others.slice(others.length - (maxInputs - 1)) : []
    const pruned = edges.filter(
      (e) => e.id === oldEdge.id || e.target !== conn.target || keep.includes(e)
    )
    set({ edges: reconnectEdge(oldEdge, conn, pruned) })
    // both the previous and new target lost/changed their input
    for (const t of new Set([oldEdge.target, conn.target])) get().markStale(t)
  },

  onEdgesDelete: (deleted) => {
    for (const e of deleted) get().markStale(e.target)
  },

  removeEdge: (id) => {
    const edge = get().edges.find((e) => e.id === id)
    if (!edge) return
    get().commit()
    set((s) => ({ edges: s.edges.filter((e) => e.id !== id) }))
    get().markStale(edge.target)
  },

  isValidConnection: (conn) => {
    const { nodes } = get()
    const src = nodes.find((n) => n.id === conn.source)
    const tgt = nodes.find((n) => n.id === conn.target)
    return !!src && !!tgt && isStep(src) && isStep(tgt) && canConnect(src.data.kind, tgt.data.kind)
  },

  addNode: (op, opts) => {
    get().commit()
    const id = `${op}-${get().nextId}`
    const pos = opts?.position ?? { x: 120 + Math.min(get().nodes.length, 8) * 24, y: 340 }
    set((s) => ({
      nodes: [...s.nodes, makeNode(id, op, pos)],
      nextId: s.nextId + 1,
      selectedId: id
    }))
    // optional: wire an edge from an upstream node (used by the node "+" affordance)
    const from = opts?.connectFrom
    if (from) {
      const src = get().nodes.find((n) => n.id === from)
      if (src && isStep(src) && canConnect(src.data.kind, op)) {
        set((s) => ({
          edges: [
            ...s.edges.filter((e) => e.target !== id),
            { id: `e-${from}-${id}`, source: from, target: id }
          ]
        }))
      }
    }
    return id
  },

  addPlaceholder: (source, ops, position) => {
    // No commit: a placeholder is UI-only until resolved, so it stays out of history.
    const id = `step-${get().nextId}`
    const ph: PlaceholderNode = {
      id,
      type: 'placeholder',
      position,
      data: { ops, source: source ?? undefined }
    }
    set((s) => ({
      nodes: [...s.nodes, ph],
      edges: source
        ? [
            ...s.edges.filter((e) => e.target !== id),
            { id: `e-${source}-${id}`, source, target: id }
          ]
        : s.edges,
      nextId: s.nextId + 1,
      selectedId: null
    }))
    return id
  },

  resolvePlaceholder: (id, ops) => {
    const { nodes, edges, nextId, past } = get()
    const ph = nodes.find((n) => n.id === id)
    if (!ph || ph.type !== 'placeholder' || ops.length === 0) return
    // Snapshot the graph as if the placeholder never existed → one clean undo step
    // that removes the finished step and its edge together.
    const baseNodes = nodes.filter((n) => n.id !== id)
    const baseEdges = edges.filter((e) => e.target !== id)
    set({
      past: [
        ...past,
        { nodes: structuredClone(baseNodes), edges: structuredClone(baseEdges), nextId }
      ].slice(-50),
      future: [],
      dirty: true
    })
    // One op → a plain node. Multiple (all plotting) → a group tile with a subcard per op.
    // Either way keep the placeholder's id, position, and incoming edge.
    if (ops.length === 1) {
      set((s) => ({
        nodes: s.nodes.map((n) => (n.id === id ? makeNode(id, ops[0], n.position) : n)),
        selectedId: id,
        selectedSub: null
      }))
      return
    }
    const children = toChildren(
      ops.map((kind) => ({ kind, config: NODE_SPECS[kind].defaultConfig() })),
      nextId
    )
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? makeGroupNode(id, n.position, children) : n)),
      nextId: s.nextId + ops.length,
      selectedId: id,
      selectedSub: children[0]?.id ?? null
    }))
  },

  cancelPlaceholder: (id) => {
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== id),
      edges: s.edges.filter((e) => e.target !== id),
      selectedId: s.selectedId === id ? null : s.selectedId
    }))
  },

  deleteNode: (id) => {
    get().commit()
    set((s) => {
      const results = { ...s.results }
      delete results[id]
      return {
        nodes: s.nodes.filter((n) => n.id !== id),
        edges: s.edges.filter((e) => e.source !== id && e.target !== id),
        results,
        selectedId: s.selectedId === id ? null : s.selectedId
      }
    })
  },

  duplicateNode: (id) => get().duplicateNodes([id]),

  duplicateNodes: (ids) => {
    const sel = ids
      .map((id) => get().nodes.find((n) => n.id === id))
      .filter((n): n is StepNode => !!n && isStep(n))
    if (sel.length === 0) return
    get().commit()
    let nextId = get().nextId
    const copies: StepNode[] = []
    for (const node of sel) {
      const newId = `${node.data.kind}-${nextId++}`
      let config = structuredClone(node.data.config)
      // A group's subcards get fresh ids so no two groups ever share a child id.
      if (node.data.kind === 'plotGroup') {
        const src = (node.data.config as PlotGroupConfig).children
        config = { children: toChildren(src, nextId) } as PlotGroupConfig
        nextId += src.length
      }
      copies.push({
        id: newId,
        type: 'step',
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        // `selected` moves React Flow's selection (and paint order) to the copies.
        selected: true,
        data: { kind: node.data.kind, config, status: 'idle' }
      })
    }
    const srcIds = new Set(ids)
    set((s) => ({
      // Copies appended last → drawn on top; originals get deselected so only the
      // fresh tiles read as selected.
      nodes: [...s.nodes.map((n) => (srcIds.has(n.id) ? { ...n, selected: false } : n)), ...copies],
      nextId,
      selectedId: copies.length === 1 ? copies[0].id : null,
      selectedSub: null
    }))
  },

  selectNode: (id) => set({ selectedId: id, selectedSub: null }),
  selectChildCard: (groupId, childId) => set({ selectedId: groupId, selectedSub: childId }),
  setCanvasSelection: (ids) => set({ canvasSelection: ids }),

  updateConfig: (id, partial) => {
    get().commit()
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...partial } as NodeConfig } }
          : n
      )
    }))
    // compute nodes go stale on config change; plot nodes re-render live. Display-only
    // keys (focus-gene sets) never affect the computed result, so editing them must not
    // wipe the result or invalidate downstream — otherwise picking a focus gene on the
    // Standardize tile would clear the very result its gene list is read from.
    const displayOnly = Object.keys(partial).every(
      (k) => k === 'goi' || k === 'panel' || k === 'focus'
    )
    const kind = get().nodeKind(id)
    if (kind && NODE_SPECS[kind].hasRun && !displayOnly) {
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n)
            ? { ...n, data: { ...n.data, status: 'idle', error: undefined } }
            : n
        )
      }))
      const results = { ...get().results }
      delete results[id]
      set({ results })
      get().invalidateDownstream(id)
    }
  },

  updateChildConfig: (groupId, childId, partial) => {
    get().commit()
    // Children are plot subcards (never `hasRun`), so they re-render live — no result to
    // wipe, no downstream to invalidate. Just patch the matching child in place.
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n) || n.data.kind !== 'plotGroup') return n
        const cfg = n.data.config as PlotGroupConfig
        return {
          ...n,
          data: {
            ...n.data,
            config: {
              children: cfg.children.map((c) =>
                c.id === childId ? { ...c, config: { ...c.config, ...partial } as NodeConfig } : c
              )
            }
          }
        }
      })
    }))
  },

  groupNodes: (ids) => {
    const { nodes, edges } = get()
    const sel = ids
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is StepNode => !!n && isStep(n))
    // Need ≥2 plotting tiles that all share exactly one upstream (see plan: same-upstream only).
    if (sel.length < 2 || !sel.every((n) => categoryOf(n.data.kind) === 'plotting')) return
    const ups = new Set<string>()
    for (const n of sel) {
      const u = edges.filter((e) => e.target === n.id).map((e) => e.source)
      if (u.length !== 1) return
      ups.add(u[0])
    }
    if (ups.size !== 1) return
    const upstream = [...ups][0]
    get().commit()
    // Flatten: a selected group contributes its subcards; a plain plot contributes itself.
    const specs = sel.flatMap((n) =>
      n.data.kind === 'plotGroup'
        ? (n.data.config as PlotGroupConfig).children.map((c) => ({
            kind: c.kind,
            config: c.config
          }))
        : [{ kind: n.data.kind, config: n.data.config }]
    )
    const startId = get().nextId
    const children = toChildren(specs, startId)
    const groupId = `plotGroup-${startId + specs.length}`
    // Anchor the group at the top-left-most selected tile.
    const pos = sel.reduce(
      (best, n) =>
        n.position.y < best.y || (n.position.y === best.y && n.position.x < best.x)
          ? n.position
          : best,
      sel[0].position
    )
    const selIds = new Set(sel.map((n) => n.id))
    set((s) => {
      const results = { ...s.results }
      for (const nid of selIds) delete results[nid]
      return {
        nodes: [...s.nodes.filter((n) => !selIds.has(n.id)), makeGroupNode(groupId, pos, children)],
        edges: [
          ...s.edges.filter((e) => !selIds.has(e.target) && !selIds.has(e.source)),
          { id: `e-${upstream}-${groupId}`, source: upstream, target: groupId }
        ],
        results,
        nextId: startId + specs.length + 1,
        selectedId: groupId,
        selectedSub: children[0]?.id ?? null
      }
    })
  },

  ungroupNodes: (ids) => {
    const { nodes, edges } = get()
    const groups = ids
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is StepNode => !!n && isStep(n) && n.data.kind === 'plotGroup')
    if (groups.length === 0) return
    get().commit()
    let nextId = get().nextId
    const addNodes: StepNode[] = []
    const addEdges: Edge[] = []
    const removeIds = new Set<string>()
    for (const g of groups) {
      const upstream = edges.find((e) => e.target === g.id)?.source
      const kids = (g.data.config as PlotGroupConfig).children
      kids.forEach((c, i) => {
        const nid = `${c.kind}-${nextId++}`
        addNodes.push({
          id: nid,
          type: 'step',
          position: { x: g.position.x + i * 28, y: g.position.y + i * 46 },
          data: { kind: c.kind, config: structuredClone(c.config), status: 'idle' }
        })
        if (upstream) addEdges.push({ id: `e-${upstream}-${nid}`, source: upstream, target: nid })
      })
      removeIds.add(g.id)
    }
    set((s) => ({
      nodes: [...s.nodes.filter((n) => !removeIds.has(n.id)), ...addNodes],
      edges: [
        ...s.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
        ...addEdges
      ],
      nextId,
      selectedId: addNodes[0]?.id ?? null,
      selectedSub: null
    }))
  },

  addGroupChild: (groupId, kind) => {
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
    get().commit()
    const [child] = toChildren([{ kind, config: NODE_SPECS[kind].defaultConfig() }], get().nextId)
    set((s) => ({
      nextId: s.nextId + 1,
      selectedSub: child.id,
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n)) return n
        const cfg = n.data.config as PlotGroupConfig
        return { ...n, data: { ...n.data, config: { children: [...cfg.children, child] } } }
      })
    }))
  },

  removeGroupChild: (groupId, childId) => {
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
    const remaining = (group.data.config as PlotGroupConfig).children.filter(
      (c) => c.id !== childId
    )
    get().commit()
    // Last subcard gone → the group has nothing to show; remove the tile entirely.
    if (remaining.length === 0) {
      set((s) => ({
        nodes: s.nodes.filter((n) => n.id !== groupId),
        edges: s.edges.filter((e) => e.source !== groupId && e.target !== groupId),
        selectedId: s.selectedId === groupId ? null : s.selectedId,
        selectedSub: null
      }))
      return
    }
    set((s) => ({
      selectedSub: remaining[0].id,
      nodes: s.nodes.map((n) =>
        n.id === groupId && isStep(n)
          ? { ...n, data: { ...n.data, config: { children: remaining } } }
          : n
      )
    }))
  },

  moveGroupChild: (groupId, fromId, targetId, place) => {
    if (fromId === targetId) return
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
    get().commit()
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n)) return n
        const kids = [...(n.data.config as PlotGroupConfig).children]
        const from = kids.findIndex((c) => c.id === fromId)
        if (from < 0) return n
        const [moved] = kids.splice(from, 1)
        // Target index is computed AFTER removal, so `before`/`after` land in the gap.
        let to = kids.findIndex((c) => c.id === targetId)
        if (to < 0) return n
        if (place === 'after') to += 1
        kids.splice(to, 0, moved)
        return { ...n, data: { ...n.data, config: { children: kids } } }
      })
    }))
  },

  cascadeNodes: (ids) => {
    const sel = ids
      .map((id) => get().nodes.find((n) => n.id === id))
      .filter((n): n is StepNode => !!n && isStep(n))
    if (sel.length < 2) return
    get().commit()
    const x0 = Math.min(...sel.map((n) => n.position.x))
    const y0 = Math.min(...sel.map((n) => n.position.y))
    // Keep current visual order (top→bottom, then left→right) so the cascade feels stable.
    const ordered = [...sel].sort(
      (a, b) => a.position.y - b.position.y || a.position.x - b.position.x
    )
    // Same tight cascade the ungroup spread uses (see ungroupNodes: i*28 / i*46).
    const pos = new Map(ordered.map((n, i) => [n.id, { x: x0 + i * 28, y: y0 + i * 46 }]))
    set((s) => ({
      nodes: s.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n))
    }))
  },

  changeOp: (id, op) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind === op) return
    get().commit()
    // reset the node to the new op with its default config (category is derived from op)
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? {
              ...n,
              data: {
                kind: op,
                config: NODE_SPECS[op].defaultConfig(),
                status: 'idle',
                error: undefined
              }
            }
          : n
      )
    }))
    const results = { ...get().results }
    delete results[id]
    set({ results })
    // prune edges no longer type-valid for the new op (either direction)
    const nodes = get().nodes
    const opOf = (nid: string): NodeKind | undefined => {
      const n = nodes.find((x) => x.id === nid)
      return n && isStep(n) ? n.data.kind : undefined
    }
    set((s) => ({
      edges: s.edges.filter((e) => {
        if (e.target === id) {
          const so = opOf(e.source)
          return !!so && canConnect(so, op)
        }
        if (e.source === id) {
          const to = opOf(e.target)
          return !!to && canConnect(op, to)
        }
        return true
      })
    }))
    get().invalidateDownstream(id)
  },

  runNode: async (id) => {
    const state = get()
    const node = state.nodes.find((n) => n.id === id)
    if (!node || !isStep(node)) return
    const kind = node.data.kind
    const setStatus = (status: NodeData['status'], error?: string) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n) ? { ...n, data: { ...n.data, status, error } } : n
        )
      }))

    const upId = state.upstreamId(id)
    const upResult = upId ? state.results[upId] : undefined

    try {
      if (kind === 'standardize') {
        const loadNode = upId ? state.nodes.find((n) => n.id === upId) : undefined
        const dir = state.dataDir
        const load = loadNode && isStep(loadNode) ? (loadNode.data.config as LoadConfig) : undefined
        if (
          !loadNode ||
          !isStep(loadNode) ||
          loadNode.data.kind !== 'load' ||
          !dir ||
          !load?.data ||
          !load.samplesheet
        ) {
          setStatus(
            'error',
            'Connect a Load tile with a data file and samplesheet, and set the project data folder.'
          )
          return
        }
        setStatus('running')
        const [dataText, samplesheetText, dbText] = await Promise.all([
          window.api.readDataFile(dir, load.data),
          window.api.readDataFile(dir, load.samplesheet),
          load.db ? window.api.readDataFile(dir, load.db) : Promise.resolve(null)
        ])
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        if (!dataText || !samplesheetText) {
          setStatus(
            'error',
            `Input file not found in the data folder (${load.data}, ${load.samplesheet}).`
          )
          return
        }
        const cfg = node.data.config as StandardizeConfig
        const std = await engine.standardize({
          dataText,
          dataFilename: load.data,
          samplesheetText,
          dbText: dbText ?? undefined,
          activeConditions: cfg.activeConditions ?? undefined,
          minSamplePct: cfg.minSamplePct ?? 0
        })
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
        setStatus('done')
        void window.api.writeTempFile(
          dir,
          `${id}.standardized.csv`,
          rowsToCsv(std.rows as unknown as Array<Record<string, unknown>>)
        )
        get().invalidateDownstream(id)
      } else if (kind === 'compare') {
        if (upResult?.kind !== 'standardize') {
          setStatus('error', 'Connect a Standardize node upstream.')
          return
        }
        const std = upResult.std
        const cfg = node.data.config as CompareConfig

        let cmp: CompareTableResult
        if (cfg.analysis === 'veh_norm') {
          let pairNum = cfg.pairNum
          let pairDen = cfg.pairDen
          if (!pairNum || !pairDen) {
            const g = guessPair(std.compounds)
            pairNum = pairNum || g.num
            pairDen = pairDen || g.den
            get().updateConfig(id, { pairNum, pairDen })
          }
          if (!pairNum || !pairDen) {
            setStatus('error', 'Choose a treatment and a vehicle compound.')
            return
          }
          setStatus('running')
          cmp = await engine.vehNorm({
            rows: std.rows,
            pairs: [[pairNum, pairDen]],
            activeConditions: std.activeConditions,
            method: cfg.method,
            transform: cfg.transform,
            threshold: cfg.threshold
          })
        } else if (cfg.analysis === 'direct') {
          if (!cfg.pairNum || !cfg.pairDen) {
            setStatus('error', 'Choose a numerator and denominator level.')
            return
          }
          setStatus('running')
          cmp = await engine.direct({
            rows: std.rows,
            condition: cfg.condition,
            pairs: [[cfg.pairNum, cfg.pairDen]],
            activeConditions: std.activeConditions,
            method: cfg.method,
            transform: cfg.transform,
            threshold: cfg.threshold
          })
        } else {
          if (!cfg.pairNum || !cfg.pairDen || !cfg.pair2Num || !cfg.pair2Den) {
            setStatus('error', 'Choose a level pair for each of the two factors.')
            return
          }
          setStatus('running')
          cmp = await engine.twoWayAnova({
            rows: std.rows,
            factors: [
              { condition: cfg.condition, pairs: [[cfg.pairNum, cfg.pairDen]] },
              { condition: cfg.condition2, pairs: [[cfg.pair2Num, cfg.pair2Den]] }
            ],
            activeConditions: std.activeConditions,
            threshold: cfg.threshold
          })
        }
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        set((s) => ({
          results: { ...s.results, [id]: { kind: 'compare', cmp, displayMap: std.displayMap } }
        }))
        setStatus('done')
        const dir = get().dataDir
        if (dir)
          void window.api.writeTempFile(
            dir,
            `${id}.${cfg.analysis}.csv`,
            rowsToCsv(cmp.rows as unknown as Array<Record<string, unknown>>)
          )
        get().invalidateDownstream(id)
      } else if (kind === 'contrast') {
        // omicViz model: pool every upstream comparison's rows, then split them by two
        // levels of `condition` (FC1 = pairNum slice, FC2 = pairDen slice).
        const cfg = node.data.config as ContrastConfig
        const ups = state.upstreamIds(id)
        const cmps = ups
          .map((u) => state.results[u])
          .filter((r): r is Extract<NodeResult, { kind: 'compare' }> => r?.kind === 'compare')
        if (!cmps.length) {
          setStatus('error', 'Connect a Compare tile and run it first.')
          return
        }
        const pooled = cmps.flatMap((r) => r.cmp.rows)
        if (!pooled.length) {
          setStatus('error', 'The upstream comparison has no results.')
          return
        }
        if (!cfg.pairNum || !cfg.pairDen) {
          setStatus('error', `Choose two ${cfg.condition} levels to contrast.`)
          return
        }
        setStatus('running')
        const ctr = await engine.contrast({
          rows: pooled,
          condition: cfg.condition,
          pair: [cfg.pairNum, cfg.pairDen],
          relationship: cfg.relationship
        })
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        set((s) => ({
          results: {
            ...s.results,
            [id]: {
              kind: 'contrast',
              ctr,
              displayMap: cmps[0].displayMap
            }
          }
        }))
        setStatus('done')
        const dir = get().dataDir
        if (dir)
          void window.api.writeTempFile(
            dir,
            `${id}.contrast.csv`,
            rowsToCsv(ctr.rows as unknown as Array<Record<string, unknown>>)
          )
        get().invalidateDownstream(id)
      }
    } catch (err) {
      // A cancel terminates the worker (rejecting here) but already reset status to idle.
      if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return
      setStatus('error', err instanceof Error ? err.message : String(err))
    }
  },

  cancelNode: (id) => {
    engine.cancel()
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, status: 'idle', error: undefined } }
          : n
      )
    }))
  },

  runAll: async () => {
    if (get().runningAll) return
    const { nodes, edges } = get()
    const steps = nodes.filter(isStep)
    const ids = new Set(steps.map((n) => n.id))
    // Kahn topological sort so a step never runs before its upstream is done.
    const indeg = new Map<string, number>(steps.map((n) => [n.id, 0]))
    const dag = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    for (const e of dag) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1)
    const queue = steps.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id)
    const order: string[] = []
    while (queue.length) {
      const id = queue.shift() as string
      order.push(id)
      for (const e of dag) {
        if (e.source !== id) continue
        const d = (indeg.get(e.target) ?? 0) - 1
        indeg.set(e.target, d)
        if (d === 0) queue.push(e.target)
      }
    }
    for (const n of steps) if (!order.includes(n.id)) order.push(n.id) // cycle safety

    set({ runningAll: true })
    for (const id of order) {
      if (!get().runningAll) break // stopped by the user
      const kind = get().nodeKind(id)
      if (!kind || !NODE_SPECS[kind].hasRun) continue
      await get().runNode(id)
      // a failed step means everything downstream would fail too → stop the chain
      if (get().nodes.find((n) => n.id === id)?.data.status === 'error') break
    }
    set({ runningAll: false })
  },

  stopAll: () => {
    engine.cancel()
    set((s) => ({
      runningAll: false,
      nodes: s.nodes.map((n) =>
        isStep(n) && n.data.status === 'running'
          ? { ...n, data: { ...n.data, status: 'idle', error: undefined } }
          : n
      )
    }))
  },

  invalidateDownstream: (id) => {
    const { nodes, edges, results } = get()
    const downstream = new Set<string>()
    let frontier = edges.filter((e) => e.source === id).map((e) => e.target)
    while (frontier.length) {
      const next: string[] = []
      for (const t of frontier) {
        if (!downstream.has(t)) {
          downstream.add(t)
          next.push(...edges.filter((e) => e.source === t).map((e) => e.target))
        }
      }
      frontier = next
    }
    if (downstream.size === 0) return
    const clearedResults = { ...results }
    for (const d of downstream) delete clearedResults[d]
    set({
      results: clearedResults,
      nodes: nodes.map((n) =>
        downstream.has(n.id) && isStep(n)
          ? { ...n, data: { ...n.data, status: 'idle', error: undefined } }
          : n
      )
    })
  },

  markStale: (id) => {
    const results = { ...get().results }
    delete results[id]
    set((s) => ({
      results,
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, status: 'idle', error: undefined } }
          : n
      )
    }))
    get().invalidateDownstream(id)
  },

  upstreamId: (id) => get().edges.find((e) => e.target === id)?.source,
  upstreamIds: (id) =>
    get()
      .edges.filter((e) => e.target === id)
      .map((e) => e.source),
  nodeKind: (id) => {
    const n = get().nodes.find((x) => x.id === id)
    return n && isStep(n) ? n.data.kind : undefined
  },

  // ── project (.omicexplorer) → folders → workflows ────────────────────────
  initProject: () => {
    // Show the home page on launch; a project is created/opened from there.
    set({ recentProjects: loadRecents(), projectOpen: false })
    return Promise.resolve()
  },
  goHome: () => {
    // Flush live edits back into the project so switching away loses nothing.
    if (get().projectOpen) syncActiveSlot(get, set)
    set({ projectOpen: false })
  },
  newProject: () => {
    const proj = newProjectFile()
    set({
      projectPath: null,
      projectName: proj.name,
      projectOpen: true,
      folders: proj.folders,
      activeFolderId: proj.activeFolderId,
      dirty: false,
      inputFiles: []
    })
    loadSlot(get, set, proj.activeFolderId)
  },
  openProject: async (path) => {
    let p = path ?? null
    let text: string
    if (p) {
      text = await window.api.readProject(p)
    } else {
      const picked = await window.api.openProject()
      if (!picked) return
      p = picked.path
      text = picked.content
    }
    const proj = deserializeProject(text)
    // The project's display name follows its filename (like Save As), so renaming the
    // `.omicexplorer` file renames the project; fall back to the embedded name if the
    // path is somehow missing.
    const nameFromPath = p ? (p.split(/[/\\]/).pop() ?? '').replace(/\.omicexplorer$/i, '') : ''
    const projectName = nameFromPath || proj.name
    set({
      projectPath: p,
      projectName,
      projectOpen: true,
      folders: proj.folders,
      activeFolderId: proj.activeFolderId,
      dirty: false,
      recentProjects: pushRecent(get().recentProjects, { path: p as string, name: projectName })
    })
    loadSlot(get, set, proj.activeFolderId)
    await get().refreshDataFiles()
  },
  saveProject: async () => {
    syncActiveSlot(get, set)
    if (!get().projectPath) return get().saveProjectAs()
    const path = get().projectPath as string
    await window.api.saveProject(path, serializeProject(buildProjectFile(get)))
    set({
      dirty: false,
      recentProjects: pushRecent(get().recentProjects, { path, name: get().projectName })
    })
    return true
  },
  saveProjectAs: async () => {
    const path = await window.api.pickProjectSavePath(get().projectName)
    if (!path) return false
    const name = (path.split(/[/\\]/).pop() ?? 'project').replace(/\.omicexplorer$/i, '')
    syncActiveSlot(get, set)
    set({ projectPath: path, projectName: name })
    await window.api.saveProject(path, serializeProject(buildProjectFile(get)))
    set({ dirty: false, recentProjects: pushRecent(get().recentProjects, { path, name }) })
    return true
  },
  refreshDataFiles: async () => {
    const dir = get().dataDir
    if (!dir) {
      set({ inputFiles: [], dataDirMissing: false })
      return
    }
    // Existence check is best-effort: an older preload build (before a full restart)
    // may not expose pathExists yet, and a probe failure must never wipe the file
    // list — otherwise the Load dropdowns go empty even though the files are readable.
    let missing = false
    try {
      if (typeof window.api.pathExists === 'function') {
        missing = !(await window.api.pathExists(dir)).dir
      }
    } catch {
      missing = false
    }
    if (get().dataDir !== dir) return // switched folders while awaiting
    if (missing) {
      set({ inputFiles: [], dataDirMissing: true })
      return
    }
    set({ inputFiles: await window.api.listDataFiles(dir), dataDirMissing: false })
  },

  // ── folders ─────────────────────────────────────────────────────────────
  addFolder: async () => {
    const path = await window.api.pickDataDir()
    if (!path) return
    syncActiveSlot(get, set)
    const folder = newFolder(path)
    set({ folders: [...get().folders, folder], dirty: true })
    loadSlot(get, set, folder.id)
    await get().refreshDataFiles()
  },
  switchFolder: (id) => {
    if (id === get().activeFolderId) return
    syncActiveSlot(get, set)
    loadSlot(get, set, id)
    void get().refreshDataFiles()
  },
  deleteFolder: (id) => {
    const list = get().folders
    if (list.length <= 1) return // a project always keeps at least one folder
    const remaining = list.filter((f) => f.id !== id)
    const wasActive = get().activeFolderId === id
    set({ folders: remaining, dirty: true })
    if (wasActive) {
      loadSlot(get, set, remaining[0].id)
      void get().refreshDataFiles()
    }
  },
  renameFolder: (id, name) => {
    const clean = name.trim() || 'Folder'
    set({
      folders: get().folders.map((f) => (f.id === id ? { ...f, name: clean } : f)),
      dirty: true
    })
  },
  repathFolder: async (id) => {
    const path = await window.api.pickDataDir()
    if (!path) return
    const name = path.split(/[/\\]/).pop() ?? path
    set({
      folders: get().folders.map((f) => (f.id === id ? { ...f, path, name } : f)),
      dirty: true
    })
    if (get().activeFolderId === id) {
      set({ dataDir: path })
      await get().refreshDataFiles()
    }
  },

  // ── recent projects ──────────────────────────────────────────────────────
  forgetRecent: (path) => {
    set({ recentProjects: removeRecent(get().recentProjects, path) })
  },
  pruneMissingRecents: async () => {
    const list = get().recentProjects
    if (list.length === 0 || typeof window.api.pathExists !== 'function') return
    try {
      const checks = await Promise.all(
        list.map((r) => window.api.pathExists(r.path).then((e) => e.exists))
      )
      const kept = list.filter((_, i) => checks[i])
      if (kept.length !== list.length) set({ recentProjects: saveRecents(kept) })
    } catch {
      // best-effort — leave recents untouched on any probe failure
    }
  },

  // ── workflows (within the active folder) ─────────────────────────────────
  addWorkflow: (name) => {
    syncActiveSlot(get, set)
    const folder = activeFolder(get())
    if (!folder) return
    const wf = emptyWorkflow(name?.trim() || `Workflow ${folder.workflows.length + 1}`)
    set({
      folders: get().folders.map((f) =>
        f.id === folder.id ? { ...f, workflows: [...f.workflows, wf], activeWorkflowId: wf.id } : f
      ),
      dirty: true
    })
    loadSlot(get, set, folder.id, wf.id)
  },
  switchWorkflow: (id) => {
    if (id === get().activeWorkflowId) return
    syncActiveSlot(get, set)
    const fid = get().activeFolderId
    if (fid) loadSlot(get, set, fid, id)
  },
  renameWorkflow: (id, name) => {
    const clean = name.trim() || 'Workflow'
    set({
      folders: get().folders.map((f) => ({
        ...f,
        workflows: f.workflows.map((w) => (w.id === id ? { ...w, name: clean } : w))
      })),
      dirty: true
    })
  },
  deleteWorkflow: (id) => {
    const folder = activeFolder(get())
    if (!folder || folder.workflows.length <= 1) return // keep at least one workflow
    const remaining = folder.workflows.filter((w) => w.id !== id)
    const wasActive = get().activeWorkflowId === id
    set({
      folders: get().folders.map((f) => (f.id === folder.id ? { ...f, workflows: remaining } : f)),
      dirty: true
    })
    if (wasActive) loadSlot(get, set, folder.id, remaining[0].id)
  },
  setGroupLayout: (rootId, layout) => {
    set((s) => ({ groupLayouts: { ...s.groupLayouts, [rootId]: layout }, dirty: true }))
  },
  resetGroupLayout: (rootId) => {
    set((s) => {
      if (!(rootId in s.groupLayouts)) return {}
      const next = { ...s.groupLayouts }
      delete next[rootId]
      return { groupLayouts: next, dirty: true }
    })
  },

  // ── undo / redo ────────────────────────────────────────────────────────────
  commit: () => {
    const { nodes, edges, nextId, past } = get()
    const snap: Snapshot = {
      nodes: structuredClone(nodes),
      edges: structuredClone(edges),
      nextId
    }
    set({ past: [...past, snap].slice(-50), future: [], dirty: true })
  },
  undo: () => {
    const { past, future, nodes, edges, nextId } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    const cur: Snapshot = { nodes: structuredClone(nodes), edges: structuredClone(edges), nextId }
    set({
      nodes: prev.nodes,
      edges: prev.edges,
      nextId: prev.nextId,
      past: past.slice(0, -1),
      future: [...future, cur],
      results: {},
      selectedId: null,
      dirty: true
    })
  },
  redo: () => {
    const { past, future, nodes, edges, nextId } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    const cur: Snapshot = { nodes: structuredClone(nodes), edges: structuredClone(edges), nextId }
    set({
      nodes: next.nodes,
      edges: next.edges,
      nextId: next.nextId,
      future: future.slice(0, -1),
      past: [...past, cur],
      results: {},
      selectedId: null,
      dirty: true
    })
  }
}))
