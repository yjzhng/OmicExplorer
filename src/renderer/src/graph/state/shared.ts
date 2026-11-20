import type { Edge } from '@xyflow/react'
import {
  type ThresholdConfig,
  applyCurveFdr,
  classifyCompareRow,
  thresholdLabel
} from '../../engine'
import { useAppSettings } from '../../ui/useAppSettings'
import { dataRootOf, withDiskNames, workflowDirOf } from '../diskNames'
import { hiddenGeneIds } from '../geneMask'
import { HistoryCache } from '../historyCache'
import { type ProjectWorkflow, geneMaskKey, packedResultsChunks, unpackParked } from '../project'
import { NODE_SPECS } from '../registry'
import { restampScales } from '../resultScales'
import { type Getter, type GraphState, type Setter } from '../store'
import {
  type CanvasFrame,
  type CompareConfig,
  type GraphNode,
  type NodeConfig,
  type NodeKind,
  type NodeResult,
  type PlotChild,
  type PlotGroupConfig,
  type StepNode,
  type StepStatus,
  isStep,
  plotResultKey
} from '../types'
import {
  type LoadedWorkflow,
  type WorkflowDoc,
  buildWorkflowDoc,
  parseWorkflowDoc
} from '../workflowDoc'

/** A Compare result re-called under `threshold`: only thrsh/signf/effect (and a curve fit's FDR)
 *  depend on it — log2FC, pP and pQ are final. `hidden` genes stay uncalled (the geneset mask
 *  holds across threshold edits). Shared by a threshold drag and its undo/redo. */
export function reclassify(
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
/** The results behind undo/redo: replaced versions spill to session files (see historyCache.ts).
 *  `window.api` is read per call — it isn't there yet when this module loads in a test. */
export const resultHistory = new HistoryCache({
  write: (key, pieces) => window.api.parkWrite(key, pieces),
  read: (key) => window.api.parkRead(key),
  drop: (key) => window.api.parkDrop(key),
  pack: packedResultsChunks,
  unpack: unpackParked
})
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
export function makeNode(id: string, op: NodeKind, position: { x: number; y: number }): StepNode {
  return {
    id,
    type: 'step',
    position,
    data: { kind: op, config: startingConfig(op), status: 'idle' }
  }
}
export interface Snapshot {
  nodes: GraphNode[]
  edges: Edge[]
  nextId: number
  /** absent in a snapshot taken without it (keeps the frames as they are on restore) */
  frames?: CanvasFrame[]
  /** result key → the version it held, kept in the history cache (absent = none recorded) */
  versions?: Record<string, number>
}
export function docFromLive(s: GraphState): WorkflowDoc {
  return buildWorkflowDoc({
    nodes: s.nodes,
    edges: s.edges,
    nextId: s.nextId,
    groupLayouts: s.groupLayouts,
    groupMeta: s.groupMeta,
    frames: s.frames
  })
}
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
/** What a project folder clean-up would remove: paths under `root` (the project data folder). */
export interface CleanupPlan {
  folderId: string
  root: string
  remove: string[]
}
/** A workflow's steps and wiring — the live graph for the open workflow, else its saved doc. */
export function graphOf(s: GraphState, folderId: string, wf: ProjectWorkflow) {
  const live = folderId === s.activeFolderId && wf.id === s.activeWorkflowId
  return live ? { nodes: s.nodes.filter(isStep), edges: s.edges } : wf.doc
}
/** Re-apply the geneset significance mask across the whole project after a hidden-set change.
 *  Compare results are re-classified in place (recompute signf from the node's threshold, then
 *  mask) — cheap and live. Contrasts mask by the compare's per-gene call, so any already-computed
 *  contrast is AUTO-RECOMPUTED (no manual re-run) against the freshly re-classified compares —
 *  like a threshold drag, carried through to completion. */
export function reapplyGeneMask(get: Getter, set: Setter): void {
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
export let liveMask: string | undefined
/** Bring the open workflow's results under the project's gene mask, if they were classified
 *  under another — genesets are the project's, so a set hidden in one workflow masks them all. */
export function syncGeneMask(get: Getter, set: Setter): void {
  if (liveMask !== geneMaskKey(get().geneSets)) reapplyGeneMask(get, set)
}
/** Flush the live graph + results into the active folder's active workflow. */
export function syncActiveSlot(get: Getter, set: Setter): void {
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
export function groupStatus(children: PlotChild[]): { status: StepStatus; error?: string } {
  const st = children.map((c) => c.status ?? 'idle')
  if (st.includes('running')) return { status: 'running' }
  const failed = children.find((c) => c.status === 'error')
  if (failed) return { status: 'error', error: failed.error }
  return { status: children.length > 0 && st.every((x) => x === 'done') ? 'done' : 'idle' }
}
/** A group node with its plots' statuses set by `statusOf` (and its own rolled up from them). */
export function withChildStatuses(
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
/** Run statuses from the results a workflow was restored with: a step or plot with a result is
 *  done (Re-run, not Run) — a group tile's plots each by their own. */
export function restoredStatuses(
  nodes: GraphNode[],
  results: Record<string, NodeResult>
): GraphNode[] {
  return nodes.map((n) => {
    if (!isStep(n)) return n
    if (n.data.kind === 'plotGroup')
      return withChildStatuses(n, (c) => ({
        status: results[plotResultKey(n.id, c.id)] ? 'done' : 'idle'
      }))
    return results[n.id] ? { ...n, data: { ...n.data, status: 'done' as const } } : n
  })
}
export function loadSlot(get: Getter, set: Setter, folderId: string, workflowId?: string): void {
  // Pin on-disk folder names before anything can be written (see graph/diskNames.ts).
  const pinned = withDiskNames(get().folders, !!get().projectPath, get().projectName)
  if (pinned !== get().folders) set({ folders: pinned })
  const folder = get().folders.find((f) => f.id === folderId)
  if (!folder) return
  const wfId = workflowId ?? folder.activeWorkflowId ?? folder.workflows[0]?.id
  const slot = folder.workflows.find((w) => w.id === wfId) ?? folder.workflows[0]
  if (!slot) return
  const loaded: LoadedWorkflow = parseWorkflowDoc(slot.doc)
  // A parked workflow's results come back from disk a moment later (unparkActive). Saved results'
  // scales follow their steps (a result from before they carried one may hold a stale one).
  const results = slot.parked ? {} : restampScales(loaded.nodes, loaded.edges, slot.results ?? {})
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
    // another workflow's tiles (ids repeat across workflows): checked afresh
    loadChecks: {},
    past: [],
    future: []
  })
  liveMask = slot.mask
  // Only the open workflow's results stay in memory: the one just left (and any other) is parked
  // FIRST, then the open one's come back (the park queue runs in order) — so two large workflows
  // are never in memory together, which ran a project of several out of memory.
  parkInactive(get, set)
  if (slot.parked) unparkActive(get, set, folderId, slot.id, slot.parked)
  else syncGeneMask(get, set)
}
// ── parking: only the open workflow's results are kept in memory ─────────────────────────────
// Every other workflow's results wait on disk (main/park.ts) in the project file's packed form,
// and come back when it's opened again. Parking and unparking run one at a time, in order.
/** Workflows whose results were read back from a park file, with that very object — parked again
 *  unchanged, they reuse the file instead of writing it anew. */
export const fromPark = new Map<string, { key: string; results: Record<string, NodeResult> }>()
export let parkQueue: Promise<void> = Promise.resolve()
let parkSeq = 0
/** The next parked workflow's sequence number. */
export const nextParkSeq = (): number => ++parkSeq
/** This window's prefix on its park keys: every window shares the app's one park folder. */
export const PARK_SESSION = Math.random().toString(36).slice(2, 10)
export const queuePark = (job: () => Promise<void>): void => {
  parkQueue = parkQueue.then(job).catch(() => undefined)
}
/** Park every workflow that isn't the open one and still holds its results in memory. */
export function parkInactive(get: Getter, set: Setter): void {
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
          key = `wf-${PARK_SESSION}-${++parkSeq}`
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
/** Bring the open workflow's parked results back into memory (and its steps back to done). */
export function unparkActive(
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

    // Anything run in the meantime wins over what was parked — its scales following their steps,
    // as loadSlot's do.
    const results = restampScales(s.nodes, s.edges, { ...loaded, ...s.results })
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
