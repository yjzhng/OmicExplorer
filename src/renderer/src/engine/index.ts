/**
 * Public surface of the analysis engine. Pure TypeScript, framework-free — safe
 * to call directly or from a Web Worker (see worker.ts / client.ts).
 */
export { standardize } from './ingest'
export { runVehNorm } from './compare'
export { runDirect } from './direct'
export { runTwoWayAnova } from './twoWay'
export { runContrast } from './contrast'
export {
  buildVolcano,
  buildHeatmap,
  buildScatter,
  buildIntensityScatter,
  buildMA,
  buildDR,
  buildBubble,
  buildDumbbell,
  buildTdr,
  buildGeneBar,
  buildCluster,
  buildResponseCluster,
  facetContextDims,
  facetCompareRows
} from './plotData'
export type { ClusterMethod } from './embed'
export { recommendedPlots } from './plotChoice'
export {
  DEFAULT_THRESHOLD,
  thresholdLabel,
  welchTTest,
  benjaminiHochberg,
  applyThreshold
} from './stats'
export { VALID_CONDITIONS } from './types'

export type { ThresholdConfig, Effect } from './stats'
export type {
  ConditionKey,
  StandardRow,
  StandardizeInput,
  StandardizeResult,
  Pair,
  VehNormInput,
  VehNormResult,
  CompareResultRow
} from './types'
export type { DirectInput, CompareTableResult } from './direct'
export type { TwoWayInput, TwoWayFactor } from './twoWay'
export type { ContrastInput, ContrastResult, ContrastResultRow } from './contrast'
export type {
  VolcanoData,
  VolcanoPoint,
  VolcanoOptions,
  HeatmapData,
  HeatmapOptions,
  ScatterData,
  ScatterPoint,
  ScatterOptions,
  ScatterGuide,
  MAData,
  MAPoint,
  MAOptions,
  DRData,
  DRSeries,
  DROptions,
  BubbleData,
  BubblePoint,
  BubbleOptions,
  DumbbellData,
  DumbbellRow,
  DumbbellOptions,
  TdrData,
  TdrSeries,
  GeneBarData,
  GeneBarValue,
  ClusterData,
  ClusterPoint,
  ClusterOptions,
  FacetGroup,
  ContextRow
} from './plotData'
export type { Analysis, PlotOption } from './plotChoice'
