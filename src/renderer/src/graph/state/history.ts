import type { ThresholdConfig } from '../../engine'
import { hiddenGeneIds } from '../geneMask'
import { type Getter, type GraphState, type Setter, type StoreSet } from '../store'
import { type PlotGroupConfig, type GraphNode, isStep, type NodeResult } from '../types'
import { type PendingLoad, restoreResults, underConfig } from '../undoResults'
import { reclassify, withChildStatuses, type Snapshot, resultHistory } from './shared'

/** undo/redo's re-call of a Compare under the threshold being restored. */
export const reclassifyFor =
  (state: GraphState) =>
  (res: Extract<NodeResult, { kind: 'compare' }>, threshold: ThresholdConfig): NodeResult =>
    reclassify(res, threshold, hiddenGeneIds(state))
/** A group tile's own status rolled up again from its plots' (after a restore set theirs). */
export const rollGroups = (nodes: GraphNode[]): GraphNode[] =>
  nodes.map((n) =>
    isStep(n) && n.data.kind === 'plotGroup'
      ? withChildStatuses(n, (c) => ({ status: c.status ?? 'idle', error: c.error }))
      : n
  )
/** Read back the results an undo/redo restored from disk, installing each only if its tile still
 *  waits for it: same config object, not run meanwhile (anything run since wins), no result yet. */
export function loadFromHistory(get: Getter, set: Setter, pending: PendingLoad[]): void {
  for (const p of pending)
    void resultHistory.load(p.id).then((r) => {
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
/** Undo / redo. */
export function historySlice(
  set: StoreSet,
  get: Getter
): Pick<GraphState, 'commit' | 'undo' | 'redo'> {
  return {
    // ── undo / redo ────────────────────────────────────────────────────────────
    commit: () => {
      const { nodes, edges, nextId, past, frames } = get()
      // A snapshot keeps the current lists by REFERENCE, not a deep copy: every change replaces the
      // objects it touches (never edits them in place), so an untouched node — say an interactive
      // Load holding megabytes of fetched annotations — is shared by every step of the history
      // instead of copied into each. Results are recorded as versions in the history cache, which
      // spills replaced ones to disk rather than holding them all (see historyCache.ts).
      const snap: Snapshot = {
        nodes,
        edges,
        nextId,
        frames,
        versions: resultHistory.ref(get().results)
      }
      set({ past: [...past, snap].slice(-50), future: [], dirty: true })
    },
    undo: () => {
      const { past, future, nodes, edges, nextId, frames, results } = get()
      if (past.length === 0) return
      const prev = past[past.length - 1]
      const cur: Snapshot = { nodes, edges, nextId, frames, versions: resultHistory.ref(results) }
      // Results that still hold stay, a threshold change is re-called, the rest come back from the
      // history cache (or need a re-run when it no longer has them).
      const restored = restoreResults(
        { nodes, edges, results },
        prev,
        reclassifyFor(get()),
        resultHistory
      )
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
      const cur: Snapshot = { nodes, edges, nextId, frames, versions: resultHistory.ref(results) }
      const restored = restoreResults(
        { nodes, edges, results },
        next,
        reclassifyFor(get()),
        resultHistory
      )
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
  }
}
