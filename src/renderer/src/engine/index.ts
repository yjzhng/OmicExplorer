/**
 * Public surface of the analysis engine. Pure TypeScript, framework-free — safe
 * to call directly or from a Web Worker (see worker.ts / client.ts).
 */
export {
  manualSheetConditions,
  manualSheetIssues,
  previewOfResult,
  previewScale,
  previewProteins,
  samplesheetIssues,
  sheetIssueLines,
  sheetSamples,
  sheetIssueText,
  standardize,
  recleanStandardized,
  type RecleanInput,
  type ScalePreview,
  type SheetIssue
} from './data/ingest'
export {
  canonicalAccession,
  groupMembers,
  matchKey,
  pairsOf,
  unionRecords,
  unionValues
} from './data/accession'
export { combineStandardize } from './data/combine'
export {
  BATCH_COND,
  batchesOf,
  blockedTTest,
  correctBatches,
  withBatchCond,
  type BatchSpec,
  type BatchSummary
} from './data/batch'
export { sampleLabel, sampleName } from './data/sampleLabel'
export {
  contextIndices,
  contextOf,
  contextRowAt,
  contrastYRangeOf,
  distinctOf,
  facetGroupsOf,
  hasTermRows,
  holderWhere,
  holderWhereNested,
  idsWhere,
  rowsOfContexts,
  rowsWhere,
  type ContextIndex,
  type FacetIndexGroup
} from './columns/contextIndex'
export { descPeakOf, hasResponseFits, withModelView, type ModelView } from './curves/modelView'
export {
  fittedSurfaceModel,
  linearJoin,
  pchipJoin,
  placed,
  shiftReference,
  surfaceAxes,
  surfaceModel,
  type SurfaceAxes,
  type SurfaceKind,
  type SurfaceModel
} from './curves/surfaceModel'
export { rowsAt } from './columns/lazyRows'
export {
  arrayView,
  nestedCol,
  nestedPresent,
  rowView,
  scanRows,
  someNested,
  valuesOf,
  type RowView
} from './columns/rowView'
export { distShape, VIOLIN_CAP, type DistShape } from './plot/distShape'
export {
  sampleIndex,
  isSampleIndex,
  stdLookupOf,
  type SampleIndex,
  type StdLookup
} from './data/sampleIndex'
export {
  conditionLevels,
  filterActive,
  keptBy,
  sampleLevels,
  samplePasses,
  subsetStandardize,
  type SampleFilter
} from './data/subset'
export { jointAt, jointPredict } from './curves/surfaceJoint'
export { descValue } from './curves/splineDescribe'
export type { Progress } from './runtime/progress'
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
} from './curves/axisModel'
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
  filterOn,
  filterStep,
  stepBy,
  matchSheetRows,
  type InteractiveSampleCond,
  type InteractiveRole,
  type FilterSpec,
  type ColumnFacet,
  type MatrixInfo,
  type MatrixPreset,
  type FieldRule
} from './data/interactive'
export { runVehNorm } from './compare/compare'
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
} from './compare/direct'
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
  curveIsFlat,
  flatPEC50,
  type FlatPotency,
  relevanceScore,
  PEC50_DELTA,
  Y_LIMITS_LOG2,
  type CurveFit
} from './curves/curveFit'
export { samBoundary } from './compare/sam'
export {
  curvePointsFromStd,
  replicateLog2FCs,
  stdByGene,
  type CurvePoints
} from './curves/curvePoints'
export type { ComparePreview } from './compare/direct'
export { runFactorAnova, previewFactorAnova, crossPairs, slopePositions } from './compare/twoWay'
export type { FactorAnovaPreview } from './compare/twoWay'
export {
  runContrast,
  runContrastPair,
  previewContrastPair,
  quantityOnScale,
  contrastYRange,
  rowOnScale,
  CONTRAST_STAT_DEFAULTS,
  AXIS_TAILS,
  statTails,
  valueCutoffs,
  upperOnly,
  reclassifyContrast,
  contrastStatDrag,
  contrastFeatureLabel,
  CURVE_FC_FEATURE,
  rowsOfFeature,
  rowsOfFeatureNamed
} from './compare/contrast'
export type {
  ContrastSideRow,
  ContrastPairInput,
  ContrastPairPreview,
  ContrastStat,
  AxisTail,
  ValueCutoffs,
  PairFix,
  PairValueAlignment,
  ContrastFeatureId
} from './compare/contrast'
export { BUBBLE_DUMBBELL_CAP, buildDR, drBase, drPick, responseCurve, buildTdr } from './plot/dr'
export {
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
  resolveEnrichSource
} from './enrich/terms'
export { buildVolcano, comparisonOf, fcName, fcMeasure } from './plot/volcano'
export { buildHeatmap, buildHeatmapSteps, sortSamples } from './plot/heatmap'
export { buildFcHeatmap, buildFcHeatmapSteps } from './plot/fcHeatmap'
export {
  buildScatter,
  bandEdgePath,
  bandConfAt,
  cutoffOnScale,
  cutoffFromScale,
  buildIntensityScatter
} from './plot/scatter'
export { buildMA } from './plot/ma'
export { buildBubble, bubbleBase, bubbleWith } from './plot/bubble'
export {
  buildDumbbell,
  dumbbellBase,
  dumbbellWith,
  DUMBBELL_ORDERS,
  dumbbellOrderLabel
} from './plot/dumbbell'
export {
  thinPoints,
  RESIDUAL_DOT_CAP,
  buildQc,
  sampleQc,
  buildStdMatrix,
  type StdMatrixSample,
  type SampleQc
} from './plot/qc'
export { buildGeneBar } from './plot/geneBar'
export {
  buildCluster,
  buildResponseCluster,
  metaValue,
  CLUSTER_COLOR,
  GROUP_COLOR,
  colorByCond
} from './plot/cluster'
export {
  buildSampleCorr,
  buildSampleCorrAll,
  arrangeSampleCorr,
  CORR_METRICS,
  corrMetricOf,
  CORR_METRIC_LABEL
} from './plot/corr'
export { buildEnrichment } from './enrich/ora'
export {
  facetContextDims,
  responseColorDims,
  facetDims,
  facetCompareRows,
  facetPaired,
  facetSides,
  ctxValue,
  ctxNum,
  facetKeyLabel,
  rowsOfKind,
  showKindOf,
  SHOW_KINDS
} from './plot/facet'
export type { ClusterMethod } from './stats/embed'
export { recommendedPlots } from './plot/plotChoice'
export {
  DEFAULT_THRESHOLD,
  thresholdLabel,
  welchTTest,
  benjaminiHochberg,
  applyThreshold
} from './stats/stats'
export {
  VALID_CONDITIONS,
  RESERVED_COND_NAMES,
  condLabel,
  condsIn,
  ctxLabel,
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
export {
  CLEANUP_MODES,
  cleanupModeOf,
  cleanupRuleOf,
  type CleanupMode,
  type CleanupRule,
  type CleanupThreshold
} from './data/cleanup'
export type { CustomConditionKey, NumericConds, PresetConditionKey } from './types'
export { condValue, condPresent, numValue } from './compare/compare'
export {
  analysisUnmet,
  CURVE_MIN_TREATED,
  dataShape,
  type CompareAnalysis,
  type DataShape
} from './data/dataShape'
export { detectCustomConditions } from './data/ingest'
export type { ProteinList } from './data/ingest'

export type { ThresholdConfig, Effect, FdrMethod } from './stats/stats'
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
} from './stats/stats'
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
export type { DirectInput, CompareTableResult } from './compare/direct'
export type { FactorAnovaInput, AnovaFactorPick } from './compare/twoWay'
export type { ContrastInput, ContrastResult, ContrastResultRow } from './compare/contrast'
export type { VolcanoData, VolcanoPoint, VolcanoOptions } from './plot/volcano'
export type { HeatmapData, HeatmapOptions, SampleOrder, SampleOrdering } from './plot/heatmap'
export type { FcHeatmapData, FcHeatmapOptions } from './plot/fcHeatmap'
export type { ScatterData, ScatterPoint, ScatterOptions, ScatterGuide } from './plot/scatter'
export type { MAData, MAPoint, MAOptions } from './plot/ma'
export type { DRData, DRSeries, DROptions, TdrData, TdrSeries } from './plot/dr'
export type { BubbleData, BubblePoint, BubbleOptions } from './plot/bubble'
export type { DumbbellData, DumbbellRow, DumbbellOptions, DumbbellOrder } from './plot/dumbbell'
export type { GeneBarData, GeneBarValue } from './plot/geneBar'
export type {
  ClusterData,
  ClusterPoint,
  ClusterMeta,
  ClusterOptions,
  ClusterColorBy
} from './plot/cluster'
export type { QcData, QcGroup, QcMetric } from './plot/qc'
export type { EnrichData, EnrichTerm, EnrichOptions } from './enrich/ora'
export type { EnrichSource, EnrichMethod } from './enrich/terms'
export type { CorrData, SampleCorrAll, CorrMetric } from './plot/corr'
export type { FacetGroup, FacetKey, ContextRow } from './plot/facet'
export type { Analysis, PlotOption } from './plot/plotChoice'
export { IMPUTE_DEFAULTS, IMPUTE_LABEL } from './data/impute'
export { MIN_SHARED_GENES, NORMALIZE_REFERENCE_LABEL } from './data/normalize'
export { proteinDescOf, proteinDescs } from './data/proteinDesc'
export type {
  NormalizeOptions,
  NormalizeReference,
  NormalizeSummary,
  RefCombine,
  RefMissing
} from './data/normalize'
export type { ImputeMethod, ImputeOptions, ImputeSummary } from './data/impute'
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
  analysisScaleOf,
  withLogTransform,
  withLogDisplay,
  plainLogOf,
  tableScaleOf,
  type LogDisplay,
  withScale,
  quantityLabel,
  scaleName,
  fromLog10,
  type LogTransform,
  type Shape,
  type ScaleEvidence,
  type ValueHistogram,
  type ValueScale,
  type ValueUnit,
  valueUnitOf
} from './data/scale'
export { clusterRowGroups, clusterRowTree } from './stats/cluster'
export type { DendroLink, Linkage, LeafOrder } from './stats/cluster'
export {
  DESCRIBE_Q,
  RESPONSE_METRICS,
  RESPONSE_THRESHOLD,
  responseMetrics,
  runResponseSurface
} from './curves/responseSurface'
export type { ResponseInput } from './curves/responseSurface'
export {
  anovaSliceFor,
  geneShares,
  interactionAxes,
  interactionGene,
  rankByQ
} from './plot/anovaPlots'
export type { AnovaSliceResult, GeneShares, InteractionGene } from './plot/anovaPlots'
export type { AnovaFactor, AnovaResult } from './compare/anova'
export { pickTop } from './stats/topPick'
export type { TopSplit, TopSplitSpec } from './stats/topPick'
export { MODULE_OVERLAP, moduleParts, termModules } from './enrich/enrichModules'
export { termLevelsOf, type TermLevels } from './enrich/enrichLevels'
export type { ModuleTerm, TermModules } from './enrich/enrichModules'
export {
  callSets,
  directedSets,
  facetNames,
  intersections,
  maskOf,
  quantitySets,
  regionPoints,
  sampleConds,
  sampleGroups,
  sortIntersections,
  termGroups,
  vennLayout,
  type CallGroup,
  type Circle,
  type Intersection,
  type IntersectionOrder,
  type MeasuredSets,
  type SampleGroup,
  type SampleOf,
  type SetDef,
  type SetDirection
} from './stats/sets'
