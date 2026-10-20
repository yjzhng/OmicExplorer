/**
 * Public surface of the analysis engine. Pure TypeScript, framework-free — safe
 * to call directly or from a Web Worker (see worker.ts / client.ts).
 */
export {
  manualSheetConditions,
  manualSheetIssues,
  previewScale,
  samplesheetIssues,
  sheetIssueLines,
  sheetSamples,
  sheetIssueText,
  standardize,
  recleanStandardized,
  type RecleanInput,
  type ScalePreview,
  type SheetIssue
} from './ingest'
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
  conditionLevels,
  filterActive,
  keptBy,
  sampleLevels,
  samplePasses,
  subsetStandardize,
  type SampleFilter
} from './subset'
export { jointAt, jointPredict } from './surfaceJoint'
export { descValue } from './splineFit'
export type { Progress } from './progress'
export {
  axisModelFor,
  detectAxisScale,
  driftsByDefault,
  presetModel,
  xUnits,
  type AxisBaseline,
  type AxisFit,
  type AxisScale,
  type AxisShape,
  type ScaleGuess,
  type StoredScale
} from './axisModel'
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
export {
  runDirect,
  runCompare,
  runCurveFit,
  previewCompare,
  compareSlices,
  baselineText,
  classifyConditions,
  controlIsBaseline,
  curveControlIsBaseline
} from './direct'
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
  curveHasLof,
  curveLackOfFit,
  ccTestOf,
  CURVE_METRICS,
  curveResidualMad,
  curveResidualPoints,
  curvesReplicated,
  type ResidualPoint,
  type DoseMad,
  logistic,
  curveSampleX,
  curveDescribed,
  relevanceScore,
  PEC50_DELTA,
  Y_LIMITS_LOG2,
  type CurveFit
} from './curveFit'
export { samBoundary } from './sam'
export { curvePointsFromStd, replicateLog2FCs, stdByGene, type CurvePoints } from './curvePoints'
export type { ComparePreview } from './direct'
export { runFactorAnova, previewFactorAnova, crossPairs } from './twoWay'
export type { FactorAnovaPreview } from './twoWay'
export {
  runContrast,
  runContrastPair,
  previewContrastPair,
  abundanceOnScale,
  CONTRAST_STAT_DEFAULTS,
  AXIS_TAILS,
  statTails,
  reclassifyContrast,
  contrastStatDrag,
  contrastFeatureLabel,
  CURVE_FC_FEATURE,
  rowsOfFeature,
  rowsOfFeatureNamed
} from './contrast'
export type {
  ContrastSideRow,
  ContrastPairInput,
  ContrastPairPreview,
  ContrastStat,
  AxisTail,
  PairFix,
  PairValueAlignment,
  ContrastFeatureId
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
  buildHeatmapSteps,
  buildFcHeatmap,
  buildScatter,
  bandEdgePath,
  bandConfAt,
  marginalQAt,
  buildIntensityScatter,
  buildMA,
  buildDR,
  responseCurve,
  comparisonOf,
  fcName,
  fcMeasure,
  buildBubble,
  buildDumbbell,
  thinPoints,
  RESIDUAL_DOT_CAP,
  DUMBBELL_ORDERS,
  dumbbellOrderLabel,
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
  ctxNum,
  metaValue,
  facetKeyLabel,
  rowsOfKind,
  SHOW_KINDS,
  sortSamples,
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
  numericConds,
  numericOf,
  orderConds,
  validCondName,
  isTermRow,
  isInteractionRow,
  isSlopeRow,
  termless
} from './types'
export type { CustomConditionKey, NumericConds, PresetConditionKey } from './types'
export { condValue, condPresent, numValue } from './compare'
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
  snapStatMin,
  normalPpf
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
export type { FactorAnovaInput, AnovaFactorPick } from './twoWay'
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
  DumbbellOrder,
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
  SampleOrder,
  SampleOrdering,
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
export { MIN_SHARED_GENES, NORMALIZE_REFERENCE_LABEL } from './normalize'
export type { NormalizeOptions, NormalizeReference, NormalizeSummary } from './normalize'
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
export { clusterRowGroups } from './cluster'
export type { DendroLink, Linkage, LeafOrder } from './cluster'
export {
  DESCRIBE_Q,
  RESPONSE_METRICS,
  RESPONSE_THRESHOLD,
  responseMetrics,
  runResponseSurface
} from './responseSurface'
export type { ResponseInput } from './responseSurface'
export { anovaSliceFor, geneShares, interactionAxes, interactionGene, rankByQ } from './anovaPlots'
export type { AnovaSliceResult, GeneShares, InteractionGene } from './anovaPlots'
export type { AnovaResult } from './anova'
