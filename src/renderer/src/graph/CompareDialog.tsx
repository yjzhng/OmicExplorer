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
  compareSlices,
  condLabel,
  crossPairs,
  previewCompare,
  previewTwoWay,
  type CompareInput,
  type ConditionKey,
  type DataShape,
  type StandardRow,
  type ThresholdConfig
} from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { UI } from '../ui/theme'
import {
  compareModel,
  confounded,
  controlKind,
  controlLine,
  readCompareState,
  sampleRows,
  defaultControl,
  valuesOf,
  type CompareState,
  type CtxMode
} from './compareModel'
import { CondRow, NodeTable, Section, SelectorShell, SideCell, SidesBox, Tag, ValChip } from './condRows'
import { useCondUnits } from './useUpstreamFacts'
import { PreviewTable } from './selectorParts'
import { useGraph } from './store'
import { thresholdForAnalysis, type CompareConfig } from './types'

type Analysis = 'compare' | 'two_way_anova'

const LEGEND: Array<[string, string]> = [
  ['compared', 'what is tested: test values, each its own comparison, against one control value. Several compared conditions combine: each combination of test values against the control combination.'],
  ['context', 'every other condition: how each test group finds its control there, one of —'],
  ['matched', 'each test group gets its own control at the same value; the test side is split per value.'],
  ['shared', 'still split per value, but every value is compared against one control at a single value.'],
  ['pooled', 'the condition is ignored: its values are merged into one group on both sides.']
]

export function CompareDialog({
  id,
  rows,
  active,
  shape,
  initial,
  onClose
}: {
  id: string
  /** Clean data's rows (gene × sample) */
  rows: StandardRow[]
  active: ConditionKey[]
  shape?: DataShape
  initial: Pick<CompareConfig, 'num' | 'den' | 'match' | 'compared' | 'pool' | 'analysis'>
  onClose: () => void
}): ReactNode {
  const units = useCondUnits(id)
  const update = useGraph((s) => s.updateConfig)
  // The grouping depends on the samples, not the genes: work on one row per sample.
  const samples = useMemo(() => sampleRows(rows, active), [rows, active])
  const [state, setState] = useState<CompareState>(() => readCompareState(initial, samples, active))
  // each condition's value box: set by its chevron; until then a compared one open, a context one folded
  const [fold, setFold] = useState<Partial<Record<ConditionKey, boolean>>>({})
  const [analysis, setAnalysis] = useState<Analysis>(initial.analysis === 'two_way_anova' ? 'two_way_anova' : 'compare')
  const twoWay = analysis === 'two_way_anova'

  const m = useMemo(() => compareModel(state, samples, active), [state, samples, active])
  const any = m.CMP.length > 0
  const input = useMemo<CompareInput>(
    () => ({ rows: samples, num: m.num, den: m.den, match: m.match, compared: m.CMP, pool: m.pool, activeConditions: active }),
    [m, samples, active]
  )
  const preview = useMemo(() => (any && !twoWay ? previewCompare(input) : null), [any, twoWay, input])
  const slices = useMemo(
    () => (preview && preview.groups > 0 ? compareSlices(input).slices : []),
    [preview, input]
  )
  // 2-way ANOVA: the two compared conditions are its factors; every numerator × denominator level
  // pair of each runs as its own 2×2 interaction.
  const twoWayView = useMemo(() => {
    if (!twoWay || m.CMP.length !== 2) return null
    const [f1, f2] = m.CMP.map((c) => ({ condition: c, pairs: crossPairs(m.num[c] ?? [], m.den[c] ?? []) }))
    if (!f1.pairs.length || !f2.pairs.length) return null
    const factors: [typeof f1, typeof f2] = [f1, f2]
    return previewTwoWay({ rows: samples, factors, activeConditions: active, num: m.num, den: m.den })
  }, [twoWay, m, samples, active])
  const conf = !twoWay ? confounded(m, samples) : null

  const warnings = [
    ...m.warnings,
    ...(twoWay
      ? m.CMP.length !== 2
        ? ['A 2-way ANOVA needs two compared conditions: its two factors.']
        : (twoWayView?.warnings ?? [])
      : (preview?.warnings ?? []))
  ]
  const canApply = any && warnings.length === 0

  const apply = (): void => {
    const cur = (useGraph.getState().nodes.find((n) => n.id === id)?.data.config as { threshold?: ThresholdConfig } | undefined)?.threshold
    const next = cur ? thresholdForAnalysis(initial.analysis ?? 'compare', analysis, cur) : null
    const patch: Record<string, unknown> = {
      analysis,
      num: m.num,
      den: m.den,
      match: m.match,
      compared: m.CMP,
      pool: m.pool,
      ...(next ? { threshold: next } : {})
    }
    if (twoWay) {
      const [a, b] = m.CMP
      Object.assign(patch, {
        condition: a,
        pairNum: m.num[a]?.[0] ?? '',
        pairDen: m.den[a]?.[0] ?? '',
        condition2: b,
        pair2Num: m.num[b]?.[0] ?? '',
        pair2Den: m.den[b]?.[0] ?? ''
      })
    }
    update(id, patch)
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
    const r = defaultControl(samples, c)
    edit((s) => {
      s.cmp[c] = { r, T: valuesOf(samples, c).filter((v) => v !== r) }
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

  // ── one row per condition ──
  const rowOf = (c: ConditionKey, i: number): ReactNode => {
    const vs = valuesOf(samples, c)
    const isX = m.CMP.includes(c)
    const x = isX ? null : (m.ctx.find((k) => k.c === c) ?? null)
    const live = any && x
    const mode = isX ? 'cmp' : live ? x.mode : vs.length < 2 ? 'single' : (state.modes[c] ?? 'match')
    if (mode === 'single')
      return (
        <CondRow
          key={c}
          first={i === 0}
          name={condLabel(c)}
          badge={<Tag kind="ctx">context condition</Tag>}
          toggle={<OnOffSwitch on={false} disabled label={`Compare on ${condLabel(c)}`} title={`One ${condLabel(c)} only: nothing to compare`} onChange={() => {}} />}
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
                onClick={() => edit((s) => void (s.cmp[c] = { ...s.cmp[c]!, T: toggle(s.cmp[c]!.T, v) }))}
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
                onClick={() => edit((s) => void (s.cmp[c] = { r: v, T: s.cmp[c]!.T.filter((t) => t !== v) }))}
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
          left={['test', Tv.map((v) => (Cv.includes(v) ? outChip(v, 'matched') : <ValChip key={v} label={v} look="out" title="No control at this value: skipped" />))]}
          right={['control', Cv.map((v) => (Tv.includes(v) ? outChip(v, 'matched') : <ValChip key={v} label={v} look="out" title="No test group at this value" />))]}
        />
      )
    } else {
      box = <SidesBox left={['test · merged', Tv.map((v) => outChip(v, 'plain'))]} right={['control · merged', Cv.map((v) => outChip(v, 'plain'))]} />
    }
    // the row's role sits by its name
    const badge = mode === 'cmp' ? <Tag kind="cmp">compared condition</Tag> : <Tag kind="ctx">context condition</Tag>
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
            title={mode === 'cmp' ? `${condLabel(c)} is compared. Switch off to make it context` : `Compare on ${condLabel(c)}`}
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
            {/* disabled while compared (showing the mode switching off returns to), so nothing shifts */}
            {!twoWay && (
              <span
                style={styles.ctxGroup}
                title={mode === 'cmp' ? `${condLabel(c)} is compared. Switch compared off to set its context` : undefined}
              >
                <span style={styles.swLabel}>context:</span>
                <ToggleSwitch
                  label={`${condLabel(c)}: matched, shared or pooled`}
                  size="sm"
                  value={mode === 'cmp' ? (state.modes[c] ?? 'match') : mode}
                  disabled={mode === 'cmp'}
                  options={[
                    { value: 'match', label: 'matched', disabled: locked, title: locked ? `The control has one ${condLabel(c)} only` : undefined },
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

  const nComparisons = twoWay ? (twoWayView?.groups ?? 0) : (preview?.groups ?? 0)
  const own = m.ctx.filter((x) => x.mode === 'match').map((x) => condLabel(x.c))
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
          options={(
            [
              ['compare', 't-test'],
              ['two_way_anova', '2-way ANOVA']
            ] as const
          ).map(([value, label]) => {
            const why = shape ? analysisUnmet(shape, value) : null
            return { value: value as Analysis, label, disabled: !!why, title: why ?? undefined }
          })}
          onChange={setAnalysis}
        />
      }
    >
      <Section
        title="Comparison"
        hint="What is tested against what, and how each test group finds its control on every other condition. Click a value to leave it out."
        legend={LEGEND}
      >
        {m.conds.map(rowOf)}
        <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
          {!any ? (
            <StatusNote kind="warn">
              <b>Comparison:</b> no condition is compared. Set one to compared.
            </StatusNote>
          ) : twoWay ? (
            <StatusNote kind="info">
              <b>Factors:</b> {m.CMP.map(condLabel).join(' × ')}; every other condition matched like-for-like.
            </StatusNote>
          ) : (
            <StatusNote kind={controlKind(m)}>
              <b>Control:</b> {controlLine(m)}
            </StatusNote>
          )}
          {conf && (
            <StatusNote kind="warn">
              <b>Confounded:</b> the data have samples where {conf.conds.map(condLabel).join(' or ')} changes alone (e.g. {conf.example}), so the effects of {m.CMP.map(condLabel).join(' and ')} can’t be told apart.
            </StatusNote>
          )}
        </div>
      </Section>
      <Section title={`Preview (${nComparisons} ${twoWay ? 'interaction' : 'comparison'}${nComparisons === 1 ? '' : 's'})`} hint="What will run: one row per comparison." grid={false} shade>
        {any && (
          <div style={styles.formula}>
            {twoWay && m.CMP.length === 2
              ? `log₂ abundance ~ ${condLabel(m.CMP[0])} + ${condLabel(m.CMP[1])} + ${condLabel(m.CMP[0])} × ${condLabel(m.CMP[1])}`
              : `log₂ abundance ~ ${m.CMP.length === 1 ? condLabel(m.CMP[0]) : `group(${m.CMP.map(condLabel).join(' × ')})`}`}
            <div style={styles.formulaNote}>
              {twoWay ? 'Welch t-test on the interaction' : 'Welch t-test'}
              {!twoWay && own.length ? `, for each ${own.join(' × ')}` : ''}
            </div>
          </div>
        )}
        {twoWay
          ? twoWayView && twoWayView.rows.length > 0 && <PreviewTable columns={twoWayView.columns} rows={twoWayView.rows} />
          : slices.length > 0 && (
              <NodeTable
                columns={['test', '', 'control']}
                rows={slices.slice(0, 50).map((s) => [
                  <SideCell key="t" rows={s.grp} conds={active} units={units} />,
                  'vs',
                  <SideCell key="c" rows={s.denSlice} conds={active} units={units} />
                ])}
                more={slices.length - 50}
              />
            )}
        {!twoWay &&
          preview?.notes.map((n) => (
            <StatusNote key={n} kind="info">
              {n}
            </StatusNote>
          ))}
        {warnings.map((w) => (
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
  formulaNote: { fontFamily: 'inherit', color: UI.textMuted, fontWeight: 400, marginTop: 2, fontSize: 11 }
} as const
