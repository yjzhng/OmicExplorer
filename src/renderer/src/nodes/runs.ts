/**
 * Every step's run, by kind (nodes/<kind>/run.ts) — what the store's runNode calls once the run's
 * inputs are ready. A Curve fit runs a Compare's run (the same num / den model, fitting curves); a
 * kind with no run of its own is null (Load data is ready once configured; plots run through
 * graph/plotRun.ts — PLOT_RUNS below). A kind added to NodeKind without an entry here fails the type check.
 */
import type { NodeKind } from '../graph/types'
import { run as compare } from './compare/run'
import { run as contrast } from './contrast/run'
import { run as merge } from './merge/run'
import type { PlotRun, StepRun } from './runContext'
import { run as pcaRun } from './pca/run'
import { run as enrichRun } from './enrich/run'
import { run as stringRun } from './string/run'
import { run as standardize } from './standardize/run'
import { run as subset } from './subset/run'

export const STEP_RUNS: Record<NodeKind, StepRun | null> = {
  load: null,
  standardize,
  merge,
  subset,
  compare,
  curveFit: compare,
  contrast,
  volcano: null,
  heatmap: null,
  scatter: null,
  ma: null,
  dr: null,
  potency: null,
  metrics: null,
  variance: null,
  interaction: null,
  curveMad: null,
  response: null,
  bubble: null,
  dumbbell: null,
  tdr: null,
  geneBar: null,
  pca: null,
  enrich: null,
  string: null,
  qc: null,
  corr: null,
  table: null,
  plotGroup: null
}

/** The plots that compute something of their own, by kind (their spec says `plot.computes`); every
 *  other plot draws live from its upstream, its run only checking it can. */
export const PLOT_RUNS: Partial<Record<NodeKind, PlotRun>> = {
  pca: { run: pcaRun },
  enrich: { run: enrichRun },
  string: { run: stringRun, afterRequirement: true }
}
