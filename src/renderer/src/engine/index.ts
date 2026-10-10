/**
 * Public surface of the analysis engine. Pure TypeScript, framework-free — safe
 * to call directly or from a Web Worker (see worker.ts / client.ts).
 */
export { previewScale, standardize, type ScalePreview } from './ingest'
export {
  canonicalAccession,
  groupMembers,
  matchKey,
  pairsOf,
  unionRecords,
  unionValues
} from './accession'
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
export { runDirect, runCompare, runCurveFit, previewCompare, classifyConditions } from './direct'
export {
  applyCurveFdr,
  classifyCompareRow,
  curveBand,
  curveM0,
  curveModel,
  curveCuratorBoundary,
  curveCuratorWall,
  curveGroupKey,
  curveMetrics,
  CURVE_METRICS,
  curveResidualMad,
  type DoseMad,
  logistic,
  relevanceScore,
  type CurveFit
} from './curveFit'
export { samBoundary } from './sam'
export { curvePointsFromStd, replicateLog2FCs, stdByGene, type CurvePoints } from './curvePoints'
export type { ComparePreview } from './direct'
export { runTwoWayAnova, previewTwoWay, crossPairs } from './twoWay'
export type { TwoWayPreview } from './twoWay'
export {
  runContrast,
  runContrastPair,
  previewContrastPair,
  abundanceOnScale,
  CONTRAST_STAT_DEFAULTS,
  AXIS_TAILS,
  statTails
} from './contrast'
export type {
  ContrastSideRow,
  ContrastPairInput,
  ContrastPairPreview,
  ContrastStat,
  AxisTail,
  PairFix,
  PairValueAlignment
} from './contrast'
export {
  BUBBLE_DUMBBELL_CAP,
  enrichTermsOf,
  cogAreasOf,
  goAspectsOf,
  enrichTermGroups,
  enrichmentTable,
  enrichmentAll,
  enrichTermRows,
  ENRICH_DIST_KEPT,
  facetLabel,
  reactomeCategoriesOf,
  enrichSourcesPresent,
  ENRICH_FALLBACK,
  ENRICH_GROUPS,
  ENRICH_SOURCE_LABEL,
  resolveEnrichSource,
  buildVolcano,
  buildHeatmap,
  buildFcHeatmap,
  buildScatter,
  buildIntensityScatter,
  buildMA,
  buildDR,
  comparisonOf,
  fcMeasure,
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
  facetCompareRows,
  facetPaired,
  facetSides,
  ctxValue,
  metaValue,
  facetKeyLabel,
  CLUSTER_COLOR
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
export {
  VALID_CONDITIONS,
  RESERVED_COND_NAMES,
  condLabel,
  condsIn,
  customCond,
  customCondsIn,
  customSlug,
  isCustomCond,
  isNumericCond,
  orderConds,
  validCondName
} from './types'
export type { CustomConditionKey, PresetConditionKey } from './types'
export { condValue, condPresent } from './compare'
export {
  analysisUnmet,
  CURVE_MIN_TREATED,
  dataShape,
  type CompareAnalysis,
  type DataShape
} from './dataShape'
export { detectCustomConditions } from './ingest'

export type { ThresholdConfig, Effect, FdrMethod } from './stats'
export {
  FDR_LABEL,
  fdrMethodOf,
  adjustPValues,
  jacobiEigenSymmetric,
  roundP,
  CC_Q_MIN,
  SAM_PERMUTATIONS,
  SAM_S0,
  snapStatMin
} from './stats'
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
  ContextRow,
  ClusterColorBy
} from './plotData'
export type { Analysis, PlotOption } from './plotChoice'
export { IMPUTE_DEFAULTS, IMPUTE_LABEL } from './impute'
export type { ImputeMethod, ImputeOptions, ImputeSummary } from './impute'
export {
  defaultTransform,
  detectScale,
  histogramShape,
  fromLinear,
  histogram,
  outputScale,
  toLinear,
  presentStd,
  presentScaleOf,
  plotScaleOf,
  abundanceLabel,
  fromLog10,
  type LogTransform,
  type Shape,
  type ScaleEvidence,
  type ValueHistogram,
  type ValueScale
} from './scale'
