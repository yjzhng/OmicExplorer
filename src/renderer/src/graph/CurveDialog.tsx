/**
 * The Curve fit window: Model (model, axis — any numeric condition, or dose × time — a surface's fit,
 * and the baseline's kind), Filter (each condition's values kept), Baseline (picked with the grid's
 * header chips — the curve's axis by its partner; the grid only shows the result), Context
 * (the other conditions' values, their curves left out by clicking), and the engine's own preview of
 * the config it compiles (curveModel). Baselines the engine can't run yet are disabled with the reason.
 */
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import {
  compareSlices,
  condLabel,
  DESCRIBE_Q,
  isNumericCond,
  numericConds,
  orderConds,
  previewCompare,
  type AxisScale,
  type CompareInput,
  type ConditionKey,
  type CustomConditionKey,
  type NumericConds,
  type DataShape,
  type StandardRow,
  type ThresholdConfig
} from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { ValueMultiSelect } from '../ui/ValueMultiSelect'
import { UI } from '../ui/theme'
import { POPOVER_PROPS, usePopover } from '../ui/usePopover'
import { cv, sampleRows, valuesOf } from './compareModel'
import { Section, SelectorShell, ValChip } from './condRows'
import { AxisModelRows } from './AxisModelRows'
import {
  detectionOf,
  driftFollowsBaselines,
  fitOf,
  jointWhy,
  SHAPE_LABEL,
  setFit
} from './axisFits'
import {
  baselineLine,
  curveModel,
  defaultBaseline,
  readCurveState,
  refAxisOf,
  scaleOf,
  type CurveState,
  type HeadChip
} from './curveModel'
import {
  CURVE_METHOD_OPTIONS,
  INTENT_OPTIONS,
  curveAxisOptions,
  readAxisValue,
  surfacePairs,
  surfaceValue
} from './curveSettings'
import { PreviewTable } from './selectorParts'
import { useGraph } from './store'
import { describesAll, thresholdForDetection, type CompareConfig } from './types'

export function CurveDialog({
  id,
  rows,
  active,
  numericConditions,
  shape,
  initial,
  detection: initialDetection,
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
    | 'num'
    | 'den'
    | 'match'
    | 'curveAxis'
    | 'surface'
    | 'surfaceDescription'
    | 'surfaceIntent'
    | 'responseAxis'
    | 'describeAll'
    | 'interpolation'
    | 'controlBackground'
    | 'detection'
    | 'curveMethod'
    | 'axisScale'
    | 'axisBaseline'
    | 'axisFits'
    | 'surfacePair'
  >
  /** the tile's model, for a fresh window */
  detection: 'spline' | '4pl'
  onClose: () => void
}): ReactNode {
  const update = useGraph((s) => s.updateConfig)
  const samples = useMemo(() => sampleRows(rows, active), [rows, active])
  const numeric = useMemo(() => numericConds(numericConditions), [numericConditions])
  // the surfaces the data can take: each pair of numeric conditions that both vary (dose × time
  // first); a fresh window opens on the first
  const varying = useMemo(
    () =>
      orderConds(active).filter(
        (c) => isNumericCond(c, numeric) && valuesOf(samples, c, numeric).length > 1
      ),
    [active, numeric, samples]
  )
  const pairs = useMemo(() => surfacePairs(varying), [varying])
  const pairOk = (p: readonly ConditionKey[]): boolean => p.every((c) => varying.includes(c))
  const surfaceOk = pairs.length > 0
  const [state, setState] = useState<CurveState>(() =>
    readCurveState(
      {
        ...initial,
        detection: initial.detection ?? initialDetection,
        surfacePair: initial.surfacePair ?? pairs[0]
      },
      samples,
      active,
      {
        detection: initialDetection,
        axis: surfaceOk && (initial.surface ?? true) ? 'surface' : (initial.curveAxis ?? 'dose')
      },
      numeric
    )
  )
  // the method: a preset of the models (Hybrid / 4PL), or custom — picked here, or by picking a
  // model the preset doesn't (as the tile panel's)
  const [custom, setCustom] = useState(initial.curveMethod === 'custom')
  // which genes get a description (unset: the default — see describesAll), and CurveCurator's
  // interpolation
  const [describeAll, setDescribeAll] = useState<boolean | undefined>(initial.describeAll)
  const [interpolation, setInterpolation] = useState(!!initial.interpolation)
  const method = custom ? 'custom' : state.detection === 'spline' ? 'hybrid' : '4pl'
  const edit = (f: (s: CurveState) => void): void =>
    setState((s) => {
      const n: CurveState = {
        ...s,
        filter: { ...s.filter },
        drop: { ...s.drop },
        base: { ...s.base },
        scales: { ...s.scales },
        baselines: { ...s.baselines },
        ...(s.fits ? { fits: { ...s.fits } } : null)
      }
      f(n)
      return n
    })

  const m = useMemo(
    () => curveModel(state, samples, active, numeric),
    [state, samples, active, numeric]
  )
  const input = useMemo<CompareInput>(
    () => ({
      rows: samples,
      num: m.num,
      den: m.den,
      match: m.match,
      activeConditions: active,
      numericConditions,
      curveAxis: m.refAx,
      axisScale: m.surface ? undefined : m.scale,
      axisBaseline: m.surface ? undefined : m.baseline
    }),
    [
      m.num,
      m.den,
      m.match,
      m.refAx,
      m.surface,
      m.scale,
      m.baseline,
      samples,
      active,
      numericConditions
    ]
  )
  const preview = useMemo(() => (m.picked ? previewCompare(input) : null), [m.picked, input])
  // the samples some curve uses: its group spans at least two axis levels above 0
  const used = useMemo(() => {
    const out = new Set<StandardRow>()
    if (!preview || preview.groups === 0) return out
    for (const s of compareSlices(input).slices) {
      const lv = new Set(
        s.grp
          .map((r) => cv(r, m.refAx))
          .filter((v) =>
            m.scale === 'log' || m.surface ? Number(v) > 0 : v !== '' && Number(v) !== 0
          )
      )
      if (lv.size > 1 && s.denSlice.length) for (const r of s.grp) out.add(r)
    }
    return out
  }, [preview, input, m.refAx, m.scale, m.surface])
  const baseRows = useMemo(() => m.rows.filter(m.isBase), [m])
  // the joint description needs a shape along every axis
  const jointBad =
    m.surface && state.intent === 'shape'
      ? jointWhy(
          m.axisConds.map(
            (_, i) =>
              fitOf(custom ? state.fits : undefined, m.axisConds, i, state.detection).describe
          ),
          m.axisConds
        )
      : null
  // testing changes runs only along an axis the user picked
  const axisMissing =
    m.surface &&
    state.intent === 'changes' &&
    !(state.responseAxis && m.axisConds.includes(state.responseAxis))
      ? 'Pick the axis the curves run along.'
      : null
  const warnings = [
    ...m.warnings,
    ...(preview?.warnings ?? []),
    ...(jointBad ? [jointBad] : []),
    ...(axisMissing ? [axisMissing] : [])
  ]
  const canApply = m.picked && warnings.length === 0

  const apply = (): void => {
    const cur = (
      useGraph.getState().nodes.find((n) => n.id === id)?.data.config as
        { threshold?: ThresholdConfig } | undefined
    )?.threshold
    // what the axes' detectors amount to (the run's path and its calls)
    const detection = custom
      ? detectionOf(state.fits, m.axisConds, state.detection)
      : state.detection
    const next = cur ? thresholdForDetection(detection, cur, m.surface) : null
    update(id, {
      analysis: 'curve_fit',
      num: m.num,
      den: m.den,
      match: m.match,
      curveAxis: m.refAx,
      surface: surfaceOk ? m.surface : undefined,
      surfacePair: m.surface ? (m.axisConds as [ConditionKey, ConditionKey]) : undefined,
      detection,
      curveMethod: custom ? 'custom' : undefined,
      describeAll,
      interpolation: interpolation || undefined,
      // a custom method's per-axis models; a preset's are its own
      axisFits: custom && state.fits && Object.keys(state.fits).length ? state.fits : undefined,
      // a surface: what it's for (the description follows), and — testing changes — the axis its
      // curves run along when set against the default
      ...(m.surface
        ? {
            surfaceIntent: state.intent,
            responseAxis: state.intent === 'changes' ? (response ?? undefined) : undefined,
            surfaceDescription: undefined
          }
        : {}),
      // only the scales the user set against the detection: the rest follow the data
      axisScale: Object.keys(state.scales ?? {}).length ? state.scales : undefined,
      // …and the baseline kinds set against an axis's preset
      axisBaseline: Object.keys(state.baselines ?? {}).length ? state.baselines : undefined,
      // any baseline the user picks runs (a treated one too): no confirmation to store
      controlBackground: undefined,
      ...(next ? { threshold: next } : {})
    })
    onClose()
  }

  const pickAxis = (v: string): void =>
    edit((s) => {
      const p = readAxisValue(v)
      s.axis = 'pair' in p ? 'surface' : p.axis
      if ('pair' in p) s.pair = p.pair
      Object.assign(s, defaultBaseline(samples, refAxisOf(s.axis, s.pair), numeric))
    })

  // ── Baseline grid ──
  // one width per chip set, the longest label's measured in the chip font: the grid's two chip sets
  // (and its pills) share one; the Context chips another
  const minW = useMemo(
    () => chipWidth([...m.gx, ...m.gy.filter((y): y is string => y != null)]),
    [m]
  )
  const ctxW = useMemo(
    () => chipWidth(m.ctxConds.flatMap((c) => valuesOf(m.rows, c, numeric))),
    [m, numeric]
  )
  // The grid's chip width: the one that fills the panel exactly — the row headers' chip is that
  // width too, so the n columns and it share what's left after the fixed gaps and padding — or,
  // when that's below the labels' minimum, the minimum (and the panel scrolls).
  const [avail, setAvail] = useState(0)
  const nCols = m.gx.length + (m.yCond ? 1 : 0)
  // The one axis left to pick a baseline on, when there's no partner to make a grid. Null when both
  // vary.
  const oneAxis: ConditionKey | null = m.partner ? null : m.refAx
  const fixed = COL_GAP + 2 * GAP + 2 + (m.gx.length - 1) * GAP
  const fitW = avail > 0 && nCols > 0 ? Math.floor((avail - fixed) / nCols) : 0
  const chipW = Math.max(minW, fitW)
  const track = `repeat(${m.gx.length}, ${chipW}px)`
  const headChip = (c: ConditionKey, h: HeadChip, width = chipW): ReactNode => (
    <ValChip
      key={h.v}
      label={h.v}
      look={h.on ? 'on' : 'plain'}
      width={width}
      disabled={!!h.why}
      title={
        h.on
          ? `${condLabel(c)} ${h.v} is the baseline. Click to clear`
          : (h.why ?? `Make ${condLabel(c)} ${h.v} the baseline`)
      }
      onClick={() =>
        edit((s) => {
          const cur = s.base[c] ?? []
          s.base[c] = h.on ? cur.filter((x) => x !== h.v) : [...cur, h.v]
        })
      }
    />
  )
  const cell = (x: string, y: string | null): ReactNode => {
    const at = m.rows.filter(
      (r) => cv(r, m.xCond) === x && (y == null || !m.yCond || cv(r, m.yCond) === y)
    )
    const kind = !at.length
      ? 'none'
      : at.some(m.isBase)
        ? 'base'
        : at.some((r) => used.has(r))
          ? 'point'
          : 'idle'
    const where = `${condLabel(m.xCond)} ${x}${y == null || !m.yCond ? '' : ` · ${condLabel(m.yCond)} ${y}`}`
    const what = {
      base: 'the baseline',
      point: 'a curve point',
      idle: 'not on any curve',
      none: 'no samples'
    }[kind]
    return (
      <span
        key={`${x}|${y}`}
        style={styles.pos}
        title={`${where}: ${what}${at.length ? ` — ${valuesOf(at, 'cmpd', numeric).join(', ')}` : ''}`}
      >
        <span style={{ ...styles.pill, width: chipW, ...PILL[kind] }}>
          {kind === 'point' ? '✓' : kind === 'none' ? '–' : ''}
        </span>
      </span>
    )
  }
  // The axis titles ride with their chips: the across condition's title and chips stick to the
  // panel's top, the down one's to its left, so both stay in view as the grid scrolls under them.
  const grid = (
    <div style={styles.ginner}>
      <span style={{ ...styles.sticky, gridArea: 'corner', top: 0, left: 0, zIndex: 3 }} />
      <div data-pin="top" style={{ ...styles.sticky, gridArea: 'cols', top: 0 }}>
        <div style={{ ...styles.cols, gridTemplateColumns: track }}>
          {m.xChips.map((h) => (
            <span key={h.v} style={styles.head}>
              {headChip(m.xCond, h)}
            </span>
          ))}
        </div>
      </div>
      <div
        data-pin="left"
        style={{ ...styles.sticky, ...styles.rowsHead, gridArea: 'rows', left: 0 }}
      >
        <div style={styles.rows}>
          {m.yCond &&
            m.yChips.map((h) => (
              <span key={h.v} style={styles.head}>
                {headChip(m.yCond!, h)}
              </span>
            ))}
        </div>
      </div>
      <div
        style={{ ...styles.box, gridArea: 'box', gridTemplateColumns: track }}
        role="img"
        aria-label="Baseline grid: which positions are the baseline"
      >
        {m.gy.map((y) => m.gx.map((x) => cell(x, y)))}
      </div>
    </div>
  )

  // ── Context chips ──
  const ctxRow = (c: ConditionKey): ReactNode => {
    const vs = valuesOf(m.rows, c, numeric)
    const drop = new Set(state.drop[c] ?? [])
    return (
      <FieldRow key={c} name={condLabel(c)}>
        {vs.length < 2 ? (
          <span style={styles.single}>{vs[0]}</span>
        ) : (
          <span style={styles.chips}>
            {vs.map((v) => {
              const mine = m.rows.filter((r) => cv(r, c) === v)
              const why =
                !m.picked || drop.has(v)
                  ? null
                  : mine.every(m.isBase)
                    ? `${v} is only in the baseline: no curve`
                    : !mine.some((r) => used.has(r))
                      ? `${v} has one ${condLabel(m.refAx)} level only here: no curve`
                      : null
              return (
                <ValChip
                  key={v}
                  label={v}
                  // struck through only when left out; a value with no curve is just disabled
                  look={drop.has(v) ? 'out' : why ? 'plain' : 'matched'}
                  width={ctxW}
                  disabled={!!why}
                  title={
                    why ??
                    (drop.has(v)
                      ? 'Left out. Click to include'
                      : 'Matched. Click to leave its curves out')
                  }
                  onClick={
                    why
                      ? undefined
                      : () =>
                          edit(
                            (s) =>
                              void (s.drop[c] = drop.has(v)
                                ? [...drop].filter((x) => x !== v)
                                : [...drop, v])
                          )
                  }
                />
              )
            })}
          </span>
        )}
      </FieldRow>
    )
  }

  // a warning when the baseline isn't at the lowest level (e.g. the top dose: an inverse fit)
  const notLowest = (Object.keys(m.pin) as ConditionKey[]).some(
    (c) => m.pin[c]![0] !== valuesOf(m.rows, c, numeric)[0]
  )
  const fitLine =
    m.picked && preview ? (
      <div style={{ gridColumn: '1 / -1', paddingTop: 6 }}>
        <StatusNote kind={notLowest ? 'warn' : 'info'}>
          <b>Fit:</b> {baselineLine(m, baseRows, preview.matched)}
        </StatusNote>
      </div>
    ) : null
  const pooledOrNone = !m.picked
  // The preview table, alike in every mode: a row per curve (or surface) — its conditions, the
  // levels it spans, and where it starts.
  const curveTable = useMemo(() => {
    if (!preview || preview.groups === 0) return null
    const span = (g: StandardRow[], c: ConditionKey): string => {
      const vs = valuesOf(g, c, numeric).filter((v) => Number(v) > 0)
      return vs.length ? `${vs.length} (${vs[0]}–${vs[vs.length - 1]})` : '—'
    }
    const startOf = (d: StandardRow[]): string =>
      [m.refAx, ...(m.partner ? [m.partner] : [])]
        .map((c) => `${condLabel(c)} ${valuesOf(d, c, numeric).join(', ')}`)
        .join(' · ')
    if (m.surface) {
      const groups = new Map<string, StandardRow[]>()
      for (const r of used) {
        const k = m.ctxConds.map((c) => cv(r, c) ?? '').join('\u0001')
        const g = groups.get(k)
        if (g) g.push(r)
        else groups.set(k, [r])
      }
      return {
        columns: [
          ...m.ctxConds.map(condLabel),
          `${condLabel('dose')}s`,
          `${condLabel('time')}s`,
          'starts from'
        ],
        rows: [...groups.values()].map((g) => [
          ...m.ctxConds.map((c) => valuesOf(g, c, numeric).join(', ')),
          span(g, 'dose'),
          span(g, 'time'),
          m.pin.dose ? `${condLabel('dose')} ${m.pin.dose[0]}, each ${condLabel('time')}` : ''
        ])
      }
    }
    // one row per curve, by its context conditions (time beside a dose axis among them)
    const facets = m.ctxConds
    const rowsOut = compareSlices(input)
      .slices.filter((sl) => sl.denSlice.length && sl.grp.some((r) => used.has(r)))
      .map((sl) => [
        ...facets.map((c) => valuesOf(sl.grp, c, numeric).join(', ')),
        span(sl.grp, m.refAx),
        startOf(sl.denSlice)
      ])
    return {
      columns: [...facets.map(condLabel), `${condLabel(m.refAx)}s`, 'starts from'],
      rows: rowsOut
    }
  }, [preview, input, m, used, numeric])
  // a surface spans every time: one per combination of the other conditions (compound, cell, …)
  // its points cover; a curve per preview group otherwise (each time its own curve on a dose axis)
  const nCurves = m.surface
    ? new Set([...used].map((r) => m.ctxConds.map((c) => cv(r, c) ?? '').join('\u0001'))).size
    : (preview?.groups ?? 0)
  // testing changes: the axis the curves run along — the user's pick (none until then)
  const pairAxes = m.axisConds as [ConditionKey, ConditionKey]
  const response =
    m.surface && state.responseAxis && pairAxes.includes(state.responseAxis)
      ? state.responseAxis
      : null
  const across = response ? pairAxes.find((a) => a !== response)! : null
  // what runs, in one line: each axis's detector shape over its own x
  const detects = m.axisConds.map(
    (_, i) => fitOf(custom ? state.fits : undefined, m.axisConds, i, state.detection).detect
  )
  const xName = (a: ConditionKey): string =>
    `${scaleOf(valuesOf(m.rows, a, numeric), state.scales?.[a]).scale === 'log' ? 'log₁₀ ' : ''}${condLabel(a)}`
  const formula = !m.surface
    ? `log₂ ratio ~ ${SHAPE_LABEL[detects[0]]}(${xName(m.refAx)})`
    : detects.includes('4pl')
      ? `log₂ ratio ~ A · ${m.axisConds.map((a, i) => `${SHAPE_LABEL[detects[i]]}(${xName(a)})`).join(' · ')}`
      : `log₂ ratio ~ ${m.axisConds.map((a, i) => `${SHAPE_LABEL[detects[i]]}(${xName(a)})`).join(' ⊗ ')}`
  return (
    <SelectorShell
      title="Configure curve fit"
      canApply={canApply}
      onApply={apply}
      onClose={onClose}
    >
      <Section
        title="Model"
        hint="The method (a preset of the detector and descriptor models, or custom), what each curve runs over (dose × time, or one numeric condition), and what its baseline is to it."
      >
        <FieldRow name="method">
          <ToggleSwitch
            size="sm"
            label="Method"
            value={method}
            options={CURVE_METHOD_OPTIONS}
            onChange={(v) => {
              setCustom(v === 'custom')
              if (v !== 'custom')
                edit((s) => void (s.detection = v === 'hybrid' ? 'spline' : '4pl'))
            }}
          />
        </FieldRow>
        <FieldRow name="axis">
          <ToggleSwitch
            size="sm"
            label="Axis"
            value={m.surface ? surfaceValue(m.axisConds as [ConditionKey, ConditionKey]) : m.refAx}
            // the surfaces first, as the tile panel orders them
            options={[...curveAxisOptions(shape, state.detection)]
              .sort(
                (a, b) =>
                  Number(b.value.startsWith('surface:')) - Number(a.value.startsWith('surface:'))
              )
              .map((o) => {
                const p = readAxisValue(o.value)
                const absent = 'pair' in p ? !pairOk(p.pair) : !active.includes(p.axis)
                return {
                  ...o,
                  disabled: o.disabled || absent,
                  title: absent && !o.disabled ? `No ${o.label} in the data` : o.title
                }
              })}
            onChange={pickAxis}
          />
        </FieldRow>
        <FieldRow name="intent">
          <ToggleSwitch
            size="sm"
            label="What the fit is for"
            value={state.intent}
            disabled={!m.surface}
            options={INTENT_OPTIONS.map((o) => ({
              ...o,
              title: m.surface ? o.title : 'Only for a surface (two axes)'
            }))}
            onChange={(v) => v !== state.intent && edit((s) => void (s.intent = v))}
          />
        </FieldRow>
        {m.surface && state.intent === 'changes' && (
          <FieldRow name="axis">
            <ToggleSwitch
              size="sm"
              label="The axis the curves run along"
              value={response ?? ''}
              options={pairAxes.map((a) => ({
                value: a,
                label: condLabel(a),
                title: `${condLabel(a)} curves at each ${condLabel(pairAxes.find((b) => b !== a)!)} level, compared across them`
              }))}
              onChange={(v) => v && edit((s) => void (s.responseAxis = v))}
            />
          </FieldRow>
        )}
        {/* Each axis's models — detector, descriptor, what its baseline is to it and (a surface)
            its 4PL midpoint's drift: the method preset's, faded, until one is picked (then the
            method is custom). */}
        <FieldRow name="models">
          <AxisModelRows
            axes={m.axisConds}
            surface={m.surface}
            detection={state.detection}
            fits={custom ? state.fits : undefined}
            baselines={state.baselines}
            locked={!custom}
            joint={m.surface && state.intent === 'shape'}
            onFit={(i, field, value) => {
              setCustom(true)
              edit((s) => {
                // under a preset the axes' models were its own: they start from there
                s.fits = setFit(
                  custom ? s.fits : undefined,
                  m.axisConds,
                  i,
                  field,
                  value,
                  s.detection,
                  s.baselines
                )
              })
            }}
            onBaseline={(a, v) =>
              edit((s) => {
                const b = (s.baselines ??= {})
                if (v == null) delete b[a]
                else b[a] = v
                s.fits = driftFollowsBaselines(s.fits, m.axisConds)
              })
            }
          />
        </FieldRow>
        {/* Which genes get a description (EC50, top): every one, or the responders only. */}
        <FieldRow name="description for">
          <ToggleSwitch
            size="sm"
            label="Description for"
            value={
              describesAll({ describeAll, detection: state.detection }, m.surface)
                ? 'all'
                : 'responders'
            }
            options={[
              {
                value: 'all',
                label: 'every gene',
                title:
                  'Every gene gets an EC50 (e.g. to contrast pEC50) — slower with a separate descriptor, and a flat curve’s EC50 means little'
              },
              {
                value: 'responders',
                label: 'responders only',
                title: `The genes within q ≤ ${DESCRIBE_Q}: their EC50s describe real curves; the rest are drawn flat`
              }
            ]}
            onChange={(v) => setDescribeAll(v === 'all')}
          />
        </FieldRow>
        {/* CurveCurator's interpolation, for every model and axis. */}
        <FieldRow name="interpolation">
          <span title="Adapted from CurveCurator: a data point midway between adjacent levels (a grid cell's centre on a surface), a straight line across the gap, to steer 4PL fits smooth. Tests and R² use the measured data only.">
            <OnOffSwitch on={interpolation} label="Interpolation" onChange={setInterpolation} />
          </span>
        </FieldRow>
        {jointBad && (
          <div style={{ gridColumn: '1 / -1' }}>
            <StatusNote kind="warn">{jointBad}</StatusNote>
          </div>
        )}
      </Section>

      {/* Filter (a quarter) beside Baseline (three quarters) */}
      <div style={styles.split}>
        <Section
          style={styles.noRule}
          title="Filter"
          hint="The values to fit. Filtered-out values are left out of the baseline grid, the curves and the preview."
        >
          {m.conds.map((c) => {
            const vs = valuesOf(samples, c, numeric)
            const out = new Set(state.filter[c] ?? [])
            return (
              <FieldRow key={c} name={condLabel(c)}>
                <TypeChip
                  numeric={numeric}
                  cond={c}
                  levels={valuesOf(m.rows, c, numeric)}
                  set={state.scales?.[c]}
                  surface={m.surface}
                  onSet={(v) =>
                    edit((s) => {
                      const sc = (s.scales ??= {})
                      if (v) sc[c] = v
                      else delete sc[c]
                    })
                  }
                />
                {vs.length < 2 ? (
                  <span style={styles.single}>{vs[0]}</span>
                ) : (
                  <ValueMultiSelect
                    values={vs}
                    selected={out.size ? vs.filter((v) => !out.has(v)) : []}
                    noun={condLabel(c)}
                    onChange={(kept) =>
                      edit(
                        (s) =>
                          void (s.filter[c] = kept.length
                            ? vs.filter((v) => !kept.includes(v))
                            : [])
                      )
                    }
                  />
                )}
              </FieldRow>
            )
          })}
        </Section>
        {/* One axis — no time, or dose or time filtered down to a single value: no grid to read,
            so the baseline is a condition row of chips, as in the other windows. */}
        {oneAxis ? (
          <Section
            style={{ ...styles.noRule, ...styles.rightCol }}
            title="Baseline"
            aside={
              <StatusNote kind="info" inline style={styles.headTip}>
                Select a condition value as the baseline
              </StatusNote>
            }
          >
            <FieldRow name={condLabel(oneAxis)}>
              <span style={styles.chips}>{m.xChips.map((h) => headChip(oneAxis, h, minW))}</span>
            </FieldRow>
          </Section>
        ) : (
          <Section
            style={{ ...styles.noRule, ...styles.rightCol }}
            title="Baseline"
            aside={
              <StatusNote kind="info" inline style={styles.headTip}>
                Select a condition group as the baseline
              </StatusNote>
            }
            grid={false}
          >
            {/* the heading and its tip stay; the grid scrolls (both ways) beneath them */}
            {/* the axis titles sit outside the scroll box, centred on what's visible, not on the grid */}
            <div style={styles.gframe}>
              <span style={{ ...styles.gtitle, gridArea: 'top' }}>{condLabel(m.xCond)}</span>
              {m.yCond && (
                <span style={{ ...styles.gtitle, gridArea: 'side', alignSelf: 'center' }}>
                  <span style={styles.vertical}>{condLabel(m.yCond)}</span>
                </span>
              )}
              <div style={{ gridArea: 'scroll', minWidth: 0 }}>
                <FadeScroll maxHeight={240} onWidth={setAvail}>
                  {grid}
                </FadeScroll>
              </div>
            </div>
          </Section>
        )}
      </div>

      {m.ctxConds.length > 0 && (
        <Section
          title="Context"
          hint="The other conditions: one curve per combination of their values, each matched to the baseline where it has that value. Click a value to leave its curves out."
        >
          {m.ctxConds.map(ctxRow)}
          {fitLine}
        </Section>
      )}
      {m.ctxConds.length === 0 && fitLine && <div style={styles.fitAlone}>{fitLine}</div>}

      <Section
        title={`Preview (${nCurves} ${m.surface ? 'surface' : 'curve'}${nCurves === 1 ? '' : 's'})`}
        hint="What will run."
        grid={false}
        shade
      >
        {!pooledOrNone && (
          <div style={styles.formula}>
            {/* one scale throughout: log₂ ratio to the baseline (4PL fits it as the ratio, CurveCurator's way) */}
            {formula}
            <div style={styles.formulaNote}>
              {!detects.includes('4pl')
                ? 'vs flat, moderated F'
                : m.surface
                  ? 'vs flat, adjusted F'
                  : 'vs flat, recalibrated F (CurveCurator)'}
              {m.surface
                ? state.intent === 'changes'
                  ? response
                    ? `; ${condLabel(response)} curves compared across ${condLabel(across!)}, described by how they differ`
                    : '; pick the axis the curves run along'
                  : '; described by one joint model'
                : ''}
            </div>
          </div>
        )}
        {curveTable && curveTable.rows.length > 0 && (
          <PreviewTable columns={curveTable.columns} rows={curveTable.rows} />
        )}
        {preview?.notes.map((t) => (
          <StatusNote key={t} kind="info">
            {t}
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

/** The width a chip needs for the longest of `labels` (600 11px, 4px padding each side, 1px borders),
 *  at least 28px, at most 160px. */
function chipWidth(labels: string[]): number {
  const ctx = document.createElement('canvas').getContext('2d')
  let w = 0
  if (ctx) {
    ctx.font = `600 11px ${getComputedStyle(document.body).fontFamily}`
    for (const l of labels) w = Math.max(w, ctx.measureText(l).width)
  } else w = Math.max(0, ...labels.map((l) => l.length)) * 6.5
  return Math.min(160, Math.max(28, Math.ceil(w) + 10))
}

/** A scroll box (both ways) that fades an edge while more is scrolled out of view past it, as the
 *  data table does; the top / left fades start past the pinned header chips (`data-pin`). */
function FadeScroll({
  maxHeight,
  onWidth,
  children
}: {
  maxHeight: number
  /** the box's inner width (less any scrollbar), as it changes */
  onWidth?: (w: number) => void
  children: ReactNode
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [f, setF] = useState({
    top: false,
    bottom: false,
    left: false,
    right: false,
    headH: 0,
    headW: 0,
    barX: 0,
    barY: 0
  })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const top = el.querySelector<HTMLElement>('[data-pin="top"]')
    const left = el.querySelector<HTMLElement>('[data-pin="left"]')
    const next = {
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
      headH: top?.offsetHeight ?? 0,
      headW: left?.offsetWidth ?? 0,
      barX: Math.max(0, el.offsetHeight - el.clientHeight),
      barY: Math.max(0, el.offsetWidth - el.clientWidth)
    }
    setF((p) =>
      (Object.keys(next) as Array<keyof typeof next>).every((k) => p[k] === next[k]) ? p : next
    )
    onWidth?.(el.clientWidth)
  }, [onWidth])
  useLayoutEffect(() => {
    update()
    const ro = new ResizeObserver(update)
    if (ref.current) {
      ro.observe(ref.current)
      if (ref.current.firstElementChild) ro.observe(ref.current.firstElementChild)
    }
    return () => ro.disconnect()
  }, [update])
  return (
    <div style={{ position: 'relative', minWidth: 0 }}>
      <div ref={ref} onScroll={update} style={{ overflow: 'auto', maxHeight, minWidth: 0 }}>
        {children}
      </div>
      {f.top && (
        <div
          style={{ ...styles.fade, ...styles.fadeTop, top: f.headH, left: f.headW, right: f.barY }}
        />
      )}
      {f.bottom && (
        <div
          style={{
            ...styles.fade,
            ...styles.fadeBottom,
            bottom: f.barX,
            left: f.headW,
            right: f.barY
          }}
        />
      )}
      {f.left && (
        <div
          style={{
            ...styles.fadeV,
            ...styles.fadeLeft,
            left: f.headW,
            top: f.headH,
            bottom: f.barX
          }}
        />
      )}
      {f.right && (
        <div
          style={{
            ...styles.fadeV,
            ...styles.fadeRight,
            right: f.barY,
            top: f.headH,
            bottom: f.barX
          }}
        />
      )}
    </div>
  )
}

/** A compact settings row in a section's name | body grid: its name, then its control. */
/** A condition's variable type, beside its name in the Filter: "cat" (categorical — fixed, set at
 *  import) or, for a numeric one, its scale — "log" / "lin" — detected from its kept
 *  levels' spacing (scaleOf), and a dropdown to override it. A surface fits log on both axes, so
 *  there the scale is shown but can't be changed. */
function TypeChip({
  numeric,
  cond,
  levels,
  set,
  surface,
  onSet
}: {
  /** the dataset's numeric conditions (its schema) */
  numeric: NumericConds
  cond: ConditionKey
  levels: string[]
  set: AxisScale | undefined
  surface: boolean
  /** the scale picked (undefined: back to the detected one) */
  onSet: (v: AxisScale | undefined) => void
}): ReactNode {
  const { open, setOpen, toggle, rect, btnRef, menuRef } = usePopover()
  if (!isNumericCond(cond, numeric))
    return (
      <span style={styles.typeChip} title="Categorical: its values are labels, not a scale">
        cat
      </span>
    )
  const { scale, guess } = scaleOf(levels, set)
  const shown: AxisScale = surface ? 'log' : scale
  const label = (v: AxisScale): string => (v === 'log' ? 'log' : 'lin')
  const note = surface
    ? 'A dose × time surface fits log on both axes.'
    : guess.scale
      ? `Detected ${guess.scale}: ${guess.why}.`
      : `Can't tell (${guess.why}): linear unless set.`
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        disabled={surface}
        title={`Numeric, on a ${shown} scale. ${note}${set ? ' Set here.' : ''}`}
        style={{
          ...styles.typeChip,
          cursor: surface ? 'default' : 'pointer',
          ...(set ? { color: UI.text, borderColor: UI.accent } : null)
        }}
      >
        {label(shown)} ▾
      </button>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            {...POPOVER_PROPS}
            style={{ ...styles.typeMenu, left: rect.left, top: rect.bottom + 4 }}
          >
            {(['log', 'linear'] as const).map((v) => (
              <button
                key={v}
                type="button"
                style={{ ...styles.typeItem, ...(v === scale ? { fontWeight: 700 } : null) }}
                onClick={() => {
                  // back on the detected scale: no override, so it keeps following the data
                  onSet(v === (guess.scale ?? 'linear') ? undefined : v)
                  setOpen(false)
                }}
              >
                {label(v)}
                {v === guess.scale ? ' (detected)' : ''}
              </button>
            ))}
            <div style={styles.typeNote}>{note}</div>
          </div>,
          document.body
        )}
    </>
  )
}

function FieldRow({ name, children }: { name: string; children: ReactNode }): ReactNode {
  return (
    <>
      <span style={styles.fname}>{name}</span>
      <span style={styles.fbody}>{children}</span>
    </>
  )
}

const GAP = 8
/** between the time chips and the grid box */
const COL_GAP = 6
const PILL: Record<'base' | 'point' | 'idle' | 'none', CSSProperties> = {
  base: { background: UI.accent, borderColor: UI.accent },
  point: { background: 'rgba(63,174,90,0.16)', borderColor: UI.ok, color: UI.ok },
  idle: {},
  none: { borderStyle: 'dashed', color: UI.border }
}
const styles: Record<string, CSSProperties> = {
  fname: {
    gridColumn: 1,
    fontSize: 12,
    fontWeight: 600,
    color: UI.text,
    alignSelf: 'center',
    padding: '3px 0'
  },
  fbody: {
    gridColumn: 2,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    padding: '3px 0'
  },
  typeChip: {
    flex: 'none',
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '14px',
    padding: '1px 6px',
    borderRadius: 9,
    border: `1px solid ${UI.border}`,
    background: 'transparent',
    color: UI.textMuted,
    whiteSpace: 'nowrap'
  },
  typeMenu: {
    position: 'fixed',
    zIndex: 4100,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
    padding: 4,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 150
  },
  typeItem: {
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: UI.text,
    fontSize: 12,
    textAlign: 'left',
    padding: '4px 8px',
    cursor: 'pointer'
  },
  typeNote: { fontSize: 11, color: UI.textMuted, padding: '4px 8px 2px', maxWidth: 220 },
  single: { fontSize: 12, color: UI.textMuted },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  // the grid: its chips stuck top / left as it scrolls; the axis titles outside, around the box
  gframe: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gridTemplateAreas: '". top" "side scroll"',
    columnGap: 10,
    rowGap: 8,
    minWidth: 0
  },
  gtitle: { fontSize: 13, fontWeight: 700, color: UI.text, textAlign: 'center', paddingBottom: 2 },
  vertical: { display: 'inline-block', writingMode: 'vertical-rl', transform: 'rotate(180deg)' },
  // as wide as the column (tracks grow), never narrower than the chips (then it scrolls)
  ginner: {
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    gridTemplateAreas: '"corner cols" "rows box"',
    columnGap: COL_GAP,
    rowGap: 4,
    width: 'max-content'
  },
  sticky: { position: 'sticky', zIndex: 2, background: UI.panel },
  cols: { display: 'grid', columnGap: GAP, padding: `0 ${GAP + 1}px` },
  rowsHead: { display: 'flex' },
  rows: {
    display: 'grid',
    gridAutoRows: 22,
    rowGap: GAP,
    padding: `${GAP + 1}px 0`,
    alignContent: 'start'
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
  // the positions show the result, they aren't controls: the box's contents take the disabled look
  box: {
    display: 'grid',
    gridAutoRows: 22,
    gap: GAP,
    padding: GAP,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    background: UI.panelAlt
  },
  pos: { display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: UI.border,
    background: UI.bg,
    fontSize: 12,
    fontWeight: 600,
    verticalAlign: 'middle'
  },
  split: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 3fr)',
    borderTop: `1px solid ${UI.border}`
  },
  noRule: { borderTop: 'none' },
  rightCol: { borderLeft: `1px solid ${UI.border}`, minWidth: 0 },
  headTip: { marginLeft: 6 },
  fade: { position: 'absolute', height: 18, pointerEvents: 'none', zIndex: 4 },
  fadeV: { position: 'absolute', width: 18, pointerEvents: 'none', zIndex: 4 },
  fadeTop: { background: `linear-gradient(to bottom, ${UI.panel}, transparent)` },
  fadeBottom: { background: `linear-gradient(to top, ${UI.panel}, transparent)` },
  fadeLeft: { background: `linear-gradient(to right, ${UI.panel}, transparent)` },
  fadeRight: { background: `linear-gradient(to left, ${UI.panel}, transparent)` },
  fitAlone: { padding: '0 16px 12px' },
  formula: { fontSize: 12, color: UI.text, fontFamily: 'ui-monospace, monospace' },
  formulaNote: {
    fontFamily: 'inherit',
    color: UI.textMuted,
    fontWeight: 400,
    marginTop: 2,
    fontSize: 11
  }
}
