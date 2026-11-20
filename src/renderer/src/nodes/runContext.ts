/**
 * What a step's run (nodes/<kind>/run.ts) is handed by the store's runNode: the node, the graph as
 * it was when the run started, the store's get / set, and the status and progress reporters. A run
 * reads its inputs' results, computes (mostly in the engine worker), stores its result and marks
 * itself done — or sets an error status with the reason. Anything it throws becomes the node's error
 * (logged with its context — shared/diagnostics.ts).
 */
import type { StoreApi } from 'zustand'

import type { Progress } from '../engine'
import type { GraphState } from '../graph/store'
import type {
  DataResult,
  NodeConfig,
  NodeData,
  NodeKind,
  NodeResult,
  StepNode
} from '../graph/types'
import type { UpstreamFacts } from './contract'

export interface StepRunContext {
  id: string
  kind: NodeKind
  node: StepNode
  /** the graph when the run started (read the live one with `get()`) */
  state: GraphState
  get: () => GraphState
  set: StoreApi<GraphState>['setState']
  /** set this node's status (and its error or note) */
  setStatus: (status: NodeData['status'], error?: string, note?: string) => void
  /** the engine's progress for this run */
  onProgress: (p: Progress) => void
  /** its (first) input's id */
  upId: string | undefined
}

export type StepRun = (ctx: StepRunContext) => Promise<void>

/** What a plot's own run (nodes/<kind>/run.ts — the plots that compute something: the cluster's
 *  embedding, enrichment, STRING) is handed by graph/plotRun.ts. It returns the plot's run result,
 *  or throws with the reason it can't be viewed. */
export interface PlotRunContext {
  kind: NodeKind
  config: NodeConfig
  /** the upstream's data result (it has run) */
  upstream: DataResult
  /** polled between the long steps: the run was stopped */
  cancelled: () => boolean
  /** the upstream's facts (for its requirement) */
  facts: () => UpstreamFacts
}
export interface PlotRun {
  run: (ctx: PlotRunContext) => Promise<NodeResult>
  /** run only once the plot's requirement holds (graph/plotRun.ts checks it first) */
  afterRequirement?: boolean
}
