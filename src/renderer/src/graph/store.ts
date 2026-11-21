/** Zustand store backing the composable pipeline graph. */
import { type Connection, type Edge, type EdgeChange, type NodeChange } from '@xyflow/react'
import { create, type StoreApi } from 'zustand'

import type { ContrastStat, Progress, ScalePreview, ThresholdConfig } from '../engine'
import { type MatrixPreset } from '../engine/interactive'
import { useAppSettings } from '../ui/useAppSettings'
import { useAppView } from '../ui/useAppView'
import { compactResult } from './compactResults'
import { dataFolderName, pathSeg, planRenames } from './diskNames'
import { EXAMPLE_LOAD_CONFIG } from './example'
import { type DropSlot } from './frameOrder'
import { saveLastView } from './lastView'
import { wrapPlot } from './plotGroups'
import { type ProjectFolder, type ProjectHeader } from './project'
import { type RecentProject } from './recents'
import { canvasSlice } from './state/canvas'
import { configSlice } from './state/config'
import { historySlice } from './state/history'
import { importingSlice } from './state/importing'
import { projectSlice, stepTitlesOf } from './state/project'
import { resultsSlice } from './state/results'
import { runSlice } from './state/run'
import {
  type CleanupPlan,
  groupStatus,
  resultHistory,
  makeNode,
  type Snapshot,
  withChildStatuses
} from './state/shared'
import { workspaceSlice } from './state/workspace'
import { type TemplateSections } from './template'
import { type TileClip } from './tileClipboard'
import {
  isStep,
  plotResultKey,
  type CanvasFrame,
  type CondUnits,
  type EffectLabels,
  type FavGene,
  type GeneSet,
  type GraphNode,
  type GroupMeta,
  type InteractiveImport,
  type LoadCheck,
  type NodeKind,
  type NodeResult,
  type PanelLayoutItem,
  type PlotGroupConfig,
  type StepStatus
} from './types'

export interface GraphState {
  nodes: GraphNode[]
  edges: Edge[]
  results: Record<string, NodeResult>
  /** a running step's progress as its engine run reports it (curve fits) — live only: never saved,
   *  cleared when the run ends (the tile's accent strip fills with it) */
  progress: Record<string, Progress>
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
  resolvePlaceholder: (
    id: string,
    picks: { kind: NodeKind; override?: Record<string, unknown> }[]
  ) => void
  /** Discard a placeholder and its pending edge (no history entry). */
  cancelPlaceholder: (id: string) => void
  deleteNode: (id: string) => void
  duplicateNode: (id: string) => void
  /** Duplicate several tiles at once; the copies land on top and become the selection. */
  duplicateNodes: (ids: string[]) => void
  /** These tiles as a copy for the clipboard (see tileClipboard): their configs, links among
   *  them, whole groups and results layouts — null when none is a tile. */
  copyTiles: (ids: string[]) => TileClip | null
  /** Whether a copy came from the open workflow (a paste then lands beside its originals). */
  copiedHere: (clip: TileClip) => boolean
  /** Paste a copy into the open workflow, its top-left tile at `at`: fresh ids, not run, the
   *  pasted tiles selected; a Load tile's converted inputs are copied into this workflow's
   *  folder first. One undo step. Resolves to what was pasted, and the input files that couldn't
   *  be copied. */
  pasteTiles: (
    clip: TileClip,
    at: { x: number; y: number }
  ) => Promise<{ tiles: number; groups: number; errors: string[] }>
  selectNode: (id: string | null) => void
  /** Select a subcard within a group tile (opens that child's config). */
  selectChildCard: (groupId: string, childId: string) => void
  updateConfig: (id: string, partial: Record<string, unknown>) => void
  /** Live-patch a Compare tile's threshold (from dragging a volcano guide) and re-classify its
   *  ALREADY-COMPUTED result rows in place — no recompute, since only the calls (effect/signf)
   *  depend on the threshold, not the statistics. Keeps the Compare result; then re-runs what's
   *  downstream (refreshDownstream) — a Contrast below masks by the compare's per-gene call. */
  setCompareThreshold: (id: string, partial: Partial<ThresholdConfig>) => void
  /** Live-patch a Contrast's statistic cutoffs (from dragging a contrast-scatter guide) and redo
   *  its divergence calls on the ALREADY-COMPUTED rows — no re-run, as setCompareThreshold does for
   *  a Compare; what's downstream then re-runs (refreshDownstream). A result from before the calls
   *  could be redone this way is re-run instead. */
  setContrastStat: (id: string, partial: Partial<ContrastStat>) => void
  /** Rename a Compare's effect classes (display-only: the result stays `done`; undoable). */
  setCompareEffectLabels: (id: string, labels: Partial<EffectLabels>) => void
  /** a Compare's effect colours (unset = the default); display-only, as the labels */
  setCompareEffectColors: (
    id: string,
    colors: Partial<Record<'up' | 'down' | 'none', string | undefined>>
  ) => void
  /** A Curve fit's method label: 'custom', or unset (the preset its detector implies). UI only —
   *  the run reads the models themselves — so it never stales the result. */
  setCurveMethod: (id: string, method: 'custom' | undefined) => void
  /** Set a curve fit's dose unit (pEC50's molar scale). Display-only — never stales the result. */
  /** Set a Load tile's condition units. Display-only — downstream results stay current. */
  setLoadUnits: (id: string, units: CondUnits) => void
  /** Declare a manual Load tile's custom condition numeric or not (its cat/num chip). Unlike its
   *  units this changes the data — Clean data's schema — so everything below goes stale. */
  setLoadNumeric: (
    id: string,
    name: string,
    numeric: boolean,
    /** false: don't stale what's below yet (the interactive import does on Apply) */
    opts?: { stale?: boolean }
  ) => void
  /** Set Clean data's log-transform — the scale its values are PRESENTED on, and the scale a
   *  Compare downstream tests on (log or not). Its own rows stay linear and its result stays as it
   *  is; the Compares (and what follows them) go stale, to be re-run on the new scale. */
  setStdLogTransform: (id: string, logTransform: 'none' | 'log2' | 'log10') => void
  /** Clean data's data-scale preview, straight from its upstream Load step's data file — no run
   *  needed: the detected scale and a value sample. Null when there's no data file to read yet
   *  (no Load wired, or an interactive import not converted). Cached per file name. Fed by Clean
   *  data (a Merge, a Subset of one), from that result instead — null until it has run. */
  previewStdScale: (id: string) => Promise<ScalePreview | null>
  /** Set (or clear, with '') a tile's user-given name. Label only — never invalidates results. */
  renameNode: (id: string, name: string) => void
  /** Move a step to sit just before `beforeId` in the node list (null = to the end). The list is
   *  creation order, which is what the form layout reads as its section order. */
  moveStep: (id: string, beforeId: string | null) => void
  /** Form mode's drag: move a step or a whole group (frame) to `slot`, among its own siblings only
   *  (see frameOrder.dropOrder); a drop that isn't allowed does nothing. */
  moveItem: (item: string, slot: DropSlot) => void
  /** Copy one plot tile's settings onto EVERY other plot of the same kind — standalone tiles and
   *  group subcards alike (undoable). `axis` is left alone: it's what makes a dose-response tile a
   *  dose one, so copying it would retarget the other tiles rather than restyle them. */
  applyConfigToKind: (kind: NodeKind, config: Record<string, unknown>, exceptId?: string) => void
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
  /** Fold (or unfold) the plot lists of the plot groups among `ids` on the canvas (one undo step). */
  setGroupsCollapsed: (ids: string[], collapsed: boolean) => void
  /** Lay the selected tiles out as a left-to-right flow along their edges (undoable; see tidy.ts). */
  tidyNodes: (ids: string[]) => void
  /** Auto-arrange the selected tiles in a neat cascade from the top-left-most (undoable). */
  cascadeNodes: (ids: string[]) => void
  /** Switch a node's operation within its category, resetting config + pruning now-invalid edges. */
  changeOp: (id: string, op: NodeKind) => void

  runNode: (id: string) => Promise<void>
  /** Run a step, then every compute step downstream of it (in wiring order) — after a setting
   *  that changes its result is applied from somewhere other than its own Run button. */
  rerunFrom: (id: string) => Promise<void>
  /** Re-run every runnable step and plot downstream of `id`, in wiring order, keeping what they
   *  show until each is replaced — after `id` changed in place (a threshold drag re-calling it):
   *  a plot drawn straight from its upstream just re-marks (instant); one whose run depends on the
   *  calls (enrichment, STRING) and a Contrast below a Compare recompute. Stops at an error. */
  refreshDownstream: (id: string) => Promise<void>
  cancelNode: (id: string) => void
  /** Run ONE plot inside a group tile (each has its own status; the group is done when all are). */
  runPlotChild: (groupId: string, childId: string) => Promise<void>
  /** True while `runAll` is executing the pipeline. */
  runningAll: boolean
  /** Run every runnable step once, in dependency (topological) order. */
  runAll: () => Promise<void>
  /** Abort an in-progress `runAll` and the step currently running. */
  stopAll: () => void

  /** Reset every strictly-downstream node to idle and clear its cached result — or, `stepsOnly`,
   *  every downstream step but none of the plots (a threshold drag: they redraw / re-run after). */
  invalidateDownstream: (id: string, stepsOnly?: boolean) => void
  /** Mark a node itself (and everything downstream) stale — used on edge changes. */
  markStale: (id: string) => void
  upstreamId: (id: string) => string | undefined
  /** All upstream source ids feeding `id`, in edge (connection) order. */
  upstreamIds: (id: string) => string[]
  nodeKind: (id: string) => NodeKind | undefined

  // ── project (.omicexplorer) → folders → workflows ────────────────────────
  projectPath: string | null
  projectName: string
  /** the app version the open project was created with (saved as its `createdWith`); null for a
   *  file from before 0.3.7, which never recorded it */
  projectCreatedWith: string | null
  /** whether a project is open (false = show the home page) */
  projectOpen: boolean
  /** active folder's path, scanned for input files (kept in sync from folders) */
  dataDir: string | null
  /** this app run's scratch folder: an unsaved project's files live under it until the first save
   *  moves them into the data folder (see graph/diskNames.ts). null until fetched at launch. */
  scratchRoot: string | null
  /** A processing step's output/ folder (absolute) in the active workflow — where its downloads go.
   *  Pins the folder's name on first use. null without a data folder. */
  outputDirFor: (stepId: string) => string | null
  /** A project folder clean-up's plan for this data folder (`folderId`): everything under its
   *  project data folder that the project no longer uses — see planCleanup. Null when the project
   *  has no data folder there. Reads the disk; changes nothing. */
  planCleanup: (folderId: string) => Promise<CleanupPlan | null>
  /** Delete what a clean-up plan lists (only inside its project data folder), then forget the
   *  deleted steps' output folder names. Returns what couldn't be removed. */
  applyCleanup: (plan: CleanupPlan) => Promise<string[]>
  /** The active workflow's output/ folder (absolute), and each listed processing step's subfolder
   *  name in it (pinned on first use) — for the Export window. null without a data folder. */
  outputLayoutFor: (stepIds: string[]) => { root: string; names: Record<string, string> } | null
  /** A processing step's output/ subfolder name in a given workflow (pinned on first use) — for
   *  background writers that must stay with the workflow they started in. */
  outputSubdirFor: (stepId: string, folderId: string, workflowId: string) => string | null
  dirty: boolean
  /** input files available in the active data folder */
  inputFiles: string[]
  /** each input file's folder, relative to the data folder ('' = the folder itself); empty with an
   *  older main process (before a restart) */
  inputFileFolders: Record<string, string>
  /** the active folder has a path set, but it no longer exists on disk */
  dataDirMissing: boolean
  folders: ProjectFolder[]
  activeFolderId: string | null
  /** active workflow within the active folder; its live state is nodes/edges/results */
  activeWorkflowId: string | null
  /** recently opened/saved projects (persisted to localStorage) */
  recentProjects: RecentProject[]
  /** each recent project file's header (format, saved by, created with), read from disk for the
   *  home page's version tags; a path missing here hasn't been read (or couldn't be) */
  recentHeaders: Record<string, ProjectHeader>
  /** of those saved before the last upgrade (upgradesDue), whether the upgrades change them
   *  (upgradeChanges) — only one that changes is flagged older; a path missing here isn't known */
  recentUpgrades: Record<string, boolean>
  /** last error from opening a project (shown on the Home screen); null when none */
  openError: string | null
  /** the project file being opened, while it loads (an "Opening…" notice covers the window and
   *  takes the clicks meanwhile; a second open is ignored); null otherwise */
  opening: string | null
  /** why the last save failed (cleared by the next successful one) */
  saveError: string | null
  /** the last save went through, but some folders couldn't be renamed/moved to match */
  saveWarning: string | null
  /** a save is being written (the project chip's dot turns into a spinner meanwhile) */
  saving: boolean
  clearSaveError: () => void

  initProject: () => Promise<void>
  goHome: () => void
  /** Re-enter the in-memory project after goHome, preserving any unsaved changes (no disk reload). */
  resumeProject: () => void
  /** Unsaved changes in the in-memory project? Ask Save / Don't Save / Cancel (saving if asked);
   *  resolves true when it's fine to replace the project, false to abort. `action` completes the
   *  prompt's "before …?". */
  confirmDiscard: (action: string) => Promise<boolean>
  newProject: () => Promise<void>
  openProject: (path?: string) => Promise<void>
  /** returns true if written (false if cancelled at the save-as dialog) */
  saveProject: () => Promise<boolean>
  saveProjectAs: () => Promise<boolean>
  /** Save a template of the project (see graph/template.ts) keeping `sections`, at a path picked
   *  in the save window; true once written. The project itself is untouched. */
  saveTemplate: (sections: TemplateSections) => Promise<boolean>
  /** Start a new (unsaved) project from a template picked in the open window. */
  newFromTemplate: () => Promise<void>
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
    /** the import's columns the raw file lacks (the conversion didn't run) */
    missing?: string[]
    files?: { data: string; samplesheet: string; db: string }
  }>
  /** Each Load tile's inputs against what was converted / read (checkLoad) — live, never saved. */
  loadChecks: Record<string, LoadCheck>
  /** Check a Load tile's files against what was last converted (interactive) or read by Clean
   *  data (manual): a changed raw file is re-converted with the saved import settings when its
   *  columns still fit; a file changed under Clean data puts it and below out of date. The same
   *  file moved or re-synced (new time, same bytes) is just re-stamped. Sets `loadChecks`. */
  checkLoad: (id: string) => Promise<LoadCheck | undefined>
  /** checkLoad for every Load tile of the open workflow (a project or workflow opened, the window
   *  focused, the data folder re-read). */
  checkLoads: () => Promise<void>
  /** Re-convert an interactive Load tile's raw file with its saved import settings. */
  reconvertLoad: (id: string) => Promise<LoadCheck | undefined>

  /** folders (each a data location with its own workflows) */
  addFolder: () => Promise<void>
  switchFolder: (id: string) => void
  deleteFolder: (id: string) => void
  renameFolder: (id: string, name: string) => void
  /** re-point a folder at a new data directory (e.g. after the old path went missing) */
  repathFolder: (id: string) => Promise<void>
  /** Change a folder's location, taking its data along: the project data folder moves to the new
   *  folder, and the input files its Load tiles read are copied there (originals kept). */
  moveFolder: (id: string) => Promise<void>

  /** recent projects: drop one entry, or prune entries whose file no longer exists */
  forgetRecent: (path: string) => void
  pruneMissingRecents: () => Promise<void>
  /** read the recent project files' headers into recentHeaders */
  loadRecentHeaders: () => Promise<void>
  /** rewrite an older project file in the current format, keeping a copy of the old file beside
   *  it; the open project is saved instead. Returns the backup's path, or an error. */
  upgradeProject: (path: string) => Promise<{ backup?: string; error?: string }>

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

  // ── custom genesets: named, saved gene selections (persisted with the project, shared by
  //    every workflow in it) ──
  geneSets: GeneSet[]
  /** canvas frames: labelled areas around tiles that move them together (Group on the canvas) */
  frames: CanvasFrame[]
  /** Frame the selected tiles and frames (see frames.groupInto: frames nest whole); one undo step. */
  frameNodes: (ids: string[]) => void
  /** Ungroup the selected tiles' frames, handing their members back (see frames.ungroupFrom). */
  unframeNodes: (ids: string[]) => void
  /** Add tiles to a frame and take others out of it (see frames.editMembers); one undo step. */
  editFrame: (id: string, add: string[], remove: string[]) => void
  /** Set the canvas selection to these tiles (or add them, `additive`); a connection is selected
   *  when both its ends are. Selection is kept on tiles only — a frame is selected when all of its
   *  tiles are. Not an undo step. */
  selectTiles: (ids: string[], additive?: boolean) => void
  /** Fold / unfold a group in form mode (its steps hidden under the header); saved with the
   *  workflow, not an undo step. */
  setFrameFolded: (id: string, folded: boolean) => void
  renameFrame: (id: string, label: string) => void
  /** Create a geneset from `genes` (typically the current selection); returns its new id. */
  createGeneSet: (name: string, genes: FavGene[]) => string
  /** Rename a geneset. */
  renameGeneSet: (id: string, name: string) => void
  /** Replace a geneset's member genes (e.g. save the current selection into it). */
  updateGeneSetGenes: (id: string, genes: FavGene[]) => void
  /** Set (or clear, with undefined) a geneset's point colour. */
  setGeneSetColor: (id: string, color: string | undefined) => void
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

// ── seed graph: a ready-to-run default chain the user can extend ────────────────
const seedLoad = makeNode('load-1', 'load', { x: 0, y: 80 })
seedLoad.data.config = { ...EXAMPLE_LOAD_CONFIG }
const SEED_NODES: GraphNode[] = [
  seedLoad,
  makeNode('std-1', 'standardize', { x: 290, y: 80 }),
  makeNode('cmp-1', 'compare', { x: 580, y: 40 }),
  // Visualisations are always plot groups (see plotGroups.ts), even of one plot.
  wrapPlot(makeNode('vol-1', 'volcano', { x: 900, y: 0 }), 'sub-vol-1'),
  wrapPlot(makeNode('heat-1', 'heatmap', { x: 900, y: 210 }), 'sub-heat-1')
]
const SEED_EDGES: Edge[] = [
  { id: 'e-load-std', source: 'load-1', target: 'std-1' },
  { id: 'e-std-cmp', source: 'std-1', target: 'cmp-1' },
  { id: 'e-cmp-vol', source: 'cmp-1', target: 'vol-1' },
  { id: 'e-std-heat', source: 'std-1', target: 'heat-1' }
]

// ── project helpers (module scope; take the store's set/get) ──────────────────
export type Setter = (partial: Partial<GraphState>) => void
export type Getter = () => GraphState

/**
 * The folder renames the next save will make (applyDiskLayout's plain save, worked out without
 * touching the disk): the project data folder after the project, each workflow's folder after the
 * workflow, each step's output/ folder after the step — full path on disk now → the name it gets.
 * Empty for a project not saved yet (its files are in the session scratch, moved in whole on the
 * first save). For the project-folder viewer, to show what a save will rename.
 */
export function pendingRenames(s: GraphState): Map<string, string> {
  const out = new Map<string, string>()
  if (!s.projectPath) return out
  const want = dataFolderName(s.projectName)
  for (const f of s.folders) {
    if (!f.path || !f.dataName) continue
    const root = `${f.path}/${f.dataName}`
    if (f.dataName !== want) out.set(root, want)
    const wfPlan = planRenames(
      f.workflows.map((w) => ({
        key: w.id,
        dir: w.dir ?? pathSeg(w.name, 'Workflow'),
        want: pathSeg(w.name, 'Workflow')
      }))
    )
    for (const p of wfPlan) if (p.to !== p.dir) out.set(`${root}/${p.dir}`, p.to)
    for (const w of f.workflows) {
      const dir = w.dir ?? pathSeg(w.name, 'Workflow')
      const titles = stepTitlesOf(s, f.id, w)
      const tracked = Object.entries(w.outDirs ?? {}).filter(([id]) => titles.has(id))
      const outPlan = planRenames(
        tracked.map(([id, d]) => ({ key: id, dir: d, want: pathSeg(titles.get(id)!, 'Step') }))
      )
      for (const p of outPlan) if (p.to !== p.dir) out.set(`${root}/${dir}/output/${p.dir}`, p.to)
    }
  }
  return out
}

export const useGraph = create<GraphState>()((set, get) => ({
  nodes: SEED_NODES,
  edges: SEED_EDGES,
  results: {},
  progress: {},
  selectedId: 'load-1',
  selectedSub: null,
  canvasSelection: [],
  nextId: 2,
  runningAll: false,

  projectPath: null,
  scratchRoot: null,
  projectName: 'Untitled project',
  projectCreatedWith: null,
  projectOpen: false,
  dataDir: null,
  dirty: false,
  inputFiles: [],
  inputFileFolders: {},
  dataDirMissing: false,
  folders: [],
  activeFolderId: null,
  activeWorkflowId: null,
  recentProjects: [],
  recentHeaders: {},
  recentUpgrades: {},
  openError: null,
  opening: null,
  saveError: null,
  saving: false,
  saveWarning: null,
  groupLayouts: {},
  groupMeta: {},
  loadChecks: {},
  geneSets: [],
  frames: [],
  past: [],
  future: [],
  ...canvasSlice(set, get),
  ...configSlice(set, get),
  ...runSlice(set, get),
  ...projectSlice(set, get),
  ...importingSlice(set, get),
  ...workspaceSlice(set, get),
  ...resultsSlice(set, get),
  ...historySlice(set, get)
}))

// ── undo history's results ──────────────────────────────────────────────────
// After the results or the history change, bring the history cache in line: versions no snapshot
// records are forgotten, replaced ones beyond the few kept hot spill to disk (historyCache.ts).
// Batched to once per tick — a run or an undo changes several fields in a row.
let historySync: ReturnType<typeof setTimeout> | null = null
useGraph.subscribe((s, prev) => {
  if (s.results === prev.results && s.past === prev.past && s.future === prev.future) return
  if (historySync) return
  historySync = setTimeout(() => {
    historySync = null
    const g = useGraph.getState()
    const live = new Set<number>()
    for (const snap of [...g.past, ...g.future])
      for (const id of Object.values(snap.versions ?? {})) live.add(id)
    resultHistory.sync(g.results, live)
  }, 0)
})

// ── large row tables kept columnar ───────────────────────────────────────────
// A results map can take tables built on this thread (a threshold re-call, a step re-run off the
// worker's pool): once the UI is idle, any large one is compacted (compactResults.ts) — its rows
// stay the same array for whatever holds them, and are released once nothing does. Tables that
// arrive from the worker or from a file are columnar already.
const COMPACT_MIN_ROWS = 50000
let compactTimer: ReturnType<typeof setTimeout> | null = null
useGraph.subscribe((s, prev) => {
  if (s.results === prev.results) return
  if (compactTimer) clearTimeout(compactTimer)
  compactTimer = setTimeout(() => {
    compactTimer = null
    for (const r of Object.values(useGraph.getState().results))
      compactResult(r, { keep: true, minRows: COMPACT_MIN_ROWS })
  }, 2000)
})

// ── last-view tracker ─────────────────────────────────────────────────────────
// Remember where the user is in the open project (folder, workflow, page, Results tab) whenever
// any of it changes, keyed by project path — see lastView.ts. Only a project that has a path can
// be reopened, so an unsaved new project is skipped, as is the Home screen.
function rememberLastView(): void {
  const s = useGraph.getState()
  if (!s.projectOpen || !s.projectPath) return
  const av = useAppView.getState()
  saveLastView(s.projectPath, {
    folderId: s.activeFolderId,
    workflowId: s.activeWorkflowId,
    view: av.view,
    resultsTab: av.resultsTab
  })
}
useGraph.subscribe((s, prev) => {
  if (
    s.projectOpen !== prev.projectOpen ||
    s.projectPath !== prev.projectPath ||
    s.activeFolderId !== prev.activeFolderId ||
    s.activeWorkflowId !== prev.activeWorkflowId
  )
    rememberLastView()
})
useAppView.subscribe((s, prev) => {
  if (s.view !== prev.view || s.resultsTab !== prev.resultsTab) rememberLastView()
})

// ── Form → Flow: tidy the canvas ─────────────────────────────────────────────
// The form has no canvas positions to speak of (it stacks steps as a list), so arriving on the
// canvas from it lays every tile out with Tidy — a readable left-to-right flow. Undoable.
useAppSettings.subscribe((s, prev) => {
  if (prev.uiStyle !== 'form' || s.uiStyle !== 'flow') return
  const g = useGraph.getState()
  g.tidyNodes(g.nodes.filter(isStep).map((n) => n.id))
})

// ── plot-group runs kept in step with the group's plots ──────────────────────
// A group tile's plots change in many ways (add, remove, group / ungroup, duplicate, undo …). After
// any of them: each plot's status follows whether its result is held (running and failed ones stay
// as they are), the group's rolls up from its plots', and results of plots no longer in a group are
// dropped. Nodes are replaced only when something actually changed, so a drag costs nothing.
useGraph.subscribe((s, prev) => {
  if (s.nodes === prev.nodes) return
  let changed = false
  const nodes = s.nodes.map((n) => {
    if (!isStep(n) || n.data.kind !== 'plotGroup') return n
    const kids = (n.data.config as PlotGroupConfig).children
    const want = kids.map((c) =>
      c.status === 'running' || (c.status === 'error' && !s.results[plotResultKey(n.id, c.id)])
        ? { status: c.status, error: c.error }
        : { status: (s.results[plotResultKey(n.id, c.id)] ? 'done' : 'idle') as StepStatus }
    )
    const roll = groupStatus(kids.map((c, i) => ({ ...c, ...want[i] })))
    const same =
      kids.every((c, i) => (c.status ?? 'idle') === want[i].status) &&
      n.data.status === roll.status &&
      (n.data.error ?? undefined) === (roll.error ?? undefined)
    if (same) return n
    changed = true
    return withChildStatuses(n, (c) => want[kids.indexOf(c)])
  })
  // Results of plots that are no longer any group's.
  const live = new Set<string>()
  for (const n of nodes)
    if (isStep(n) && n.data.kind === 'plotGroup')
      for (const c of (n.data.config as PlotGroupConfig).children)
        live.add(plotResultKey(n.id, c.id))
  const orphans = Object.keys(s.results).filter((k) => k.includes('/') && !live.has(k))
  if (!changed && orphans.length === 0) return
  const results = { ...s.results }
  for (const k of orphans) delete results[k]
  useGraph.setState({ ...(changed ? { nodes } : null), ...(orphans.length ? { results } : null) })
})

// ── unsaved-changes guard (main-process close prompt) ────────────────────────
// Keep main informed whether the in-memory project is dirty so closing the window can prompt
// (see src/main/close-guard.ts); when the user picks Save there, main asks us to write it.
useGraph.subscribe((s, prev) => {
  if (s.dirty !== prev.dirty || s.projectName !== prev.projectName)
    window.api.setProjectDirty(s.dirty && s.folders.length > 0, s.projectName)
})
window.api.onSaveRequest(() => useGraph.getState().saveProject())

/** The store's set (a patch, or a function of the state). */
export type StoreSet = StoreApi<GraphState>['setState']
