import { type ReactNode, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  CURVE_MIN_TREATED,
  type ConditionKey,
  type StandardizeResult,
  analysisUnmet,
  batchesOf,
  classifyConditions,
  combineStandardize,
  condLabel,
  dataShape
} from '../../engine'
import { analysisChoice, stdSampleRows } from '../../graph/compareModel'
import {
  curveAxisOptions,
  curveSurfaceWhy,
  readAxisValue,
  surfacePairs,
  surfaceValue
} from '../../graph/curveSettings'
import { useConfigWindowOpen } from '../../graph/dialogDock'
import { useGraph } from '../../graph/store'
import {
  type CompareConfig,
  isCompareConfigured,
  normalizeCompareConfig,
  thresholdForAnalysis,
  thresholdForDetection
} from '../../graph/types'
import { StatusNote } from '../../ui/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../../ui/ToggleSwitch'
import { CompareStatisticSection } from '../kit/settings/compareSections'
import { ConfigureButton, Field, Section } from '../kit/settings/controls'
import { styles } from '../kit/settings/styles'
import { type StepSettingsProps } from '../settings'
import { CompareDialog } from './CompareDialog'
import { CurveDialog } from './CurveDialog'
import { comparisonCount } from './model'

/** A Compare's panel — and a Curve fit's (`curve`): the same num/den model, with the treatments as
 *  the numerator and the control as the denominator, and no analysis to switch. */
export function ComparePanel({
  id,
  config: rawConfig,
  curve = false
}: {
  id: string
  config: CompareConfig
  curve?: boolean
}) {
  const config = normalizeCompareConfig(rawConfig)
  const configured = isCompareConfigured(config)
  const [dialogOpen, setDialogOpen] = useConfigWindowOpen(id)
  // Compare accepts up to two Standardize inputs; combine them into one pooled dataset (matched by
  // uniqID) so the comparison selectors offer the union of both datasets' conditions/values. Select
  // the upstream std refs shallowly (stable across unrelated edits), then combine in a memo — a
  // single input passes through unchanged.
  const stds = useGraph(
    useShallow((s) =>
      s.edges
        .filter((e) => e.target === id)
        .map((e) => s.results[e.source])
        .filter((r) => r?.kind === 'standardize')
        .map((r) => (r as { std: StandardizeResult }).std)
    )
  )
  const std = useMemo(() => (stds.length ? combineStandardize(stds) : null), [stds])
  const shape = useMemo(() => (std ? dataShape(std) : null), [std])

  // Only the comparison-defining fields change the count — NOT threshold/transform. Keying the
  // memo on those (references stay stable when only the threshold changes) avoids re-running the
  // O(rows) previewCompare dry-run on every unrelated edit, which stalled on large data.
  const nComparisons = useMemo(
    () => (std && configured ? comparisonCount(std, config) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      std,
      configured,
      config.analysis,
      config.num,
      config.den,
      config.match,
      config.compared,
      config.pool,
      config.condition,
      config.condition2,
      config.pairNum,
      config.pairDen,
      config.pair2Num,
      config.pair2Den,
      config.curveAxis
    ]
  )
  // Switch the analysis from here as well as from the dialog. The comparison carries over when it
  // fits the new analysis — one compared condition for a t-test, two for a 2-way ANOVA (its
  // factors); otherwise the dialog opens on the new analysis to finish setting it up.
  const update = useGraph((s) => s.updateConfig)
  // A fresh (unconfigured) Compare starts on the first analysis its data can take, rather than a
  // t-test the data can't support. A fresh Curve fit starts on the widest fit its data can take —
  // the dose × time surface, else the first axis it can fit over — until the user picks one (a
  // pick sets `surface`, so it's never overridden); after that it only moves off an axis its data
  // can't fit over. A configured one keeps its pick and shows why it can't run.
  useEffect(() => {
    if (configured || !shape) return
    if (curve) {
      const pair =
        config.surface === undefined
          ? surfacePairs(shape.numeric).find((p) => !curveSurfaceWhy(shape, p))
          : undefined
      if (pair) {
        const patch: Record<string, unknown> = { surface: true, surfacePair: pair }
        const t = thresholdForDetection(config.detection ?? '4pl', config.threshold, true)
        if (t) patch.threshold = t
        update(id, patch)
        return
      }
      if (config.surface) return
      const fits = (a: ConditionKey): boolean =>
        (shape.levels[a] ?? 0) >= 2 && (shape.treated[a] ?? 0) >= CURVE_MIN_TREATED
      if (fits(config.curveAxis ?? 'dose')) return
      const ax = shape.numeric.find(fits)
      if (ax) update(id, { curveAxis: ax })
      return
    }
    if (!analysisUnmet(shape, config.analysis)) return
    const next = (['compare', 'anova'] as const).find((a) => !analysisUnmet(shape, a))
    if (!next) return
    const patch: Record<string, unknown> = { analysis: next }
    const t = thresholdForAnalysis(config.analysis, next, config.threshold)
    if (t) patch.threshold = t
    update(id, patch)
  }, [
    configured,
    curve,
    shape,
    config.analysis,
    config.curveAxis,
    config.surface,
    config.threshold,
    config.detection,
    id,
    update
  ])
  const switchAnalysis = (a: CompareConfig['analysis']): void => {
    if (a === config.analysis) return
    const axis = std
      ? classifyConditions(std.rows, config.num, config.den, std.activeConditions, config.compared)
          .axis
      : []
    const patch: Record<string, unknown> = { analysis: a }
    const t = thresholdForAnalysis(config.analysis, a, config.threshold)
    if (t) patch.threshold = t
    // the ANOVA's factors are the compared conditions (inferred on a config saved without them)
    if (a === 'anova' && !config.compared?.length && axis.length) patch.compared = axis
    update(id, patch)
    if (!configured && std) setDialogOpen(true)
  }
  // The analysis is the user's only where the comparison leaves a choice: several test values, or several
  // compared conditions (one at two values is a t-test either way).
  const comparedNow = config.compared?.length
    ? config.compared
    : std
      ? classifyConditions(std.rows, config.num, config.den, std.activeConditions).axis
      : []
  const noChoice = configured && !analysisChoice(comparedNow, config.num)
  // What the data can't take: the picked analysis (a Curve fit's own), and — on a Compare — whether
  // neither of its analyses fits (e.g. no replicates), which a Curve fit may still take.
  const unmet = shape ? analysisUnmet(shape, curve ? 'curve_fit' : config.analysis) : null
  const noCompare =
    !curve && !!shape && !!analysisUnmet(shape, 'compare') && !!analysisUnmet(shape, 'anova')
  const curveFits = !!shape && !analysisUnmet(shape, 'curve_fit')
  // A reason ("Needs …") inside a sentence.
  const inline = (why: string | null): string => (why ? why[0].toLowerCase() + why.slice(1) : '')
  const unit = curve ? 'curve set' : 'comparison'
  // A Curve fit's detection model picks its method: 4PL = the CurveCurator method, Spline = the
  // response surface method (which can also fit one dose × time surface per gene × compound).
  const detection = config.detection ?? '4pl'
  // A dose × time surface, under either model (4PL: the 4PL surface detector, adjusted F).
  const surfaceRun = curve && !!config.surface
  const pair = config.surfacePair ?? ['dose', 'time']
  const pairName = `${condLabel(pair[0])} × ${condLabel(pair[1])}`
  const readyMsg = surfaceRun
    ? `Ready, one ${pairName} surface per gene × compound`
    : nComparisons
      ? `Ready, ${nComparisons.n} ${unit}${nComparisons.n === 1 ? '' : 's'}${nComparisons.on.length ? ` on ${nComparisons.on.join(', ')}` : ''}`
      : 'Ready'
  // The axis a curve runs over, or the dose × time surface. An axis the data can't fit over (too
  // few levels — unknown until Clean data has run) is offered greyed.
  const axisValue = surfaceRun ? surfaceValue(pair) : (config.curveAxis ?? 'dose')

  return (
    <>
      <Section title={curve ? 'Curve fit' : 'Comparison'}>
        {curve ? (
          <>
            {(() => {
              // Only the fit's dimensions and its axis here; everything else in the Configure
              // window. Options the data has too few levels for are offered greyed.
              const opts = curveAxisOptions(shape, detection)
              const twoD = opts.filter((o) => o.value.startsWith('surface:'))
              const oneD = opts.filter((o) => !o.value.startsWith('surface:'))
              const firstOk = (os: typeof opts): string | undefined =>
                (os.find((o) => !o.disabled) ?? os[0])?.value
              const pick = (v: string): void => {
                const p = readAxisValue(v)
                const surface = 'pair' in p
                const patch: Record<string, unknown> =
                  'pair' in p
                    ? { surface: true, surfacePair: p.pair }
                    : { curveAxis: p.axis, surface: false }
                // onto or off a surface under 4PL: q-value calls ⇄ the relevance score
                const t = thresholdForDetection(detection, config.threshold, surface)
                if (t) patch.threshold = t
                update(id, patch)
              }
              const no2d = !twoD.some((o) => !o.disabled)
              return (
                <>
                  <Field
                    label="dimensions"
                    info={
                      <>
                        <b>1D</b> — one curve per gene × compound over one numeric condition, at
                        each level of the others.
                        <br />
                        <b>2D</b> — one surface per gene × compound over two, tested once.
                      </>
                    }
                  >
                    <ToggleSwitch
                      label="Dimensions"
                      value={surfaceRun ? '2d' : '1d'}
                      options={[
                        { value: '1d', label: '1D' },
                        {
                          value: '2d',
                          label: '2D',
                          disabled: no2d,
                          title: no2d ? 'Needs two numeric conditions that vary' : undefined
                        }
                      ]}
                      onChange={(v) => {
                        if ((v === '2d') === surfaceRun) return
                        const keep = v === '2d' ? surfaceValue(pair) : (config.curveAxis ?? 'dose')
                        const own = v === '2d' ? twoD : oneD
                        const ok = own.some((o) => o.value === keep && !o.disabled)
                        const next = ok ? keep : firstOk(own)
                        if (next) pick(next)
                      }}
                    />
                  </Field>
                  <Field
                    label="axis"
                    info={
                      surfaceRun
                        ? 'The two numeric conditions the surface runs over.'
                        : 'The numeric condition each curve runs over.'
                    }
                  >
                    <ToggleSwitch
                      label="Axis"
                      value={axisValue}
                      options={surfaceRun ? twoD : oneD}
                      onChange={pick}
                    />
                  </Field>
                </>
              )
            })()}
            {shape && analysisUnmet(shape, 'curve_fit') && (
              <StatusNote kind="warn">{analysisUnmet(shape, 'curve_fit')}</StatusNote>
            )}
          </>
        ) : (
          <>
            <Field label="analysis">
              <ToggleSwitch
                label="Analysis"
                // No highlight on an analysis the data can't take — nothing is really picked.
                value={
                  unmet ? ('' as CompareConfig['analysis']) : noChoice ? 'compare' : config.analysis
                }
                options={(
                  [
                    ['compare', 't-test', 'Each test group against its control'],
                    [
                      'anova',
                      'ANOVA',
                      'Whether the compared conditions change a gene at all, and which: an ANOVA'
                    ]
                  ] as const
                ).map(([value, label, what]) => {
                  // An analysis the data's shape can't support is offered greyed, with why (unknown
                  // until the upstream Clean data has run — then every one is offered); so is
                  // the ANOVA on a comparison that leaves no choice.
                  const why =
                    (shape ? analysisUnmet(shape, value) : null) ??
                    (value === 'anova' && noChoice
                      ? 'One condition at two values: the t-test answers both'
                      : null)
                  return { value, label, disabled: !!why, title: why ?? what }
                })}
                onChange={switchAnalysis}
              />
            </Field>
            {/* The analysis already picked, but the data can't support it (e.g. no replicates) —
                        and when neither analysis can, where this data can go instead. */}
            {noCompare ? (
              <StatusNote kind="warn">
                {`This data can’t take a t-test or an ANOVA — it ${inline(shape && analysisUnmet(shape, 'compare'))}.`}
                {curveFits && ' For a dose or time series, use a Curve fit tile.'}
              </StatusNote>
            ) : (
              unmet && <StatusNote kind="warn">{unmet}</StatusNote>
            )}
            {/* Data with batches (Clean data's, or the Merge inputs above): one comparison blocked
                        on them, or one per batch — each batch's own fold change, for a Contrast to pair. */}
            {config.analysis === 'compare' && std && batchesOf(std) && (
              <Field label="per batch">
                <OnOffSwitch
                  on={!!config.splitBatch}
                  label="Per batch"
                  onChange={(on) => update(id, { splitBatch: on })}
                />
              </Field>
            )}
            {config.analysis === 'compare' && config.splitBatch && std && batchesOf(std) && (
              <div style={styles.hint}>
                Each batch compared on its own, as (batch) — a Contrast can pair one batch&apos;s
                fold change against another&apos;s. Off: one comparison, tested within batches.
              </div>
            )}
          </>
        )}
        {/* The comparison itself (what's compared, matched, and over what) — for the analysis above. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ConfigureButton
            label="Configure…"
            disabled={!std || !!unmet}
            title={
              !std
                ? 'Run the upstream Clean data first'
                : unmet
                  ? `The data can’t take this analysis — it ${inline(unmet)}`
                  : undefined
            }
            onClick={() => setDialogOpen(true)}
          />
        </div>
        {dialogOpen && std && !curve && (
          // Compare (t-test / 2-way ANOVA): the condition-row window.
          <CompareDialog
            id={id}
            // one row per sample, cached per result: all the window reads of the rows
            rows={stdSampleRows(std)}
            active={std.activeConditions}
            numericConditions={std.numericConditions ?? []}
            shape={shape ?? undefined}
            initial={{
              num: config.num,
              den: config.den,
              match: config.match,
              compared: config.compared,
              pool: config.pool,
              analysis: config.analysis,
              asFactor: config.asFactor,
              axisScale: config.axisScale
            }}
            onClose={() => setDialogOpen(false)}
          />
        )}
        {dialogOpen && std && curve && (
          <CurveDialog
            id={id}
            // one row per sample, cached per result: all the window reads of the rows
            rows={stdSampleRows(std)}
            active={std.activeConditions}
            numericConditions={std.numericConditions ?? []}
            shape={shape ?? undefined}
            initial={{
              num: config.num,
              den: config.den,
              match: config.match,
              curveAxis: config.curveAxis,
              controlBackground: config.controlBackground,
              surface: config.surface,
              surfaceDescription: config.surfaceDescription,
              surfaceIntent: config.surfaceIntent,
              responseAxis: config.responseAxis,
              describeAll: config.describeAll,
              interpolation: config.interpolation,
              axisScale: config.axisScale,
              axisBaseline: config.axisBaseline,
              detection: config.detection,
              curveMethod: config.curveMethod
            }}
            detection={detection}
            onClose={() => setDialogOpen(false)}
          />
        )}
        {configured ? (
          <StatusNote kind="ok" style={styles.doneNote}>
            {readyMsg}
          </StatusNote>
        ) : (
          <StatusNote kind="warn">Not configured — pipeline blocked</StatusNote>
        )}
      </Section>
      <CompareStatisticSection id={id} config={config} />
    </>
  )
}

/** Its settings panel (nodes/settings.ts). */
export function Settings({ id, config }: StepSettingsProps): ReactNode {
  return <ComparePanel id={id} config={config as CompareConfig} curve={false} />
}
