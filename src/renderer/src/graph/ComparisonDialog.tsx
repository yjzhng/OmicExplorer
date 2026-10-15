/**
 * Interactive comparison builder — Compare (t-test / 2-way ANOVA), Curve fit and Contrast share one
 * way of defining what's compared: every condition is a row with its values picked explicitly on
 * BOTH sides (SideRows). Where the sides' picks differ, the condition is compared (one for a t-test
 * or a curve, two for 2-way ANOVA, any for a contrast); where they're the same it's context, matched
 * like-for-like or pooled by the row's switch. A live preview (the comparisons that will run + any
 * warnings) sits beneath. Mirrors the engine's `previewCompare`.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  crossPairs,
  previewCompare,
  previewContrastPair,
  previewTwoWay,
  analysisUnmet,
  condLabel,
  condsIn,
  condValue,
  type DataShape,
  orderConds,
  isNumericCond,
  type CondSelector,
  type ConditionKey,
  type PairFix,
  type ThresholdConfig,
  type StandardRow
} from '../engine'
import { DOCKED_CARD, DOCKED_WRAP, useDialogDock } from './dialogDock'
import { useGraph } from './store'
import { thresholdForAnalysis, thresholdForDetection, type ContrastConfig } from './types'
import {
  CURVE_MODEL_OPTIONS,
  SURFACE_FIT_OPTIONS,
  curveAxisOptions,
  type CurveModel,
  type SurfaceFit
} from './curveSettings'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { StatusNote } from '../ui/StatusNote'
import type { ChipItem } from './ChipSet'
import { SideRows, type RowRole, type SideRow } from './SideRows'
import { picksOf, readSides, type Picks, type SideKey } from './sides'
import { PreviewTable, selectorStyles } from './selectorParts'
import { pairSides, selectorRowsOf, toContrastSide } from './contrastPair'
import { DatasetPick, PairContrastBody, type PairInput } from './PairContrastDialog'
import { useUiTheme } from '../ui/useUiTheme'

/** The two steps that share this window: Compare (t-test / two-way) and Contrast (divergence). */
export type SelectVariant = 'compare' | 'contrast'
export type ContrastSource = 'select' | 'pair'

type Analysis = 'compare' | 'two_way_anova' | 'curve_fit'
/** The curve-axis switch's dose × time entry (not a condition key). */
const SURFACE = '\u0000surface'

type Side = 'num' | 'den'

type Combo = Record<ConditionKey, string>

/** Distinct condition-tuples ('' = absent) from the upstream table — the small "sample space"
 *  the value chips are derived from (far smaller than the gene×sample rows). */
function combosOf(rows: StandardRow[]): Combo[] {
  const seen = new Set<string>()
  const out: Combo[] = []
  // Every condition the rows carry, custom ones included — a combo that left one out would merge
  // distinct sample groups and hide their values from the chips below.
  const conds = condsIn(rows)
  for (const r of rows) {
    const rec = {} as Combo
    for (const c of conds) {
      const v = condValue(r, c)
      rec[c] = v == null || v === '' ? '' : String(v)
    }
    const key = conds.map((c) => rec[c]).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(rec)
  }
  return out
}

/** Does a row satisfy every pinned condition of a side's selector (unpinned conditions are free)? */
function rowMatchesSel(
  r: Record<ConditionKey, unknown>,
  sel: CondSelector,
  active: ConditionKey[]
): boolean {
  return active.every((c) => {
    const want = sel[c]
    if (!want || want.length === 0) return true
    const v = condValue(r as never, c)
    return v != null && v !== '' && want.map(String).includes(String(v))
  })
}

const pinnedOn = (sel: CondSelector, c: ConditionKey): boolean => (sel[c]?.length ?? 0) > 0
const sameSetOf = (x?: string[], y?: string[]): boolean => {
  const a = new Set((x ?? []).map(String))
  const b = new Set((y ?? []).map(String))
  return a.size === b.size && [...a].every((v) => b.has(v))
}

/** Contrast preview: split the rows into the two explicit selections, join on the match context,
 *  and report how many genes pair per context group (the Contrast analogue of `previewCompare`). */
function previewContrast(
  rows: StandardRow[],
  num: CondSelector,
  den: CondSelector,
  match: ConditionKey[],
  active: ConditionKey[],
  axis: ConditionKey[]
): {
  groups: number
  columns: string[]
  rows: string[][]
  matched: ConditionKey[]
  pooled: ConditionKey[]
  warnings: string[]
} {
  const pinned = (sel: CondSelector): boolean => active.some((c) => (sel[c]?.length ?? 0) > 0)
  const warnings: string[] = []
  const defined = pinned(num) && pinned(den)
  if (!defined) warnings.push('Pin at least one value on each side (group A and group B).')
  // No table until both groups are pinned — an unpinned side matches everything and would list
  // "— vs —" rows (the comparison dialog likewise shows nothing until it's configured).
  const recs = defined ? (rows as unknown as Record<ConditionKey, unknown>[]) : []
  const A = recs.filter((r) => rowMatchesSel(r, num, active))
  const B = recs.filter((r) => rowMatchesSel(r, den, active))
  // Only align on match dims both sides actually carry.
  const has = (r: Record<ConditionKey, unknown>, c: ConditionKey): boolean => {
    const v = condValue(r as never, c)
    return v != null && v !== ''
  }
  const ctx = match.filter((c) => A.some((r) => has(r, c)) && B.some((r) => has(r, c)))
  const ctxKey = (r: Record<ConditionKey, unknown>): string =>
    ctx.map((c) => String(condValue(r as never, c) ?? '')).join('¦')
  const group = (src: Record<ConditionKey, unknown>[]): Map<string, Set<string>> => {
    const m = new Map<string, Set<string>>()
    for (const r of src) {
      const k = ctxKey(r)
      let s = m.get(k)
      if (!s) m.set(k, (s = new Set()))
      s.add(String((r as { uniqID?: unknown }).uniqID ?? ''))
    }
    return m
  }
  const aG = group(A)
  const bG = group(B)
  const ctxKeys = [...aG.keys()].filter((k) => bG.has(k))
  // Group names: the values pinned on the contrasted axis (every pinned condition if none differs).
  const nameOf = (sel: CondSelector): string => {
    const on = axis.length ? axis : active.filter((c) => (sel[c]?.length ?? 0) > 0)
    const parts = on.map((c) => (sel[c] ?? []).join('+')).filter(Boolean)
    return parts.join(' · ') || '—'
  }
  const nameA = nameOf(num)
  const nameB = nameOf(den)
  // The '' column is a UI-only "vs" between the two groups (rendered muted by the table).
  const columns = ['group A', '', 'group B', ...ctx.map(condLabel), 'paired genes']
  const tableRows: string[][] = ctxKeys.slice(0, 50).map((k) => {
    const aSet = aG.get(k)!
    const bSet = bG.get(k)!
    let n = 0
    for (const g of aSet) if (bSet.has(g)) n++
    return [
      nameA,
      'vs',
      nameB,
      ...(ctx.length ? k.split('¦') : []),
      `${n} (${aSet.size} vs ${bSet.size})`
    ]
  })
  if (pinned(num) && pinned(den) && ctxKeys.length === 0)
    warnings.push('No genes pair across the two sides with the current match context.')
  const pooled = active.filter((c) => !ctx.includes(c))
  return { groups: ctxKeys.length, columns, rows: tableRows, matched: ctx, pooled, warnings }
}

/** For the Contrast tile's status line: how many contrasts an intra-dataset config yields, the
 *  conditions it contrasts on, and the two group names the preview table shows. */
// eslint-disable-next-line react-refresh/only-export-components
export function contrastSummary(
  rows: StandardRow[],
  num: CondSelector,
  den: CondSelector,
  match: ConditionKey[],
  active: ConditionKey[]
): { groups: number; axis: ConditionKey[]; nameA: string; nameB: string } | null {
  const axis = orderConds(active).filter(
    (c) => pinnedOn(num, c) && pinnedOn(den, c) && !sameSetOf(num[c], den[c])
  )
  const p = previewContrast(rows, num, den, match, active, axis)
  if (p.warnings.length > 0) return null
  const first = p.rows[0]
  return { groups: p.groups, axis, nameA: first?.[0] ?? '—', nameB: first?.[2] ?? '—' }
}

export function ComparisonDialog({
  id,
  variant = 'compare',
  rows: rowsProp,
  active: activeProp,
  shape,
  initial,
  pair,
  curve: curveTile = false,
  detection: initialDetection = '4pl',
  onClose
}: {
  id: string
  variant?: SelectVariant
  /** gene-level rows with condition fields (Compare/Standardize rows) for combos + preview */
  rows: StandardRow[]
  /** conditions offered as selectable (Standardize's active set, or those present upstream) */
  active: ConditionKey[]
  /** compare only: what the data's shape allows (see dataShape) — gates the analysis switch */
  shape?: DataShape
  initial: {
    num: CondSelector
    den: CondSelector
    match: ConditionKey[]
    analysis?: Analysis
    /** curve fit only: the numeric condition the curve runs over */
    curveAxis?: ConditionKey
    /** curve fit only: the control is a confirmed background treatment (see controlIsBaseline) */
    controlBackground?: boolean
    /** curve fit, spline detection only: one dose × time surface (absent = the default: a surface
     *  whenever the data have both) */
    surface?: boolean
    /** curve fit, dose × time surface only: how each surface is described */
    surfaceDescription?: SurfaceFit
    /** contrast only: intra-dataset (select; one input) or inter-dataset (pair; two inputs).
     *  Fixed by the tile's wiring; the other pill option shows disabled. */
    source?: ContrastSource
    /** contrast only: the configured dataset A / B ids (inter-dataset mode) */
    pairA?: string
    pairB?: string
    /** contrast only: the input the groups are selected from (intra-dataset with several wired) */
    selectFrom?: string
    /** contrast only: fixed slices for unmatched conditions (inter-dataset) */
    pairFix?: PairFix
    /** contrast only: whether `match` was ever set (an unset match defaults to every shared
     *  condition matched — the no-pooling default) */
    matchSet?: boolean
  }
  /** contrast only: every wired input (in edge order), for the inter-dataset mode's pickers */
  pair?: PairInput[]
  /** opened from a Curve fit tile: always a curve fit (no analysis switch), its sides named
   *  treatments and control */
  curve?: boolean
  /** a Curve fit's detection model (picked again here, with its axis and surface fit) */
  detection?: CurveModel
  onClose: () => void
}): ReactNode {
  const update = useGraph((s) => s.updateConfig)
  const mode = useUiTheme((s) => s.mode)
  // Docked (the form workflow's details column): rendered into that pane, with no scrim.
  const dock = useDialogDock()
  const contrast = variant === 'contrast'
  const [analysis, setAnalysis] = useState<Analysis>(
    curveTile ? 'curve_fit' : initial.analysis === 'two_way_anova' ? 'two_way_anova' : 'compare'
  )
  const twoWay = !contrast && analysis === 'two_way_anova'
  // Curve fit: the num/den model of a t-test, with one numeric condition (dose) as the curve's
  // x-axis instead of a matched context — each numerator group (treatment) pools its levels into
  // one curve, against the denominator (the control, the curve's starting point).
  const curve = !contrast && analysis === 'curve_fit'
  // A Curve fit's model and surface fit — the tile panel's settings, local until Apply.
  const [detection, setDetection] = useState<CurveModel>(initialDetection)
  const [surfaceFit, setSurfaceFit] = useState<SurfaceFit>(initial.surfaceDescription ?? 'slices')
  // A control that is itself treated (another compound at a dose) is valid only as a background
  // treatment the curve's compound is added on top of — the user confirms that here.
  const [background, setBackground] = useState(!!initial.controlBackground)
  // Contrast: intra-dataset (select two groups from one input) vs inter-dataset (pair two
  // inputs). One input wired ⇒ intra only; several ⇒ chosen here, local until Apply.
  const inputCount = pair?.length ?? 0
  const [source, setSource] = useState<ContrastSource>(
    initial.source === 'pair' && inputCount >= 2 ? 'pair' : 'select'
  )
  const pairMode = contrast && source === 'pair'
  // Intra-dataset with several inputs: which one the groups are selected from. Its rows drive
  // the selector (a single input, or the Compare variant, uses the rows passed in).
  const [selectPick, setSelectPick] = useState<string | undefined>(initial.selectFrom)
  const selectInput = pair?.find((i) => i.id === selectPick)
  const { rows, active } = useMemo(() => {
    if (!contrast || !pair || pair.length < 2) return { rows: rowsProp, active: activeProp }
    const r = selectorRowsOf(selectInput?.result)
    return { rows: r.rows, active: r.present }
  }, [contrast, pair, selectInput, rowsProp, activeProp])
  // Inter-dataset picks (which wired inputs are A/B) and match set — local until Apply.
  const [pairPick, setPairPick] = useState<{ a?: string; b?: string }>(() => {
    const ids = (pair ?? []).map((i) => i.id)
    const s = pairSides({ pairA: initial.pairA, pairB: initial.pairB } as ContrastConfig, ids)
    return s ? { a: s[0], b: s[1] } : {}
  })
  // Match set defaults to every shared condition (nothing pooled) until the user has chosen.
  const [pairMatch, setPairMatch] = useState<ConditionKey[]>(() => {
    if (initial.matchSet) return initial.match
    const s = pairSides(
      { pairA: initial.pairA, pairB: initial.pairB } as ContrastConfig,
      (pair ?? []).map((i) => i.id)
    )
    if (!s) return initial.match
    const A = toContrastSide(pair?.find((i) => i.id === s[0])?.result)
    const B = toContrastSide(pair?.find((i) => i.id === s[1])?.result)
    return previewContrastPair(A, B, []).candidates
  })
  // Inter-dataset picks: per dataset, the values each condition is narrowed to (absent = all of
  // that dataset's). A saved single-value pin reads as a one-value pick.
  const [pairPicks, setPairPicks] = useState<Record<SideKey, Picks>>(() => {
    const read = (pins: PairFix['a'] | undefined): Picks => {
      const out: Picks = {}
      for (const [c, v] of Object.entries(pins ?? {}) as [ConditionKey, string | string[]][])
        if (v != null && v !== '') out[c] = Array.isArray(v) ? v.map(String) : [v]
      return out
    }
    return { a: read(initial.pairFix?.a), b: read(initial.pairFix?.b) }
  })
  const pairFix: PairFix = { a: { ...pairPicks.a }, b: { ...pairPicks.b } }
  const pairReady = (() => {
    const A = pair?.find((i) => i.id === pairPick.a)?.result
    const B = pair?.find((i) => i.id === pairPick.b)?.result
    if (!A || !B || !(A.kind === 'compare' || A.kind === 'standardize') || B.kind !== A.kind)
      return false
    // Nothing left to pool (every unmatched condition one slice per dataset), and no side emptied.
    const p = previewContrastPair(
      toContrastSide(A),
      toContrastSide(B),
      pairMatch,
      { a: 'A', b: 'B' },
      pairFix
    )
    const emptied = (['a', 'b'] as const).some((s) =>
      (Object.keys(pairPicks[s]) as ConditionKey[]).some(
        (c) =>
          (p.values[c]?.[s].length ?? 0) > 0 &&
          !(p.values[c]?.[s] ?? []).some((v) => pairPicks[s][c]!.includes(v))
      )
    )
    return p.unpinned.length === 0 && !emptied
  })()

  const combos = useMemo(() => combosOf(rows), [rows])
  // All distinct values per condition (numeric-aware order).
  const allValues = useMemo(() => {
    const out = {} as Record<ConditionKey, string[]>
    // Keys come from the combos themselves, so a custom condition's values are listed too.
    for (const c of orderConds([
      ...new Set(combos.flatMap((m) => Object.keys(m)))
    ] as ConditionKey[])) {
      const seen = new Set<string>()
      for (const combo of combos) if (combo[c] !== '' && combo[c] != null) seen.add(combo[c])
      out[c] = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }
    return out
  }, [combos])
  const valsOf = (c: ConditionKey): string[] => allValues[c] ?? []
  const ordered = useMemo(() => orderConds(active), [active])

  // ── the curve's axis (curve fit only) ────────────────────────────────────────────
  // A curve runs over a numeric condition (or dose × time, one surface per gene × compound): that
  // condition's row is the AXIS — the treatment side's levels make up the curve, the control side's
  // are its starting point (one level, or every level of a control compound).
  const numericConds = useMemo(() => ordered.filter((c) => isNumericCond(c)), [ordered])
  // Either model can fit dose and time together when the data have both: the Spline model's
  // default; under 4PL (the 4PL surface) the user's choice.
  const surfaceOk = curve && numericConds.includes('dose') && numericConds.includes('time')
  const cmpdVals = useMemo(() => allValues.cmpd ?? [], [allValues])
  // The vehicle, from the data alone: the one compound never given a dose above 0.
  const vehicle = useMemo(() => {
    if (!active.includes('dose')) return undefined
    const v = cmpdVals.filter((c) => combos.every((m) => m.cmpd !== c || !(Number(m.dose) > 0)))
    return v.length === 1 ? v[0] : undefined
  }, [active, cmpdVals, combos])
  // The levels of a condition among the rows of some compounds (every row when there's no cmpd).
  const levelsOf = (c: ConditionKey, cmpds?: string[]): string[] => {
    const seen = new Set<string>()
    for (const m of combos)
      if (m[c] !== '' && (!cmpds || !cmpdVals.length || cmpds.includes(m.cmpd))) seen.add(m[c])
    return valsOf(c).filter((v) => seen.has(v))
  }
  const [axisSel, setAxisSel] = useState<string>(() =>
    surfaceOk && (initial.surface ?? initialDetection === 'spline')
      ? SURFACE
      : initial.curveAxis && numericConds.includes(initial.curveAxis)
        ? initial.curveAxis
        : numericConds.includes('dose')
          ? 'dose'
          : (numericConds[0] ?? 'dose')
  )
  const surface = surfaceOk && axisSel === SURFACE
  // The axis whose levels the curve and control are picked on (a surface's: dose, at every time).
  const refAxis: ConditionKey = axisSel === SURFACE ? 'dose' : (axisSel as ConditionKey)
  const curveAxis: ConditionKey | undefined = curve ? refAxis : undefined
  const axisConds = useMemo<ConditionKey[]>(
    () => (!curve ? [] : surface ? ['dose', 'time'] : [refAxis]),
    [curve, surface, refAxis]
  )

  // ── the two sides' picks ─────────────────────────────────────────────────────────
  // Per side, the values each condition is narrowed to; absent = every value. Read straight off the
  // saved selectors (a pinned condition is its pick), so a saved setup opens as it was.
  const configured = Object.keys(initial.num).length > 0 || Object.keys(initial.den).length > 0
  const [picks, setPicks] = useState<Record<SideKey, Picks>>(() => {
    if (curve && !configured) {
      // A fresh curve fit: every dosed compound against the vehicle (or, without one, each against
      // its own lowest level) over the levels above 0.
      const ax = refAxis
      const curveCmpds = cmpdVals.filter(
        (v) => v !== vehicle && levelsOf(ax, [v]).some((x) => Number(x) > 0)
      )
      const cmpd: Picks = cmpdVals.length ? { cmpd: curveCmpds } : {}
      return {
        a: { ...cmpd, [ax]: valsOf(ax).filter((v) => Number(v) > 0) },
        b: vehicle
          ? { cmpd: [vehicle] }
          : {
              ...cmpd,
              [ax]: valsOf(ax)
                .filter((v) => !(Number(v) > 0))
                .slice(0, 1)
            }
      }
    }
    return { a: picksOf(initial.num), b: picksOf(initial.den) }
  })
  // Every context condition starts matched like-for-like (nothing pooled) until the user says
  // otherwise; a saved setup keeps its own.
  const [matchOn, setMatchOn] = useState<ConditionKey[]>(() =>
    configured ? initial.match : [...active]
  )
  const pickOf = (s: SideKey, c: ConditionKey): string[] => {
    const p = picks[s][c]
    return p ? valsOf(c).filter((v) => p.includes(v)) : valsOf(c)
  }

  // The comparison, read off the picks: a condition whose sides differ is compared (for a curve,
  // the axis aside — unless nothing else differs, then the axis is: each compound against its own
  // level); every other condition is context, matched or pooled by its switch.
  const derived = useMemo(
    () =>
      readSides({
        picks,
        values: allValues,
        ordered,
        matchOn,
        curve: curve ? { axes: axisConds, ref: refAxis, surface } : undefined
      }),
    [picks, allValues, ordered, matchOn, curve, axisConds, refAxis, surface]
  )
  const { compared, match, num, den } = derived

  // Values a condition can take on a side, given that side's OTHER picks.
  const availableFor = (side: Side, c: ConditionKey): Set<string> => {
    const sel = side === 'num' ? num : den
    const seen = new Set<string>()
    for (const combo of combos) {
      let ok = true
      for (const k of active) {
        if (k === c) continue
        const chosen = sel[k]
        if (!chosen || chosen.length === 0) continue
        if (combo[k] === '' || !chosen.includes(combo[k])) {
          ok = false
          break
        }
      }
      if (ok && combo[c] !== '') seen.add(combo[c])
    }
    return seen
  }

  // A side's name, as the rows' column heads and the warnings say it.
  const sideLabel = (s: Side): string =>
    s === 'num'
      ? contrast
        ? 'group A'
        : curve
          ? 'treatment'
          : 'numerator'
      : contrast
        ? 'group B'
        : curve
          ? 'control'
          : 'denominator'

  // The curve's axis switch: the new axis takes its default picks (the levels above 0 for the
  // curve; the control's own lowest level, or every level of a control compound), the old one
  // goes back to context with every value.
  const pickAxis = (a: string): void => {
    const ax: ConditionKey = a === SURFACE ? 'dose' : (a as ConditionKey)
    if (ax !== refAxis)
      setPicks((p) => {
        const controlCmpd =
          !!cmpdVals.length && !sameSetOf(pickOf('a', 'cmpd'), pickOf('b', 'cmpd'))
        const na: Picks = { ...p.a, [ax]: valsOf(ax).filter((v) => Number(v) > 0) }
        const nb: Picks = { ...p.b }
        delete na[refAxis]
        delete nb[refAxis]
        if (controlCmpd) delete nb[ax]
        else
          nb[ax] = valsOf(ax)
            .filter((v) => !(Number(v) > 0))
            .slice(0, 1)
        return { a: na, b: nb }
      })
    setAxisSel(a)
  }

  // ── derived: axis, preview ─────────────────────────────────────────────────────
  const axis = compared
  const preview = useMemo(
    () =>
      contrast
        ? previewContrast(rows, num, den, match, active, compared)
        : previewCompare({ rows, num, den, match, activeConditions: active, curveAxis }),
    [contrast, rows, num, den, match, active, compared, curveAxis]
  )
  // Role-level problems the engine can't see (it only gets selectors).
  const roleWarnings: string[] = []
  const list = (cs: ConditionKey[]): string => cs.map(condLabel).join(' and ')
  for (const c of ordered) {
    if ((surface && c === 'time') || valsOf(c).length === 0) continue
    for (const s of ['a', 'b'] as const)
      if (pickOf(s, c).length === 0)
        roleWarnings.push(
          `${condLabel(c)}: pick at least one value for the ${sideLabel(s === 'a' ? 'num' : 'den')}.`
        )
  }
  if (curve) {
    if (numericConds.length === 0)
      roleWarnings.push('A curve fit needs a numeric condition (dose or time) to run over.')
    else if (derived.nonAxis.length > 1)
      roleWarnings.push(
        `The treatment and the control differ on ${list(derived.nonAxis)} — a curve’s control differs on one condition (usually the compound). Make the others the same on both sides.`
      )
    else if (compared.length === 0)
      roleWarnings.push(
        `Pick the control: another compound, or one ${condLabel(refAxis)} level of the treatments’ own.`
      )
  } else if (contrast) {
    if (compared.length === 0)
      roleWarnings.push('Make the two groups differ on at least one condition.')
  } else if (!twoWay) {
    if (compared.length === 0)
      roleWarnings.push(
        'Make the two sides differ on the condition to compare — narrow the numerator or the denominator.'
      )
    else if (compared.length > 1)
      roleWarnings.push(
        `A t-test compares one condition — the sides differ on ${list(compared)}. Make all but one the same on both sides.`
      )
  }
  // One reference value: a t-test's denominator, a curve's control, per compared condition.
  if (!contrast && !twoWay)
    for (const c of compared)
      if (pickOf('b', c).length > 1)
        roleWarnings.push(`${condLabel(c)}: pick one ${sideLabel('den')} value.`)
  // A value can't be compared against itself.
  for (const c of compared) {
    const both = pickOf('a', c).filter((v) => pickOf('b', c).includes(v))
    if (both.length && pickOf('b', c).length > 0)
      roleWarnings.push(
        `${condLabel(c)}: ${both.join(', ')} ${both.length === 1 ? 'is' : 'are'} on both sides — a value can’t be compared against itself.`
      )
  }
  const controlTreated = curve && 'controlTreated' in preview && !!preview.controlTreated
  if (controlTreated && !background)
    roleWarnings.push(
      'The control is a treated sample, not the vehicle. A curve starts from its control, so this is only valid as a background treatment (the treatments added on top of it) — confirm below, or pick the vehicle.'
    )

  // Two-way ANOVA needs exactly two compared conditions (two factors). Each factor may carry
  // MULTIPLE numerator and/or denominator levels — every numerator × denominator level pair runs
  // as its own 2×2 interaction. Cheap to compute inline (≤4 conditions), so no memo.
  const twoWayCheck = ((): { warnings: string[]; ok: boolean } => {
    const warnings: string[] = []
    if (axis.length !== 2)
      warnings.push(
        `2-way ANOVA needs the sides to differ on two conditions (the two factors)${axis.length ? ` — they differ on ${list(axis)}` : ''}.`
      )
    for (const c of axis) {
      if (crossPairs(num[c] ?? [], den[c] ?? []).length === 0)
        warnings.push(
          `Factor “${condLabel(c)}”: pick at least one numerator and one denominator level.`
        )
    }
    return { warnings, ok: axis.length === 2 && warnings.length === 0 }
  })()

  // When the two factors are valid, dry-run the two-way grouping: one interaction per context
  // combination (every non-factor condition, matched like-for-like) with a complete 2×2 — across
  // every numerator×denominator level pair of each factor.
  const twoWayView = ((): ReturnType<typeof previewTwoWay> | null => {
    if (!twoWay || !twoWayCheck.ok) return null
    const [a, b] = axis
    return previewTwoWay({
      rows,
      factors: [
        { condition: a, pairs: crossPairs(num[a] ?? [], den[a] ?? []) },
        { condition: b, pairs: crossPairs(num[b] ?? [], den[b] ?? []) }
      ],
      activeConditions: active,
      num,
      den
    })
  })()

  // Apply is gated on a clean preview: any warning in the active mode blocks it. Pair mode only
  // needs its two inputs ready.
  const activeWarnings = twoWay
    ? [
        ...roleWarnings.filter((w) => !w.startsWith('Make')),
        ...twoWayCheck.warnings,
        ...(twoWayView?.warnings ?? [])
      ]
    : [...roleWarnings, ...preview.warnings]
  const canApply = pairMode ? pairReady : activeWarnings.length === 0

  const apply = (): void => {
    if (contrast) {
      // Contrast: inter-dataset → the match context and each dataset's picks (A/B are the
      // edges); intra → group A = num selection, group B = den selection, aligned on the match.
      if (source === 'pair')
        update(id, {
          source,
          match: pairMatch,
          pairA: pairPick.a,
          pairB: pairPick.b,
          pairFix
        })
      else update(id, { source, num, den, match, selectFrom: selectPick })
      onClose()
      return
    }
    // The threshold follows the analysis (see thresholdForAnalysis).
    const cur = (
      useGraph.getState().nodes.find((n) => n.id === id)?.data.config as
        { threshold?: ThresholdConfig } | undefined
    )?.threshold
    // A Curve fit's follows its model and whether it fits a surface (see thresholdForDetection).
    const next = cur
      ? curveTile
        ? thresholdForDetection(detection, cur, surface)
        : thresholdForAnalysis(
            initial.analysis ?? 'compare',
            twoWay ? 'two_way_anova' : curve ? 'curve_fit' : 'compare',
            cur
          )
      : null
    const threshold: { threshold?: ThresholdConfig } = next ? { threshold: next } : {}
    if (twoWay) {
      // Derive the two factors from the compared conditions for the existing two-way run path.
      const [a, b] = axis
      update(id, {
        analysis: 'two_way_anova',
        num,
        den,
        match,
        ...threshold,
        ...(axis.length === 2
          ? {
              condition: a,
              pairNum: (num[a] ?? [''])[0],
              pairDen: (den[a] ?? [''])[0],
              condition2: b,
              pair2Num: (num[b] ?? [''])[0],
              pair2Den: (den[b] ?? [''])[0]
            }
          : {})
      })
    } else if (curve) {
      update(id, {
        analysis: 'curve_fit',
        num,
        den,
        match,
        curveAxis,
        surface: surfaceOk ? surface : undefined,
        detection,
        ...(surface ? { surfaceDescription: surfaceFit } : {}),
        controlBackground: controlTreated ? background : undefined,
        ...threshold
      })
    } else {
      update(id, { analysis: 'compare', num, den, match, ...threshold })
    }
    onClose()
  }

  // For a matched condition, how each of its values sits within the OTHER matched conditions'
  // contexts, per side. `byValue` maps value → the context keys (tuple of the other matched
  // conditions' values) it occurs in; `contexts` is every context key on that side. Drives the
  // chip look: a value found in every compared context on both sides is fully matched; in some
  // but not all → partial; in none shared → skipped. A condition with ≤1 value on a side is
  // "fixed" there (invariant — the other side fans out against that single slice, veh-norm).
  const contextsOf = (
    side: Side,
    c: ConditionKey
  ): { byValue: Map<string, Set<string>>; contexts: Set<string> } => {
    const sel = side === 'num' ? num : den
    // Context = the other conditions the engine actually matches on — not pooled ones, nor those
    // it has found invariant on a side (dose on a vehicle), which never take part in matching.
    const invariant = new Set('invariant' in preview ? preview.invariant : [])
    const others = match.filter((k) => k !== c && !invariant.has(k))
    const byValue = new Map<string, Set<string>>()
    const contexts = new Set<string>()
    for (const combo of combos) {
      let ok = true
      for (const k of active) {
        if (k === c) continue
        const chosen = sel[k]
        if (!chosen || chosen.length === 0) continue
        if (combo[k] === '' || !chosen.includes(combo[k])) {
          ok = false
          break
        }
      }
      if (!ok || combo[c] === '') continue
      const ctx = others.map((k) => combo[k]).join('¦')
      contexts.add(ctx)
      let set = byValue.get(combo[c])
      if (!set) byValue.set(combo[c], (set = new Set()))
      set.add(ctx)
    }
    return { byValue, contexts }
  }

  // ── rendering ──────────────────────────────────────────────────────────────────
  // One row per condition, both sides picked explicitly (SideRows).
  const rowSpecs = (): SideRow[] => {
    const live = axis.length > 0
    return ordered.map((c): SideRow => {
      if (surface && c === 'time')
        return {
          cond: c,
          role: 'axis',
          values: { a: [], b: [] },
          picked: { a: [], b: [] },
          fixedText: 'every time point — each against the control at the same time'
        }
      const isAxis = axisConds.includes(c)
      const isCompared = compared.includes(c)
      const role: RowRole = isAxis
        ? 'axis'
        : isCompared
          ? 'compared'
          : matchOn.includes(c)
            ? 'matched'
            : 'pooled'
      const a = pickOf('a', c)
      const b = pickOf('b', c)
      // Context chips show how each value pairs across the sides (as the matched line reads).
      const N = role === 'matched' && live ? contextsOf('num', c) : null
      const D = role === 'matched' && live ? contextsOf('den', c) : null
      const shared = N && D ? [...N.contexts].filter((x) => D.contexts.has(x)) : []
      const availA = availableFor('num', c)
      const availB = availableFor('den', c)
      const chip = (s: SideKey, v: string, on: boolean): Partial<ChipItem> => {
        const avail = (s === 'a' ? availA : availB).has(v)
        if (!on)
          return avail
            ? { title: `Add ${condLabel(c)} ${v} to the ${sideLabel(s === 'a' ? 'num' : 'den')}` }
            : {
                disabled: true,
                title: `Not present with the ${sideLabel(s === 'a' ? 'num' : 'den')}’s other picks`
              }
        if (role === 'pooled')
          return {
            look: styles.valChipIdle,
            title: 'Kept, pooled with the rest — click to leave out'
          }
        if (role === 'matched') {
          if (!N || !D) return { look: styles.valChipIdle, title: 'Kept — click to leave out' }
          const nC = N.byValue.get(v) ?? new Set<string>()
          const dC = D.byValue.get(v) ?? new Set<string>()
          const paired = shared.filter((x) => nC.has(x) && dC.has(x))
          if (paired.length === 0)
            return {
              look: styles.valChipIdle,
              title: `No matching sample pair at ${condLabel(c)} = ${v} in any context — skipped`
            }
          if (paired.length < shared.length)
            return {
              look: styles.valChipPartial,
              title: `${condLabel(c)} = ${v} is compared in ${paired.length} of ${shared.length} contexts — missing on a side in the rest`
            }
          return {
            look: styles.valChipIncluded,
            title: 'Matched like-for-like — click to leave out'
          }
        }
        // Compared / axis: the accent pick; a value on both sides of a compared condition warns.
        const twice = isCompared && a.includes(v) && b.includes(v)
        return twice
          ? { title: 'On both sides — a value can’t be compared against itself' }
          : { title: 'Picked — click to leave out' }
      }
      const note: Partial<Record<SideKey, string>> = {}
      if (a.length === 0) note.a = 'pick at least one'
      if (b.length === 0) note.b = 'pick at least one'
      else if (isCompared && !contrast && !twoWay && b.length > 1)
        note.b = 'pick one reference value'
      return {
        cond: c,
        role,
        values: { a: valsOf(c), b: valsOf(c) },
        picked: { a, b },
        match: isAxis
          ? undefined
          : isCompared
            ? {
                on: false,
                disabled: true,
                title: 'Compared — the sides differ here. Make them the same to use it as context.'
              }
            : {
                on: role === 'matched',
                title:
                  role === 'matched'
                    ? 'Matched like-for-like — switch off to pool its values'
                    : 'Pooled — switch on to match like-for-like'
              },
        chip,
        note
      }
    })
  }

  // A curve fit's own settings, above its rows: the model, the axis, and a surface's fit.
  const curveSettings = (): ReactNode => {
    const head = (name: string): ReactNode => (
      <div style={styles.condHead}>
        <span style={{ ...styles.condName, ...styles.condNameOn }}>{name}</span>
      </div>
    )
    return (
      <>
        <div style={{ ...styles.condRow, borderTop: 'none' }}>
          {head('model')}
          <ToggleSwitch
            label="Model"
            value={detection}
            options={CURVE_MODEL_OPTIONS}
            onChange={(d) => {
              setDetection(d)
              // As on the tile: the surface is the Spline model's default wherever dose and time
              // both vary (unless the tile already chose).
              if (d === 'spline' && initial.surface == null && surfaceOk) pickAxis(SURFACE)
            }}
          />
        </div>
        <div style={styles.condRow}>
          {head('axis')}
          <ToggleSwitch
            label="Axis"
            value={axisSel === SURFACE ? 'surface' : axisSel}
            options={curveAxisOptions(shape, detection).map((o) => {
              // Also greyed: an axis the wired data doesn't carry at all.
              const absent =
                o.value === 'surface' ? !surfaceOk : !numericConds.includes(o.value as ConditionKey)
              return {
                ...o,
                value: o.value as string,
                disabled: o.disabled || absent,
                title: absent && !o.disabled ? `No ${o.label} in the data` : o.title
              }
            })}
            onChange={(a) => pickAxis(a === 'surface' ? SURFACE : a)}
          />
        </div>
        {surface && (
          <div style={styles.condRow}>
            {head('fit')}
            <ToggleSwitch
              label="Fit"
              value={surfaceFit}
              options={SURFACE_FIT_OPTIONS}
              onChange={setSurfaceFit}
            />
          </div>
        )}
      </>
    )
  }
  return createPortal(
    // Re-establish the theme CSS variables inside the portal (document.body is outside the app
    // root where they're defined), otherwise UI.* (var(--panel) …) resolve to transparent.
    <div style={dock ? { ...cssVars(PALETTES[mode]), ...DOCKED_WRAP } : cssVars(PALETTES[mode])}>
      {/* Chips are buttons: no focus ring after a click (it lingered as a dark outline), but keep
          one for keyboard focus. */}
      <style>{`.oe-chip:focus{outline:none}.oe-chip:focus-visible{box-shadow:0 0 0 2px var(--accent)}`}</style>
      {!dock && <div style={styles.scrim} onClick={onClose} />}
      <div
        style={dock ? { ...styles.modal, ...DOCKED_CARD } : styles.modal}
        role="dialog"
        aria-label={
          contrast
            ? 'Configure contrast'
            : curveTile
              ? 'Configure curve fit'
              : 'Configure comparison'
        }
      >
        <div style={styles.head}>
          <span style={styles.title}>
            {contrast
              ? 'Configure contrast'
              : curveTile
                ? 'Configure curve fit'
                : 'Configure comparison'}
          </span>
          {/* Mode toggle: Compare picks the analysis (plain two-level vs 2×2 interaction); Contrast
              picks its inputs (two groups from one upstream vs two upstreams). */}
          <span style={styles.modeSwitch}>
            {contrast ? (
              <ToggleSwitch
                label="Contrast source"
                value={source}
                options={(['select', 'pair'] as ContrastSource[]).map((v) => {
                  // Inter-dataset needs two inputs wired; intra-dataset always works.
                  const off = v === 'pair' && inputCount < 2
                  return {
                    value: v,
                    label: v === 'select' ? 'intra-dataset' : 'inter-dataset',
                    disabled: off,
                    title: off
                      ? 'Wire a second input into the tile to contrast two datasets'
                      : undefined
                  }
                })}
                onChange={(v) => setSource(v)}
              />
            ) : curveTile ? null : (
              <ToggleSwitch
                label="Analysis"
                value={analysis}
                options={(
                  [
                    ['compare', 't-test'],
                    ['two_way_anova', '2-way ANOVA']
                  ] as const
                ).map(([value, label]) => {
                  // An analysis the data's shape can't support is offered greyed, with why.
                  const why = shape ? analysisUnmet(shape, value) : null
                  return {
                    value: value as Analysis,
                    label,
                    disabled: !!why,
                    title: why ?? undefined
                  }
                })}
                onChange={setAnalysis}
              />
            )}
          </span>
          <button style={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {pairMode && pair ? (
          <PairContrastBody
            inputs={pair}
            a={pairPick.a}
            b={pairPick.b}
            onPick={(side, id) => setPairPick((p) => ({ ...p, [side]: id }))}
            match={pairMatch}
            onMatch={(c, on) =>
              setPairMatch((m) =>
                on ? [...m.filter((x) => x !== c), c] : m.filter((x) => x !== c)
              )
            }
            picks={pairPicks}
            onPickValue={(side, c, next) =>
              setPairPicks((p) => ({ ...p, [side]: { ...p[side], [c]: next } }))
            }
          />
        ) : (
          <>
            {contrast && pair && pair.length >= 2 && (
              <DatasetPick
                label="dataset"
                inputs={pair}
                value={selectPick}
                onPick={setSelectPick}
                style={{ padding: '14px 14px 0' }}
              />
            )}
            {rows.length === 0 ? (
              <StatusNote kind="warn" style={{ margin: 14 }}>
                {contrast && pair && pair.length >= 2
                  ? 'Pick a run Compare or Clean data input.'
                  : 'Connect and run an upstream Compare or Clean data first.'}
              </StatusNote>
            ) : (
              <>
                <div style={styles.conds}>
                  {curve && curveSettings()}
                  <SideRows
                    labels={{
                      a: contrast ? 'group A (y-axis)' : sideLabel('num'),
                      b: contrast ? 'group B (x-axis)' : sideLabel('den')
                    }}
                    rows={rowSpecs()}
                    onPick={(side, c, next) =>
                      setPicks((p) => ({ ...p, [side]: { ...p[side], [c]: next } }))
                    }
                    onMatch={(c, on) =>
                      setMatchOn((m) =>
                        on ? [...m.filter((x) => x !== c), c] : m.filter((x) => x !== c)
                      )
                    }
                  />
                  {(() => {
                    // A result line only once the contrast/comparison is fully defined (the
                    // preview has no warnings) — before that there's nothing to report.
                    if (activeWarnings.length > 0) return null
                    // The context the comparison is matched on — the engine's view in either mode.
                    const matchedOn = twoWay ? (twoWayView?.context ?? []) : preview.matched
                    const fixed = twoWay
                      ? (twoWayView?.fixed ?? [])
                      : 'invariant' in preview
                        ? preview.invariant
                        : []
                    // Which side each fixed condition is fixed on (its single slice serves every level of
                    // the other side): the side with ≤1 value. Two-way has no sides, so just "fixed in".
                    const sideName = (s: Side): string =>
                      s === 'num'
                        ? contrast
                          ? 'group A'
                          : curve
                            ? 'treatments'
                            : 'numerator'
                        : contrast
                          ? 'group B'
                          : curve
                            ? 'control'
                            : 'denominator'
                    // Nothing to match (the compared condition is the only one that varies, or the
                    // rest are fixed): say nothing about matching rather than "matched on —".
                    const parts: string[] = matchedOn.length
                      ? [`matched on ${matchedOn.map(condLabel).join(', ')}`]
                      : []
                    if (fixed.length > 0) {
                      if (twoWay) parts.push(`fixed in ${fixed.map(condLabel).join(', ')}`)
                      else {
                        const bySide = new Map<Side | 'both', ConditionKey[]>()
                        for (const c of fixed) {
                          const n = contextsOf('num', c).byValue.size
                          const d = contextsOf('den', c).byValue.size
                          const s: Side | 'both' =
                            d <= 1 && n > 1 ? 'den' : n <= 1 && d > 1 ? 'num' : 'both'
                          bySide.set(s, [...(bySide.get(s) ?? []), c])
                        }
                        for (const [s, conds] of bySide)
                          parts.push(
                            s === 'both'
                              ? `fixed in ${conds.map(condLabel).join(', ')}`
                              : `fixed ${sideName(s)} in ${conds.map(condLabel).join(', ')}`
                          )
                      }
                    }
                    return (
                      <StatusNote kind="ok" style={styles.matchedLine}>
                        {parts.length ? parts.join(' · ') : 'no other condition to match on'}
                      </StatusNote>
                    )
                  })()}
                </div>

                {twoWay ? (
                  <div style={styles.preview}>
                    <div style={styles.previewHead}>
                      Interaction (2-way ANOVA)
                      {twoWayView ? ` · ${twoWayView.groups} in total` : ''}
                    </div>
                    {/* The linear model whose interaction term is tested, in formula notation. */}
                    {axis.length === 2 && (
                      <div style={styles.previewItem}>
                        <div>
                          log₂ abundance ~ {condLabel(axis[0])} + {condLabel(axis[1])} +{' '}
                          {condLabel(axis[0])} × {condLabel(axis[1])}
                        </div>
                        <div style={styles.previewItemNote}>
                          Welch t-test on the {condLabel(axis[0])} × {condLabel(axis[1])}{' '}
                          interaction
                          {twoWayView && twoWayView.context.length
                            ? `, for each ${twoWayView.context.map(condLabel).join(' × ')}`
                            : ''}
                        </div>
                      </div>
                    )}
                    {/* One X×Y interaction per combination of the non-factor (context) conditions. */}
                    {twoWayView && twoWayView.rows.length > 0 && (
                      <PreviewTable columns={twoWayView.columns} rows={twoWayView.rows} />
                    )}
                    {[...twoWayCheck.warnings, ...(twoWayView?.warnings ?? [])].map((w) => (
                      <StatusNote key={w} kind="warn">
                        {w}
                      </StatusNote>
                    ))}
                  </div>
                ) : (
                  <div style={styles.preview}>
                    <div style={styles.previewHead}>
                      {surface
                        ? 'Surfaces'
                        : `${contrast ? 'Contrast' : curve ? 'Curves' : 'Comparisons'} (${preview.groups} in total)`}
                    </div>
                    {curve && axis.length === 1 && curveAxis && detection === '4pl' && !surface && (
                      <div style={styles.previewItem}>
                        <div>ratio to control ~ log-logistic(log₁₀ {condLabel(curveAxis)})</div>
                        <div style={styles.previewItemNote}>
                          4-parameter curve vs a flat line, recalibrated F-test (CurveCurator), per
                          gene
                          {preview.matched.length
                            ? `, for each ${preview.matched.map(condLabel).join(' × ')}`
                            : ''}
                        </div>
                      </div>
                    )}
                    {curve &&
                      axis.length === 1 &&
                      curveAxis &&
                      (detection === 'spline' || surface) && (
                        <div style={styles.previewItem}>
                          <div>
                            {!surface
                              ? `log₂ effect vs control ~ spline(${condLabel(curveAxis)})`
                              : detection === 'spline'
                                ? 'log₂ effect vs control ~ spline surface(log₁₀ dose, log time)'
                                : 'log₂ effect vs control ~ 4PL(log₁₀ dose), top and midpoint over log time'}
                          </div>
                          <div style={styles.previewItemNote}>
                            {!surface
                              ? 'smooth curve vs a flat line, moderated F (Hybrid model), per gene'
                              : detection === 'spline'
                                ? 'one dose × time surface per gene × compound vs a flat surface, moderated F (Hybrid model)'
                                : 'one 4PL surface per gene × compound vs a flat surface, adjusted F (simulated null)'}
                            {!surface && preview.matched.length
                              ? `, for each ${preview.matched.map(condLabel).join(' × ')}`
                              : ''}
                          </div>
                          {/* How each surface is then described — the fit picked above. */}
                          {surface &&
                            (() => {
                              const fit = SURFACE_FIT_OPTIONS.find((o) => o.value === surfaceFit)
                              return fit ? (
                                <div style={styles.previewItemNote}>
                                  described by {fit.label}: {fit.title.charAt(0).toLowerCase()}
                                  {fit.title.slice(1)}
                                </div>
                              ) : null
                            })()}
                        </div>
                      )}
                    {!contrast && !curve && axis.length === 1 && (
                      <div style={styles.previewItem}>
                        <div>log₂ abundance ~ {condLabel(axis[0])}</div>
                        <div style={styles.previewItemNote}>
                          Welch t-test
                          {preview.matched.length
                            ? `, for each ${preview.matched.map(condLabel).join(' × ')}`
                            : ''}
                        </div>
                      </div>
                    )}
                    {/* One row per context combination actually compared. */}
                    {preview.rows.length > 0 && !surface && (
                      <PreviewTable columns={preview.columns} rows={preview.rows} />
                    )}
                    {'notes' in preview &&
                      preview.notes.map((n) => (
                        <div key={n} style={styles.note}>
                          {n}
                        </div>
                      ))}
                    {preview.warnings.map((w) => (
                      <StatusNote key={w} kind="warn">
                        {w}
                      </StatusNote>
                    ))}
                    {controlTreated && (
                      <div style={styles.backgroundRow}>
                        <OnOffSwitch
                          on={background}
                          onChange={setBackground}
                          label="Control is a background treatment"
                          title="On: the treatments are titrated on top of the control (e.g. drug A added to drug B), so the control alone is the curve's starting point"
                        />
                        <span>
                          Control is a background treatment — the treatments are added on top of it
                        </span>
                      </div>
                    )}
                    {controlTreated && !background && (
                      <StatusNote kind="warn">
                        The control is a treated sample, not the vehicle. A curve starts from its
                        control, so this is only valid as a background treatment — confirm above, or
                        pick the vehicle.
                      </StatusNote>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        <div style={styles.foot}>
          <button style={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            style={{ ...styles.apply, ...(canApply ? null : styles.applyDisabled) }}
            disabled={!canApply}
            title={canApply ? undefined : 'Resolve the warnings before applying'}
            onClick={apply}
          >
            Apply
          </button>
        </div>
      </div>
    </div>,
    dock ?? document.body
  )
}

const styles: Record<string, CSSProperties> = {
  ...selectorStyles,
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 70 },
  modal: {
    // Centred by auto margins, not translate(−50%): a translate lands on a half pixel whenever the
    // window's size is odd, and Chromium then renders its scrolled text (the preview tables)
    // blurry.
    position: 'fixed',
    inset: 0,
    margin: 'auto',
    height: 'fit-content',
    width: 640,
    maxWidth: '94vw',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 71,
    overflow: 'hidden'
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  title: { fontWeight: 700, fontSize: 14, color: UI.text },

  // The header's mode switch, pushed to the right of the title.
  modeSwitch: { marginLeft: 'auto', display: 'inline-flex' },
  close: {
    marginLeft: 12,
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer'
  },
  sidePair: { display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 },
  sideCol: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
  sideLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: UI.textMuted },
  vsRule: { width: 1, alignSelf: 'stretch', background: UI.border, flex: '0 0 auto' },
  // Included value of a MATCHED condition: a light-blue tint, distinct from the accent fill of a
  // compared pick, so "kept as context" doesn't read as "selected for comparison".
  // Included value before any condition is switched on: light grey (there's nothing to match yet).
  // Flat pill: border matches the fill (the theme's border colour is a near-miss of panelAlt and
  // reads as a smudged outline).
  // Included and paired in SOME of the compared contexts, but not all.

  valChipDisabled: { opacity: 0.3, cursor: 'not-allowed' },
  curveTag: { fontSize: 11, color: UI.textMuted, alignSelf: 'center' },
  previewItemNote: { fontFamily: 'inherit', color: UI.textMuted, fontWeight: 400, marginTop: 2 },
  previewItem: {
    fontSize: 12,
    color: UI.text,
    fontFamily: 'ui-monospace, monospace',
    marginBottom: 6
  },
  // Bottom fade cue: sits inside the table's border, hinting there are more rows below.
  previewMeta: { fontSize: 11, color: UI.textMuted, marginTop: 8 },
  note: { fontSize: 11, color: UI.textMuted, marginTop: 6 },
  backgroundRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 8 },
  foot: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 16px',
    borderTop: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  cancel: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    padding: '7px 16px',
    fontSize: 13,
    cursor: 'pointer'
  },
  apply: {
    background: UI.accent,
    color: UI.accentText,
    border: 'none',
    borderRadius: 6,
    padding: '7px 18px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer'
  },
  applyDisabled: { opacity: 0.4, cursor: 'not-allowed' }
}
