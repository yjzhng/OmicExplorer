/** Gene-bar panel body: ONE gene's standardized value across every condition, with a
 *  gene switch-tab (like TDR). Selected genes get tabs,
 *  and a hovered gene transiently drives the bars. `std` comes on the scale Clean data's
 *  log-transform setting picks (presentStd), and the bars draw it as given — a plain axis, means
 *  and errors of those values — rather than guessing a log axis of their own. The look comes from
 *  the tile's BarConfig: the error type, the colouring, the replicate dots. */
import { useMemo, type ReactNode } from 'react'
import { CATEGORICAL_SCHEMES, toCategoricalId, type PaletteRef } from '../ui/palettes'
import { useAppSettings, useRolePalette } from '../ui/useAppSettings'

import {
  abundanceLabel,
  buildGeneBar,
  distinctOf,
  isNumericCond,
  numericOf,
  sampleIndex,
  valuesOf,
  type ConditionKey,
  type SampleOrder,
  type StandardizeResult,
  type ValueScale
} from '../engine'
import { barColorConds, primaryColorLevels, sampleOrderOf, type BarConfig } from '../graph/types'
import { valueRange, type ValueRange } from '../ui/colormap'
import { GeneBarView, type ReplicateLook } from '../ui/GeneBarView'
import { GeneSwitch } from './GeneSwitch'

function GeneBarBody({
  std,
  gene,
  orient,
  range,
  scale,
  error,
  replicates,
  colorCat,
  colorNum,
  errorWidth,
  errorColor,
  valueRangeFixed,
  categorical,
  valuePalette,
  condTitle,
  sampleOrder
}: {
  condTitle?: (c: ConditionKey) => string
  sampleOrder: SampleOrder
  std: StandardizeResult
  gene: string
  orient?: 'landscape' | 'portrait'
  range: ValueRange
  scale: ValueScale
  error: NonNullable<BarConfig['error']>
  replicates: ReplicateLook
  colorCat?: ConditionKey
  colorNum?: ConditionKey
  errorWidth?: number
  errorColor?: string
  valueRangeFixed?: [number, number]
  categorical: readonly string[]
  valuePalette: PaletteRef
}) {
  const bar = useMemo(
    () =>
      // off the result's shared sample index (sampleIndex): the condition axis made once per
      // sample, the rows read as ids — no row built
      buildGeneBar(sampleIndex(std), [gene], std.displayMap, range.log, error, {
        by: sampleOrder,
        samples: std.samples
      }),
    [std, gene, range.log, error, sampleOrder]
  )
  return (
    <GeneBarView
      bar={bar}
      orient={orient}
      title={std.displayMap[gene] ?? gene}
      range={range}
      valueLabel={abundanceLabel(scale)}
      replicates={replicates}
      colorCat={colorCat}
      colorNum={colorNum}
      errorWidth={errorWidth}
      errorColor={errorColor}
      valueRangeFixed={valueRangeFixed}
      categorical={categorical}
      valuePalette={valuePalette}
      condTitle={condTitle}
    />
  )
}

export function GeneBarTile({
  std,
  genes,
  scale,
  config,
  controls,
  condTitle
}: {
  /** a condition's legend heading, with its unit (see GeneBarView) */
  condTitle?: (c: ConditionKey) => string
  /** on its presented scale (see presentStd) */
  std: StandardizeResult
  genes: string[]
  /** that scale — for the axis title */
  scale: ValueScale
  config: BarConfig
  /** the tile's quick switches, on the gene switcher's row, before the gene */
  controls?: ReactNode
}) {
  // Its categorical palette: the plot's own, else the global one; colour by value on the
  // data-values role.
  const globalCat = useAppSettings((s) => s.categorical)
  const categorical = CATEGORICAL_SCHEMES[toCategoricalId(config.categorical) ?? globalCat]
  const valuePalette = useRolePalette('data')
  const present = useMemo(() => distinctOf(std, 'uniqID') as Set<string>, [std])
  // Every gene by default; the selected ones (those in this data) once any are selected.
  const pager = useMemo(
    () => (genes.some((id) => present.has(id)) ? genes : [...present]),
    [genes, present]
  )
  // Global value range, for the bars' colour (shared with the Heatmap tile). Never a log axis of
  // its own: the values already are on the scale Clean data presents them on.
  const range = useMemo(
    () => ({ ...valueRange(valuesOf(std, 'value') as Array<number | null>), log: false }),
    [std]
  )
  // Global axis scale: the whole dataset's values (from 0, as bars are), with headroom for the
  // error bars — so paging genes keeps one scale.
  const globalRange = useMemo((): [number, number] | undefined => {
    const { min, max } = range
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined
    const lo = Math.min(0, min)
    const hi = Math.max(0, max)
    const pad = (hi - lo) * 0.08 || 1
    return [lo < 0 ? lo - pad : 0, hi + pad]
  }, [range])
  // Colour by condition: the categorical one sets the colour, the numeric one (dose, time) the shade.
  const numeric = numericOf(std)
  const conds = barColorConds(config, std.activeConditions, primaryColorLevels(std), numeric)
  const colorCat = conds.find((c) => !isNumericCond(c, numeric))
  const colorNum = conds.find((c) => isNumericCond(c, numeric))
  const { replicates, repSize, repOpacity, repColor, repJitter } = config
  const look = useMemo(
    (): ReplicateLook => ({
      show: !!replicates,
      size: repSize ?? 6,
      opacity: repOpacity ?? 0.6,
      color: repColor ?? 'auto',
      jitter: repJitter ?? true
    }),
    [replicates, repSize, repOpacity, repColor, repJitter]
  )
  return (
    <GeneSwitch genes={pager} present={present} displayMap={std.displayMap} controls={controls}>
      {(gene) => (
        <GeneBarBody
          std={std}
          gene={gene}
          orient={config.orient}
          range={range}
          scale={scale}
          error={config.error ?? 'sd'}
          replicates={look}
          colorCat={colorCat}
          colorNum={colorNum}
          errorWidth={config.errorWidth}
          errorColor={config.errorColor}
          valueRangeFixed={config.yScale === 'global' ? globalRange : undefined}
          categorical={categorical}
          valuePalette={valuePalette}
          condTitle={condTitle}
          sampleOrder={sampleOrderOf(config)}
        />
      )}
    </GeneSwitch>
  )
}
