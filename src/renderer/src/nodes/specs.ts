/**
 * Every kind's node contract (nodes/<kind>/spec.ts), by kind — the registry the shared code looks a
 * kind up in (graph/registry.ts re-exports it as NODE_SPECS). The key order is the ops' canonical
 * order (ALL_OPS). A kind added to NodeKind without a spec here fails the type check.
 */
import type { NodeKind } from '../graph/types'
import type { NodeSpec } from './contract'
import { loadSpec } from './load/spec'
import { standardizeSpec } from './standardize/spec'
import { mergeSpec } from './merge/spec'
import { subsetSpec } from './subset/spec'
import { compareSpec } from './compare/spec'
import { curveFitSpec } from './curveFit/spec'
import { contrastSpec } from './contrast/spec'
import { volcanoSpec } from './volcano/spec'
import { heatmapSpec } from './heatmap/spec'
import { scatterSpec } from './scatter/spec'
import { maSpec } from './ma/spec'
import { drSpec } from './dr/spec'
import { potencySpec } from './potency/spec'
import { metricsSpec } from './metrics/spec'
import { varianceSpec } from './variance/spec'
import { interactionSpec } from './interaction/spec'
import { curveMadSpec } from './curveMad/spec'
import { responseSpec } from './response/spec'
import { bubbleSpec } from './bubble/spec'
import { dumbbellSpec } from './dumbbell/spec'
import { tdrSpec } from './tdr/spec'
import { geneBarSpec } from './geneBar/spec'
import { pcaSpec } from './pca/spec'
import { enrichSpec } from './enrich/spec'
import { stringSpec } from './string/spec'
import { qcSpec } from './qc/spec'
import { corrSpec } from './corr/spec'
import { tableSpec } from './table/spec'
import { plotGroupSpec } from './plotGroup/spec'

export const SPECS: { readonly [K in NodeKind]: NodeSpec<K> } = {
  load: loadSpec,
  standardize: standardizeSpec,
  merge: mergeSpec,
  subset: subsetSpec,
  compare: compareSpec,
  curveFit: curveFitSpec,
  contrast: contrastSpec,
  volcano: volcanoSpec,
  heatmap: heatmapSpec,
  scatter: scatterSpec,
  ma: maSpec,
  dr: drSpec,
  potency: potencySpec,
  metrics: metricsSpec,
  variance: varianceSpec,
  interaction: interactionSpec,
  curveMad: curveMadSpec,
  response: responseSpec,
  bubble: bubbleSpec,
  dumbbell: dumbbellSpec,
  tdr: tdrSpec,
  geneBar: geneBarSpec,
  pca: pcaSpec,
  enrich: enrichSpec,
  string: stringSpec,
  qc: qcSpec,
  corr: corrSpec,
  table: tableSpec,
  plotGroup: plotGroupSpec
}
