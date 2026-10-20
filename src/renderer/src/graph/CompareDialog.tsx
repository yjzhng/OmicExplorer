/**
 * The Compare window: one row per condition — compared (its test values against one control value)
 * or context (matched like-for-like, shared at one control level, or pooled), with values left out
 * by clicking their chips. Several conditions may be compared (flagged when the data could separate
 * them). The model lives in compareModel; the preview is the engine's own (compareSlices) on the
 * config it compiles, so what it lists is what runs.
 */
import { useMemo, useState, type ReactNode } from 'react'

import {
  analysisUnmet,
  axisModelFor,
  detectAxisScale,
  isNumericCond,
  type AxisScale,
  compareSlices,
  condLabel,
  numericConds,
  previewCompare,
  previewFactorAnova,
  type CompareInput,
  type ConditionKey,
  type CustomConditionKey,
  type DataShape,
  type StandardRow,
  type ThresholdConfig
} from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { UI } from '../ui/theme'
import {
  anovaSelectors,
  compareModel,
  confounded,
  analysisChoice,
  controlKind,
  controlLine,
  readCompareState,
  sampleRows,
  defaultControl,
  valuesOf,
  type CompareState,
  type CtxMode
} from './compareModel'
import {
  CondRow,
  NodeTable,
  Section,
  SelectorShell,
  SideCell,
  SidesBox,
  Tag,
  ValChip
} from './condRows'
import { useCondUnits } from './useUpstreamFacts'
import { PreviewTable } from './selectorParts'
import { useGraph } from './store'
import { anovaFactorsOf, thresholdForAnalysis, type CompareConfig } from './types'

type Analysis = 'compare' | 'anova'

const LEGEND: Array<[string, string]> = [
  [
    'compared',
    'what is tested: test values, each its own comparison, against one control value. Several compared conditions combine: each combination of test values against the control combination.'
  ],
  ['context', 'every other condition: how each test group finds its control there, one of —'],
  [
    'matched',
    'each test group gets its own control at the same value; the test side is split per value.'
  ],
  [
    'shared',
    'still split per value, but every value is compared against one control at a single value.'
  ],
  ['pooled', 'the condition is ignored: its values are merged into one group on both sides.'],
  [
    't-test',
    'is each test group different from its control? A t-test per comparison, a signed fold change each.'
  ],
  [
    'ANOVA',
    'do the compared conditions change a gene at all, and which? An ANOVA with the compared conditions as its factors (every context matched): an F-test per factor and interaction, and the signed comparisons as contrasts of the model. Offered with several test values or several compared conditions.'
  ]
]

export function CompareDialog({
  id,
  rows,
  active,
  numericConditions,
  shape,
  initial,
  onClose
}: {
  id: string
  /** Clean data's rows — gene × sample, or one per sample (only its samples are read) */
  rows: StandardRow[]
  active: ConditionKey[]
  /** Clean data's declared numeric custom conditions (its schema, with dose and time) */
  numericConditions: readonly CustomConditionKey[]
  shape?: DataShape
  initial: Pick<
    CompareConfig,
    'num' | 'den' | 'match' | 'compared' | 'pool' | 'analysis' | 'asFactor' | 'axisScale'
  >
  onClose: () => void
}): ReactNode {
  const units = useCondUnits(id)
  const update = useGraph((s) => s.updateConfig)
  // The grouping depends on the samples, not the genes: work on one row per sample.
  const samples = useMemo(() => sampleRows(rows, active), [rows, active])
  const numeric = useMemo(() => numericConds(numericConditions), [numericConditions])
  const [state, setState] = useState<CompareState>(() =>
    readCompareState(initial, samples, active, numeric)
  )
  // each condition's value box: set by its chevron; until then a compared one open, a context one folded
  const [fold, setFold] = useState<Partial<Record<ConditionKey, boolean>>>({})
  // the analysis: a t-test per test group, or an ANOVA — the user's
  // only where the comparison leaves a choice (analysisChoice); a t-test otherwise
  const [goal, setGoal] = useState<Analysis>(initial.analysis === 'anova' ? 'anova' : 'compare')

  // An ANOVA matches every context condition like-for-like (shared and pooled are the t-test's):
  // its model reads the picks without the context modes, which stay for the t-test.
  const m = useMemo(
    () =>
      compareModel(goal === 'anova' ? { ...state, modes: {} } : state, samples, active, numeric),
    [goal, state, samples, active, numeric]
  )
  const choice = analysisChoice(m.CMP, m.num)
  const analysis: Analysis = choice ? goal : 'compare'
  const anova = analysis === 'anova'
  const any = m.CMP.length > 0
  const input = useMemo<CompareInput>(
    () => ({
      rows: samples,
      num: m.num,
      den: m.den,
      match: m.match,
      compared: m.CMP,
      pool: m.pool,
      activeConditions: active,
      numericConditions
    }),
    [m, samples, active, numericConditions]
  )
  const preview = useMemo(() => (any && !anova ? previewCompare(input) : null), [any, anova, input])
  const slices = useMemo(
    () => (preview && preview.groups > 0 ? compareSlices(input).slices : []),
    [preview, input]
  )
  // The ANOVA: the compared conditions are its factors, each at its test values and its control;
  // its overall rows are each test value against the control (one factor) or the factors'
  // interactions (several), one per context.
  const sel = useMemo(() => anovaSelectors(m, state, samples), [m, state, samples])
  // a compared numeric condition in the ANOVA: a slope (the default) or a factor, its slope's scale
  // as detected unless set here
  const [asFactor, setAsFactor] = useState<ConditionKey[]>(initial.asFactor ?? [])
  const [scales, setScales] = useState<Partial<Record<ConditionKey, AxisScale>>>(
    initial.axisScale ?? {}
  )
  const pick = useMemo(
    () => ({ compared: m.CMP, num: sel.num, den: sel.den, asFactor, axisScale: scales }),
    [m, sel, asFactor, scales]
  )
  const anovaView = useMemo(() => {
    if (!anova) return null
    const factors = anovaFactorsOf(pick, numeric)
    if (!factors.length) return null
    return previewFactorAnova({
      rows: samples,
      factors,
      activeConditions: active,
      num: sel.num,
      den: sel.den
    })
  }, [anova, pick, numeric, sel, samples, active])
  const conf = !anova ? confounded(m, samples) : null

  const warnings = [
    ...m.warnings,
    ...(anova ? (anovaView?.warnings ?? []) : (preview?.warnings ?? []))
  ]
  const canApply = any && warnings.length === 0

  const apply = (): void => {
    const cur = (
      useGraph.getState().nodes.find((n) => n.id === id)?.data.config as
        { threshold?: ThresholdConfig } | undefined
    )?.threshold
    const next = cur ? thresholdForAnalysis(initial.analysis ?? 'compare', analysis, cur) : null
    update(id, {
      analysis,
      ...(anova
        ? {
            num: sel.num,
            den: sel.den,
            match: sel.match,
            pool: [],
            asFactor: asFactor.filter((c) => m.CMP.includes(c)),
            axisScale: scales
          }
        : { num: m.num, den: m.den, match: m.match, pool: m.pool }),
      compared: m.CMP,
      ...(next ? { threshold: next } : {})
    })
    onClose()
  }

  // ── state edits ──
  const edit = (f: (s: CompareState) => void): void =>
    setState((s) => {
      const n: CompareState = {
        cmp: { ...s.cmp },
        modes: { ...s.modes },
        fixedVal: { ...s.fixedVal },
        drop: { ...s.drop }
      }
      f(n)
      return n
    })
  const compareOn = (c: ConditionKey): void => {
    const r = defaultControl(samples, c, numeric)
    edit((s) => {
      s.cmp[c] = { r, T: valuesOf(samples, c, numeric).filter((v) => v !== r) }
      delete s.modes[c]
    })
    setFold((f) => ({ ...f, [c]: false }))
  }
  const toContext = (c: ConditionKey, mode: CtxMode): void => {
    edit((s) => {
      delete s.cmp[c]
      s.modes[c] = mode
    })
  }
  const toggle = (list: string[] | undefined, v: string): string[] =>
    (list ?? []).includes(v) ? (list ?? []).filter((x) => x !== v) : [...(list ?? []), v]

  // A compared numeric condition in the ANOVA: as a slope (one df: a trend over its levels, on its
  // axis scale) or a factor (a level each); a slope's scale detected from the levels' spacing.
  const slopeControls = (c: ConditionKey): ReactNode => {
    const slope = !asFactor.includes(c)
    const levels = [...(sel.num[c] ?? []), ...(sel.den[c] ?? [])].map(Number)
    const guess = detectAxisScale(levels)
    const detected = axisModelFor(c, undefined, undefined, levels).scale
    const scale = scales[c] ?? detected
    return (
      <span style={styles.ctxGroup}>
        <span style={styles.swLabel}>as:</span>
        <ToggleSwitch
          label={`${condLabel(c)}: a slope or a factor`}
          size="sm"
          value={slope ? 'slope' : 'factor'}
          options={[
            {
              value: 'slope',
              label: 'slope',
              title:
                'A trend over its levels (one df): more power for a steady change, blind to a peak in the middle'
            },
            { value: 'factor', label: 'factor', title: 'Each level its own: any shape, more df' }
          ]}
          onChange={(v) =>
            setAsFactor((a) => (v === 'factor' ? [...a, c] : a.filter((x) => x !== c)))
          }
        />
        {slope && (
          <>
            <span style={styles.swLabel}>scale:</span>
            <ToggleSwitch
              label={`${condLabel(c)}: the slope's axis scale`}
              size="sm"
              value={scale}
              options={(['log', 'linear'] as const).map((v) => ({
                value: v,
                label: v,
                title:
                  v === detected
                    ? `Detected: ${guess.scale ? guess.why : `${guess.why}, so linear`}`
                    : undefined
              }))}
              onChange={(v) =>
                setScales((s) => {
                  const n = { ...s }
                  if (v === detected) delete n[c]
                  else n[c] = v as AxisScale
                  return n
                })
              }
            />
          </>
        )}
      </span>
    )
  }

  // ── one row per condition ──
  const rowOf = (c: ConditionKey, i: number): ReactNode => {
    const vs = valuesOf(samples, c, numeric)
    const isX = m.CMP.includes(c)
    const x = isX ? null : (m.ctx.find((k) => k.c === c) ?? null)
    const live = any && x
    const mode = isX
      ? 'cmp'
      : live
        ? x.mode
        : vs.length < 2
          ? 'single'
          : (state.modes[c] ?? 'match')
    if (mode === 'single')
      return (
        <CondRow
          key={c}
          first={i === 0}
          name={condLabel(c)}
          badge={<Tag kind="ctx">context condition</Tag>}
          toggle={
            <OnOffSwitch
              on={false}
              disabled
              label={`Compare on ${condLabel(c)}`}
              title={`One ${condLabel(c)} only: nothing to compare`}
              onChange={() => {}}
            />
          }
          line={<span style={{ fontSize: 12, color: UI.textMuted }}>{vs[0]}</span>}
        />
      )
    const Tv = live ? x.Tv : vs
    const Cv = live ? x.Cv : vs
    const drop = new Set(state.drop[c] ?? [])
    const leaveOut = (v: string): void => edit((s) => void (s.drop[c] = toggle(s.drop[c], v)))
    const folded = fold[c] ?? mode !== 'cmp'
    const outChip = (v: string, inLook: 'on' | 'matched' | 'plain'): ReactNode => (
      <ValChip
        key={v}
        label={v}
        look={drop.has(v) ? 'out' : inLook}
        title={drop.has(v) ? 'Left out. Click to include' : 'Included. Click to leave out'}
        onClick={() => leaveOut(v)}
      />
    )
    let box: ReactNode
    if (mode === 'cmp') {
      const P = m.P[c]!
      box = (
        <SidesBox
          left={[
            'test (numerator)',
            P.vs.map((v) => (
              <ValChip
                key={v}
                label={v}
                look={P.T.includes(v) ? 'on' : 'plain'}
                disabled={v === P.r}
                title={v === P.r ? 'This is the control' : undefined}
                onClick={() =>
                  edit((s) => void (s.cmp[c] = { ...s.cmp[c]!, T: toggle(s.cmp[c]!.T, v) }))
                }
              />
            ))
          ]}
          right={[
            'control (denominator)',
            P.vs.map((v) => (
              <ValChip
                key={v}
                label={v}
                radio
                look={v === P.r ? 'on' : 'plain'}
                onClick={() =>
                  edit((s) => void (s.cmp[c] = { r: v, T: s.cmp[c]!.T.filter((t) => t !== v) }))
                }
              />
            ))
          ]}
        />
      )
    } else if (mode === 'fixed') {
      const val = live ? x.val : (state.fixedVal[c] ?? Cv[0])
      box = (
        <SidesBox
          left={['test', Tv.map((v) => outChip(v, 'on'))]}
          right={[
            'control · shared by every test value',
            Cv.map((v) => (
              <ValChip
                key={v}
                label={v}
                radio
                look={v === val ? 'on' : 'plain'}
                onClick={Cv.length > 1 ? () => edit((s) => void (s.fixedVal[c] = v)) : undefined}
              />
            ))
          ]}
        />
      )
    } else if (mode === 'match') {
      box = (
        <SidesBox
          left={[
            'test',
            Tv.map((v) =>
              Cv.includes(v) ? (
                outChip(v, 'matched')
              ) : (
                <ValChip key={v} label={v} look="out" title="No control at this value: skipped" />
              )
            )
          ]}
          right={[
            'control',
            Cv.map((v) =>
              Tv.includes(v) ? (
                outChip(v, 'matched')
              ) : (
                <ValChip key={v} label={v} look="out" title="No test group at this value" />
              )
            )
          ]}
        />
      )
    } else {
      box = (
        <SidesBox
          left={['test · merged', Tv.map((v) => outChip(v, 'plain'))]}
          right={['control · merged', Cv.map((v) => outChip(v, 'plain'))]}
        />
      )
    }
    // the row's role sits by its name
    const badge =
      mode === 'cmp' ? (
        <Tag kind="cmp">compared condition</Tag>
      ) : (
        <Tag kind="ctx">context condition</Tag>
      )
    const locked = !!live && !x.matchOk
    return (
      <CondRow
        key={c}
        first={i === 0}
        name={condLabel(c)}
        folded={folded}
        onFold={() => setFold((f) => ({ ...f, [c]: !folded }))}
        box={box}
        badge={badge}
        swapKey={mode === 'cmp' ? 'cmp' : 'ctx'}
        // compared: on / off, right of the name; off, the row is context — its mode follows, then the tag
        toggle={
          <OnOffSwitch
            on={mode === 'cmp'}
            label={`Compare on ${condLabel(c)}`}
            title={
              mode === 'cmp'
                ? `${condLabel(c)} is compared. Switch off to make it context`
                : `Compare on ${condLabel(c)}`
            }
            onChange={(on) => {
              if (on) return compareOn(c)
              toContext(c, state.modes[c] ?? 'match')
              // keeps the row as it was (a compared row's default is open; a context row's is folded)
              setFold((f) => ({ ...f, [c]: f[c] ?? false }))
            }}
          />
        }
        line={
          <>
            {anova && mode === 'cmp' && isNumericCond(c, numeric) && slopeControls(c)}
            {/* disabled while compared (showing the mode switching off returns to), so nothing shifts */}
            {!anova && (
              <span
                style={styles.ctxGroup}
                title={
                  mode === 'cmp'
                    ? `${condLabel(c)} is compared. Switch compared off to set its context`
                    : undefined
                }
              >
                <span style={styles.swLabel}>context:</span>
                <ToggleSwitch
                  label={`${condLabel(c)}: matched, shared or pooled`}
                  size="sm"
                  value={mode === 'cmp' ? (state.modes[c] ?? 'match') : mode}
                  disabled={mode === 'cmp'}
                  options={[
                    {
                      value: 'match',
                      label: 'matched',
                      disabled: locked,
                      title: locked ? `The control has one ${condLabel(c)} only` : undefined
                    },
                    { value: 'fixed', label: 'shared' },
                    { value: 'pool', label: 'pooled' }
                  ]}
                  onChange={(v) => toContext(c, v as CtxMode)}
                />
              </span>
            )}
          </>
        }
      />
    )
  }

  const nComparisons = anova
    ? new Set((anovaView?.rows ?? []).map((r) => r[0])).size
    : (preview?.groups ?? 0)
  const nTerms = anovaView?.tested.length ?? 0
  const slopes = anova ? anovaFactorsOf(pick, numeric).filter((f) => f.slope) : []
  const own = m.ctx.filter((x) => x.mode === 'match').map((x) => condLabel(x.c))
  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`
  const anovaWhy = shape ? analysisUnmet(shape, 'anova') : null
  return (
    <SelectorShell
      title="Configure comparison"
      canApply={canApply}
      onApply={apply}
      onClose={onClose}
      mode={
        <ToggleSwitch
          label="Analysis"
          value={analysis}
          options={[
            {
              value: 'compare' as Analysis,
              label: 't-test',
              title: 'Each test group against its control: a t-test per comparison'
            },
            {
              value: 'anova' as Analysis,
              label: 'ANOVA',
              disabled: !!anovaWhy || (any && !choice),
              title:
                anovaWhy ??
                (any && !choice
                  ? 'One condition at two values: the t-test answers both'
                  : 'Whether the compared conditions change a gene at all, and which (with their interactions): an ANOVA, an F-test per factor')
            }
          ]}
          onChange={setGoal}
        />
      }
    >
      <Section
        title="Comparison"
        hint="What is tested against what, and how each test group finds its control on every other condition. Click a value to leave it out."
        legend={LEGEND}
      >
        {m.conds.map(rowOf)}
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            paddingTop: 6
          }}
        >
          {!any ? (
            <StatusNote kind="warn">
              <b>Comparison:</b> no condition is compared. Set one to compared.
            </StatusNote>
          ) : anova ? (
            <StatusNote kind="info">
              <b>Factors:</b> {m.CMP.map(condLabel).join(' × ')}, each at its test values and its
              control; every other condition matched like-for-like.
            </StatusNote>
          ) : (
            <StatusNote kind={controlKind(m)}>
              <b>Control:</b> {controlLine(m)}
            </StatusNote>
          )}
          {conf && (
            <StatusNote kind="warn">
              <b>Confounded:</b> the data have samples where{' '}
              {conf.conds.map(condLabel).join(' or ')} changes alone (e.g. {conf.example}), so the
              effects of {m.CMP.map(condLabel).join(' and ')} can’t be told apart.
            </StatusNote>
          )}
        </div>
      </Section>
      <Section
        title={
          anova
            ? `Preview (${plural(nComparisons, 'comparison')} · ${plural(nTerms, 'factor test')})`
            : `Preview (${plural(nComparisons, 'comparison')})`
        }
        hint={
          anova
            ? 'What will run: an F-test per factor and interaction, and the overall comparisons — one row per comparison and context.'
            : 'What will run: one row per comparison.'
        }
        grid={false}
        shade
      >
        {any && (
          <div style={styles.formula}>
            {anova && anovaView
              ? `log₂ abundance ~ ${anovaView.terms
                  .map((t) =>
                    t
                      .split(' × ')
                      .map((c) => condLabel(c as ConditionKey))
                      .join(' × ')
                  )
                  .join(' + ')}`
              : `log₂ abundance ~ ${m.CMP.length === 1 ? condLabel(m.CMP[0]) : `group(${m.CMP.map(condLabel).join(' × ')})`}`}
            <div style={styles.formulaNote}>
              {anova
                ? slopes.length
                  ? `${slopes.map((f) => `${condLabel(f.condition)} a slope (log₂FC per ${f.slope === 'log' ? 'decade' : 'unit'})`).join(', ')}; F-test per term; overall: ${m.CMP.length === 1 ? 'the slope' : anovaView?.sharedBaseline ? 'each one’s slope from the vehicle' : 'the slopes’ differences'}, contrasts of the model`
                  : m.CMP.length === 1
                    ? 'F-test of the factor; each test value against the control, a contrast of the model'
                    : 'F-test per term; overall: the factors’ interaction, a contrast of the model'
                : 'Welch t-test'}
              {!anova && own.length ? `, for each ${own.join(' × ')}` : ''}
            </div>
          </div>
        )}
        {anova
          ? anovaView &&
            anovaView.rows.length > 0 && (
              <PreviewTable columns={anovaView.columns} rows={anovaView.rows} />
            )
          : slices.length > 0 && (
              <NodeTable
                columns={['test', '', 'control']}
                rows={slices
                  .slice(0, 50)
                  .map((s) => [
                    <SideCell
                      key="t"
                      rows={s.grp}
                      conds={active}
                      units={units}
                      numeric={numeric}
                    />,
                    'vs',
                    <SideCell
                      key="c"
                      rows={s.denSlice}
                      conds={active}
                      units={units}
                      numeric={numeric}
                    />
                  ])}
                more={slices.length - 50}
              />
            )}
        {(anova ? (anovaView?.notes ?? []) : (preview?.notes ?? [])).map((n) => (
          <StatusNote key={n} kind="info">
            {n}
          </StatusNote>
        ))}
        {[...(anovaView?.cautions ?? []), ...warnings].map((w) => (
          <StatusNote key={w} kind="warn">
            {w}
          </StatusNote>
        ))}
      </Section>
    </SelectorShell>
  )
}

const styles = {
  swLabel: { fontSize: 11, color: UI.textMuted },
  ctxGroup: { display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 'auto' },
  formula: { fontSize: 12, color: UI.text, fontFamily: 'ui-monospace, monospace' },
  formulaNote: {
    fontFamily: 'inherit',
    color: UI.textMuted,
    fontWeight: 400,
    marginTop: 2,
    fontSize: 11
  }
} as const
