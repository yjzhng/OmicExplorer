/**
 * The steps' canvas tile summaries, by kind (nodes/<kind>/Tile.tsx): what a tile on the canvas says
 * about its node — its files, its table's size, its comparisons. A plot's tile shows its spec's
 * `plot.tileHint` instead (null here). Render functions over TileContext, called inside
 * graph/GraphNode.tsx's NodeSummary — they call no hooks of their own.
 */
import type { ReactNode } from 'react'

import type { LoadCheck, NodeData, NodeKind, NodeResult } from '../graph/types'
import { tile as compare } from './compare/Tile'
import { tile as contrast } from './contrast/Tile'
import { tile as load } from './load/Tile'
import { tile as merge } from './merge/Tile'
import { tile as standardize } from './standardize/Tile'
import { tile as subset } from './subset/Tile'

/** What a tile summary reads. */
export interface TileContext {
  kind: NodeKind
  id: string
  result: NodeResult | undefined
  config: NodeData['config']
  /** a Load tile's files against what was converted / read (the store's checkLoad) */
  check: LoadCheck | undefined
  /** a Compare's / Contrast's significant rows (counted once per result) */
  signfCount: number
  /** a Contrast's value rows */
  valueRows: number
}

export const TILES: Record<NodeKind, ((t: TileContext) => ReactNode) | null> = {
  load,
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
