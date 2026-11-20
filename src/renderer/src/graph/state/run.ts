import type { Progress } from '../../engine'
import { engine } from '../../engine/client'
import { STEP_RUNS } from '../../nodes/runs'
import { reportError } from '../../shared/diagnostics'
import { runPlot } from '../plotRun'
import { axisAvailFor, categoryOf, runsIn } from '../registry'
import { downstreamOf, runOrder } from '../runOrder'
import { type Getter, type GraphState, type StoreSet } from '../store'
import {
  isStep,
  plotResultKey,
  type GraphNode,
  type NodeData,
  type NodeResult,
  type PlotChild,
  type PlotGroupConfig,
  type StepStatus
} from '../types'
import { withChildStatuses } from './shared'

/** The runs waiting on a running input (by node id, or a group's subcard key — see waitForInputs):
 *  stopping one only stands it down, it doesn't cancel the engine (that's the input's run). */
export const waitingRuns = new Set<string>()
/** Hold a run until none of its inputs is running — a downstream tile run while its input still
 *  runs joins the queue rather than failing at once on the input it doesn't have yet. Meanwhile
 *  the run shows as running. False when it was stopped
 *  while waiting (its status set back from running); true to go ahead — the run's own checks then
 *  see the input's outcome (done, failed or stopped). */
export async function waitForInputs(
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
export const plotRunSeq = new Map<string, number>()
/** The steps whose downstream is being refreshed (refreshDownstream), each flagged when another
 *  refresh was asked for meanwhile. */
export const refreshing = new Map<string, { again: boolean }>()
export const nextPlotRun = (key: string): number => {
  const n = (plotRunSeq.get(key) ?? 0) + 1
  plotRunSeq.set(key, n)
  return n
}
/** Clear the run results of the plots in these nodes — a standalone plot's own, and each plot of a
 *  group tile (kept under plotResultKey) — and set them idle. For an upstream re-run / re-wire. */
export function clearPlotResults(
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
    // (a plot queued on its input keeps running: it goes on once the input is done)
    nodes: nodes.map((n) =>
      ids.has(n.id) && isStep(n) && n.data.kind === 'plotGroup'
        ? withChildStatuses(n, (c) =>
            waitingRuns.has(plotResultKey(n.id, c.id))
              ? { status: c.status ?? 'running', error: c.error }
              : { status: 'idle' }
          )
        : n
    )
  }
}
/** Running: a node's run (its kind's — nodes/runs.ts), a plot's, waiting on inputs, cancelling, Run all, and what goes stale downstream. */
export function runSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'runNode'
  | 'cancelNode'
  | 'runPlotChild'
  | 'rerunFrom'
  | 'refreshDownstream'
  | 'runAll'
  | 'stopAll'
  | 'invalidateDownstream'
  | 'markStale'
  | 'upstreamId'
  | 'upstreamIds'
  | 'nodeKind'
> {
  return {
    runNode: async (id) => {
      // An input still running: wait for it (a group's plots each wait in runPlotChild).
      const waiting = get().nodes.find((n) => n.id === id)
      if (waiting && isStep(waiting) && waiting.data.kind !== 'plotGroup') {
        const markWaiting = (): void =>
          set((s) => ({
            nodes: s.nodes.map((n) =>
              n.id === id && isStep(n)
                ? {
                    ...n,
                    data: { ...n.data, status: 'running', error: undefined, note: undefined }
                  }
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
        set((s) => {
          // a run ended (or restarted): its progress goes
          const { [id]: _gone, ...progress } = s.progress
          void _gone
          return {
            nodes: s.nodes.map((n) =>
              n.id === id && isStep(n) ? { ...n, data: { ...n.data, status, error, note } } : n
            ),
            ...(id in s.progress ? { progress } : null),
            ...(status === 'done' ? { dirty: true } : {})
          }
        })
      // the engine's progress for this run, while it's still the one running
      const onProgress = (p: Progress): void =>
        set((s) =>
          s.nodes.find((n) => n.id === id)?.data.status === 'running'
            ? { progress: { ...s.progress, [id]: p } }
            : {}
        )

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
            axisAvailFor(get(), upId)
          )
          if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
          if (plotRunSeq.get(id) !== seq) return // superseded by a newer run of this plot
          set((s) => ({ results: { ...s.results, [id]: r } }))
          setStatus('done')
        } catch (err) {
          if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return
          if (plotRunSeq.get(id) !== seq) return
          setStatus('error', reportError(err, { where: 'plot-run', nodeId: id, kind }))
        }
        return
      }

      try {
        // The kind's own run (nodes/<kind>/run.ts, by kind in nodes/runs.ts).
        await STEP_RUNS[kind]?.({ id, kind, node, state, get, set, setStatus, onProgress, upId })
      } catch (err) {
        // A cancel terminates the worker (rejecting here) but already reset status to idle.
        if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return
        setStatus('error', reportError(err, { where: 'run', nodeId: id, kind }))
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
          axisAvailFor(get(), upId)
        )
        if (childOf()?.status !== 'running') return // cancelled
        if (plotRunSeq.get(key) !== seq) return // superseded by a newer run of this plot
        set((s) => ({ results: { ...s.results, [key]: r } }))
        setChild('done')
      } catch (err) {
        if (childOf()?.status !== 'running') return
        if (plotRunSeq.get(key) !== seq) return
        setChild(
          'error',
          reportError(err, { where: 'plot-run', nodeId: `${groupId}/${childId}`, kind: child.kind })
        )
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
          if (!kind || !runsIn(get(), n.id)) continue
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
        if (!kind || !runsIn(get(), id)) continue
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
      // A run queued on its input (waitForInputs) stays running: the input finishing is what it
      // waits for — set back to idle, it read that as being stopped and never ran.
      const idled = nodes.map((n) =>
        downstream.has(n.id) && isStep(n) && !waitingRuns.has(n.id)
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
    }
  }
}
