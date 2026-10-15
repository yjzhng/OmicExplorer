/**
 * The Curve fit window: Model (model, axis, a surface's fit), Filter (each condition's values kept),
 * Baseline (picked with the dose × time grid's header chips; the grid only shows the result), Context
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

import {
  compareSlices,
  condLabel,
  previewCompare,
  type CompareInput,
  type ConditionKey,
  type DataShape,
  type StandardRow,
  type ThresholdConfig
} from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { ValueMultiSelect } from '../ui/ValueMultiSelect'
import { UI } from '../ui/theme'
import { cv, sampleRows, valuesOf } from './compareModel'
import { Section, SelectorShell, ValChip } from './condRows'
import {
  baselineLine,
  curveModel,
  defaultBaseline,
  readCurveState,
  type CurveState,
  type HeadChip
} from './curveModel'
import {
  CURVE_MODEL_OPTIONS,
  SURFACE_FIT_OPTIONS,
  curveAxisOptions,
  type CurveAxisPick
} from './curveSettings'
import { PreviewTable } from './selectorParts'
import { useGraph } from './store'
import { thresholdForDetection, type CompareConfig } from './types'

export function CurveDialog({
  id,
  rows,
  active,
  shape,
  initial,
  detection: initialDetection,
  onClose
}: {
  id: string
  /** Clean data's rows (gene × sample) */
  rows: StandardRow[]
  active: ConditionKey[]
  shape?: DataShape
  initial: Pick<
    CompareConfig,
    | 'num'
    | 'den'
    | 'match'
    | 'curveAxis'
    | 'surface'
    | 'surfaceDescription'
    | 'controlBackground'
    | 'detection'
  >
  /** the tile's model, for a fresh window */
  detection: 'spline' | '4pl'
  onClose: () => void
}): ReactNode {
  const update = useGraph((s) => s.updateConfig)
  const samples = useMemo(() => sampleRows(rows, active), [rows, active])
  const surfaceOk =
    active.includes('dose') && active.includes('time') && valuesOf(samples, 'time').length > 1
  const [state, setState] = useState<CurveState>(() =>
    readCurveState(
      { ...initial, detection: initial.detection ?? initialDetection },
      samples,
      active,
      {
        detection: initialDetection,
        axis:
          surfaceOk && (initial.surface ?? initialDetection === 'spline')
            ? 'surface'
            : initial.curveAxis === 'time'
              ? 'time'
              : 'dose'
      }
    )
  )
  const edit = (f: (s: CurveState) => void): void =>
    setState((s) => {
      const n: CurveState = {
        ...s,
        filter: { ...s.filter },
        drop: { ...s.drop },
        bDose: [...s.bDose],
        bTime: [...s.bTime]
      }
      f(n)
      return n
    })

  const m = useMemo(() => curveModel(state, samples, active), [state, samples, active])
  const input = useMemo<CompareInput>(
    () => ({
      rows: samples,
      num: m.num,
      den: m.den,
      match: m.match,
      activeConditions: active,
      curveAxis: m.refAx
    }),
    [m, samples, active]
  )
  const preview = useMemo(() => (m.picked ? previewCompare(input) : null), [m.picked, input])
  // the samples some curve uses: its group spans at least two axis levels above 0
  const used = useMemo(() => {
    const out = new Set<StandardRow>()
    if (!preview || preview.groups === 0) return out
    for (const s of compareSlices(input).slices) {
      const lv = new Set(s.grp.map((r) => cv(r, m.refAx)).filter((v) => Number(v) > 0))
      if (lv.size > 1 && s.denSlice.length) for (const r of s.grp) out.add(r)
    }
    return out
  }, [preview, input, m.refAx])
  const baseRows = useMemo(() => m.rows.filter(m.isBase), [m])
  const warnings = [...m.warnings, ...(preview?.warnings ?? [])]
  const canApply = m.picked && warnings.length === 0

  const apply = (): void => {
    const cur = (
      useGraph.getState().nodes.find((n) => n.id === id)?.data.config as
        { threshold?: ThresholdConfig } | undefined
    )?.threshold
    const next = cur ? thresholdForDetection(state.detection, cur, m.surface) : null
    update(id, {
      analysis: 'curve_fit',
      num: m.num,
      den: m.den,
      match: m.match,
      curveAxis: m.refAx,
      surface: surfaceOk ? m.surface : undefined,
      detection: state.detection,
      ...(m.surface ? { surfaceDescription: state.surfaceFit } : {}),
      // any baseline the user picks runs (a treated one too): no confirmation to store
      controlBackground: undefined,
      ...(next ? { threshold: next } : {})
    })
    onClose()
  }

  const pickAxis = (a: CurveAxisPick): void =>
    edit((s) => {
      s.axis = a
      Object.assign(s, defaultBaseline(samples, a === 'time' ? 'time' : 'dose'))
    })

  // ── Baseline grid ──
  // one width per chip set, the longest label's measured in the chip font: the grid's dose and time
  // chips (and its pills) share one; the Context chips another
  const minW = useMemo(
    () => chipWidth([...m.gx, ...m.gy.filter((y): y is string => y != null)]),
    [m]
  )
  const ctxW = useMemo(() => chipWidth(m.ctxConds.flatMap((c) => valuesOf(m.rows, c))), [m])
  // The grid's chip width: the one that fills the panel exactly — the time column's chip is that
  // width too, so the n dose columns and it share what's left after the fixed gaps and padding — or,
  // when that's below the labels' minimum, the minimum (and the panel scrolls).
  const [avail, setAvail] = useState(0)
  const nCols = m.gx.length + (m.hasTime ? 1 : 0)
  // The one axis left to pick a baseline on, when there's no second to make a grid: dose without
  // time, or time with dose filtered down to one value. Null when both vary.
  const oneAxis: 'dose' | 'time' | null = !m.hasTime ? 'dose' : m.gx.length <= 1 ? 'time' : null
  const fixed = COL_GAP + 2 * GAP + 2 + (m.gx.length - 1) * GAP
  const fitW = avail > 0 && nCols > 0 ? Math.floor((avail - fixed) / nCols) : 0
  const chipW = Math.max(minW, fitW)
  const track = `repeat(${m.gx.length}, ${chipW}px)`
  const headChip = (c: 'dose' | 'time', h: HeadChip, width = chipW): ReactNode => (
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
          const k = c === 'dose' ? 'bDose' : 'bTime'
          s[k] = h.on ? s[k].filter((x) => x !== h.v) : [...s[k], h.v]
        })
      }
    />
  )
  const cell = (x: string, y: string | null): ReactNode => {
    const at = m.rows.filter((r) => cv(r, 'dose') === x && (y == null || cv(r, 'time') === y))
    const kind = !at.length
      ? 'none'
      : at.some(m.isBase)
        ? 'base'
        : at.some((r) => used.has(r))
          ? 'point'
          : 'idle'
    const where = `${condLabel('dose')} ${x}${y == null ? '' : ` · ${condLabel('time')} ${y}`}`
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
        title={`${where}: ${what}${at.length ? ` — ${valuesOf(at, 'cmpd').join(', ')}` : ''}`}
      >
        <span style={{ ...styles.pill, width: chipW, ...PILL[kind] }}>
          {kind === 'point' ? '✓' : kind === 'none' ? '–' : ''}
        </span>
      </span>
    )
  }
  // The axis titles ride with their chips: dose's title and chips stick to the panel's top, time's
  // to its left, so both stay in view as the grid scrolls under them.
  const grid = (
    <div style={styles.ginner}>
      <span style={{ ...styles.sticky, gridArea: 'corner', top: 0, left: 0, zIndex: 3 }} />
      <div data-pin="top" style={{ ...styles.sticky, gridArea: 'cols', top: 0 }}>
        <div style={{ ...styles.cols, gridTemplateColumns: track }}>
          {m.doseChips.map((h) => (
            <span key={h.v} style={styles.head}>
              {headChip('dose', h)}
            </span>
          ))}
        </div>
      </div>
      <div
        data-pin="left"
        style={{ ...styles.sticky, ...styles.rowsHead, gridArea: 'rows', left: 0 }}
      >
        <div style={styles.rows}>
          {m.timeChips.map((h) => (
            <span key={h.v} style={styles.head}>
              {headChip('time', h)}
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
    const vs = valuesOf(m.rows, c)
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

  // a warning when the baseline isn't at the lowest dose / time (e.g. the top dose: an inverse fit)
  const notLowest = (['dose', 'time'] as const).some(
    (c) => m.pin[c] && m.pin[c]![0] !== valuesOf(m.rows, c)[0]
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
      const vs = valuesOf(g, c).filter((v) => Number(v) > 0)
      return vs.length ? `${vs.length} (${vs[0]}–${vs[vs.length - 1]})` : '—'
    }
    const startOf = (d: StandardRow[]): string =>
      (['dose', 'time'] as const)
        .filter((c) => m.conds.includes(c) && (c === 'dose' || m.hasTime))
        .map((c) => `${condLabel(c)} ${valuesOf(d, c).join(', ')}`)
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
          ...m.ctxConds.map((c) => valuesOf(g, c).join(', ')),
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
        ...facets.map((c) => valuesOf(sl.grp, c).join(', ')),
        span(sl.grp, m.refAx),
        startOf(sl.denSlice)
      ])
    return {
      columns: [...facets.map(condLabel), `${condLabel(m.refAx)}s`, 'starts from'],
      rows: rowsOut
    }
  }, [preview, input, m, used])
  // a surface spans every time: one per combination of the other conditions (compound, cell, …)
  // its points cover; a curve per preview group otherwise (each time its own curve on a dose axis)
  const nCurves = m.surface
    ? new Set([...used].map((r) => m.ctxConds.map((c) => cv(r, c) ?? '').join('\u0001'))).size
    : (preview?.groups ?? 0)
  const fit = SURFACE_FIT_OPTIONS.find((o) => o.value === state.surfaceFit)
  return (
    <SelectorShell
      title="Configure curve fit"
      canApply={canApply}
      onApply={apply}
      onClose={onClose}
    >
      <Section
        title="Model"
        hint="The curve model, and what each curve runs over: dose, time, or a dose × time surface."
      >
        <FieldRow name="model">
          <ToggleSwitch
            size="sm"
            label="Model"
            value={state.detection}
            options={CURVE_MODEL_OPTIONS}
            onChange={(v) => edit((s) => void (s.detection = v))}
          />
        </FieldRow>
        <FieldRow name="axis">
          <ToggleSwitch
            size="sm"
            label="Axis"
            value={m.surface ? 'surface' : m.refAx === 'time' ? 'time' : 'dose'}
            options={curveAxisOptions(shape, state.detection).map((o) => {
              const absent = o.value === 'surface' ? !surfaceOk : !active.includes(o.value)
              return {
                ...o,
                disabled: o.disabled || absent,
                title: absent && !o.disabled ? `No ${o.label} in the data` : o.title
              }
            })}
            onChange={pickAxis}
          />
        </FieldRow>
        <FieldRow name="fit">
          <ToggleSwitch
            size="sm"
            label="Surface fit"
            value={state.surfaceFit}
            disabled={!m.surface}
            options={SURFACE_FIT_OPTIONS.map((o) => ({
              ...o,
              title: m.surface ? o.title : 'Only for a dose × time surface'
            }))}
            onChange={(v) => edit((s) => void (s.surfaceFit = v))}
          />
        </FieldRow>
      </Section>

      {/* Filter (a quarter) beside Baseline (three quarters) */}
      <div style={styles.split}>
        <Section
          style={styles.noRule}
          title="Filter"
          hint="The values to fit. Filtered-out values are left out of the baseline grid, the curves and the preview."
        >
          {m.conds.map((c) => {
            const vs = valuesOf(samples, c)
            const out = new Set(state.filter[c] ?? [])
            return (
              <FieldRow key={c} name={condLabel(c)}>
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
              <span style={styles.chips}>
                {(oneAxis === 'dose' ? m.doseChips : m.timeChips).map((h) =>
                  headChip(oneAxis, h, minW)
                )}
              </span>
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
              <span style={{ ...styles.gtitle, gridArea: 'top' }}>{condLabel('dose')}</span>
              {m.hasTime && (
                <span style={{ ...styles.gtitle, gridArea: 'side', alignSelf: 'center' }}>
                  <span style={styles.vertical}>{condLabel('time')}</span>
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
            {!m.surface
              ? `log₂ ratio ~ ${state.detection === '4pl' ? '4PL' : 'spline'}(log₁₀ ${condLabel(m.refAx)})`
              : state.detection === 'spline'
                ? 'log₂ ratio ~ spline(log₁₀ dose, log₁₀ time)'
                : 'log₂ ratio ~ top(time) · 4PL(log₁₀ dose; mid(time))'}
            <div style={styles.formulaNote}>
              {state.detection === '4pl' && !m.surface
                ? 'vs flat, recalibrated F (CurveCurator)'
                : state.detection === 'spline'
                  ? 'vs flat, moderated F'
                  : 'vs flat, adjusted F'}
              {m.surface && fit ? `; described by ${fit.label}` : ''}
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
  fbody: { gridColumn: 2, display: 'flex', alignItems: 'center', minWidth: 0, padding: '3px 0' },
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
