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
import {
  buildStandardInputs,
  guessRolesPreset,
  parseMatrix,
  type MatrixPreset
} from '../engine/interactive'
import { applyThreshold, combineStandardize, crossPairs, thresholdLabel } from '../engine'
import type {
  CompareTableResult,
  ConditionKey,
  ContrastResult,
  ContrastSideRow,
  Pair,
  ThresholdConfig
} from '../engine'
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
import { childPanelId } from './groups'
import { loadRecents, pushRecent, removeRecent, saveRecents, type RecentProject } from './recents'
import { canConnect, categoryOf, maxInputsFor, NODE_SPECS } from './registry'
import {
  isStep,
  normalizeCompareConfig,
  resolveLoadMode,
  type CompareConfig,
  type ContrastConfig,
  type FavGene,
  type GeneSet,
  type GraphNode,
  type GroupMeta,
  type InteractiveImport,
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
import { useAppView } from '../ui/useAppView'

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
  /** Live-patch a Compare tile's threshold (from dragging a volcano guide) and re-classify its
   *  ALREADY-COMPUTED result rows in place — no recompute, since only the calls (effect/signf)
   *  depend on the threshold, not the statistics. Keeps the Compare result; stales downstream
   *  COMPUTE nodes (e.g. contrast masks by the compare's per-gene call, so it needs a re-run). */
  setCompareThreshold: (id: string, partial: Partial<ThresholdConfig>) => void
  /** Set (or clear, with '') a tile's user-given name. Label only — never invalidates results. */
  renameNode: (id: string, name: string) => void
  /** Patch one subcard's config inside a group tile (display-only keys don't invalidate). */
  updateChildConfig: (groupId: string, childId: string, partial: Record<string, unknown>) => void
  /** Fold plot tiles that share one upstream into a single group tile (undoable). */
  groupNodes: (ids: string[]) => void
  /** Explode each selected group tile back into standalone plot nodes (undoable). */
  ungroupNodes: (ids: string[]) => void
  /** Append a plot subcard to a group tile and select it (undoable). `override` is merged onto the
   *  kind's default config, so callers can seed e.g. a dose- vs time-response variant of one kind. */
  addGroupChild: (groupId: string, kind: NodeKind, override?: Record<string, unknown>) => void
  /** Append several plot subcards to a group in ONE undoable step (for category "select all"). */
  addGroupChildren: (
    groupId: string,
    specs: { kind: NodeKind; override?: Record<string, unknown> }[]
  ) => void
  /** Remove a subcard; deletes the whole group tile when it was the last one (undoable). */
  removeGroupChild: (groupId: string, childId: string) => void
  /** Remove several subcards by id in ONE undoable step; deletes the tile if none remain. */
  removeGroupChildren: (groupId: string, childIds: string[]) => void
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
  /** last error from opening a project (shown on the Home screen); null when none */
  openError: string | null

  initProject: () => Promise<void>
  goHome: () => void
  /** Re-enter the in-memory project after goHome, preserving any unsaved changes (no disk reload). */
  resumeProject: () => void
  newProject: () => void
  openProject: (path?: string) => Promise<void>
  /** returns true if written (false if cancelled at the save-as dialog) */
  saveProject: () => Promise<boolean>
  saveProjectAs: () => Promise<boolean>
  refreshDataFiles: () => Promise<void>
  /** Interactive mode: read the matrix, list its columns, and seed default column roles for the
   *  step-1 classifier. Replaces any prior import spec. */
  detectInteractive: (
    id: string,
    preset?: MatrixPreset
  ) => Promise<{ ok: boolean; error?: string; count?: number }>
  /** Interactive mode: patch the import spec (roles / conditions) being edited (no undo entry). */
  setInteractive: (id: string, patch: Partial<InteractiveImport>) => void
  /** Interactive mode: convert the chosen matrix into the three standard input files (using the
   *  kept samples + their conditions), write them to input/, and point the Load tile's
   *  standard fields at them. */
  convertInteractive: (id: string) => Promise<{
    ok: boolean
    error?: string
    files?: { data: string; samplesheet: string; db: string }
  }>

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
  /** Persist the results-page tab order (rootIds in the new left→right order). */
  reorderGroups: (orderedRootIds: string[]) => void

  // ── custom genesets: named, saved gene selections (persisted with the workflow) ──
  geneSets: GeneSet[]
  /** Create a geneset from `genes` (typically the current selection); returns its new id. */
  createGeneSet: (name: string, genes: FavGene[]) => string
  /** Rename a geneset. */
  renameGeneSet: (id: string, name: string) => void
  /** Replace a geneset's member genes (e.g. save the current selection into it). */
  updateGeneSetGenes: (id: string, genes: FavGene[]) => void
  /** Delete a geneset. */
  deleteGeneSet: (id: string) => void
  /** Toggle a geneset's HIDDEN flag — masking its genes non-significant across every comparison /
   *  contrast result in the project (re-applied in place; contrasts go stale for re-run). */
  toggleGeneSetHidden: (id: string) => void

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

/** Raise the store-selected node's React Flow zIndex so its config-detail float (which floats to
 *  the right of the tile, over neighbours) always paints above sibling tiles — a node's own
 *  zIndex governs the whole `.react-flow__node` stacking context, which the float can't escape. */
const SELECTED_Z = 1000
function elevate(nodes: GraphNode[], selId: string | null): GraphNode[] {
  return nodes.map((n) => {
    const z = n.id === selId ? SELECTED_Z : undefined
    return n.zIndex === z ? n : { ...n, zIndex: z }
  })
}

/** Rewrite dashboard-layout panel ids (`PanelLayoutItem.i`) through `idMap`, preserving each
 *  tile's saved position and size. Group/ungroup mint fresh node & subcard ids, so without this
 *  the old layout entries no longer match any panel and reconcileLayout resets them to defaults. */
function remapLayouts(
  layouts: Record<string, PanelLayoutItem[]>,
  idMap: Map<string, string>
): Record<string, PanelLayoutItem[]> {
  return Object.fromEntries(
    Object.entries(layouts).map(([rid, items]) => [
      rid,
      items.map((it) => (idMap.has(it.i) ? { ...it, i: idMap.get(it.i)! } : it))
    ])
  )
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
    groupMeta: s.groupMeta,
    geneSets: s.geneSets
  })
}

const activeFolder = (s: GraphState): ProjectFolder | undefined =>
  s.folders.find((f) => f.id === s.activeFolderId)

/** The active workflow's name. READS pass this always: main tries the per-workflow subfolder first
 *  then falls back to the shared data-folder root, so a file resolves whether it was written nested
 *  (multi-workflow folder) or flat (single workflow, or a pre-workflow-level project) — which also
 *  makes growing/shrinking the workflow count safe. undefined when no workflow is active. */
const readScope = (s: GraphState): string | undefined =>
  activeFolder(s)?.workflows.find((w) => w.id === s.activeWorkflowId)?.name

/** WRITES nest generated files under the workflow subfolder ONLY when the data folder holds more
 *  than one workflow; a lone workflow writes straight into the shared data folder (no needless
 *  nesting). undefined = write to the root input/temp dirs. */
const writeScope = (s: GraphState): string | undefined => {
  const folder = activeFolder(s)
  return folder && folder.workflows.length > 1 ? readScope(s) : undefined
}

/** Union of every HIDDEN geneset's gene uniqIDs — the project-wide significance mask. */
const hiddenGeneIds = (s: GraphState): Set<string> => {
  const ids = new Set<string>()
  for (const g of s.geneSets) if (g.hidden) for (const gene of g.genes) ids.add(gene.id)
  return ids
}

/** Force the masked genes non-significant on a result's rows (leaves everything else untouched). */
function maskSignf<T extends { uniqID: string; signf: boolean; effect: string }>(
  rows: T[],
  hidden: Set<string>
): T[] {
  if (hidden.size === 0) return rows
  return rows.map((r) => (hidden.has(r.uniqID) ? { ...r, signf: false, effect: 'none' } : r)) as T[]
}

/** Re-apply the geneset significance mask across the whole project after a hidden-set change.
 *  Compare results are re-classified in place (recompute signf from the node's threshold, then
 *  mask) — cheap and live. Contrasts mask by the compare's per-gene call, so any already-computed
 *  contrast is AUTO-RECOMPUTED (no manual re-run) against the freshly re-classified compares —
 *  like a threshold drag, carried through to completion. */
function reapplyGeneMask(get: Getter, set: Setter): void {
  const hidden = hiddenGeneIds(get())
  const results = { ...get().results }
  for (const n of get().nodes) {
    if (!isStep(n)) continue
    const res = results[n.id]
    if (res?.kind !== 'compare') continue
    const threshold = (n.data.config as CompareConfig).threshold
    const label = thresholdLabel(threshold)
    const rows = res.cmp.rows.map((r) => {
      const stat = threshold.statType === 'pP' ? r.pP : r.pQ
      const cls = applyThreshold(r.log2FC ?? NaN, stat ?? NaN, threshold)
      const signf = cls.signf && !hidden.has(r.uniqID)
      return { ...r, thrsh: label, signf, effect: signf ? cls.effect : 'none' }
    })
    results[n.id] = { ...res, cmp: { ...res.cmp, rows } }
  }
  set({ results })
  // Re-run every already-computed contrast so the mask propagates downstream automatically.
  for (const n of get().nodes)
    if (isStep(n) && n.data.kind === 'contrast' && get().results[n.id]) void get().runNode(n.id)
}

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
    geneSets: loaded.geneSets,
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
  const av = useAppView.getState()
  return {
    format: 'omicexplorer-project',
    version: 2,
    name: s.projectName,
    folders: s.folders,
    activeFolderId: s.activeFolderId ?? s.folders[0]?.id ?? '',
    // Persist which page the user was on so opening the project resumes it (see openProject).
    view: av.view,
    resultsTab: av.resultsTab
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
  openError: null,
  groupLayouts: {},
  groupMeta: {},
  geneSets: [],
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
    // contrast and compare take two inputs; every other node takes one.
    const maxInputs = maxInputsFor(tgt.data.kind)
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
    const maxInputs = maxInputsFor(tgt.data.kind)
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
      nodes: elevate(
        [...s.nodes.map((n) => (srcIds.has(n.id) ? { ...n, selected: false } : n)), ...copies],
        copies.length === 1 ? copies[0].id : null
      ),
      nextId,
      selectedId: copies.length === 1 ? copies[0].id : null,
      selectedSub: null
    }))
  },

  selectNode: (id) => set((s) => ({ selectedId: id, selectedSub: null, nodes: elevate(s.nodes, id) })),
  selectChildCard: (groupId, childId) =>
    set((s) => ({ selectedId: groupId, selectedSub: childId, nodes: elevate(s.nodes, groupId) })),
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

  setCompareThreshold: (id, partial) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind !== 'compare') return
    const cur = (node.data.config as CompareConfig).threshold
    const threshold: ThresholdConfig = { ...cur, ...partial }
    // No-op guard: dragging that lands back on the same value shouldn't spawn an undo step or
    // needlessly stale a downstream contrast.
    if (
      threshold.type === cur.type &&
      threshold.fcLow === cur.fcLow &&
      threshold.fcHigh === cur.fcHigh &&
      threshold.statMin === cur.statMin &&
      threshold.b === cur.b &&
      threshold.s0 === cur.s0 &&
      threshold.statType === cur.statType
    )
      return
    get().commit()
    // Patch the threshold on the Compare config WITHOUT going through updateConfig — the statistics
    // are unchanged, so the compare must stay `done` (updateConfig would stale it and force a re-run).
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? {
              ...n,
              data: {
                ...n.data,
                config: { ...(n.data.config as CompareConfig), threshold } as NodeConfig
              }
            }
          : n
      )
    }))
    // Re-classify the stored result rows in place: only thrsh/signf/effect depend on the threshold
    // (log2FC, pP, pQ are already final). Cheap enough to run synchronously on the UI thread.
    const res = get().results[id]
    if (res?.kind === 'compare') {
      const label = thresholdLabel(threshold)
      const hidden = hiddenGeneIds(get())
      const rows = res.cmp.rows.map((r) => {
        const stat = threshold.statType === 'pP' ? r.pP : r.pQ
        const cls = applyThreshold(r.log2FC ?? NaN, stat ?? NaN, threshold)
        const signf = cls.signf && !hidden.has(r.uniqID) // keep the geneset mask across threshold edits
        return { ...r, thrsh: label, signf, effect: signf ? cls.effect : 'none' }
      })
      set((s) => ({
        results: { ...s.results, [id]: { ...res, cmp: { ...res.cmp, rows } } }
      }))
    }
    // Downstream COMPUTE nodes (contrast) mask by the compare's per-gene call, so a threshold change
    // genuinely invalidates them → stale for re-run. Downstream plot nodes just re-render live.
    get().invalidateDownstream(id)
  },

  renameNode: (id, name) => {
    get().commit()
    const trimmed = name.trim()
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, name: trimmed || undefined } }
          : n
      )
    }))
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
    // Each spec's CURRENT dashboard panel id, parallel to `specs`: a group subcard is
    // `${groupId}::${childId}`; a plain plot is its own node id. Remapped onto the new subcard
    // ids below so the tiles keep their saved grid position/size across the regroup.
    const oldPanelIds = sel.flatMap((n) =>
      n.data.kind === 'plotGroup'
        ? (n.data.config as PlotGroupConfig).children.map((c) => childPanelId(n.id, c.id))
        : [n.id]
    )
    const startId = get().nextId
    const children = toChildren(specs, startId)
    const groupId = `plotGroup-${startId + specs.length}`
    const layoutRemap = new Map<string, string>()
    children.forEach((c, i) => layoutRemap.set(oldPanelIds[i], childPanelId(groupId, c.id)))
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
        nodes: elevate(
          [...s.nodes.filter((n) => !selIds.has(n.id)), makeGroupNode(groupId, pos, children)],
          groupId
        ),
        edges: [
          ...s.edges.filter((e) => !selIds.has(e.target) && !selIds.has(e.source)),
          { id: `e-${upstream}-${groupId}`, source: upstream, target: groupId }
        ],
        results,
        groupLayouts: remapLayouts(s.groupLayouts, layoutRemap),
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
    // Each freed subcard becomes a standalone plot node; carry its saved grid slot over by
    // remapping the old `${groupId}::${childId}` panel id to the new node id (see remapLayouts).
    const layoutRemap = new Map<string, string>()
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
        layoutRemap.set(childPanelId(g.id, c.id), nid)
        if (upstream) addEdges.push({ id: `e-${upstream}-${nid}`, source: upstream, target: nid })
      })
      removeIds.add(g.id)
    }
    set((s) => ({
      nodes: elevate(
        [...s.nodes.filter((n) => !removeIds.has(n.id)), ...addNodes],
        addNodes[0]?.id ?? null
      ),
      edges: [
        ...s.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
        ...addEdges
      ],
      groupLayouts: remapLayouts(s.groupLayouts, layoutRemap),
      nextId,
      selectedId: addNodes[0]?.id ?? null,
      selectedSub: null
    }))
  },

  addGroupChild: (groupId, kind, override) => {
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
    get().commit()
    const config = { ...NODE_SPECS[kind].defaultConfig(), ...(override ?? {}) } as NodeConfig
    const [child] = toChildren([{ kind, config }], get().nextId)
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

  addGroupChildren: (groupId, specs) => {
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup' || specs.length === 0) return
    get().commit()
    const startId = get().nextId
    const added = toChildren(
      specs.map((s) => ({
        kind: s.kind,
        config: { ...NODE_SPECS[s.kind].defaultConfig(), ...(s.override ?? {}) } as NodeConfig
      })),
      startId
    )
    set((s) => ({
      nextId: startId + added.length,
      selectedSub: added[added.length - 1].id,
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n)) return n
        const cfg = n.data.config as PlotGroupConfig
        return { ...n, data: { ...n.data, config: { children: [...cfg.children, ...added] } } }
      })
    }))
  },

  removeGroupChildren: (groupId, childIds) => {
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup' || childIds.length === 0) return
    const drop = new Set(childIds)
    const remaining = (group.data.config as PlotGroupConfig).children.filter((c) => !drop.has(c.id))
    get().commit()
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

    try {
      if (kind === 'standardize') {
        const loadNode = upId ? state.nodes.find((n) => n.id === upId) : undefined
        const dir = state.dataDir
        const load = loadNode && isStep(loadNode) ? (loadNode.data.config as LoadConfig) : undefined
        if (!loadNode || !isStep(loadNode) || loadNode.data.kind !== 'load' || !dir) {
          setStatus('error', 'Connect a Load tile and set the project data folder.')
          return
        }
        // Interactive mode materializes standard files into input/ (see convertInteractive), so
        // the run always reads the standard three-file inputs — identical to Manual mode.
        if (!load?.data || !load.samplesheet) {
          setStatus(
            'error',
            load && resolveLoadMode(load) === 'interactive'
              ? 'Interactive mode: click “Configure samples…” on the Load tile and convert first.'
              : 'Connect a Load tile with a data file and samplesheet.'
          )
          return
        }
        setStatus('running')
        // Generated standard files may live under the workflow's own subfolder; the read falls back
        // to the shared data-folder root, so a lone workflow's flat files, manual-mode files, and
        // pre-workflow-level projects all still resolve.
        const wf = readScope(state)
        const [dataText, samplesheetText, dbText] = await Promise.all([
          window.api.readDataFile(dir, load.data, wf),
          window.api.readDataFile(dir, load.samplesheet, wf),
          load.db ? window.api.readDataFile(dir, load.db, wf) : Promise.resolve(null)
        ])
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        if (!dataText || !samplesheetText) {
          setStatus(
            'error',
            `Input file not found in the data folder (${load.data}, ${load.samplesheet}).`
          )
          return
        }
        const dataFilename = load.data
        const cfg = node.data.config as StandardizeConfig
        const std = await engine.standardize({
          dataText,
          dataFilename,
          samplesheetText,
          dbText: dbText ?? undefined,
          activeConditions: cfg.activeConditions ?? undefined,
          minSamplePct: cfg.minSamplePct ?? 0,
          minSamplePctPerStrain: cfg.minSamplePctPerStrain ?? false,
          // Global (non-per-row) map from the interactive import — passed straight through so
          // enrichment can group KEGG pathways by category.
          keggCategories: load.interactive?.annotations?.keggCategories
        })
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
        setStatus('done')
        void window.api.writeTempFile(
          dir,
          `${id}.standardized.csv`,
          rowsToCsv(std.rows as unknown as Array<Record<string, unknown>>),
          writeScope(state)
        )
        get().invalidateDownstream(id)
      } else if (kind === 'compare') {
        // Compare accepts up to two Standardize inputs; pool them into one dataset (rows matched
        // across datasets by uniqID) so numerator/denominator/context conditions can be drawn from
        // either. One input is the common case and passes through unchanged.
        const stds = state
          .upstreamIds(id)
          .map((u) => state.results[u])
          .filter((r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize')
          .map((r) => r.std)
        if (stds.length === 0) {
          setStatus('error', 'Connect a Standardize node upstream.')
          return
        }
        const std = combineStandardize(stds)
        // Migrate any legacy veh_norm/direct config to the explicit num/den/match model, and
        // persist it so the stored workflow is updated on first run.
        const cfg = normalizeCompareConfig(node.data.config as CompareConfig)
        if (cfg !== node.data.config)
          get().updateConfig(id, cfg as unknown as Record<string, unknown>)

        let cmp: CompareTableResult
        if (cfg.analysis === 'compare') {
          const numPinned = Object.values(cfg.num).some((v) => v && v.length > 0)
          const denPinned = Object.values(cfg.den).some((v) => v && v.length > 0)
          if (!numPinned || !denPinned) {
            setStatus('error', 'Open “Configure comparison” to define numerator and denominator.')
            return
          }
          setStatus('running')
          cmp = await engine.compare({
            rows: std.rows,
            num: cfg.num,
            den: cfg.den,
            match: cfg.match,
            activeConditions: std.activeConditions,
            method: cfg.method,
            transform: cfg.transform,
            threshold: cfg.threshold
          })
        } else {
          // Build each factor's level pairs from the multi-select numerator/denominator values
          // (so "drugA, drugB vs DMSO" runs both 2×2 interactions); fall back to the single legacy
          // pair fields for older configs.
          const factorPairs = (c: ConditionKey, n1: string, d1: string): Pair[] => {
            const cross = crossPairs(cfg.num[c] ?? [], cfg.den[c] ?? [])
            return cross.length > 0 ? cross : n1 && d1 ? [[n1, d1]] : []
          }
          const p1 = factorPairs(cfg.condition, cfg.pairNum, cfg.pairDen)
          const p2 = factorPairs(cfg.condition2, cfg.pair2Num, cfg.pair2Den)
          if (p1.length === 0 || p2.length === 0) {
            setStatus('error', 'Choose numerator and denominator level(s) for each of the two factors.')
            return
          }
          setStatus('running')
          cmp = await engine.twoWayAnova({
            rows: std.rows,
            factors: [
              { condition: cfg.condition, pairs: p1 },
              { condition: cfg.condition2, pairs: p2 }
            ],
            activeConditions: std.activeConditions,
            threshold: cfg.threshold
          })
        }
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        // Apply the project-wide geneset mask so hidden genes are non-significant from the start.
        cmp = { ...cmp, rows: maskSignf(cmp.rows, hiddenGeneIds(get())) }
        set((s) => ({
          results: {
            ...s.results,
            [id]: {
              kind: 'compare',
              cmp,
              displayMap: std.displayMap,
              annotationMap: std.annotationMap ?? {},
              keggCategories: std.keggCategories ?? {}
            }
          }
        }))
        setStatus('done')
        const dir = get().dataDir
        if (dir)
          void window.api.writeTempFile(
            dir,
            `${id}.${cfg.analysis}.csv`,
            rowsToCsv(cmp.rows as unknown as Array<Record<string, unknown>>),
            writeScope(get())
          )
        get().invalidateDownstream(id)
      } else if (kind === 'contrast') {
        const cfg = node.data.config as ContrastConfig
        const ups = state.upstreamIds(id)
        let ctr: ContrastResult
        let displayMap: Record<string, string>
        if (cfg.source === 'pair') {
          // Pair mode: two same-kind inputs joined side-by-side by uniqID + matched context —
          // two Compares → FC-vs-FC, two Standardizes → mean-log2-abundance-vs-abundance.
          if (ups.length < 2) {
            setStatus('error', 'Pair mode needs two inputs — connect two Compare or two Standardize tiles.')
            return
          }
          const ra = state.results[ups[0]]
          const rb = state.results[ups[1]]
          const okKind = (k?: string): boolean => k === 'compare' || k === 'standardize'
          if (!ra || !rb || !okKind(ra.kind) || rb.kind !== ra.kind) {
            setStatus('error', 'Pair mode needs two run inputs of the SAME kind (two Compares, or two Standardizes).')
            return
          }
          // Compare → log2FC (+ significance); Standardize → per-sample log2 abundance (the engine
          // averages replicates + unmatched dims to the matched context).
          const toSide = (r: NodeResult): ContrastSideRow[] =>
            r.kind === 'compare'
              ? r.cmp.rows.map((row) => ({
                  uniqID: row.uniqID,
                  strain: row.strain ?? null,
                  cmpd: row.cmpd,
                  dose: row.dose,
                  time: row.time,
                  value: row.log2FC,
                  signf: row.signf,
                  effect: row.effect,
                  pP: row.pP,
                  pQ: row.pQ
                }))
              : r.kind === 'standardize'
                ? r.std.rows.map((row) => ({
                    uniqID: row.uniqID,
                    strain: row.strain,
                    cmpd: row.cmpd,
                    dose: row.dose,
                    time: row.time,
                    value: row.value != null && row.value > 0 ? Math.log2(row.value) : null
                  }))
                : []
          const label = (nid: string, fb: string): string => {
            const n = state.nodes.find((x) => x.id === nid)
            return (n && isStep(n) && n.data.name?.trim()) || fb
          }
          setStatus('running')
          ctr = await engine.contrastPair({
            sideA: toSide(ra),
            sideB: toSide(rb),
            match: cfg.match ?? [],
            relationship: cfg.relationship,
            labelA: label(ups[0], 'A'),
            labelB: label(ups[1], 'B'),
            // No per-side significance for abundance pairs → the band is the only divergence call.
            driverMask: ra.kind === 'compare'
          })
          displayMap =
            ra.kind === 'compare' ? ra.displayMap : ra.kind === 'standardize' ? ra.std.displayMap : {}
        } else {
          // Split mode (omicViz): pool every upstream comparison's rows, then split them by two
          // levels of `condition` (FC1 = pairNum slice, FC2 = pairDen slice).
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
          ctr = await engine.contrast({
            rows: pooled,
            condition: cfg.condition,
            pair: [cfg.pairNum, cfg.pairDen],
            relationship: cfg.relationship
          })
          displayMap = cmps[0].displayMap
        }
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        // Mask hidden-geneset genes non-significant (covers pair mode with no per-side driver signf).
        ctr = { ...ctr, rows: maskSignf(ctr.rows, hiddenGeneIds(get())) }
        set((s) => ({ results: { ...s.results, [id]: { kind: 'contrast', ctr, displayMap } } }))
        setStatus('done')
        const dir = get().dataDir
        if (dir)
          void window.api.writeTempFile(
            dir,
            `${id}.contrast.csv`,
            rowsToCsv(ctr.rows as unknown as Array<Record<string, unknown>>),
            writeScope(get())
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
  resumeProject: () => {
    // The project's live state (nodes/edges/folders/dirty) is kept in memory by goHome, so
    // re-entering it simply re-shows the workspace — unsaved changes are still there. Guarded so it
    // is a no-op on a fresh launch with no in-memory project.
    if (get().folders.length > 0) set({ projectOpen: true })
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
    // A fresh project always starts on the Workflow canvas.
    useAppView.getState().setView('canvas')
  },
  openProject: async (path) => {
    set({ openError: null })
    let p = path ?? null
    try {
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
      // Drop dangling path-less placeholder folders once at least one real (path-having) folder
      // exists — these are leftovers from a project's initial empty folder and only clutter the
      // selector as "(no path) —" rows. Always keep at least one folder.
      const hasReal = proj.folders.some((f) => f.path)
      const folders = hasReal ? proj.folders.filter((f) => f.path) : proj.folders
      const activeFolderId = folders.some((f) => f.id === proj.activeFolderId)
        ? proj.activeFolderId
        : folders[0].id
      set({
        projectPath: p,
        projectName,
        projectOpen: true,
        folders,
        activeFolderId,
        dirty: false,
        recentProjects: pushRecent(get().recentProjects, { path: p as string, name: projectName })
      })
      loadSlot(get, set, activeFolderId)
      // Resume the page the user was last on (Workflow canvas vs Results dashboard) and its tab,
      // instead of always dropping onto the canvas.
      useAppView.getState().setView(proj.view ?? 'canvas')
      if (proj.resultsTab) useAppView.getState().setResultsTab(proj.resultsTab)
      await get().refreshDataFiles()
    } catch (e) {
      // Surface the failure instead of a silent no-op (missing file, bad JSON, etc.).
      const msg = e instanceof Error ? e.message : String(e)
      const missing = /ENOENT|no such file/i.test(msg)
      set({
        openError: p
          ? `Couldn't open ${p.split(/[/\\]/).pop() ?? p}: ${missing ? 'file not found' : msg}`
          : `Couldn't open project: ${msg}`
      })
    }
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

  detectInteractive: async (id, preset = 'none') => {
    const s = get()
    const dir = s.dataDir
    if (!dir) return { ok: false, error: 'Set the project data folder first.' }
    const node = s.nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind !== 'load')
      return { ok: false, error: 'Not a Load tile.' }
    const cfg = node.data.config as LoadConfig
    if (!cfg.matrix) return { ok: false, error: 'Choose a data matrix file first.' }
    const matrixText = await window.api.readDataFile(dir, cfg.matrix)
    if (!matrixText)
      return { ok: false, error: `Matrix not found in the data folder (${cfg.matrix}).` }
    let interactive: InteractiveImport
    try {
      const info = parseMatrix(matrixText)
      interactive = { columns: info.columns, roles: guessRolesPreset(info, preset), conditions: {} }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to read the matrix.' }
    }
    get().updateConfig(id, { interactive })
    const sampleCount = Object.values(interactive.roles).filter((r) => r === 'sample').length
    return { ok: true, count: sampleCount }
  },

  setInteractive: (id, patch) => {
    // Editing the import spec shouldn't spam undo history, so patch config in place (no commit).
    // But it MUST mark the project dirty — otherwise the Save button stays disabled and a fetched
    // annotation set (STRING/KEGG ids, etc.) is silently lost on reopen.
    set((st) => ({
      dirty: true,
      nodes: st.nodes.map((n) => {
        if (n.id !== id || !isStep(n)) return n
        const cfg = n.data.config as LoadConfig
        const interactive = { ...(cfg.interactive as InteractiveImport), ...patch }
        return { ...n, data: { ...n.data, config: { ...cfg, interactive } } }
      })
    }))
  },

  convertInteractive: async (id) => {
    const s = get()
    const dir = s.dataDir
    if (!dir) return { ok: false, error: 'Set the project data folder first.' }
    const node = s.nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind !== 'load')
      return { ok: false, error: 'Not a Load tile.' }
    const cfg = node.data.config as LoadConfig
    if (!cfg.matrix) return { ok: false, error: 'Choose a data matrix file first.' }
    const matrixText = await window.api.readDataFile(dir, cfg.matrix)
    if (!matrixText)
      return { ok: false, error: `Matrix not found in the data folder (${cfg.matrix}).` }
    const interactive = cfg.interactive
    if (!interactive) return { ok: false, error: 'Set up the columns first (step 1).' }
    let adapted
    try {
      adapted = buildStandardInputs(matrixText, {
        roles: interactive.roles,
        conditions: interactive.conditions,
        filters: interactive.filters,
        annotations: interactive.annotations
          ? {
              fields: interactive.annotations.fields,
              byId: interactive.annotations.byId,
              taxon: interactive.annotations.taxon
            }
          : undefined
      })
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to build inputs.' }
    }
    // Base the generated names on the matrix; the data file's stem must end with
    // `_wide` so ingest detects the wide format.
    const base = cfg.matrix.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
    const files = {
      data: `${base}_wide.csv`,
      samplesheet: `${base}_samplesheet.csv`,
      db: `${base}_DB.csv`
    }
    // Generated files nest under the workflow's subfolder when the data folder holds more than one
    // workflow (else they go flat into the shared data folder).
    const wf = writeScope(get())
    await window.api.writeInputFile(dir, files.data, adapted.dataText, wf)
    await window.api.writeInputFile(dir, files.samplesheet, adapted.samplesheetText, wf)
    await window.api.writeInputFile(dir, files.db, adapted.dbText, wf)
    // Point the Load tile's standard fields at the generated files — from here the
    // pipeline runs the standard path, identical to a manual custom-format project.
    get().updateConfig(id, { data: files.data, samplesheet: files.samplesheet, db: files.db })
    // Load is `hasRun: false`, so updateConfig won't stale the pipeline — do it here so a
    // (re)conversion forces Standardize to re-run against the freshly written files.
    get().invalidateDownstream(id)
    await get().refreshDataFiles()
    return { ok: true, files }
  },

  // ── folders ─────────────────────────────────────────────────────────────
  addFolder: async () => {
    const path = await window.api.pickDataDir()
    if (!path) return
    const name = path.split(/[/\\]/).pop() ?? path
    // If the active folder is a pristine, path-less placeholder (e.g. a brand-new project's
    // initial "Folder 1"), set ITS path in place instead of appending — otherwise the empty
    // folder lingers in the selector as a "(no path) —" row.
    const active = activeFolder(get())
    if (active && !active.path) {
      set({
        folders: get().folders.map((f) => (f.id === active.id ? { ...f, path, name } : f)),
        dataDir: path,
        dirty: true
      })
      await get().refreshDataFiles()
      return
    }
    syncActiveSlot(get, set)
    const folder = newFolder(path)
    set({ folders: [...get().folders, folder], dirty: true })
    loadSlot(get, set, folder.id)
    useAppView.getState().setView('canvas') // fresh folder → empty workflow, built on the canvas
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
    // A new workflow is empty and built on the canvas — land there rather than leaving the user
    // on a now-blank Results dashboard (which reads as "stuck").
    useAppView.getState().setView('canvas')
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
  reorderGroups: (orderedRootIds) => {
    set((s) => {
      const meta = { ...s.groupMeta }
      orderedRootIds.forEach((rootId, i) => {
        meta[rootId] = { ...(meta[rootId] ?? {}), order: i }
      })
      return { groupMeta: meta, dirty: true }
    })
  },

  createGeneSet: (name, genes) => {
    const id = `gs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
    set((s) => ({
      geneSets: [...s.geneSets, { id, name: name.trim() || 'Untitled', genes }],
      dirty: true
    }))
    return id
  },
  renameGeneSet: (id, name) => {
    set((s) => {
      if (!s.geneSets.some((g) => g.id === id)) return {}
      return {
        geneSets: s.geneSets.map((g) => (g.id === id ? { ...g, name: name.trim() || g.name } : g)),
        dirty: true
      }
    })
  },
  updateGeneSetGenes: (id, genes) => {
    set((s) => {
      if (!s.geneSets.some((g) => g.id === id)) return {}
      return {
        geneSets: s.geneSets.map((g) => (g.id === id ? { ...g, genes } : g)),
        dirty: true
      }
    })
  },
  deleteGeneSet: (id) => {
    set((s) => {
      if (!s.geneSets.some((g) => g.id === id)) return {}
      return { geneSets: s.geneSets.filter((g) => g.id !== id), dirty: true }
    })
    // Deleting a hidden set changes the mask → re-apply.
    reapplyGeneMask(get, set)
  },
  toggleGeneSetHidden: (id) => {
    set((s) => {
      if (!s.geneSets.some((g) => g.id === id)) return {}
      return {
        geneSets: s.geneSets.map((g) => (g.id === id ? { ...g, hidden: !g.hidden } : g)),
        dirty: true
      }
    })
    reapplyGeneMask(get, set)
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
