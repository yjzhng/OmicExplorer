/**
 * Every kind's result body, by kind (nodes/<kind>/View.tsx): what the Results tile draws for it.
 * Each is a render function over the tile's ViewContext (nodes/kit/views/context.tsx), called inside
 * PanelBody — it calls no hooks of its own. A Curve fit shows a Compare's body (one comparison table
 * either way) and the interaction plot the variance plot's (both read an ANOVA's factors). null:
 * nothing of its own (Merge / Subset show their output in the Clean data below; a group tile draws
 * its subcards). A kind added to NodeKind without an entry here fails the type check.
 */
import type { ReactNode } from 'react'

import type { NodeKind } from '../graph/types'
import type { ViewContext } from './kit/views/context'
import { loadView } from './load/View'
import { standardizeView } from './standardize/View'
import { compareView } from './compare/View'
import { contrastView } from './contrast/View'
import { volcanoView } from './volcano/View'
import { heatmapView } from './heatmap/View'
import { scatterView } from './scatter/View'
import { maView } from './ma/View'
import { drView } from './dr/View'
import { potencyView } from './potency/View'
import { metricsView } from './metrics/View'
import { varianceView } from './variance/View'
import { curveMadView } from './curveMad/View'
import { responseView } from './response/View'
import { bubbleView } from './bubble/View'
import { dumbbellView } from './dumbbell/View'
import { tdrView } from './tdr/View'
import { geneBarView } from './geneBar/View'
import { pcaView } from './pca/View'
import { enrichView } from './enrich/View'
import { enrichMapView } from './enrichMap/View'
import { setCompareView } from './setCompare/View'
import { stringView } from './string/View'
import { qcView } from './qc/View'
import { corrView } from './corr/View'
import { tableView } from './table/View'

export type ViewFn = (v: ViewContext) => ReactNode

export const VIEWS: Record<NodeKind, ViewFn | null> = {
  load: loadView,
  standardize: standardizeView,
  merge: null,
  subset: null,
  compare: compareView,
  curveFit: compareView,
  contrast: contrastView,
  volcano: volcanoView,
  heatmap: heatmapView,
  scatter: scatterView,
  ma: maView,
  dr: drView,
  potency: potencyView,
  metrics: metricsView,
  variance: varianceView,
  interaction: varianceView,
  curveMad: curveMadView,
  response: responseView,
  bubble: bubbleView,
  dumbbell: dumbbellView,
  tdr: tdrView,
  geneBar: geneBarView,
  pca: pcaView,
  enrich: enrichView,
  enrichMap: enrichMapView,
  setCompare: setCompareView,
  string: stringView,
  qc: qcView,
  corr: corrView,
  table: tableView,
  plotGroup: null
}
