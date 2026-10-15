/** Which results an undo/redo leaves in place. A history step restores the graph to a snapshot,
 *  and each tile's result is worked out against the CURRENT state:
 *  - a tile whose settings and every input upstream are the same in both states keeps its current
 *    result and run state;
 *  - a Compare / Curve fit whose only difference is its threshold is re-called under the restored
 *    one (its statistics don't depend on it). What's downstream does NOT count as unchanged — a
 *    Contrast masks by the calls, as a threshold drag's invalidation says — so it takes the
 *    snapshot's result like any other changed tile;
 *  - otherwise the result the snapshot recorded comes back from the history cache (historyCache.ts)
 *    — at once when it's in memory, else read back from disk (`pending`) while the tile waits;
 *  - and failing that (never run then, or dropped past the cache's disk cap) it needs a re-run.
 *  "The same settings" follows a plot's `staleOn`: a view setting the run didn't use doesn't count
 *  as a change. A plot inside a group tile is decided on its own, as it runs on its own. */
import type { Edge } from '@xyflow/react'

import type { ThresholdConfig } from '../engine'
import { NODE_SPECS } from './registry'
import type {
  CompareConfig,
  GraphNode,
  NodeConfig,
  NodeResult,
  PlotChild,
  PlotGroupConfig,
  StepNode
} from './types'
import { isComparisonKind, isStep, plotResultKey } from './types'

export interface GraphState {
  nodes: GraphNode[]
  edges: Edge[]
  results: Record<string, NodeResult>
}

/** A snapshot being restored: its graph and the result version each key had. */
export interface TargetState {
  nodes: GraphNode[]
  edges: Edge[]
  versions?: Record<string, number>
}

type CompareResult = Extract<NodeResult, { kind: 'compare' }>
export type Reclassify = (res: CompareResult, threshold: ThresholdConfig) => NodeResult

/** What the restore reads from the history cache. */
export interface HistoryLookup {
  peek: (id: number) => NodeResult | undefined
  has: (id: number) => boolean
}

/** A result to read back from disk: installed only if, by then, the tile still waits for it. */
export interface PendingLoad {
  key: string
  id: number
  nodeId: string
  childId?: string
  /** the config it was computed under — the tile must still hold this very object */
  config: NodeConfig
}

const sameJson = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b)

const inputsOf = (edges: Edge[], id: string): string =>
  edges
    .filter((e) => e.target === id)
    .map((e) => e.source)
    .sort()
    .join('\u0000')

/** Whether a result computed under `cur` still holds under `next`. */
function compatible(
  kind: StepNode['data']['kind'],
  next: NodeConfig,
  cur: NodeConfig,
  result: NodeResult | undefined
): boolean {
  if (sameJson(next, cur)) return true
  const staleOn = NODE_SPECS[kind]?.staleOn
  return !!staleOn && !staleOn(next, cur, result)
}

/** Whether two comparison configs differ in their threshold alone. */
function thresholdOnly(next: NodeConfig, cur: NodeConfig): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { threshold: _a, ...a } = next as CompareConfig
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { threshold: _b, ...b } = cur as CompareConfig
  return sameJson(a, b)
}

/** A result as a tile under `config` shows it: a Compare's re-called under that config's threshold
 *  (a version from the cache may be any member of its family, called under another one). */
export function underConfig(
  r: NodeResult,
  kind: StepNode['data']['kind'],
  config: NodeConfig,
  reclassify: Reclassify
): NodeResult {
  return r.kind === 'compare' && isComparisonKind(kind)
    ? reclassify(r, (config as CompareConfig).threshold)
    : r
}

/** The target's nodes (run state patched to match), the results to install with them, and the
 *  results still to read back from disk. */
export function restoreResults(
  current: GraphState,
  target: TargetState,
  reclassify: Reclassify,
  history?: HistoryLookup
): { nodes: GraphNode[]; results: Record<string, NodeResult>; pending: PendingLoad[] } {
  const curById = new Map(current.nodes.filter(isStep).map((n) => [n.id, n]))
  const tgtById = new Map(target.nodes.filter(isStep).map((n) => [n.id, n]))
  const versions = target.versions ?? {}

  // Whether each tile's CURRENT result carries over: kept as is, re-called, or not at all.
  type Fate = 'keep' | 'recall' | 'other'
  const memo = new Map<string, Fate>()
  const fate = (id: string): Fate => {
    const hit = memo.get(id)
    if (hit) return hit
    memo.set(id, 'other') // a cycle never keeps
    const c = curById.get(id)
    const t = tgtById.get(id)
    let f: Fate = 'other'
    if (
      c &&
      t &&
      c.data.kind === t.data.kind &&
      inputsOf(current.edges, id) === inputsOf(target.edges, id) &&
      current.edges.filter((e) => e.target === id).every((e) => fate(e.source) === 'keep')
    ) {
      const kind = t.data.kind
      const res = current.results[id]
      // A group tile's own chain is its upstream; each plot in it is decided below.
      if (kind === 'plotGroup' || compatible(kind, t.data.config, c.data.config, res)) f = 'keep'
      else if (
        isComparisonKind(kind) &&
        res?.kind === 'compare' &&
        thresholdOnly(t.data.config, c.data.config)
      )
        f = 'recall'
    }
    memo.set(id, f)
    return f
  }

  const results: Record<string, NodeResult> = {}
  const pending: PendingLoad[] = []
  const put = (key: string, r: NodeResult | undefined): void => {
    if (r) results[key] = r
  }
  /** The snapshot's own result for `key`, if it had one and the cache still holds it: installed
   *  now ('done'), queued for a read ('pending'), or not there ('none'). */
  const fromHistory = (
    key: string,
    status: string | undefined,
    kind: StepNode['data']['kind'],
    config: NodeConfig,
    load: Omit<PendingLoad, 'key' | 'id' | 'config'>
  ): 'done' | 'pending' | 'none' => {
    const id = versions[key]
    if (status !== 'done') return 'none'
    // Done with nothing stored (a plot drawn live from its input): as done as it was then.
    if (id == null) return 'done'
    if (!history?.has(id)) return 'none'
    const r = history.peek(id)
    if (r) {
      put(key, underConfig(r, kind, config, reclassify))
      return 'done'
    }
    pending.push({ key, id, config, ...load })
    return 'pending'
  }
  const runnable = (n: StepNode): boolean => !!NODE_SPECS[n.data.kind]?.hasRun

  const nodes = target.nodes.map((n): GraphNode => {
    if (!isStep(n)) return n
    const cur = curById.get(n.id)
    const f = fate(n.id)
    if (n.data.kind === 'plotGroup') {
      const curChildren = cur ? (cur.data.config as PlotGroupConfig).children : []
      const children = (n.data.config as PlotGroupConfig).children.map((ch): PlotChild => {
        const key = plotResultKey(n.id, ch.id)
        const cc = curChildren.find((x) => x.id === ch.id)
        const h = (): ReturnType<typeof fromHistory> =>
          fromHistory(key, ch.status, ch.kind, ch.config, { nodeId: n.id, childId: ch.id })
        if (
          f === 'keep' &&
          cc &&
          cc.kind === ch.kind &&
          compatible(ch.kind, ch.config, cc.config, current.results[key])
        ) {
          // Unchanged — but if it has gone stale since, the snapshot's result is the one that holds.
          if (current.results[key] || cc.status !== 'idle') {
            put(key, current.results[key])
            return { ...ch, status: cc.status, error: cc.error }
          }
          return h() === 'done' ? ch : { ...ch, status: 'idle', error: undefined }
        }
        const fromSnap = h()
        return fromSnap === 'done' ? ch : { ...ch, status: 'idle', error: undefined }
      })
      return {
        ...n,
        data: { ...n.data, config: { ...(n.data.config as PlotGroupConfig), children } }
      } as GraphNode
    }
    // Unchanged but stale since (e.g. a Contrast a threshold drag invalidated): the snapshot's
    // result holds for it, so that comes back rather than the current nothing.
    const staleSince = cur && f === 'keep' && !current.results[n.id] && cur.data.status === 'idle'
    if (cur && f !== 'other' && !staleSince) {
      const res = current.results[n.id]
      put(
        n.id,
        f === 'recall'
          ? reclassify(res as CompareResult, (n.data.config as CompareConfig).threshold)
          : res
      )
      return {
        ...n,
        data: { ...n.data, status: cur.data.status, error: cur.data.error, note: cur.data.note }
      } as GraphNode
    }
    const h = fromHistory(n.id, n.data.status, n.data.kind, n.data.config, { nodeId: n.id })
    if (h === 'done') return n
    // Waiting on a read, or needs a re-run — a tile with no run of its own (Load) keeps its state.
    return runnable(n)
      ? ({ ...n, data: { ...n.data, status: 'idle', error: undefined } } as GraphNode)
      : n
  })
  return { nodes, results, pending }
}
