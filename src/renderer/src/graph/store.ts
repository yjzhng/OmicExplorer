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
import {
  applyCurveFdr,
  classifyCompareRow,
  combineStandardize,
  subsetStandardize,
  presentScaleOf,
  replicateLog2FCs,
  stdByGene,
  crossPairs,
  condsIn,
  ctxValue,
  snapStatMin,
  reclassifyContrast,
  thresholdLabel
} from '../engine'
import type {
  CompareResultRow,
  CompareTableResult,
  CondSelector,
  ConditionKey,
  ContrastResult,
  ContrastSideRow,
  ContrastStat,
  Pair,
  ScalePreview,
  StandardRow,
  ThresholdConfig
} from '../engine'
import { EXAMPLE_LOAD_CONFIG } from './example'
import { dropOrder, groupedOrder, type DropSlot } from './frameOrder'
import {
  deserializeProject,
  emptyWorkflow,
  geneMaskKey,
  newFolder,
  newProjectFile,
  packedResultsChunks,
  isNewerVersion,
  ParkedRef,
  PROJECT_VERSION,
  projectHeader,
  type ProjectHeader,
  savedByVersion,
  serializeProjectChunks,
  unpackParked,
  relocateFolders,
  withRelPaths,
  type ProjectFile,
  type ProjectFolder,
  type ProjectWorkflow
} from './project'
import {
  buildTemplate,
  fitTemplateSpec,
  isTemplateSpec,
  isTemplateText,
  projectFromTemplate,
  serializeTemplate,
  TEMPLATE_EXT,
  type TemplateSections
} from './template'
import {
  dataFolderName,
  dataRootOf,
  outDirName,
  pathSeg,
  planRenames,
  withDiskNames,
  workflowDirOf
} from './diskNames'
import { diskWrite, exclusiveDisk } from './diskWrites'
import { childPanelId } from './groups'
import { loadRecents, pushRecent, removeRecent, saveRecents, type RecentProject } from './recents'
import { canConnect, categoryOf, maxInputsFor, NODE_SPECS, stepTitle } from './registry'
import {
  compareFeatureValue,
  contrastFeatures,
  isPairable,
  isSurfaceRow,
  surfaceSideRows,
  pairSides,
  selectSource,
  stdFeatureValue,
  stdGroups,
  toContrastSide,
  type CompareFeatureCtx,
  type ContrastFeature
} from './contrastPair'
import {
  DEFAULT_EFFECT_LABELS,
  isComparisonKind,
  describesAll,
  isContrastConfigured,
  isStep,
  normalizeCompareConfig,
  resolveContrastSource,
  resolveLoadMode,
  condUnitsFor,
  curveDoseUnit,
  type CompareConfig,
  type CondUnits,
  type EffectLabels,
  type ContrastConfig,
  type FavGene,
  cleanupOn,
  imputeOn,
  type CanvasFrame,
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
  plotResultKey,
  type StandardizeConfig,
  type SubsetConfig,
  type StepNode,
  type StepStatus
} from './types'
import { runPlot } from './plotRun'
import { HistoryCache } from './historyCache'
import { restoreResults, underConfig, type PendingLoad } from './undoResults'
import {
  buildWorkflowDoc,
  parseWorkflowDoc,
  type LoadedWorkflow,
  type WorkflowDoc
} from './workflowDoc'
import { useAppSettings } from '../ui/useAppSettings'
import { useAppView } from '../ui/useAppView'
import { loadLastView, saveLastView } from './lastView'
import { groupInto, ungroupFrom, withoutTiles } from './frames'
import { isLonePlot, wrapPlot } from './plotGroups'
import { tidyLayout } from './tidy'
import { downstreamOf, runOrder } from './runOrder'

/** The runs waiting on a running input (by node id, or a group's subcard key — see waitForInputs):
 *  stopping one only stands it down, it doesn't cancel the engine (that's the input's run). */
const waitingRuns = new Set<string>()

/** Hold a run until none of its inputs is running — a downstream tile run while its input still
 *  runs joins the queue rather than failing at once on the input it doesn't have yet. Meanwhile
 *  the run shows as running. False when it was stopped
 *  while waiting (its status set back from running); true to go ahead — the run's own checks then
 *  see the input's outcome (done, failed or stopped). */
async function waitForInputs(
  get: () => GraphState,
  key: string,
  inputs: () => string[],
  mark: () => void,
  stillRunning: () => boolean
): Promise<boolean> {
  const busy = (): GraphNode[] =>
    inputs()
      .map((u) => get().nodes.find((n) => n.id === u))
      .filter((n): n is GraphNode => !!n && isStep(n) && n.data.status === 'running')
  let b = busy()
  if (!b.length) return true
  waitingRuns.add(key)
  mark()
  try {
    while (b.length) {
      await new Promise((res) => setTimeout(res, 200))
      if (!stillRunning()) return false
      b = busy()
    }
    return true
  } finally {
    waitingRuns.delete(key)
  }
}

/** Each plot's latest run (by node id, or a group's subcard key): an older run that finishes after
 *  a newer one started — a tile's switch flipped twice in a row — drops its result. */
const plotRunSeq = new Map<string, number>()
/** The steps whose downstream is being refreshed (refreshDownstream), each flagged when another
 *  refresh was asked for meanwhile. */
const refreshing = new Map<string, { again: boolean }>()
const nextPlotRun = (key: string): number => {
  const n = (plotRunSeq.get(key) ?? 0) + 1
  plotRunSeq.set(key, n)
  return n
}

/** A Compare result re-called under `threshold`: only thrsh/signf/effect (and a curve fit's FDR)
 *  depend on it — log2FC, pP and pQ are final. `hidden` genes stay uncalled (the geneset mask
 *  holds across threshold edits). Shared by a threshold drag and its undo/redo. */
function reclassify(
  res: Extract<NodeResult, { kind: 'compare' }>,
  threshold: ThresholdConfig,
  hidden: Set<string>
): NodeResult {
  const label = thresholdLabel(threshold)
  // A curve fit's target–decoy q-values and FDR follow CurveCurator's alpha and fold-change
  // limits — re-derived from the decoys kept with the result (absent under other thresholds)
  // BEFORE the calls, which (called by FDR) read them.
  const withQ = applyCurveFdr(res.cmp.rows, res.cmp.decoys, threshold)
  const rows = withQ.rows.map((r) => {
    const cls = classifyCompareRow(r, threshold)
    const signf = cls.signf && !hidden.has(r.uniqID)
    return {
      ...r,
      thrsh: label,
      signf,
      effect: signf ? cls.effect : 'none',
      ...(cls.model ? { model: cls.model } : null)
    }
  })
  return {
    ...res,
    cmp: { ...res.cmp, rows, threshold, curveFdr: withQ.fdr, ccAlpha: withQ.alphas }
  }
}

/** undo/redo's re-call of a Compare under the threshold being restored. */
const reclassifyFor =
  (state: GraphState) =>
  (res: Extract<NodeResult, { kind: 'compare' }>, threshold: ThresholdConfig): NodeResult =>
    reclassify(res, threshold, hiddenGeneIds(state))

/** The results behind undo/redo: replaced versions spill to session files (see historyCache.ts).
 *  `window.api` is read per call — it isn't there yet when this module loads in a test. */
const history = new HistoryCache({
  write: (key, pieces) => window.api.parkWrite(key, pieces),
  read: (key) => window.api.parkRead(key),
  drop: (key) => window.api.parkDrop(key),
  pack: packedResultsChunks,
  unpack: unpackParked
})

/** The log transform of the Clean data step a plot reads (its direct input), for the scale its
 *  run follows; undefined when that input isn't a Clean data step. */
function cleanTransformOf(
  nodes: GraphNode[],
  upId: string | undefined
): StandardizeConfig['logTransform'] {
  const n = upId ? nodes.find((x) => x.id === upId) : undefined
  return n && isStep(n) && n.data.kind === 'standardize'
    ? (n.data.config as StandardizeConfig).logTransform
    : undefined
}

/** Keep the node list consistent with the wiring: a step never sits before one of its inputs — and
 *  each group's steps sit together wherever the wiring allows (see frameOrder.groupedOrder). The
 *  list is the form layout's section order, so it has to agree with the edges and groups no matter
 *  which view changed them — hence this runs on every edge or group change rather than inside the
 *  form. Returns the SAME array when nothing needs moving, so an unaffected edit doesn't churn React
 *  Flow's node identity. */
function sortStepsByWiring(nodes: GraphNode[], edges: Edge[], frames: CanvasFrame[]): GraphNode[] {
  const order = nodes.map((n) => n.id)
  const sorted = groupedOrder(order, edges, frames)
  if (sorted.every((id, i) => id === order[i])) return nodes
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return sorted.flatMap((id) => {
    const n = byId.get(id)
    return n ? [n] : []
  })
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
  /** Set Clean data's log-transform — the scale its values are PRESENTED on, and the scale a
   *  Compare downstream tests on (log or not). Its own rows stay linear and its result stays as it
   *  is; the Compares (and what follows them) go stale, to be re-run on the new scale. */
  setStdLogTransform: (id: string, logTransform: 'none' | 'log2' | 'log10') => void
  /** Clean data's data-scale preview, straight from its upstream Load step's data file — no run
   *  needed: the detected scale and a value sample. Null when there's no data file to read yet
   *  (no Load wired, or an interactive import not converted). Cached per file name. */
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
  /** last error from opening a project (shown on the Home screen); null when none */
  openError: string | null
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
    files?: { data: string; samplesheet: string; db: string }
  }>

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

/** What a NEW tile of `op` starts with: the kind's built-in defaults, then the user's own for that
 *  kind (Settings → Customisation → Defaults), then any caller override. Existing tiles are never touched —
 *  changing a default only affects what's added next. */
export function startingConfig(op: NodeKind, override?: Record<string, unknown>): NodeConfig {
  return {
    ...NODE_SPECS[op].defaultConfig(),
    ...(useAppSettings.getState().plotDefaults[op] ?? {}),
    ...(override ?? {})
  } as NodeConfig
}

function makeNode(id: string, op: NodeKind, position: { x: number; y: number }): StepNode {
  return {
    id,
    type: 'step',
    position,
    data: { kind: op, config: startingConfig(op), status: 'idle' }
  }
}

/** Raise the store-selected node's React Flow zIndex so its config-detail float (which floats to
 *  the right of the tile, over neighbours) always paints above sibling tiles — a node's own
 *  zIndex governs the whole `.react-flow__node` stacking context, which the float can't escape. */
const SELECTED_Z = 1_000_000
/** Tiles brought to the front (a plot group just expanded / collapsed — it may now overlap its
 *  neighbours), each above the ones lifted before it; below the selected tile's float. */
const lifted = new Map<string, number>()
let liftTop = 0
function lift(ids: Iterable<string>): void {
  for (const id of ids) lifted.set(id, ++liftTop)
}
function elevate(nodes: GraphNode[], selId: string | null): GraphNode[] {
  return nodes.map((n) => {
    const z = n.id === selId ? SELECTED_Z : lifted.get(n.id)
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

/** The default name for a new frame: "Group n", the lowest n not already taken. */
function nextGroupName(frames: CanvasFrame[]): string {
  const taken = new Set(frames.map((f) => f.label))
  let n = 1
  while (taken.has(`Group ${n}`)) n++
  return `Group ${n}`
}

interface Snapshot {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
  /** absent in a snapshot taken without it (keeps the frames as they are on restore) */
  frames?: CanvasFrame[]
  /** result key → the version it held, kept in the history cache (absent = none recorded) */
  versions?: Record<string, number>
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
    frames: s.frames
  })
}

const activeFolder = (s: GraphState): ProjectFolder | undefined =>
  s.folders.find((f) => f.id === s.activeFolderId)

/** Clean data's data-scale previews, per data file (dir | workflow | name) — a file is parsed once
 *  per session for its preview; a re-converted import writes a new set of rows the next run sees,
 *  and the preview follows on the next session. */
const scalePreviews = new Map<string, ScalePreview>()

/** Where a workflow's files live: its data folder (`dir`, also where your own input files are
 *  read from) and its folder in the project data layout (`scope.base` — see graph/diskNames.ts),
 *  with its name as `scope.legacy` so older projects' `<data folder>/<workflow>` files still read.
 *  The active workflow by default. null without a data folder (or before the scratch folder is
 *  known, for an unsaved project). Exported for writers outside the store (export/autoTables.ts). */
export interface WorkflowLocation {
  dir: string
  scope: { base: string; legacy: string }
}
export function locationOf(
  s: GraphState,
  folderId: string | null = s.activeFolderId,
  workflowId: string | null = s.activeWorkflowId
): WorkflowLocation | null {
  const folder = s.folders.find((f) => f.id === folderId)
  const wf = folder?.workflows.find((w) => w.id === workflowId)
  if (!folder?.path || !wf) return null
  const root = dataRootOf(folder, {
    saved: !!s.projectPath,
    projectName: s.projectName,
    scratch: s.scratchRoot
  })
  return root
    ? { dir: folder.path, scope: { base: workflowDirOf(root, wf), legacy: wf.name } }
    : null
}

/** Pin output/ folder names for these processing steps of a workflow (the active one by default;
 *  first use takes the step's current name); returns each one's name. Not undoable and doesn't
 *  dirty the project — a name not yet saved is simply re-derived from the step's name next time. */
function pinOutDirs(
  get: Getter,
  set: Setter,
  stepIds: string[],
  folderId: string | null = get().activeFolderId,
  workflowId: string | null = get().activeWorkflowId
): Record<string, string> {
  const s = get()
  const folder = s.folders.find((f) => f.id === folderId)
  const wf = folder?.workflows.find((w) => w.id === workflowId)
  if (!folder || !wf) return {}
  const titles = stepTitlesOf(s, folder.id, wf)
  const outDirs = { ...(wf.outDirs ?? {}) }
  const names: Record<string, string> = {}
  let changed = false
  for (const id of stepIds) {
    const title = titles.get(id)
    if (title == null) continue
    if (!outDirs[id]) {
      outDirs[id] = outDirName(outDirs, id, title)
      changed = true
    }
    names[id] = outDirs[id]
  }
  if (changed)
    set({
      folders: s.folders.map((f) =>
        f.id !== folder.id
          ? f
          : { ...f, workflows: f.workflows.map((w) => (w.id === wf.id ? { ...w, outDirs } : w)) }
      )
    })
  return names
}

/** What a project folder clean-up would remove: paths under `root` (the project data folder). */
export interface CleanupPlan {
  folderId: string
  root: string
  remove: string[]
}

/** A folder's entries, or none when it can't be read (missing). */
async function entriesOf(
  dir: string
): Promise<Array<{ name: string; path: string; dir: boolean }>> {
  try {
    return await window.api.listDir(dir)
  } catch {
    return []
  }
}

/**
 * Everything under a data folder's project data folder that the project no longer uses: folders of
 * workflows it no longer has; in each workflow's folder, anything besides input/ and output/; input
 * files no Load tile of that workflow reads; output folders of steps it no longer has. A live
 * step's output folder is kept whole (its run tables and your downloads). Names are compared
 * ignoring case, as a Mac disk does.
 */
async function planCleanupOf(s: GraphState, folderId: string): Promise<CleanupPlan | null> {
  const f = s.folders.find((x) => x.id === folderId)
  if (!f) return null
  const root = dataRootOf(f, {
    saved: !!s.projectPath,
    projectName: s.projectName,
    scratch: s.scratchRoot
  })
  if (!root) return null
  const lc = (n: string): string => n.toLowerCase()
  const remove: string[] = []
  const wfByDir = new Map(f.workflows.map((w) => [lc(w.dir ?? pathSeg(w.name, 'Workflow')), w]))
  for (const e of await entriesOf(root)) {
    const w = e.dir ? wfByDir.get(lc(e.name)) : undefined
    if (!w) {
      remove.push(e.path)
      continue
    }
    const nodes = graphOf(s, f.id, w).nodes
    for (const sub of await entriesOf(e.path)) {
      if (sub.dir && lc(sub.name) === 'input') {
        const refs = new Set<string>()
        for (const n of nodes)
          if (n.data.kind === 'load') {
            const c = n.data.config as LoadConfig
            for (const name of [c.matrix, c.data, c.samplesheet, c.db]) if (name) refs.add(lc(name))
          }
        for (const file of await entriesOf(sub.path))
          if (!refs.has(lc(file.name))) remove.push(file.path)
      } else if (sub.dir && lc(sub.name) === 'output') {
        // The live steps' folders: their pinned names, else (not written to yet) their names now.
        const live = new Set(nodes.map((n) => n.id))
        const keep = new Set<string>()
        for (const [id, d] of Object.entries(w.outDirs ?? {})) if (live.has(id)) keep.add(lc(d))
        for (const n of nodes)
          if (!w.outDirs?.[n.id] && categoryOf(n.data.kind) === 'processing')
            keep.add(lc(pathSeg(stepTitle(n), 'Step')))
        // Kept too: a flat batch export's files of a live step (`<step>__<file>`) and its
        // `selected/` folder, written straight into output/.
        const used = (out: { name: string; dir: boolean }): boolean =>
          out.dir
            ? keep.has(lc(out.name)) || lc(out.name) === 'selected'
            : [...keep].some((k) => lc(out.name).startsWith(`${k}__`))
        for (const out of await entriesOf(sub.path)) if (!used(out)) remove.push(out.path)
      } else remove.push(sub.path)
    }
  }
  return { folderId, root, remove }
}

/** A workflow's steps and wiring — the live graph for the open workflow, else its saved doc. */
function graphOf(s: GraphState, folderId: string, wf: ProjectWorkflow) {
  const live = folderId === s.activeFolderId && wf.id === s.activeWorkflowId
  return live ? { nodes: s.nodes.filter(isStep), edges: s.edges } : wf.doc
}

/** The input files a folder's workflows read by name (their Load tiles' files), each with its
 *  workflow's name (the legacy per-workflow location data:read also looks in). */
function inputRefsOf(s: GraphState, f: ProjectFolder): Array<{ name: string; legacy: string }> {
  const out: Array<{ name: string; legacy: string }> = []
  for (const w of f.workflows)
    for (const n of graphOf(s, f.id, w).nodes) {
      if (n.data.kind !== 'load') continue
      const c = n.data.config as LoadConfig
      for (const name of [c.matrix, c.data, c.samplesheet, c.db])
        if (name) out.push({ name, legacy: w.name })
    }
  return out
}

/** A workflow's step names, by id. */
function stepTitlesOf(s: GraphState, folderId: string, wf: ProjectWorkflow): Map<string, string> {
  return new Map(graphOf(s, folderId, wf).nodes.map((n) => [n.id, stepTitle(n)]))
}

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

/**
 * Bring the disk in line with the project as it's being saved (see graph/diskNames.ts), per data
 * folder: first the project data folder itself — moved out of scratch on the first save, copied to
 * the new name on Save as (the original project keeps its own), else renamed after the project —
 * then each renamed workflow's folder, then each renamed step's output/ folder. Runs with file
 * writes held back (graph/diskWrites.ts). Records the names that resulted (a failed move keeps the
 * old one) and returns what couldn't be done, for the save to report.
 */
async function applyDiskLayout(
  get: Getter,
  set: Setter,
  mode: 'first' | 'copy' | 'rename'
): Promise<string[]> {
  return exclusiveDisk(async () => {
    const warnings: string[] = []
    const fail = (what: string, err?: string): void => {
      warnings.push(err ? `${what}: ${err}` : what)
    }
    const nameOf = (p: string): string => p.split(/[/\\]/).pop() ?? p
    const want = dataFolderName(get().projectName)
    const scratch = get().scratchRoot
    const folders: ProjectFolder[] = []
    for (const f of get().folders) {
      if (!f.path) {
        folders.push(f)
        continue
      }
      // 1 · the project data folder
      let dataName = f.dataName ?? want
      if (mode === 'first') {
        if (scratch) {
          const [r] = await window.api.applyDirOps([
            { from: `${scratch}/${f.id}`, to: `${f.path}/${want}`, mode: 'move', unique: true }
          ])
          dataName = r.ok && !r.skipped ? nameOf(r.to) : want
          if (!r.ok) fail(`Couldn't move this session's files into ${f.path}`, r.error)
        } else dataName = want
      } else if (mode === 'copy' && f.dataName) {
        const [r] = await window.api.applyDirOps([
          { from: `${f.path}/${f.dataName}`, to: `${f.path}/${want}`, mode: 'copy', unique: true }
        ])
        if (r.ok) dataName = r.skipped ? want : nameOf(r.to)
        else
          fail(`Couldn't copy ${f.dataName} to ${want} (still shared with the original)`, r.error)
      } else if (f.dataName && f.dataName !== want) {
        const [r] = await window.api.applyDirOps([
          { from: `${f.path}/${f.dataName}`, to: `${f.path}/${want}`, mode: 'rename' }
        ])
        if (r.ok) dataName = want
        else fail(`Couldn't rename ${f.dataName} to ${want}`, r.error)
      }
      const root = `${f.path}/${dataName}`

      // 2 · workflow folders
      const wfPlan = planRenames(
        f.workflows.map((w) => ({
          key: w.id,
          dir: w.dir ?? pathSeg(w.name, 'Workflow'),
          want: pathSeg(w.name, 'Workflow')
        }))
      )
      const wfMoves = wfPlan.filter((p) => p.to !== p.dir)
      const wfRes = await window.api.applyDirOps(
        wfMoves.map((p) => ({ from: `${root}/${p.dir}`, to: `${root}/${p.to}`, mode: 'rename' }))
      )
      const dirOf = new Map(wfPlan.map((p) => [p.key, p.to]))
      wfMoves.forEach((p, i) => {
        if (wfRes[i].ok) return
        dirOf.set(p.key, p.dir)
        fail(`Couldn't rename workflow folder ${p.dir} to ${p.to}`, wfRes[i].error)
      })

      // 3 · each workflow's step output folders
      const workflows: ProjectWorkflow[] = []
      for (const w of f.workflows) {
        const dir = dirOf.get(w.id) ?? w.dir
        const titles = stepTitlesOf(get(), f.id, w)
        // A deleted step's folder stays on disk; it just stops being tracked.
        const tracked = Object.entries(w.outDirs ?? {}).filter(([id]) => titles.has(id))
        const outPlan = planRenames(
          tracked.map(([id, d]) => ({ key: id, dir: d, want: pathSeg(titles.get(id)!, 'Step') }))
        )
        const outMoves = outPlan.filter((p) => p.to !== p.dir)
        const out = `${root}/${dir}/output`
        const outRes = await window.api.applyDirOps(
          outMoves.map((p) => ({ from: `${out}/${p.dir}`, to: `${out}/${p.to}`, mode: 'rename' }))
        )
        const outDirs = Object.fromEntries(outPlan.map((p) => [p.key, p.to]))
        outMoves.forEach((p, i) => {
          if (outRes[i].ok) return
          outDirs[p.key] = p.dir
          fail(`Couldn't rename output folder ${p.dir} to ${p.to}`, outRes[i].error)
        })

        workflows.push({ ...w, dir, outDirs })
      }
      folders.push({ ...f, dataName, workflows })
    }
    set({ folders })
    return warnings
  })
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
  liveMask = geneMaskKey(get().geneSets)
  const hidden = hiddenGeneIds(get())
  const results = { ...get().results }
  for (const n of get().nodes) {
    if (!isStep(n)) continue
    const res = results[n.id]
    if (res?.kind !== 'compare') continue
    const threshold = (n.data.config as CompareConfig).threshold
    const label = thresholdLabel(threshold)
    const rows = res.cmp.rows.map((r) => {
      const cls = classifyCompareRow(r, threshold)
      const signf = cls.signf && !hidden.has(r.uniqID)
      return {
        ...r,
        thrsh: label,
        signf,
        effect: signf ? cls.effect : 'none',
        ...(cls.model ? { model: cls.model } : null)
      }
    })
    results[n.id] = { ...res, cmp: { ...res.cmp, rows, threshold } }
  }
  set({ results })
  // Re-run every already-computed contrast so the mask propagates downstream automatically.
  for (const n of get().nodes)
    if (isStep(n) && n.data.kind === 'contrast' && get().results[n.id]) void get().runNode(n.id)
}

/** The gene mask (geneMaskKey) the open workflow's results are classified under. */
let liveMask: string | undefined

/** Bring the open workflow's results under the project's gene mask, if they were classified
 *  under another — genesets are the project's, so a set hidden in one workflow masks them all. */
function syncGeneMask(get: Getter, set: Setter): void {
  if (liveMask !== geneMaskKey(get().geneSets)) reapplyGeneMask(get, set)
}

/** A failed save's reason, for the message by the Save button. */
function saveErrorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return `Couldn't save the project: ${msg.replace(/^Error invoking remote method '[^']+': /, '')}`
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
              w.id === s.activeWorkflowId ? { ...w, doc, results: s.results, mask: liveMask } : w
            )
          }
    )
  })
}

/** Check out a folder + workflow as the live graph (restoring embedded results). */
/** A group tile's status: the roll-up of its plots' — running while any is, an error if any failed,
 *  done only when every plot is (and it has some), else idle. With the first failure's reason. */
function groupStatus(children: PlotChild[]): { status: StepStatus; error?: string } {
  const st = children.map((c) => c.status ?? 'idle')
  if (st.includes('running')) return { status: 'running' }
  const failed = children.find((c) => c.status === 'error')
  if (failed) return { status: 'error', error: failed.error }
  return { status: children.length > 0 && st.every((x) => x === 'done') ? 'done' : 'idle' }
}

/** A group node with its plots' statuses set by `statusOf` (and its own rolled up from them). */
function withChildStatuses(
  n: StepNode,
  statusOf: (c: PlotChild) => { status: StepStatus; error?: string }
): StepNode {
  const cfg = n.data.config as PlotGroupConfig
  const children = cfg.children.map((c) => {
    const st = statusOf(c)
    return { ...c, status: st.status, error: st.error }
  })
  const roll = groupStatus(children)
  return {
    ...n,
    data: { ...n.data, config: { ...cfg, children }, status: roll.status, error: roll.error }
  }
}

/** Clear the run results of the plots in these nodes — a standalone plot's own, and each plot of a
 *  group tile (kept under plotResultKey) — and set them idle. For an upstream re-run / re-wire. */
function clearPlotResults(
  nodes: GraphNode[],
  results: Record<string, NodeResult>,
  ids: Set<string>
): { nodes: GraphNode[]; results: Record<string, NodeResult> } {
  const out = { ...results }
  for (const key of Object.keys(out)) {
    const slash = key.indexOf('/')
    if (slash > 0 && ids.has(key.slice(0, slash))) delete out[key]
  }
  return {
    results: out,
    nodes: nodes.map((n) =>
      ids.has(n.id) && isStep(n) && n.data.kind === 'plotGroup'
        ? withChildStatuses(n, () => ({ status: 'idle' }))
        : n
    )
  }
}

/** Run statuses from the results a workflow was restored with: a step or plot with a result is
 *  done (Re-run, not Run) — a group tile's plots each by their own. */
function restoredStatuses(nodes: GraphNode[], results: Record<string, NodeResult>): GraphNode[] {
  return nodes.map((n) => {
    if (!isStep(n)) return n
    if (n.data.kind === 'plotGroup')
      return withChildStatuses(n, (c) => ({
        status: results[plotResultKey(n.id, c.id)] ? 'done' : 'idle'
      }))
    return results[n.id] ? { ...n, data: { ...n.data, status: 'done' as const } } : n
  })
}

function loadSlot(get: Getter, set: Setter, folderId: string, workflowId?: string): void {
  // Pin on-disk folder names before anything can be written (see graph/diskNames.ts).
  const pinned = withDiskNames(get().folders, !!get().projectPath, get().projectName)
  if (pinned !== get().folders) set({ folders: pinned })
  const folder = get().folders.find((f) => f.id === folderId)
  if (!folder) return
  const wfId = workflowId ?? folder.activeWorkflowId ?? folder.workflows[0]?.id
  const slot = folder.workflows.find((w) => w.id === wfId) ?? folder.workflows[0]
  if (!slot) return
  const loaded: LoadedWorkflow = parseWorkflowDoc(slot.doc)
  // A parked workflow's results come back from disk a moment later (unparkActive).
  const results = slot.parked ? {} : (slot.results ?? {})
  // Restore run state so a resumed session shows results (Re-run, not Run).
  const nodes: GraphNode[] = restoredStatuses(loaded.nodes, results)
  set({
    // Already in step order: the file's upgrade (upgrades.ts) put every workflow in it on read.
    nodes,
    edges: loaded.edges,
    nextId: loaded.nextId,
    groupLayouts: loaded.groupLayouts,
    groupMeta: loaded.groupMeta,
    frames: loaded.frames,
    results,
    // Record the checked-out workflow on the folder too: that's what the saved file (and a
    // later switchFolder) resume, so it must follow the user's last switch, not the last add.
    folders: get().folders.map((f) =>
      f.id === folderId && f.activeWorkflowId !== slot.id ? { ...f, activeWorkflowId: slot.id } : f
    ),
    activeFolderId: folderId,
    activeWorkflowId: slot.id,
    dataDir: folder.path || null,
    selectedId: null,
    past: [],
    future: []
  })
  liveMask = slot.mask
  if (slot.parked) unparkActive(get, set, folderId, slot.id, slot.parked)
  else syncGeneMask(get, set)
  // Only the open workflow's results stay in memory; the one just left (and any other) is parked.
  parkInactive(get, set)
}

// ── parking: only the open workflow's results are kept in memory ─────────────────────────────
// Every other workflow's results wait on disk (main/park.ts) in the project file's packed form,
// and come back when it's opened again. Parking and unparking run one at a time, in order.

/** Workflows whose results were read back from a park file, with that very object — parked again
 *  unchanged, they reuse the file instead of writing it anew. */
const fromPark = new Map<string, { key: string; results: Record<string, NodeResult> }>()
let parkQueue: Promise<void> = Promise.resolve()
let parkSeq = 0
const queuePark = (job: () => Promise<void>): void => {
  parkQueue = parkQueue.then(job).catch(() => undefined)
}

/** Park every workflow that isn't the open one and still holds its results in memory. */
function parkInactive(get: Getter, set: Setter): void {
  queuePark(async () => {
    for (const f of get().folders)
      for (const w of f.workflows) {
        const s = get()
        if (s.activeFolderId === f.id && s.activeWorkflowId === w.id) continue
        const cur = s.folders.find((x) => x.id === f.id)?.workflows.find((x) => x.id === w.id)
        if (!cur || cur.parked || Object.keys(cur.results ?? {}).length === 0) continue
        const results = cur.results
        const prior = fromPark.get(w.id)
        let key: string
        if (prior && prior.results === results) key = prior.key
        else {
          key = `wf${++parkSeq}`
          try {
            await window.api.parkWrite(key, packedResultsChunks(results))
          } catch {
            return // no park store (e.g. the screenshot harness): keep results in memory
          }
          if (prior) void window.api.parkDrop(prior.key).catch(() => undefined)
        }
        fromPark.delete(w.id)
        // Only if it's still not the open workflow and its results are still those written.
        const now = get()
        if (now.activeFolderId === f.id && now.activeWorkflowId === w.id) continue
        set({
          folders: now.folders.map((ff) =>
            ff.id !== f.id
              ? ff
              : {
                  ...ff,
                  workflows: ff.workflows.map((ww) =>
                    ww.id === w.id && ww.results === results
                      ? { ...ww, results: {}, parked: key }
                      : ww
                  )
                }
          )
        })
      }
  })
}

/** A group tile's own status rolled up again from its plots' (after a restore set theirs). */
const rollGroups = (nodes: GraphNode[]): GraphNode[] =>
  nodes.map((n) =>
    isStep(n) && n.data.kind === 'plotGroup'
      ? withChildStatuses(n, (c) => ({ status: c.status ?? 'idle', error: c.error }))
      : n
  )

/** Read back the results an undo/redo restored from disk, installing each only if its tile still
 *  waits for it: same config object, not run meanwhile (anything run since wins), no result yet. */
function loadFromHistory(get: Getter, set: Setter, pending: PendingLoad[]): void {
  for (const p of pending)
    void history.load(p.id).then((r) => {
      if (!r) return
      const s = get()
      if (s.results[p.key]) return
      const n = s.nodes.find((x) => x.id === p.nodeId)
      if (!n || !isStep(n)) return
      if (p.childId) {
        const ch = (n.data.config as PlotGroupConfig).children.find((c) => c.id === p.childId)
        if (!ch || ch.config !== p.config || (ch.status ?? 'idle') !== 'idle') return
        set({
          results: { ...s.results, [p.key]: underConfig(r, ch.kind, ch.config, reclassifyFor(s)) },
          nodes: s.nodes.map((x) =>
            x.id === n.id
              ? withChildStatuses(n, (c) =>
                  c.id === p.childId
                    ? { status: 'done' }
                    : { status: c.status ?? 'idle', error: c.error }
                )
              : x
          )
        })
        return
      }
      if (n.data.config !== p.config || n.data.status !== 'idle') return
      set({
        results: {
          ...s.results,
          [p.key]: underConfig(r, n.data.kind, n.data.config, reclassifyFor(s))
        },
        nodes: s.nodes.map((x) =>
          x.id === n.id && isStep(x) ? { ...x, data: { ...x.data, status: 'done' as const } } : x
        )
      })
    })
}

/** Bring the open workflow's parked results back into memory (and its steps back to done). */
function unparkActive(
  get: Getter,
  set: Setter,
  folderId: string,
  workflowId: string,
  key: string
): void {
  queuePark(async () => {
    let loaded: Record<string, NodeResult>
    try {
      loaded = unpackParked(await window.api.parkRead(key))
    } catch (err) {
      set({ saveError: `Couldn't reload this workflow's results: ${String(err)}` })
      return
    }
    const s = get()
    if (s.activeFolderId !== folderId || s.activeWorkflowId !== workflowId) return // left again
    // Anything run in the meantime wins over what was parked.
    const results = { ...loaded, ...s.results }
    fromPark.set(workflowId, { key, results })
    set({
      results,
      nodes: s.nodes.map((n) =>
        isStep(n) && n.data.kind === 'plotGroup'
          ? withChildStatuses(n, (c) =>
              results[plotResultKey(n.id, c.id)] || c.status === 'done'
                ? { status: 'done' }
                : { status: c.status ?? 'idle', error: c.error }
            )
          : isStep(n) && loaded[n.id] && !s.results[n.id] && n.data.status === 'idle'
            ? { ...n, data: { ...n.data, status: 'done' as const } }
            : n
      ),
      folders: s.folders.map((f) =>
        f.id !== folderId
          ? f
          : {
              ...f,
              workflows: f.workflows.map((w) =>
                w.id === workflowId ? { ...w, results, parked: undefined } : w
              )
            }
      )
    })
    syncGeneMask(get, set)
  })
}

/** The project file with every parked workflow's results as a reference to its park file
 *  (ParkedRef): the main process copies the file's packed text into the save itself, so it's never
 *  read into the renderer and sent back. */
async function withParkedResults(p: ProjectFile): Promise<ProjectFile> {
  await parkQueue // let any parking in flight settle first
  const folders = p.folders.map((f) => ({
    ...f,
    workflows: f.workflows.map((w) =>
      w.parked
        ? { ...w, results: new ParkedRef(w.parked) as unknown as Record<string, NodeResult> }
        : w
    )
  }))
  return { ...p, folders }
}

/** A save's folder problems as one message (null when there were none). */
const layoutWarning = (warnings: string[]): string | null =>
  warnings.length ? `Saved, but some folders weren't updated — ${warnings.join('; ')}` : null

/** Replace the session with a new, unsaved project made from a template's text. Its folders have
 *  no data folder yet — each is picked from the folder selector, as for a new project. */
function startFromTemplate(get: Getter, set: Setter, text: string): void {
  const proj = projectFromTemplate(text)
  set({
    projectPath: null,
    projectName: 'Untitled project',
    projectCreatedWith: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
    projectOpen: true,
    folders: proj.folders,
    activeFolderId: proj.activeFolderId,
    geneSets: proj.geneSets ?? [],
    dirty: false,
    inputFiles: [],
    inputFileFolders: {},
    openError: null
  })
  loadSlot(get, set, proj.activeFolderId)
  useAppView.getState().setView('canvas')
}

/** The header a file just saved from this session carries (for the home page's version tag). */
function savedHeader(get: Getter): ProjectHeader {
  return {
    format: PROJECT_VERSION,
    savedBy: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
    createdWith: get().projectCreatedWith
  }
}

function buildProjectFile(get: Getter): ProjectFile {
  const s = get()
  const av = useAppView.getState()
  return {
    format: 'omicexplorer-project',
    version: PROJECT_VERSION,
    // Named when an older app version is asked to open this file (see deserializeProject).
    ...(typeof __APP_VERSION__ === 'string' ? { appVersion: __APP_VERSION__ } : null),
    ...(s.projectCreatedWith ? { createdWith: s.projectCreatedWith } : null),
    name: s.projectName,
    folders: s.projectPath ? withRelPaths(s.folders, s.projectPath) : s.folders,
    activeFolderId: s.activeFolderId ?? s.folders[0]?.id ?? '',
    // Persist which page the user was on so opening the project resumes it (see openProject).
    view: av.view,
    resultsTab: av.resultsTab,
    geneSets: s.geneSets
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
  scratchRoot: null,
  outputDirFor: (stepId) => {
    const loc = locationOf(get())
    if (!loc) return null
    const name = pinOutDirs(get, set, [stepId])[stepId]
    return name ? `${loc.scope.base}/output/${name}` : null
  },
  planCleanup: (folderId) => planCleanupOf(get(), folderId),
  applyCleanup: async (plan) => {
    const errors = await exclusiveDisk(() => window.api.removeInside(plan.root, plan.remove))
    // Deleted steps' output folder names are gone from disk: stop tracking them.
    set((s) => ({
      folders: s.folders.map((f) =>
        f.id !== plan.folderId
          ? f
          : {
              ...f,
              workflows: f.workflows.map((w) => {
                const live = new Set(graphOf(s, f.id, w).nodes.map((n) => n.id))
                const outDirs = Object.fromEntries(
                  Object.entries(w.outDirs ?? {}).filter(([id]) => live.has(id))
                )
                return { ...w, outDirs }
              })
            }
      )
    }))
    void get().refreshDataFiles()
    return errors
  },
  outputLayoutFor: (stepIds) => {
    const loc = locationOf(get())
    if (!loc) return null
    return { root: `${loc.scope.base}/output`, names: pinOutDirs(get, set, stepIds) }
  },
  outputSubdirFor: (stepId, folderId, workflowId) =>
    pinOutDirs(get, set, [stepId], folderId, workflowId)[stepId] ?? null,
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
  openError: null,
  saveError: null,
  saving: false,
  saveWarning: null,
  clearSaveError: () => set({ saveError: null, saveWarning: null }),
  groupLayouts: {},
  groupMeta: {},
  geneSets: [],
  frames: [],
  frameNodes: (ids) => {
    const { nodes, frames, nextId } = get()
    const steps = new Set(nodes.filter(isStep).map((n) => n.id))
    const frameIds = new Set(frames.map((f) => f.id))
    const next = groupInto(frames, ids, (id) => steps.has(id) || frameIds.has(id), {
      id: `frame-${nextId}`,
      // Named Group 1, Group 2, …: the first number no frame in this workflow is using.
      label: nextGroupName(frames)
    })
    if (next === frames) return
    get().commit()
    set({
      frames: next,
      nextId: nextId + 1,
      nodes: sortStepsByWiring(nodes, get().edges, next)
    })
  },
  unframeNodes: (ids) => {
    const next = ungroupFrom(get().frames, ids)
    if (next === get().frames) return
    get().commit()
    set({ frames: next, nodes: sortStepsByWiring(get().nodes, get().edges, next) })
  },
  selectTiles: (ids, additive = false) => {
    const pick = new Set(ids)
    set((s) => {
      const nodes = s.nodes.map((n) => {
        const on = pick.has(n.id) || (additive && !!n.selected)
        return !!n.selected === on ? n : { ...n, selected: on }
      })
      const sel = new Set(nodes.filter((n) => n.selected).map((n) => n.id))
      const edges = s.edges.map((e) => {
        const on = sel.has(e.source) && sel.has(e.target)
        return !!e.selected === on ? e : { ...e, selected: on }
      })
      // Mirrors React Flow's onSelectionChange, which doesn't run while the canvas isn't shown.
      const canvasSelection = nodes.filter((n) => isStep(n) && n.selected).map((n) => n.id)
      return { nodes, edges, canvasSelection }
    })
  },
  setFrameFolded: (id, folded) =>
    set((s) => ({
      frames: s.frames.map((f) => (f.id === id ? { ...f, folded } : f)),
      dirty: true
    })),
  renameFrame: (id, label) => {
    const f = get().frames.find((x) => x.id === id)
    // An emptied name keeps the frame's current one.
    const name = label.trim() || f?.label || ''
    if (!f || f.label === name) return
    get().commit()
    set((s) => ({ frames: s.frames.map((x) => (x.id === id ? { ...x, label: name } : x)) }))
  },
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
    const next = addEdge({ ...conn, id: `e-${conn.source}-${conn.target}` }, pruned)
    set({ edges: next, nodes: sortStepsByWiring(get().nodes, next, get().frames) })
    // Only the tile that gained an input (and what it feeds) is out of date. Staling everything
    // downstream of the SOURCE also cleared its other branches — wiring a second Compare from
    // Clean data emptied the first Compare and its plots.
    get().markStale(conn.target)
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
    const moved = reconnectEdge(oldEdge, conn, pruned)
    set({ edges: moved, nodes: sortStepsByWiring(get().nodes, moved, get().frames) })
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
    // A visualisation comes as a plot group of one (its subcard takes the next id).
    const plain = makeNode(id, op, pos)
    const lone = isLonePlot(plain)
    const node = lone ? wrapPlot(plain, `sub-${get().nextId + 1}`) : plain
    set((s) => ({
      nodes: [...s.nodes, node],
      nextId: s.nextId + (lone ? 2 : 1),
      // A new tile isn't opened: its settings window would cover the canvas just as it's placed.
      selectedId: null,
      selectedSub: null
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

  resolvePlaceholder: (id, picks) => {
    const { nodes, edges, nextId, past } = get()
    const ph = nodes.find((n) => n.id === id)
    if (!ph || ph.type !== 'placeholder' || picks.length === 0) return
    // Snapshot the graph as if the placeholder never existed → one clean undo step
    // that removes the finished step and its edge together.
    const baseNodes = nodes.filter((n) => n.id !== id)
    const baseEdges = edges.filter((e) => e.target !== id)
    set({
      past: [
        ...past,
        {
          nodes: structuredClone(baseNodes),
          edges: structuredClone(baseEdges),
          nextId,
          versions: history.ref(get().results)
        }
      ].slice(-50),
      future: [],
      dirty: true
    })
    // One pick → a plain node. Multiple (all plotting) → a group tile with a subcard per pick.
    // Either way keep the placeholder's id, position, and incoming edge. A pick's `override` seeds
    // its config (e.g. a dr pick's axis = dose/time), on top of the kind's defaults.
    const configFor = (pick: { kind: NodeKind; override?: Record<string, unknown> }): NodeConfig =>
      startingConfig(pick.kind, pick.override)
    // A single plot is a group of one, the same as several (handled below) — every visualisation
    // tile is a plot group.
    if (picks.length === 1 && categoryOf(picks[0].kind) !== 'plotting') {
      const pick = picks[0]
      set((s) => ({
        nodes: s.nodes.map((n) => {
          if (n.id !== id) return n
          const node = makeNode(id, pick.kind, n.position)
          return { ...node, data: { ...node.data, config: configFor(pick) } }
        }),
        // Not opened on creation (see addNode); the form selects it itself.
        selectedId: null,
        selectedSub: null
      }))
      return
    }
    const children = toChildren(
      picks.map((pick) => ({ kind: pick.kind, config: configFor(pick) })),
      nextId
    )
    set((s) => ({
      nodes: s.nodes.map((n) => (n.id === id ? makeGroupNode(id, n.position, children) : n)),
      nextId: s.nextId + picks.length,
      selectedId: null,
      selectedSub: null
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
        selectedId: s.selectedId === id ? null : s.selectedId,
        // out of its frame too; a frame left empty goes (and a parent it empties)
        frames: withoutTiles(s.frames, new Set([id]))
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
        config = { ...(config as PlotGroupConfig), children: toChildren(src, nextId) }
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
      // Copies stay selected on the canvas but aren't opened (see addNode).
      selectedId: null,
      selectedSub: null
    }))
  },

  // A group tile always has a plot selected: its details panel shows one plot's settings, so the
  // tile highlights that plot — the one already selected in it, else its first.
  selectNode: (id) =>
    set((s) => {
      const node = id ? s.nodes.find((n) => n.id === id) : undefined
      const kids =
        node && isStep(node) && node.data.kind === 'plotGroup'
          ? (node.data.config as PlotGroupConfig).children
          : []
      const selectedSub = kids.some((c) => c.id === s.selectedSub)
        ? s.selectedSub
        : (kids[0]?.id ?? null)
      return { selectedId: id, selectedSub, nodes: elevate(s.nodes, id) }
    }),
  selectChildCard: (groupId, childId) =>
    set((s) => ({ selectedId: groupId, selectedSub: childId, nodes: elevate(s.nodes, groupId) })),
  setCanvasSelection: (ids) => set({ canvasSelection: ids }),

  updateConfig: (id, partial) => {
    get().commit()
    const before = get().nodes.find((n) => n.id === id)
    const prevConfig = before && isStep(before) ? before.data.config : undefined
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...n.data.config, ...partial } as NodeConfig } }
          : n
      )
    }))
    // A runnable node goes stale on a config change — a step on any; a plot only on one outside
    // what its run computed (its spec's staleOn; view settings just re-render).
    const kind = get().nodeKind(id)
    const spec = kind ? NODE_SPECS[kind] : undefined
    const after = get().nodes.find((n) => n.id === id)
    const stale =
      !!spec?.hasRun &&
      (!spec.staleOn ||
        (!!prevConfig &&
          !!after &&
          isStep(after) &&
          spec.staleOn(after.data.config, prevConfig, get().results[id])))
    if (stale) {
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
      // A cluster's run settings changed from the tile's switches: run it again at once (in the
      // worker), as the switch implies — rather than leave the tile on "Not run yet".
      if (kind === 'pca' && before && isStep(before) && before.data.status === 'done')
        void get().runNode(id)
    }
  },

  setCompareEffectLabels: (id, labels) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
    const cfg = node.data.config as CompareConfig
    const effectLabels: EffectLabels = { ...DEFAULT_EFFECT_LABELS, ...cfg.effectLabels, ...labels }
    get().commit()
    // Display-only, so patch the config directly (updateConfig would stale the compare).
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...cfg, effectLabels } as NodeConfig } }
          : n
      ),
      dirty: true
    }))
  },
  setCurveMethod: (id, method) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
    const cfg = node.data.config as CompareConfig
    if (cfg.curveMethod === method) return
    get().commit()
    // Display-only, so patch the config directly (updateConfig would stale the curve fit).
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...cfg, curveMethod: method } as NodeConfig } }
          : n
      ),
      dirty: true
    }))
  },
  setCompareEffectColors: (id, colors) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
    const cfg = node.data.config as CompareConfig
    const effectColors = { ...cfg.effectColors, ...colors }
    get().commit()
    // Display-only, so patch the config directly (updateConfig would stale the compare).
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...cfg, effectColors } as NodeConfig } }
          : n
      ),
      dirty: true
    }))
  },
  setLoadUnits: (id, units) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind !== 'load') return
    const cfg = node.data.config as LoadConfig
    const next: CondUnits = { ...cfg.units, ...units }
    if (next.dose === cfg.units?.dose && next.time === cfg.units?.time) return
    get().commit()
    // Display-only, so patch the config directly (updateConfig would stale everything below).
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...cfg, units: next } as NodeConfig } }
          : n
      ),
      dirty: true
    }))
  },
  previewStdScale: async (id) => {
    const state = get()
    const upId = state.upstreamId(id)
    const up = upId ? state.nodes.find((n) => n.id === upId) : undefined
    const load = up && isStep(up) && up.data.kind === 'load' ? (up.data.config as LoadConfig) : null
    const dir = state.dataDir
    if (!load?.data || !dir) return null
    const wf = locationOf(state)?.scope
    const key = `${dir}|${wf?.base ?? ''}|${load.data}`
    const hit = scalePreviews.get(key)
    if (hit) return hit
    const text = await window.api.readDataFile(dir, load.data, wf)
    if (text == null) return null
    const preview = await engine.previewScale(text, load.data)
    scalePreviews.set(key, preview)
    return preview
  },
  setStdLogTransform: (id, logTransform) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind !== 'standardize') return
    const cfg = node.data.config as StandardizeConfig
    get().commit()
    // Its own result is left exactly as it is — the scale is read from this choice where the table
    // and plots are drawn (presentScaleOf / plotScaleOf). But a Compare tests on it (logged or
    // not), so whatever was computed downstream is stale.
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...cfg, logTransform } as NodeConfig } }
          : n
      ),
      dirty: true
    }))
    if ((cfg.logTransform ?? 'none') !== logTransform) get().invalidateDownstream(id)
  },
  setCompareThreshold: (id, partial) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || !isComparisonKind(node.data.kind)) return
    const cur = (node.data.config as CompareConfig).threshold
    // Snap dragged values to what the panel shows: fold changes to 2 decimals, the stat cutoff so
    // its p-value is 3 decimals — the guide then reads as the number the user sees in the config.
    const r2 = (v: number): number => Math.round(v * 100) / 100
    const snapped: Partial<ThresholdConfig> = { ...partial }
    if (snapped.fcLow != null) snapped.fcLow = r2(snapped.fcLow)
    if (snapped.fcHigh != null) snapped.fcHigh = r2(snapped.fcHigh)
    if (snapped.s0 != null) snapped.s0 = r2(snapped.s0)
    if (snapped.s0Down != null) snapped.s0Down = r2(snapped.s0Down)
    if (snapped.statMin != null) snapped.statMin = snapStatMin(snapped.statMin)
    const threshold: ThresholdConfig = { ...cur, ...snapped }
    // Symmetric mode: the down cutoff follows the up one (fcLow = −fcHigh, s0Down = s0), so the
    // engine and every plot can read the raw fields without knowing about the switch. When the
    // user moved the DOWN side (e.g. dragged the left line), take that as the magnitude instead.
    if (!threshold.asymmetric) {
      const mag =
        snapped.fcLow != null && snapped.fcHigh == null
          ? Math.abs(snapped.fcLow)
          : Math.abs(threshold.fcHigh)
      threshold.fcHigh = mag
      threshold.fcLow = -mag
      if (snapped.s0Down != null && snapped.s0 == null) threshold.s0 = snapped.s0Down
      delete threshold.s0Down
    }
    // No-op guard: dragging that lands back on the same value shouldn't spawn an undo step or
    // needlessly stale a downstream contrast. Every field is compared (not a list that a new
    // setting could be missing from).
    const fields = new Set([...Object.keys(threshold), ...Object.keys(cur)]) as Set<
      keyof ThresholdConfig
    >
    if ([...fields].every((k) => threshold[k] === cur[k])) return
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
    // Re-classify the stored result rows: only the calls depend on the threshold (log2FC, pP, pQ
    // are already final). Cheap enough to run synchronously on the UI thread.
    const res = get().results[id]
    if (res?.kind === 'compare') {
      const next = reclassify(res, threshold, hiddenGeneIds(get()))
      history.derive(next, res) // same statistics: one version in the undo history
      set((s) => ({ results: { ...s.results, [id]: next } }))
    }
    // Everything downstream follows the new calls without a manual Run. A Contrast below masks by
    // the compare's per-gene call, so its result is stale now: cleared at once (never taken for
    // current meanwhile — by an undo either) and re-run. The plots aren't cleared — those drawn
    // straight from this result redraw live, and the ones whose run depends on the calls
    // (enrichment, STRING) recompute in place.
    get().invalidateDownstream(id, true)
    void get().refreshDownstream(id)
  },

  setContrastStat: (id, partial) => {
    const node = get().nodes.find((n) => n.id === id)
    if (!node || !isStep(node) || node.data.kind !== 'contrast') return
    const cfg = node.data.config as ContrastConfig
    const cur: ContrastStat = cfg.stat ?? {}
    const stat: ContrastStat = { ...cur, ...partial }
    // No-op guard, as a Compare drag's: landing back on the same cutoffs is no change (no undo
    // step, nothing staled).
    if (JSON.stringify(stat) === JSON.stringify(cur)) return
    get().commit()
    const res = get().results[id]
    const next =
      res?.kind === 'contrast' ? reclassifyContrast(res.ctr, cfg.relationship, stat) : null
    if (!next) {
      // An older result (or none) can't be re-called in place: save the cutoffs and re-run.
      get().updateConfig(id, { stat })
      void get().rerunFrom(id)
      return
    }
    // Patch the cutoffs WITHOUT updateConfig — the per-side values are unchanged, so the contrast
    // stays `done` (updateConfig would stale it and force a re-run) — and keep the re-called rows.
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n)
          ? { ...n, data: { ...n.data, config: { ...cfg, stat } as NodeConfig } }
          : n
      ),
      results: res?.kind === 'contrast' ? { ...s.results, [id]: { ...res, ctr: next } } : s.results
    }))
    // As a Compare drag: steps below go stale at once, then everything downstream re-runs.
    get().invalidateDownstream(id, true)
    void get().refreshDownstream(id)
  },

  moveStep: (id, beforeId) => {
    if (id === beforeId) return
    const nodes = get().nodes
    const moved = nodes.find((n) => n.id === id)
    if (!moved) return
    const rest = nodes.filter((n) => n.id !== id)
    const at = beforeId === null ? rest.length : rest.findIndex((n) => n.id === beforeId)
    if (at === -1) return
    // Normalised, not just inserted: the rule that a step never precedes its input holds for every
    // caller, so a move that would break it is corrected rather than trusted. The form's drag
    // already refuses such a drop (see canMoveBefore); this is what makes it true regardless.
    const next = sortStepsByWiring(
      [...rest.slice(0, at), moved, ...rest.slice(at)],
      get().edges,
      get().frames
    )
    // A move that lands where it started changes nothing, and must not take an undo step with it.
    if (next.every((n, i) => n.id === nodes[i].id)) return
    get().commit()
    set(() => ({ nodes: next }))
  },

  moveItem: (item, slot) => {
    const { nodes, edges, frames } = get()
    const next = dropOrder(
      nodes.map((n) => n.id),
      edges,
      frames,
      item,
      slot
    )
    if (!next) return
    get().commit()
    const byId = new Map(nodes.map((n) => [n.id, n]))
    set({ nodes: next.map((id) => byId.get(id)!) })
  },

  renameNode: (id, name) => {
    get().commit()
    // File-name-safe (the name leads downloaded files); the tile's input filters as you type, this
    // is the backstop for any other caller.
    const trimmed = name.replace(/[^A-Za-z0-9 ._-]+/g, '').trim()
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id && isStep(n) ? { ...n, data: { ...n.data, name: trimmed || undefined } } : n
      )
    }))
  },

  applyConfigToKind: (kind, config, exceptId) => {
    get().commit()
    // The settings a plot tile carries are display-only (look, axes, caps), so this never touches
    // results or stales anything downstream — it's a restyle of every tile of that kind.
    const look = { ...config }
    delete look.axis // a dose tile stays a dose tile; only its look travels
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (!isStep(n)) return n
        if (n.data.kind === kind && n.id !== exceptId)
          return { ...n, data: { ...n.data, config: { ...n.data.config, ...look } as NodeConfig } }
        if (n.data.kind !== 'plotGroup') return n
        const cfg = n.data.config as PlotGroupConfig
        if (!cfg.children.some((c) => c.kind === kind && c.id !== exceptId)) return n
        return {
          ...n,
          data: {
            ...n.data,
            // the group's own settings (its fold) kept — only its subcards change
            config: {
              ...cfg,
              children: cfg.children.map((c) =>
                c.kind === kind && c.id !== exceptId
                  ? { ...c, config: { ...c.config, ...look } as NodeConfig }
                  : c
              )
            }
          }
        }
      }),
      dirty: true
    }))
  },
  updateChildConfig: (groupId, childId, partial) => {
    get().commit()
    // Children are plot subcards: a setting re-renders live, unless it's outside what the plot's run
    // computed (its spec's staleOn) — then its result is cleared and it must run again.
    const group = get().nodes.find((n) => n.id === groupId)
    const prev =
      group && isStep(group) && group.data.kind === 'plotGroup'
        ? (group.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
        : undefined
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n) || n.data.kind !== 'plotGroup') return n
        const cfg = n.data.config as PlotGroupConfig
        return {
          ...n,
          data: {
            ...n.data,
            // the group's own settings (its fold) kept — only the subcard changes
            config: {
              ...cfg,
              children: cfg.children.map((c) =>
                c.id === childId ? { ...c, config: { ...c.config, ...partial } as NodeConfig } : c
              )
            }
          }
        }
      })
    }))
    if (!prev) return
    const key = plotResultKey(groupId, childId)
    const next = { ...prev.config, ...partial } as NodeConfig
    if (!NODE_SPECS[prev.kind].staleOn?.(next, prev.config, get().results[key])) return
    const results = { ...get().results }
    delete results[key]
    set((s) => ({
      results,
      nodes: s.nodes.map((n) =>
        n.id === groupId && isStep(n)
          ? withChildStatuses(n, (c) =>
              c.id === childId ? { status: 'idle' } : { status: c.status ?? 'idle', error: c.error }
            )
          : n
      )
    }))
    // A cluster's run settings changed: run it again at once (see updateConfig).
    if (prev.kind === 'pca' && prev.status === 'done') void get().runPlotChild(groupId, childId)
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
    // …and where each one's run result is held, so a plot that has run stays run in its new group.
    const oldResultKeys = sel.flatMap((n) =>
      n.data.kind === 'plotGroup'
        ? (n.data.config as PlotGroupConfig).children.map((c) => plotResultKey(n.id, c.id))
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
      children.forEach((c, i) => {
        const r = s.results[oldResultKeys[i]]
        if (r) results[plotResultKey(groupId, c.id)] = r
        delete results[oldResultKeys[i]]
      })
      for (const nid of selIds) delete results[nid]
      return {
        nodes: elevate(
          [...s.nodes.filter((n) => !selIds.has(n.id)), makeGroupNode(groupId, pos, children)],
          null
        ),
        edges: [
          ...s.edges.filter((e) => !selIds.has(e.target) && !selIds.has(e.source)),
          { id: `e-${upstream}-${groupId}`, source: upstream, target: groupId }
        ],
        results,
        groupLayouts: remapLayouts(s.groupLayouts, layoutRemap),
        nextId: startId + specs.length + 1,
        // Not opened on creation (see addNode).
        selectedId: null,
        selectedSub: null
      }
    })
  },

  ungroupNodes: (ids) => {
    const { nodes, edges } = get()
    const groups = ids
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is StepNode => !!n && isStep(n) && n.data.kind === 'plotGroup')
      // A group of one has nothing to split.
      .filter((n) => (n.data.config as PlotGroupConfig).children.length > 1)
    if (groups.length === 0) return
    get().commit()
    let nextId = get().nextId
    const addNodes: StepNode[] = []
    const addEdges: Edge[] = []
    const removeIds = new Set<string>()
    // Each subcard becomes its own plot group of one (every visualisation tile is a group); carry
    // its saved grid slot over by remapping its `${groupId}::${childId}` panel id to the new tile's.
    const layoutRemap = new Map<string, string>()
    // Each plot's run result follows it to its new tile.
    const resultRemap = new Map<string, string>()
    for (const g of groups) {
      const upstream = edges.find((e) => e.target === g.id)?.source
      const kids = (g.data.config as PlotGroupConfig).children
      kids.forEach((c, i) => {
        const nid = `plotGroup-${nextId++}`
        addNodes.push(
          makeGroupNode(nid, { x: g.position.x + i * 28, y: g.position.y + i * 46 }, [
            { ...c, config: structuredClone(c.config) }
          ])
        )
        layoutRemap.set(childPanelId(g.id, c.id), childPanelId(nid, c.id))
        resultRemap.set(plotResultKey(g.id, c.id), plotResultKey(nid, c.id))
        if (upstream) addEdges.push({ id: `e-${upstream}-${nid}`, source: upstream, target: nid })
      })
      removeIds.add(g.id)
    }
    set((s) => ({
      nodes: elevate([...s.nodes.filter((n) => !removeIds.has(n.id)), ...addNodes], null),
      edges: [
        ...s.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target)),
        ...addEdges
      ],
      results: (() => {
        const r = { ...s.results }
        for (const [from, to] of resultRemap) {
          if (r[from]) r[to] = r[from]
          delete r[from]
        }
        return r
      })(),
      groupLayouts: remapLayouts(s.groupLayouts, layoutRemap),
      nextId,
      selectedId: null,
      selectedSub: null
    }))
  },

  addGroupChild: (groupId, kind, override) => {
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
    get().commit()
    const config = startingConfig(kind, override)
    const [child] = toChildren([{ kind, config }], get().nextId)
    set((s) => ({
      nextId: s.nextId + 1,
      selectedSub: child.id,
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n)) return n
        const cfg = n.data.config as PlotGroupConfig
        return { ...n, data: { ...n.data, config: { ...cfg, children: [...cfg.children, child] } } }
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
        config: startingConfig(s.kind, s.override)
      })),
      startId
    )
    set((s) => ({
      nextId: startId + added.length,
      selectedSub: added[added.length - 1].id,
      nodes: s.nodes.map((n) => {
        if (n.id !== groupId || !isStep(n)) return n
        const cfg = n.data.config as PlotGroupConfig
        return {
          ...n,
          data: { ...n.data, config: { ...cfg, children: [...cfg.children, ...added] } }
        }
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
          ? {
              ...n,
              data: {
                ...n.data,
                config: { ...(n.data.config as PlotGroupConfig), children: remaining }
              }
            }
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
          ? {
              ...n,
              data: {
                ...n.data,
                config: { ...(n.data.config as PlotGroupConfig), children: remaining }
              }
            }
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
        return {
          ...n,
          data: { ...n.data, config: { ...(n.data.config as PlotGroupConfig), children: kids } }
        }
      })
    }))
  },

  setGroupsCollapsed: (ids, collapsed) => {
    const want = new Set(ids)
    const hits = get().nodes.filter(
      (n) =>
        want.has(n.id) &&
        isStep(n) &&
        n.data.kind === 'plotGroup' &&
        !!(n.data.config as PlotGroupConfig).collapsed !== collapsed
    )
    if (!hits.length) return
    get().commit()
    const ok = new Set(hits.map((n) => n.id))
    // Folding or unfolding changes the tile's height, so bring it to the front of its neighbours.
    lift(ok)
    set((s) => ({
      nodes: elevate(
        s.nodes.map((n) =>
          ok.has(n.id) && isStep(n)
            ? { ...n, data: { ...n.data, config: { ...n.data.config, collapsed } as NodeConfig } }
            : n
        ),
        s.selectedId
      )
    }))
  },

  tidyNodes: (ids) => {
    const sel = ids
      .map((id) => get().nodes.find((n) => n.id === id))
      .filter((n): n is StepNode => !!n && isStep(n))
    if (sel.length < 2) return
    get().commit()
    // Height as last drawn; one never drawn on the canvas (made in the form) is estimated — a
    // plot group grows a row per plot.
    const height = (n: StepNode): number =>
      n.measured?.height ??
      120 +
        (n.data.kind === 'plotGroup'
          ? ((n.data.config as PlotGroupConfig).children?.length ?? 0) * 30
          : 0)
    const pos = tidyLayout(
      sel.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, h: height(n) })),
      get().edges
    )
    set((s) => ({
      nodes: s.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n))
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
              data: { kind: op, config: startingConfig(op), status: 'idle', error: undefined }
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
    // An input still running: wait for it (a group's plots each wait in runPlotChild).
    const waiting = get().nodes.find((n) => n.id === id)
    if (waiting && isStep(waiting) && waiting.data.kind !== 'plotGroup') {
      const markWaiting = (): void =>
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === id && isStep(n)
              ? { ...n, data: { ...n.data, status: 'running', error: undefined, note: undefined } }
              : n
          )
        }))
      const go = await waitForInputs(
        get,
        id,
        () => get().upstreamIds(id),
        markWaiting,
        () => get().nodes.find((n) => n.id === id)?.data.status === 'running'
      )
      if (!go) return
    }
    const state = get()
    const node = state.nodes.find((n) => n.id === id)
    if (!node || !isStep(node)) return
    const kind = node.data.kind
    // A finished run stores new results, and results are saved in the project — so it's an unsaved
    // change: without marking it, Save stayed disabled ("All changes saved") after a run, and
    // closing didn't offer to save.
    const setStatus = (status: NodeData['status'], error?: string, note?: string) =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === id && isStep(n) ? { ...n, data: { ...n.data, status, error, note } } : n
        ),
        ...(status === 'done' ? { dirty: true } : {})
      }))

    const upId = state.upstreamId(id)

    // Plots: a group runs each of its plots (each with its own status); a plot computes what it
    // needs to be viewed (plotRun.ts).
    if (kind === 'plotGroup') {
      // The plots not done yet — or, when all are (Re-run), every one.
      const kids = (node.data.config as PlotGroupConfig).children
      const todo = kids.some((c) => c.status !== 'done')
        ? kids.filter((c) => c.status !== 'done')
        : kids
      for (const c of todo) {
        await get().runPlotChild(id, c.id)
        // Stopped (the plot was set back to idle): leave the rest as they are.
        const g = get().nodes.find((n) => n.id === id)
        const now =
          g && isStep(g)
            ? (g.data.config as PlotGroupConfig).children.find((x) => x.id === c.id)
            : undefined
        if (!now || (now.status ?? 'idle') === 'idle') return
      }
      return
    }
    if (categoryOf(kind) === 'plotting') {
      setStatus('running')
      const seq = nextPlotRun(id)
      try {
        const r = await runPlot(
          kind,
          node.data.config,
          upId ? get().results[upId] : undefined,
          () => get().nodes.find((n) => n.id === id)?.data.status !== 'running',
          cleanTransformOf(get().nodes, upId)
        )
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        if (plotRunSeq.get(id) !== seq) return // superseded by a newer run of this plot
        set((s) => ({ results: { ...s.results, [id]: r } }))
        setStatus('done')
      } catch (err) {
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return
        if (plotRunSeq.get(id) !== seq) return
        setStatus('error', err instanceof Error ? err.message : String(err))
      }
      return
    }

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
        // Generated standard files live in the workflow's folder; the read falls back to the shared
        // data-folder root, so your own input files and older projects' flat ones still resolve.
        const wf = locationOf(state)?.scope
        // The file is being read afresh: drop its cached preview so the settings re-read it too
        // (a re-converted import keeps the same file name).
        scalePreviews.delete(`${dir}|${wf?.base ?? ''}|${load.data}`)
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
          // The interactive import knows exactly which samplesheet columns are custom conditions;
          // a hand-written samplesheet (manual mode) leaves this unset and ingest auto-detects. One
          // switched off isn't written, so isn't listed.
          customConditions: load.interactive?.customConditions?.filter(
            (n) => !load.interactive?.hiddenConditions?.includes(n)
          ),
          minSamplePct: cleanupOn(cfg) ? (cfg.minSamplePct ?? 0) : 0,
          minSamplePctBy: cfg.minSamplePctBy ?? [],
          normalize: cfg.normalizeEnabled
            ? {
                reference: cfg.normalizeReference ?? 'shared',
                spread: !!cfg.normalizeSpread
              }
            : undefined,
          impute: imputeOn(cfg)
            ? {
                method: cfg.imputeMethod ?? 'perseus',
                shift: cfg.imputeShift,
                width: cfg.imputeWidth
              }
            : undefined,
          // Global (non-per-row) map from the interactive import — passed straight through so
          // enrichment can group KEGG pathways by category.
          keggCategories: load.interactive?.annotations?.keggCategories,
          logTransform: cfg.logTransform
        })
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
        // A DB is optional, so a missing one doesn't stop the run — but say so.
        setStatus(
          'done',
          undefined,
          load.db && dbText == null
            ? `DB file not found (${load.db}) — ran without annotations.`
            : undefined
        )
        get().invalidateDownstream(id)
      } else if (kind === 'merge') {
        // Pool every upstream Clean data (or Merge — it emits the same result kind) into one
        // dataset, so downstream tiles see the datasets as a single experiment. Genes are matched
        // across inputs by uniqID; samples sharing a condition pool as replicates.
        const stds = state
          .upstreamIds(id)
          .map((u) => state.results[u])
          .filter(
            (r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize'
          )
          .map((r) => r.std)
        if (stds.length === 0) {
          setStatus('error', 'Connect and run two or more Clean data tiles upstream.')
          return
        }
        const std = combineStandardize(stds)
        set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
        setStatus('done')
        get().invalidateDownstream(id)
      } else if (kind === 'subset') {
        // Keep the samples whose conditions take the chosen values (Clean data or a Merge in —
        // either emits the same result kind — and Clean data out).
        const up = upId ? state.results[upId] : undefined
        if (up?.kind !== 'standardize') {
          setStatus('error', 'Connect and run a Clean data tile upstream.')
          return
        }
        const std = subsetStandardize(up.std, (node.data.config as SubsetConfig).keep ?? {})
        if (std.rows.length === 0) {
          setStatus('error', 'No samples match the chosen values.')
          return
        }
        set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
        setStatus('done')
        get().invalidateDownstream(id)
      } else if (kind === 'compare' || kind === 'curveFit') {
        // Compare (and Curve fit, the same num/den model) accepts up to two Standardize inputs; pool them into one dataset (rows matched
        // across datasets by uniqID) so numerator/denominator/context conditions can be drawn from
        // either. One input is the common case and passes through unchanged.
        const stds = state
          .upstreamIds(id)
          .map((u) => state.results[u])
          .filter(
            (r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize'
          )
          .map((r) => r.std)
        if (stds.length === 0) {
          setStatus('error', 'Connect a Clean data tile upstream.')
          return
        }
        const std = combineStandardize(stds)
        const cleanId = state.upstreamIds(id).find((u) => state.results[u]?.kind === 'standardize')
        const cleanNode = cleanId ? state.nodes.find((n) => n.id === cleanId) : undefined
        const testsLogged =
          presentScaleOf(
            stds[0],
            cleanNode && isStep(cleanNode)
              ? (cleanNode.data.config as StandardizeConfig).logTransform
              : undefined
          ) !== 'linear'
        // Migrate any legacy veh_norm/direct config to the explicit num/den/match model, and
        // persist it so the stored workflow is updated on first run.
        const cfg = normalizeCompareConfig(node.data.config as CompareConfig)
        if (cfg !== node.data.config)
          get().updateConfig(id, cfg as unknown as Record<string, unknown>)

        let cmp: CompareTableResult
        if (kind === 'curveFit' || cfg.analysis === 'curve_fit') {
          const numPinned = Object.values(cfg.num).some((v) => v && v.length > 0)
          const denPinned = Object.values(cfg.den).some((v) => v && v.length > 0)
          if (!numPinned || !denPinned) {
            setStatus('error', 'Open “Configure curve fit” to pick the treatments and the control.')
            return
          }
          // The baseline is whatever the user picked — the vehicle, or a treated level (the top
          // dose, a late time) to fit the inverse effect from there.
          const curveAxis = cfg.curveAxis ?? 'dose'
          setStatus('running')
          // The response surface method: spline detection on log₂ level means vs the control,
          // over one axis or the dose × time surface.
          // A dose × time surface (under either model) needs both axes in the data — a saved
          // choice may outlive them.
          const surface =
            !!cfg.surface &&
            std.activeConditions.includes('dose') &&
            std.activeConditions.includes('time')
          if (cfg.detection === 'spline' || surface)
            cmp = await engine.responseSurface({
              rows: std.rows,
              num: cfg.num,
              den: cfg.den,
              match: cfg.match,
              activeConditions: std.activeConditions,
              curveAxis: surface ? 'surface' : curveAxis,
              // under the 4PL model, the 4PL surface detector (adjusted F)
              detector: cfg.detection === 'spline' ? 'spline' : '4pl',
              surfaceDescription: cfg.surfaceDescription,
              describeAll: describesAll(cfg, surface),
              threshold: cfg.threshold,
              interpolation: !!cfg.interpolation
            })
          // The CurveCurator method: fitted on ratios to the control of the linear values (its
          // definition), so Clean data's log-transform setting doesn't enter.
          else
            cmp = await engine.curveFit({
              rows: std.rows,
              num: cfg.num,
              den: cfg.den,
              match: cfg.match,
              activeConditions: std.activeConditions,
              curveAxis,
              threshold: cfg.threshold,
              interpolation: !!cfg.interpolation,
              // responders only marks the rest undescribed (their 4PL is still their test)
              describeAll: describesAll(cfg, false)
            })
        } else if (cfg.analysis === 'compare') {
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
            // as the dialog states them (absent on configs saved before: inferred, nothing pooled)
            compared: cfg.compared,
            pool: cfg.pool,
            activeConditions: std.activeConditions,
            method: cfg.method,
            // Tested on Clean data's scale: in log space when it presents its values logged (a
            // log₂ or log₁₀ choice, or an already-logged input left as it arrived), on the values
            // as they are when not. The first Clean data input decides.
            transform: testsLogged,
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
            setStatus(
              'error',
              'Choose numerator and denominator level(s) for each of the two factors.'
            )
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
            threshold: cfg.threshold,
            // Context inclusion filters (non-factor conditions narrowed in the dialog).
            num: cfg.num,
            den: cfg.den
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
        get().invalidateDownstream(id)
      } else if (kind === 'contrast') {
        const cfg = node.data.config as ContrastConfig
        const ups = state.upstreamIds(id)
        // The Clean data a Compare input ran on (its Standardize inputs pooled, as its run does) —
        // the source of each side's replicates. Undefined for anything but a Compare.
        const compareStd = (cid: string): StandardRow[] | undefined => {
          if (state.results[cid]?.kind !== 'compare') return undefined
          const stds = state
            .upstreamIds(cid)
            .map((u) => state.results[u])
            .filter(
              (r): r is Extract<NodeResult, { kind: 'standardize' }> => r?.kind === 'standardize'
            )
            .map((r) => r.std)
          return stds.length ? combineStandardize(stds).rows : undefined
        }
        // How a Compare input reads its features: by p or q, as it calls; pEC50 in molar where its
        // dose unit says how (as the potency plot reads it).
        const featureCtx = (cid: string): CompareFeatureCtx => {
          const r = state.results[cid]
          const n = state.nodes.find((x) => x.id === cid)
          const cmpCfg = n && isStep(n) ? (n.data.config as CompareConfig) : undefined
          return {
            statType: r?.kind === 'compare' ? (r.cmp.threshold?.statType ?? 'pQ') : 'pQ',
            doseScale: curveDoseUnit(cmpCfg, condUnitsFor(state, cid)).scale
          }
        }
        // A surface's sides carry time (one row per time point): matched on it, never pinned.
        const withTime = (match: ConditionKey[], surf: boolean): ConditionKey[] =>
          surf && !match.includes('time') ? [...match, 'time'] : match
        // Every feature the inputs offer, contrasted alike and stacked — each row tagged with its
        // feature, which the results page's switcher picks (one feature: untagged, nothing to
        // switch).
        const stack = async (
          features: ContrastFeature[],
          run: (f: ContrastFeature) => Promise<ContrastResult>
        ): Promise<ContrastResult> => {
          if (features.length <= 1) return run(features[0] ?? { id: 'value', label: '' })
          const parts: Array<{ f: ContrastFeature; ctr: ContrastResult }> = []
          for (const f of features) parts.push({ f, ctr: await run(f) })
          return {
            ...parts[0].ctr,
            rows: parts.flatMap(({ f, ctr: c }) =>
              c.rows.map((r) => ({ ...r, featureId: f.id, feature: f.label }))
            )
          }
        }
        let ctr: ContrastResult
        let displayMap: Record<string, string>
        if (resolveContrastSource(cfg, ups.length) === 'pair') {
          // Pair mode: two same-kind inputs joined side-by-side by uniqID + matched context —
          // two Compares → FC-vs-FC, two Standardizes → mean-log10-abundance-vs-abundance.
          const sides = pairSides(cfg, ups)
          if (!sides) {
            setStatus(
              'error',
              'Pair mode needs two inputs — connect two Compare or two Clean data tiles.'
            )
            return
          }
          const [idA, idB] = sides
          const ra = state.results[idA]
          const rb = state.results[idB]
          if (!isPairable(ra) || !isPairable(rb) || rb!.kind !== ra!.kind) {
            setStatus(
              'error',
              'Pair mode needs two run inputs of the SAME kind (two Compares, or two Standardizes).'
            )
            return
          }
          const label = (nid: string, fb: string): string => {
            const n = state.nodes.find((x) => x.id === nid)
            return (n && isStep(n) && n.data.name?.trim()) || fb
          }
          setStatus('running')
          // The features both inputs offer (A's names: its significance says p or q).
          const offerB = new Set(contrastFeatures(rb).map((f) => f.id))
          const features = contrastFeatures(ra).filter((f) => offerB.has(f.id))
          const ctxA = featureCtx(idA)
          const ctxB = featureCtx(idB)
          // Dose × time surfaces are contrasted time by time: matched on time.
          const surf = [ra, rb].some((r) => r.kind === 'compare' && r.cmp.rows.some(isSurfaceRow))
          ctr = await stack(features, (f) =>
            engine.contrastPair({
              sideA: toContrastSide(ra, compareStd(idA), f.id, ctxA, true),
              sideB: toContrastSide(rb, compareStd(idB), f.id, ctxB, true),
              match: withTime(cfg.match ?? [], surf),
              fix: cfg.pairFix,
              relationship: cfg.relationship,
              stat: cfg.stat,
              labelA: label(idA, 'A'),
              labelB: label(idB, 'B'),
              // No per-side significance for abundance pairs → the band is the only divergence
              // call.
              driverMask: ra.kind === 'compare'
            })
          )
          displayMap =
            ra.kind === 'compare'
              ? ra.displayMap
              : ra.kind === 'standardize'
                ? ra.std.displayMap
                : {}
          // Standardize sides carry log10 abundance; Compare sides carry log2 fold-change.
          ctr = { ...ctr, valueKind: ra.kind === 'standardize' ? 'abundance' : 'fc' }
        } else {
          // Select mode: pool the single upstream's rows, then split them into the two EXPLICIT
          // selections (num → FC1, den → FC2). Works on a Compare (each row's value is its log2FC)
          // OR a Standardize (value is log10 abundance) — both become a per-row `log2FC`, so a
          // Standardize contrast compares two abundance selections.
          // Several inputs wired: the groups come from the ONE the config picks (the others are
          // idle for this tile). A single input needs no pick.
          const from = selectSource(cfg, ups)
          const fromIds = from ? [from] : ups
          const upResults = fromIds.map((u) => state.results[u]).filter((r): r is NodeResult => !!r)
          const compares = upResults.filter(
            (r): r is Extract<NodeResult, { kind: 'compare' }> => r.kind === 'compare'
          )
          const stds = upResults.filter(
            (r): r is Extract<NodeResult, { kind: 'standardize' }> => r.kind === 'standardize'
          )
          if (!compares.length && !stds.length) {
            setStatus('error', 'Connect a Compare or Clean data tile and run it first.')
            return
          }
          const isAbundance = !compares.length // all-Standardize input → abundance split
          // Each pooled row's replicates (on its value's scale), for the DR's points.
          const repsOf = new WeakMap<CompareResultRow, number[]>()
          // One abundance group as a pseudo primary row: its mean log10 abundance, with the
          // replicate SE carried as fcSE (the DR error band).
          const poolRow = (row: StandardRow, logs: number[]): CompareResultRow => {
            const mean = logs.reduce((s, v) => s + v, 0) / logs.length
            // SE of the mean abundance = SD / √n (matches the fold-change SE convention).
            const sd =
              logs.length >= 2
                ? Math.sqrt(logs.reduce((s, v) => s + (v - mean) ** 2, 0) / (logs.length - 1)) /
                  Math.sqrt(logs.length)
                : null
            return {
              uniqID: row.uniqID,
              cmpd: row.cmpd,
              dose: row.dose,
              time: row.time,
              cell: row.cell,
              ...(row.extra ? { extra: row.extra } : null),
              cmp_cond: '',
              comparison: '',
              mean1: null,
              mean2: null,
              sd1: null,
              sd2: null,
              log2FC: mean,
              fcSE: sd,
              pP: null,
              pQ: null,
              thrsh: '',
              signf: false,
              effect: 'none'
            }
          }
          // Standardize → pseudo primary rows. Replicates are aggregated per (gene × conditions) to
          // mean log10 abundance, with the replicate SD carried as fcSE (the DR error band). This
          // both collapses replicates cleanly and gives an honest per-condition abundance spread.
          const pooled: CompareResultRow[] = isAbundance
            ? (() => {
                // One per gene × condition context (custom conditions included in the key).
                return stdGroups(stds.flatMap((r) => r.std.rows)).map(
                  ({ row, logs }): CompareResultRow => {
                    const out = poolRow(row, logs)
                    repsOf.set(out, logs)
                    return out
                  }
                )
              })()
            : compares.flatMap((r) => r.cmp.rows)
          // A Compare's rows: each replicate's log2 ratio to the control mean.
          if (!isAbundance)
            for (const cid of fromIds) {
              const r = state.results[cid]
              const cstd = compareStd(cid)
              if (r?.kind !== 'compare' || !cstd) continue
              const byGene = stdByGene(cstd)
              for (const row of r.cmp.rows) {
                const reps = replicateLog2FCs(row, byGene.get(row.uniqID) ?? [])
                if (reps.length) repsOf.set(row, reps)
              }
            }
          if (!pooled.length) {
            setStatus('error', 'The upstream tile has no results.')
            return
          }
          if (!isContrastConfigured(cfg)) {
            setStatus('error', 'Configure the two contrast sides (FC1/FC2) in the selector.')
            return
          }
          // Each side is an EXPLICIT cond-value selection. A pooled row belongs to a side when it
          // matches every pinned condition of that side's selector (others are free). FC1 = num side,
          // FC2 = den side; the two are then joined on the chosen match context (runContrastPair
          // aggregates replicates + unmatched dims), so nothing about the context is inferred.
          // Every condition a selector could pin, including the custom ones the rows carry.
          const selConds = condsIn(pooled)
          const matchesSel = (row: CompareResultRow, sel: CondSelector): boolean =>
            selConds.every((c) => {
              const want = sel[c]
              if (!want || want.length === 0) return true
              const v = ctxValue(row, c)
              return v != null && v !== '' && want.map(String).includes(String(v))
            })
          // A pooled row as a side, for one feature: its own value with its SE and replicates, or
          // another feature's value alone (an abundance group's spread from its replicates).
          const selCtx = from ? featureCtx(from) : { statType: 'pQ' as const, doseScale: 1 }
          // A dose × time surface is contrasted time by time (surfaceSideRows), matched on time.
          const surf = !isAbundance && pooled.some(isSurfaceRow)
          const toSideRows = (row: CompareResultRow, f: ContrastFeature): ContrastSideRow[] =>
            isSurfaceRow(row) ? surfaceSideRows(row, f.id, selCtx) : [toSideRow(row, f)]
          const toSideRow = (row: CompareResultRow, f: ContrastFeature): ContrastSideRow => ({
            uniqID: row.uniqID,
            cell: row.cell ?? null,
            cmpd: row.cmpd,
            dose: row.dose,
            time: row.time,
            ...(row.extra ? { extra: row.extra } : null),
            value:
              f.id === 'value'
                ? row.log2FC
                : isAbundance
                  ? stdFeatureValue(repsOf.get(row) ?? [], f.id)
                  : compareFeatureValue(row, f.id, selCtx),
            signf: row.signf,
            effect: row.effect,
            pP: row.pP,
            pQ: row.pQ,
            ...(f.id === 'value'
              ? { se: row.fcSE ?? null, ...(repsOf.has(row) ? { reps: repsOf.get(row) } : null) }
              : null)
          })
          const selLabel = (sel: CondSelector): string => {
            const parts = selConds
              .filter((c) => (sel[c]?.length ?? 0) > 0)
              .map((c) => (sel[c] as string[]).join('/'))
            return parts.length ? parts.join(' · ') : 'all'
          }
          const num = cfg.num ?? {}
          const den = cfg.den ?? {}
          const rowsA = pooled.filter((r) => matchesSel(r, num))
          const rowsB = pooled.filter((r) => matchesSel(r, den))
          if (!rowsA.length || !rowsB.length) {
            setStatus('error', 'One contrast side matched no rows — adjust the FC1/FC2 selections.')
            return
          }
          setStatus('running')
          const features = contrastFeatures(isAbundance ? stds[0] : compares[0])
          ctr = await stack(features, (f) =>
            engine.contrastPair({
              sideA: rowsA.flatMap((r) => toSideRows(r, f)),
              sideB: rowsB.flatMap((r) => toSideRows(r, f)),
              match: withTime(cfg.match ?? [], surf),
              relationship: cfg.relationship,
              stat: cfg.stat,
              labelA: selLabel(num),
              labelB: selLabel(den),
              // Abundance slices carry no per-side significance, so the band is the only
              // divergence call.
              driverMask: !isAbundance
            })
          )
          displayMap = isAbundance ? stds[0].std.displayMap : compares[0].displayMap
          ctr = { ...ctr, valueKind: isAbundance ? 'abundance' : 'fc' }
        }
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
        // Mask hidden-geneset genes non-significant (covers pair mode with no per-side driver signf).
        ctr = { ...ctr, rows: maskSignf(ctr.rows, hiddenGeneIds(get())) }
        set((s) => ({ results: { ...s.results, [id]: { kind: 'contrast', ctr, displayMap } } }))
        setStatus('done')
        get().invalidateDownstream(id)
      }
    } catch (err) {
      // A cancel terminates the worker (rejecting here) but already reset status to idle.
      if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return
      setStatus('error', err instanceof Error ? err.message : String(err))
    }
  },

  cancelNode: (id) => {
    // A run only waiting on its input stands down; the engine is busy with the input's run.
    const n0 = get().nodes.find((n) => n.id === id)
    const onlyWaiting =
      waitingRuns.has(id) ||
      (!!n0 &&
        isStep(n0) &&
        n0.data.kind === 'plotGroup' &&
        (n0.data.config as PlotGroupConfig).children.some(
          (c) => c.status === 'running' && waitingRuns.has(plotResultKey(id, c.id))
        ))
    if (!onlyWaiting) engine.cancel()
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id !== id || !isStep(n)
          ? n
          : n.data.kind === 'plotGroup'
            ? // its running plot stops; the others keep what they have
              withChildStatuses(n, (c) =>
                c.status === 'running'
                  ? { status: 'idle' }
                  : { status: c.status ?? 'idle', error: c.error }
              )
            : { ...n, data: { ...n.data, status: 'idle', error: undefined } }
      )
    }))
  },

  runPlotChild: async (groupId, childId) => {
    // An input still running: wait for it, the plot showing as running meanwhile.
    const childStatus = (): StepStatus | undefined => {
      const g = get().nodes.find((n) => n.id === groupId)
      return g && isStep(g)
        ? (g.data.config as PlotGroupConfig).children.find((c) => c.id === childId)?.status
        : undefined
    }
    const go = await waitForInputs(
      get,
      plotResultKey(groupId, childId),
      () => get().upstreamIds(groupId),
      () =>
        childStatus() !== 'running' &&
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === groupId && isStep(n)
              ? withChildStatuses(n, (c) =>
                  c.id === childId
                    ? { status: 'running' }
                    : { status: c.status ?? 'idle', error: c.error }
                )
              : n
          )
        })),
      () => childStatus() === 'running'
    )
    if (!go) return
    const group = get().nodes.find((n) => n.id === groupId)
    if (!group || !isStep(group) || group.data.kind !== 'plotGroup') return
    const child = (group.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
    if (!child) return
    const key = plotResultKey(groupId, childId)
    const childOf = (): PlotChild | undefined => {
      const g = get().nodes.find((n) => n.id === groupId)
      return g && isStep(g)
        ? (g.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
        : undefined
    }
    const setChild = (status: StepStatus, error?: string): void =>
      set((s) => ({
        nodes: s.nodes.map((n) =>
          n.id === groupId && isStep(n)
            ? withChildStatuses(n, (c) =>
                c.id === childId
                  ? { status, error }
                  : { status: c.status ?? 'idle', error: c.error }
              )
            : n
        ),
        // A finished run stores a result saved with the project — an unsaved change.
        ...(status === 'done' ? { dirty: true } : {})
      }))
    setChild('running')
    const upId = get().upstreamId(groupId)
    const seq = nextPlotRun(key)
    try {
      const r = await runPlot(
        child.kind,
        child.config,
        upId ? get().results[upId] : undefined,
        () => childOf()?.status !== 'running',
        cleanTransformOf(get().nodes, upId)
      )
      if (childOf()?.status !== 'running') return // cancelled
      if (plotRunSeq.get(key) !== seq) return // superseded by a newer run of this plot
      set((s) => ({ results: { ...s.results, [key]: r } }))
      setChild('done')
    } catch (err) {
      if (childOf()?.status !== 'running') return
      if (plotRunSeq.get(key) !== seq) return
      setChild('error', err instanceof Error ? err.message : String(err))
    }
  },

  rerunFrom: async (id) => {
    await get().runNode(id)
    if (get().nodes.find((n) => n.id === id && isStep(n))?.data.status !== 'done') return
    await get().refreshDownstream(id)
  },

  refreshDownstream: async (id) => {
    // Coalesced per step: a drag landing while the last one's refresh still runs doesn't start a
    // second (two runs of one Contrast could finish out of order) — the running one goes round
    // once more when done, so the last cutoff always wins.
    const busy = refreshing.get(id)
    if (busy) {
      busy.again = true
      return
    }
    const state = { again: false }
    refreshing.set(id, state)
    try {
      do {
        state.again = false
        await refreshOnce()
      } while (state.again)
    } finally {
      refreshing.delete(id)
    }
    async function refreshOnce(): Promise<void> {
      const { edges } = get()
      const downstream = new Set<string>()
      let frontier = [id]
      while (frontier.length) {
        const next: string[] = []
        for (const f of frontier)
          for (const e of edges)
            if (e.source === f && !downstream.has(e.target)) {
              downstream.add(e.target)
              next.push(e.target)
            }
        frontier = next
      }
      // The node list keeps every step after its inputs (sortStepsByWiring), so its order runs
      // each downstream step after what it reads.
      // Below a failed step, steps would only fail too, so they're skipped — but a failed plot
      // skips nothing (nothing reads from it), and the other branches still run (as runAll).
      const skipped = new Set<string>()
      for (const n of get().nodes) {
        if (!downstream.has(n.id) || skipped.has(n.id)) continue
        const kind = get().nodeKind(n.id)
        if (!kind || !NODE_SPECS[kind].hasRun) continue
        await get().runNode(n.id)
        if (
          categoryOf(kind) !== 'plotting' &&
          get().nodes.find((x) => x.id === n.id && isStep(x))?.data.status === 'error'
        )
          for (const d of downstreamOf(n.id, get().edges)) skipped.add(d)
      }
    }
  },

  runAll: async () => {
    if (get().runningAll) return
    const { nodes, edges } = get()
    // Branch by branch: a finished branch can be viewed while the others still run (runOrder).
    const order = runOrder(
      nodes.filter(isStep).map((n) => n.id),
      edges
    )

    set({ runningAll: true })
    // Steps below a failed one: they'd only fail too, so they're skipped — but the other branches
    // still run.
    const skipped = new Set<string>()
    for (const id of order) {
      if (!get().runningAll) break // stopped by the user
      if (skipped.has(id)) continue
      const kind = get().nodeKind(id)
      if (!kind || !NODE_SPECS[kind].hasRun) continue
      await get().runNode(id)
      // A plot's failure skips nothing — nothing reads from it.
      if (
        categoryOf(kind) !== 'plotting' &&
        get().nodes.find((n) => n.id === id)?.data.status === 'error'
      )
        for (const d of downstreamOf(id, get().edges)) skipped.add(d)
    }
    set({ runningAll: false })
  },

  stopAll: () => {
    engine.cancel()
    set((s) => ({
      runningAll: false,
      nodes: s.nodes.map((n) =>
        !isStep(n) || n.data.status !== 'running'
          ? n
          : n.data.kind === 'plotGroup'
            ? // its running plot stops; the others keep what they have
              withChildStatuses(n, (c) =>
                c.status === 'running'
                  ? { status: 'idle' }
                  : { status: c.status ?? 'idle', error: c.error }
              )
            : { ...n, data: { ...n.data, status: 'idle', error: undefined } }
      )
    }))
  },

  invalidateDownstream: (id, stepsOnly = false) => {
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
    // Steps only: the plots stay as they are (they redraw from their input, or re-run after).
    if (stepsOnly)
      for (const d of [...downstream]) {
        const kind = get().nodeKind(d)
        if (kind && categoryOf(kind) === 'plotting') downstream.delete(d)
      }
    if (downstream.size === 0) return
    const clearedResults = { ...results }
    for (const d of downstream) delete clearedResults[d]
    const idled = nodes.map((n) =>
      downstream.has(n.id) && isStep(n)
        ? { ...n, data: { ...n.data, status: 'idle' as const, error: undefined } }
        : n
    )
    // …and a group tile's plots, each kept under its own key.
    set(clearPlotResults(idled, clearedResults, downstream))
  },

  markStale: (id) => {
    const results = { ...get().results }
    delete results[id]
    const idled = get().nodes.map((n) =>
      n.id === id && isStep(n)
        ? { ...n, data: { ...n.data, status: 'idle' as const, error: undefined } }
        : n
    )
    set(clearPlotResults(idled, results, new Set([id])))
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
    return window.api
      .scratchDir()
      .then((scratchRoot) => set({ scratchRoot }))
      .catch(() => undefined)
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
  confirmDiscard: async (action) => {
    // goHome keeps the project in memory, so "dirty" applies even from the Home screen.
    if (!get().dirty || get().folders.length === 0) return true
    const choice = await window.api.askSaveChanges(action)
    if (choice === 'cancel') return false
    if (choice === 'save') return get().saveProject()
    return true
  },
  newProject: async () => {
    if (!(await get().confirmDiscard('starting a new project'))) return
    const proj = newProjectFile()
    set({
      projectPath: null,
      projectName: proj.name,
      projectCreatedWith: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
      projectOpen: true,
      folders: proj.folders,
      activeFolderId: proj.activeFolderId,
      geneSets: [],
      dirty: false,
      inputFiles: [],
      inputFileFolders: {}
    })
    loadSlot(get, set, proj.activeFolderId)
    // A fresh project always starts on the Workflow canvas.
    useAppView.getState().setView('canvas')
  },
  openProject: async (path) => {
    if (!(await get().confirmDiscard('opening another project'))) return
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
      // Saved by a newer app: it may still open, so warn and carry on rather than refuse.
      const savedBy = savedByVersion(text)
      const current = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null
      if (savedBy && current && isNewerVersion(savedBy, current)) {
        const file = p ? (p.split(/[/\\]/).pop() ?? p) : 'This project'
        await window.api.warnNewerProject(file, savedBy, current)
      }
      // A template opened as a project starts a new one from it — opening it in place would make
      // Save write a project over the template.
      if (isTemplateText(text)) {
        startFromTemplate(get, set, text)
        return
      }
      const proj = deserializeProject(text)
      // Folders found next to the project by their saved relative paths (a project copied to
      // another machine with its folders) are used there — not an edit, so not dirty: the next
      // save writes their new full paths.
      if (p && typeof window.api.pathExists === 'function') {
        const isDir = (q: string): Promise<boolean> => window.api.pathExists(q).then((e) => e.dir)
        proj.folders = (await relocateFolders(proj.folders, p, isDir)).folders
      }
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
      // Resume where the user left off: the position remembered locally as they navigated (which
      // needs no save) wins over the one written into the file at its last save. Read it before
      // any set() below, since the position tracker starts overwriting it as state changes.
      const last = p ? loadLastView(p) : null
      const wantFolder = last?.folderId ?? proj.activeFolderId
      const activeFolderId = folders.some((f) => f.id === wantFolder) ? wantFolder : folders[0].id
      const folder = folders.find((f) => f.id === activeFolderId)
      const workflowId =
        last?.folderId === activeFolderId && folder?.workflows.some((w) => w.id === last.workflowId)
          ? (last.workflowId ?? undefined)
          : undefined
      set({
        projectPath: p,
        projectName,
        projectCreatedWith: proj.createdWith ?? null,
        recentHeaders: p
          ? { ...get().recentHeaders, [p]: projectHeader(text) }
          : get().recentHeaders,
        projectOpen: true,
        folders,
        activeFolderId,
        geneSets: proj.geneSets ?? [],
        dirty: false,
        recentProjects: pushRecent(get().recentProjects, { path: p as string, name: projectName })
      })
      loadSlot(get, set, activeFolderId, workflowId)
      // …and the page (Workflow canvas vs Results dashboard) and its tab, instead of always
      // dropping onto the canvas.
      const av = useAppView.getState()
      av.setView(last?.view ?? proj.view ?? 'canvas')
      const tab = last ? last.resultsTab : proj.resultsTab
      if (tab) av.setResultsTab(tab)
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
    set({ saving: true })
    let warnings: string[]
    try {
      warnings = await applyDiskLayout(get, set, 'rename')
      syncActiveSlot(get, set) // edits made while folders moved
      const file = await withParkedResults(buildProjectFile(get))
      await window.api.saveProject(path, serializeProjectChunks(file))
    } catch (err) {
      set({ saveError: saveErrorText(err) })
      return false
    } finally {
      set({ saving: false })
    }
    set({
      dirty: false,
      saveError: null,
      saveWarning: layoutWarning(warnings),
      recentProjects: pushRecent(get().recentProjects, { path, name: get().projectName }),
      recentHeaders: { ...get().recentHeaders, [path]: savedHeader(get) }
    })
    return true
  },
  saveProjectAs: async () => {
    const path = await window.api.pickProjectSavePath(get().projectName)
    if (!path) return false
    const name = (path.split(/[/\\]/).pop() ?? 'project').replace(/\.omicexplorer$/i, '')
    syncActiveSlot(get, set)
    const prevPath = get().projectPath
    set({ projectPath: path, projectName: name })
    set({ saving: true })
    let warnings: string[]
    try {
      // First save: out of scratch. A new file: copy the data (the original keeps its own).
      warnings = await applyDiskLayout(
        get,
        set,
        !prevPath ? 'first' : prevPath !== path ? 'copy' : 'rename'
      )
      syncActiveSlot(get, set)
      const file = await withParkedResults(buildProjectFile(get))
      await window.api.saveProject(path, serializeProjectChunks(file))
    } catch (err) {
      set({ saveError: saveErrorText(err) })
      return false
    } finally {
      set({ saving: false })
    }
    set({
      dirty: false,
      saveError: null,
      saveWarning: layoutWarning(warnings),
      recentProjects: pushRecent(get().recentProjects, { path, name }),
      recentHeaders: { ...get().recentHeaders, [path]: savedHeader(get) }
    })
    return true
  },
  saveTemplate: async (sections) => {
    const path = await window.api.pickSavePath({
      defaultPath: `${get().projectName}.${TEMPLATE_EXT}`,
      ext: TEMPLATE_EXT,
      typeName: 'OmicExplorer template'
    })
    if (!path) return false
    syncActiveSlot(get, set)
    const name = (path.split(/[/\\]/).pop() ?? 'template').slice(0, -(TEMPLATE_EXT.length + 1))
    try {
      const tpl = buildTemplate(buildProjectFile(get), sections, name)
      await window.api.saveProject(path, serializeTemplate(tpl))
    } catch (err) {
      set({ saveError: saveErrorText(err) })
      return false
    }
    return true
  },
  newFromTemplate: async () => {
    if (!(await get().confirmDiscard('starting a new project'))) return
    set({ openError: null })
    try {
      const picked = await window.api.openTemplate()
      if (picked) startFromTemplate(get, set, picked.content)
    } catch (e) {
      set({ openError: `Couldn't open template: ${e instanceof Error ? e.message : String(e)}` })
    }
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
    const scope = locationOf(get())?.scope
    // Folders are best-effort: a main process from before a restart has no listWhere.
    const folders = await window.api.listDataFileFolders?.(dir, scope).catch(() => ({}))
    set({
      inputFiles: await window.api.listDataFiles(dir, scope),
      inputFileFolders: folders ?? {},
      dataDirMissing: false
    })
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
      // A template's spec (no columns yet) is fitted onto this matrix's: read by its preset, then
      // whatever of it still applies carried over (see fitTemplateSpec).
      const tpl = isTemplateSpec(cfg.interactive) ? cfg.interactive : null
      const by = tpl?.preset && tpl.preset !== 'custom' ? tpl.preset : preset
      interactive = { columns: info.columns, roles: guessRolesPreset(info, by), conditions: {} }
      if (tpl) interactive = fitTemplateSpec(tpl, interactive)
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
        customConditions: interactive.customConditions,
        hiddenConditions: interactive.hiddenConditions,
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
    // Base the generated names on the matrix.
    const base = cfg.matrix.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '')
    const files = {
      data: `${base}_datamatrix.csv`,
      samplesheet: `${base}_samplesheet.csv`,
      db: `${base}_metadata.csv`
    }
    // Generated files go to the workflow folder's input/.
    try {
      await diskWrite(async () => {
        const wf = locationOf(get())?.scope
        await window.api.writeInputFile(dir, files.data, adapted.dataText, wf)
        await window.api.writeInputFile(dir, files.samplesheet, adapted.samplesheetText, wf)
        await window.api.writeInputFile(dir, files.db, adapted.dbText, wf)
      })
    } catch (e) {
      void get().refreshDataFiles()
      return { ok: false, error: e instanceof Error ? e.message : 'Failed to write inputs.' }
    }
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
    const wasActive = get().activeFolderId === id
    // A project always keeps at least one folder: deleting the only one resets it to a fresh,
    // empty folder (no path) rather than leaving none — so the "select a data folder" guide shows.
    if (list.length <= 1) {
      if (!list.some((f) => f.id === id)) return
      const fresh = newFolder('', 'Folder 1')
      set({ folders: [fresh], dirty: true })
      loadSlot(get, set, fresh.id)
      void get().refreshDataFiles()
      return
    }
    const remaining = list.filter((f) => f.id !== id)
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
  moveFolder: async (id) => {
    syncActiveSlot(get, set)
    const s0 = get()
    const f = s0.folders.find((x) => x.id === id)
    if (!f?.path) return
    const from = f.path
    const to = await window.api.pickDataDir()
    if (!to || to === from) return
    const nameOf = (p: string): string => p.split(/[/\\]/).pop() ?? p
    if (s0.folders.some((x) => x.id !== id && x.path === to)) {
      set({ saveError: `${to} is already a folder of this project` })
      return
    }
    // A saved project's data folder is under the folder; an unsaved one's is in the session
    // scratch (keyed by the folder), so only the path changes.
    const root = s0.projectPath
      ? dataRootOf(f, { saved: true, projectName: s0.projectName, scratch: s0.scratchRoot })
      : null
    if (root && (to === root || to.startsWith(`${root}/`) || to.startsWith(`${root}\\`))) {
      set({ saveError: `Can't move ${f.name} into its own project data folder` })
      return
    }
    set({ saving: true })
    const res = await exclusiveDisk(async () => {
      let dataName = f.dataName
      if (root) {
        const [r] = await window.api.applyDirOps([
          { from: root, to: `${to}/${nameOf(root)}`, mode: 'move', unique: true }
        ])
        if (!r.ok) return { error: `Couldn't move ${nameOf(root)} to ${to}: ${r.error ?? ''}` }
        if (!r.skipped) dataName = nameOf(r.to)
      }
      const copy = await window.api.copyInputFiles(from, to, inputRefsOf(get(), f))
      return { dataName, errors: copy.errors }
    }).finally(() => set({ saving: false }))
    if ('error' in res) {
      set({ saveError: res.error })
      return
    }
    // A folder still named after its old location takes the new one's name.
    const name = f.name === nameOf(from) ? nameOf(to) : f.name
    set({
      folders: get().folders.map((x) =>
        x.id === id
          ? { ...x, path: to, name, ...(res.dataName ? { dataName: res.dataName } : null) }
          : x
      ),
      dirty: true,
      saveWarning: res.errors.length
        ? `Moved, but some input files couldn't be copied: ${res.errors.join('; ')}`
        : null
    })
    if (get().activeFolderId === id) {
      set({ dataDir: to })
      await get().refreshDataFiles()
    }
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
  loadRecentHeaders: async () => {
    const paths = get().recentProjects.map((r) => r.path)
    if (paths.length === 0 || typeof window.api.readProjectHeads !== 'function') return
    try {
      const heads = await window.api.readProjectHeads(paths)
      const next: Record<string, ProjectHeader> = {}
      for (const [path, text] of Object.entries(heads)) if (text) next[path] = projectHeader(text)
      set({ recentHeaders: { ...get().recentHeaders, ...next } })
    } catch {
      // best-effort — rows just go without a version tag
    }
  },
  upgradeProject: async (path) => {
    const s0 = get()
    const isOpen = s0.projectOpen && s0.projectPath === path
    try {
      const text = await window.api.readProject(path)
      const before = projectHeader(text)
      // The old file, untouched, beside the project — the way back if the rewrite misreads it.
      const backup = await window.api.backupProject(path, before.savedBy ?? 'unknown')
      if (isOpen) {
        // The open project was migrated when it was opened: saving it writes the current form.
        if (!(await get().saveProject())) return { error: get().saveError ?? 'save failed' }
        return { backup }
      }
      // Not open: read it as opening would (every migration applied), write it straight back.
      const proj = deserializeProject(text)
      // Header first, in the order the home page reads it back (projectHeader).
      const { format, version, createdWith, ...body } = proj
      const file: ProjectFile = {
        format,
        version,
        ...(typeof __APP_VERSION__ === 'string' ? { appVersion: __APP_VERSION__ } : null),
        ...(createdWith ? { createdWith } : null),
        ...body
      }
      await window.api.saveProject(path, serializeProjectChunks(file))
      set({
        recentHeaders: {
          ...get().recentHeaders,
          [path]: {
            format: PROJECT_VERSION,
            savedBy: file.appVersion ?? null,
            createdWith: createdWith ?? null
          }
        }
      })
      return { backup }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
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
    void get().refreshDataFiles()
    // A new workflow is empty and built on the canvas — land there rather than leaving the user
    // on a now-blank Results dashboard (which reads as "stuck").
    useAppView.getState().setView('canvas')
  },
  switchWorkflow: (id) => {
    if (id === get().activeWorkflowId) return
    syncActiveSlot(get, set)
    const fid = get().activeFolderId
    if (fid) loadSlot(get, set, fid, id)
    void get().refreshDataFiles()
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
    if (id === get().activeWorkflowId) void get().refreshDataFiles()
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
    if (wasActive) {
      loadSlot(get, set, folder.id, remaining[0].id)
      void get().refreshDataFiles()
    }
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
    // A hidden set's genes are the mask: changing them changes what's masked.
    if (get().geneSets.find((g) => g.id === id)?.hidden) reapplyGeneMask(get, set)
  },
  setGeneSetColor: (id, color) => {
    set((s) => {
      if (!s.geneSets.some((g) => g.id === id)) return {}
      return {
        geneSets: s.geneSets.map((g) => {
          if (g.id !== id) return g
          const next = { ...g }
          if (color) next.color = color
          else delete next.color
          return next
        }),
        dirty: true
      }
    })
  },
  deleteGeneSet: (id) => {
    const gone = get().geneSets.find((g) => g.id === id)
    if (!gone) return
    set((s) => ({ geneSets: s.geneSets.filter((g) => g.id !== id), dirty: true }))
    // Only a HIDDEN set is part of the mask. Re-applying it rebuilds every Compare result (so every
    // plot redraws) and re-runs every Contrast — work a visible set's deletion doesn't need.
    if (gone.hidden) reapplyGeneMask(get, set)
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
    const { nodes, edges, nextId, past, frames } = get()
    // A snapshot keeps the current lists by REFERENCE, not a deep copy: every change replaces the
    // objects it touches (never edits them in place), so an untouched node — say an interactive
    // Load holding megabytes of fetched annotations — is shared by every step of the history
    // instead of copied into each. Results are recorded as versions in the history cache, which
    // spills replaced ones to disk rather than holding them all (see historyCache.ts).
    const snap: Snapshot = { nodes, edges, nextId, frames, versions: history.ref(get().results) }
    set({ past: [...past, snap].slice(-50), future: [], dirty: true })
  },
  undo: () => {
    const { past, future, nodes, edges, nextId, frames, results } = get()
    if (past.length === 0) return
    const prev = past[past.length - 1]
    const cur: Snapshot = { nodes, edges, nextId, frames, versions: history.ref(results) }
    // Results that still hold stay, a threshold change is re-called, the rest come back from the
    // history cache (or need a re-run when it no longer has them).
    const restored = restoreResults({ nodes, edges, results }, prev, reclassifyFor(get()), history)
    set({
      nodes: rollGroups(restored.nodes),
      edges: prev.edges,
      nextId: prev.nextId,
      frames: prev.frames ?? frames,
      past: past.slice(0, -1),
      future: [...future, cur],
      results: restored.results,
      selectedId: null,
      dirty: true
    })
    loadFromHistory(get, set, restored.pending)
  },
  redo: () => {
    const { past, future, nodes, edges, nextId, frames, results } = get()
    if (future.length === 0) return
    const next = future[future.length - 1]
    const cur: Snapshot = { nodes, edges, nextId, frames, versions: history.ref(results) }
    const restored = restoreResults({ nodes, edges, results }, next, reclassifyFor(get()), history)
    set({
      nodes: rollGroups(restored.nodes),
      edges: next.edges,
      nextId: next.nextId,
      frames: next.frames ?? frames,
      future: future.slice(0, -1),
      past: [...past, cur],
      results: restored.results,
      selectedId: null,
      dirty: true
    })
    loadFromHistory(get, set, restored.pending)
  }
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
    history.sync(g.results, live)
  }, 0)
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
