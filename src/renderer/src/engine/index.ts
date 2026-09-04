/**
 * Public surface of the analysis engine. Pure TypeScript, framework-free — safe
 * to call directly or from a Web Worker (see worker.ts / client.ts).
 */
export { standardize } from './ingest'
export { combineStandardize } from './combine'
export {
  parseMatrix,
  guessRoles,
  guessRolesPreset,
  MATRIX_PRESETS,
  colsWithRole,
  buildStandardInputs,
  columnFacet,
  deriveFieldRule,
  applyFieldRule,
  fieldRuleSpan,
  type InteractiveSampleCond,
  type InteractiveRole,
  type FilterSpec,
  type ColumnFacet,
  type MatrixInfo,
  type MatrixPreset,
  type FieldRule
} from './interactive'
export { runVehNorm } from './compare'
export { runDirect, runCompare, previewCompare } from './direct'
export type { ComparePreview } from './direct'
export { runTwoWayAnova, previewTwoWay, crossPairs } from './twoWay'
export type { TwoWayPreview } from './twoWay'
export { runContrast, runContrastPair } from './contrast'
export type { ContrastSideRow, ContrastPairInput } from './contrast'
export {
  buildVolcano,
  buildHeatmap,
  buildFcHeatmap,
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
  buildQc,
  buildSampleCorr,
  buildEnrichment,
  facetContextDims,
  responseColorDims,
  facetDims,
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
  CondSelector,
  CompareInput,
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
  FcHeatmapData,
  FcHeatmapOptions,
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
  ClusterMeta,
  ClusterOptions,
  QcData,
  QcGroup,
  QcMetric,
  EnrichData,
  EnrichTerm,
  EnrichOptions,
  EnrichSource,
  EnrichMethod,
  CorrData,
  FacetGroup,
  FacetKey,
  ContextRow
} from './plotData'
export type { Analysis, PlotOption } from './plotChoice'
