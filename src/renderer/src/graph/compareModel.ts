/**
 * The Compare dialog's model, kept apart from its UI so it can be tested against the engine: what
 * the dialog holds (compared conditions with their test and control values; each context condition's
 * mode — matched, shared or pooled — and the values left out), what that compiles to (the engine's
 * num / den / match / compared / pool), and how a saved config reads back.
 *
 * Every rule here mirrors the engine's (engine/direct.ts): a context condition the control holds one
 * value of, while the test side holds several, can't be matched — the data lock it to shared (DMSO is
 * the only dose 0). Rows are the dataset's distinct samples (sampleRows): the grouping never depends
 * on genes, so the dialog works on a few hundred rows instead of every gene × sample.
 */
import {
  classifyConditions,
  condLabel,
  condValue,
  isNumericCond,
  orderConds,
  type CondSelector,
  type ConditionKey,
  type StandardRow
} from '../engine'

/** A context condition's mode: matched like-for-like, shared at one control level, or pooled. */
export type CtxMode = 'match' | 'fixed' | 'pool'

export interface ComparedPick {
  /** the test values: each its own comparison */
  T: string[]
  /** the one control value */
  r: string
}

export interface CompareState {
  /** the compared conditions (several allowed), each with its test values and control value */
  cmp: Partial<Record<ConditionKey, ComparedPick>>
  /** each context condition's mode as picked (the data may lock it: see contextInfo) */
  modes: Partial<Record<ConditionKey, CtxMode>>
  /** a shared condition's control level, when the control has several */
  fixedVal: Partial<Record<ConditionKey, string>>
  /** values left out, per context condition */
  drop: Partial<Record<ConditionKey, string[]>>
}

/** A condition's value on a row as a string (null when the row has none). */
export const cv = (r: StandardRow, c: ConditionKey): string | null => {
  const v = condValue(r, c)
  return v == null || v === '' ? null : String(v)
}

const byValue =
  (c: ConditionKey) =>
  (a: string, b: string): number =>
    isNumericCond(c) ? Number(a) - Number(b) : a.localeCompare(b, undefined, { numeric: true })

/** A condition's distinct values among `rows`, in display order (numeric conditions by number). */
export function valuesOf(rows: readonly StandardRow[], c: ConditionKey): string[] {
  const seen = new Set<string>()
  for (const r of rows) {
    const v = cv(r, c)
    if (v != null) seen.add(v)
  }
  return [...seen].sort(byValue(c))
}

/** One row per distinct sample (combination of condition values): what the grouping depends on. */
export function sampleRows(rows: readonly StandardRow[], active: readonly ConditionKey[]): StandardRow[] {
  const seen = new Map<string, StandardRow>()
  for (const r of rows) {
    const k = active.map((c) => cv(r, c) ?? '').join('\u0001')
    if (!seen.has(k)) seen.set(k, r)
  }
  return [...seen.values()]
}

/** The vehicle, from the data alone: the one compound never given a dose above 0 (as the curve-fit
 *  dialog finds it) — never by its name. */
export function vehicleOf(rows: readonly StandardRow[]): string | null {
  const v = valuesOf(rows, 'cmpd').filter((m) =>
    rows.every((r) => cv(r, 'cmpd') !== m || !(Number(cv(r, 'dose')) > 0))
  )
  return v.length === 1 ? v[0] : null
}

/** A condition's default control value: the vehicle for cmpd when the data have one, else its first. */
export function defaultControl(rows: readonly StandardRow[], c: ConditionKey): string {
  return (c === 'cmpd' && vehicleOf(rows)) || valuesOf(rows, c)[0]
}

/** How a context condition takes part, given the test and control samples. */
export interface CtxInfo {
  c: ConditionKey
  /** its values on the test and the control side */
  Tv: string[]
  Cv: string[]
  /** one value, the same on both sides: nothing to decide */
  single: boolean
  /** the control holds the values to match (not one value against the test side's several) */
  matchOk: boolean
  /** the effective mode: as picked, but matched → shared where the data lock it */
  mode: CtxMode | 'single'
  /** a shared condition's control level */
  val: string
}

export function contextInfo(
  state: CompareState,
  c: ConditionKey,
  test: readonly StandardRow[],
  ctrl: readonly StandardRow[]
): CtxInfo {
  const Tv = valuesOf(test, c)
  const Cv = valuesOf(ctrl, c)
  const single = Tv.length <= 1 && Cv.length <= 1 && (Tv[0] === Cv[0] || !Tv.length || !Cv.length)
  const matchOk = !(Cv.length <= 1 && Tv.length > 1)
  const picked = state.modes[c] ?? 'match'
  const mode = single ? 'single' : picked === 'match' && !matchOk ? 'fixed' : picked
  const fv = state.fixedVal[c]
  const val = fv != null && Cv.includes(fv) ? fv : Cv[0]
  return { c, Tv, Cv, single, matchOk, mode, val }
}

/** Everything the dialog shows and compiles, derived from its state and the samples. */
export interface CompareModel {
  conds: ConditionKey[]
  /** the compared conditions, in canonical order */
  CMP: ConditionKey[]
  /** per compared condition: its values, control value and test values */
  P: Partial<Record<ConditionKey, ComparedPick & { vs: string[] }>>
  /** the test and control samples, after values left out */
  test: StandardRow[]
  ctrl: StandardRow[]
  ctx: CtxInfo[]
  /** the engine config (num / den / match / compared / pool) */
  num: CondSelector
  den: CondSelector
  match: ConditionKey[]
  pool: ConditionKey[]
  /** the dialog's own problems (beyond the engine preview's) */
  warnings: string[]
}

export function compareModel(
  state: CompareState,
  rows: readonly StandardRow[],
  active: readonly ConditionKey[]
): CompareModel {
  const conds = orderConds(active).filter((c) => valuesOf(rows, c).length > 0)
  const CMP = conds.filter((c) => state.cmp[c] && valuesOf(rows, c).length > 1)
  const P: CompareModel['P'] = {}
  for (const c of CMP) {
    const vs = valuesOf(rows, c)
    const k = state.cmp[c]!
    const r = vs.includes(k.r) ? k.r : vs[0]
    P[c] = { vs, r, T: vs.filter((v) => k.T.includes(v) && v !== r) }
  }
  const any = CMP.length > 0
  const test0 = any ? rows.filter((r) => CMP.every((c) => P[c]!.T.includes(cv(r, c) ?? ''))) : []
  const ctrl0 = any ? rows.filter((r) => CMP.every((c) => cv(r, c) === P[c]!.r)) : []
  // Modes and locks come from every value; then each context condition's left-out values drop: from
  // both sides when matched or pooled, from the test side only when shared (the control is its level).
  const ctx = conds.filter((c) => !CMP.includes(c)).map((c) => contextInfo(state, c, test0, ctrl0))
  const dropOf = (c: ConditionKey): Set<string> => new Set(state.drop[c] ?? [])
  const test = test0.filter((r) => ctx.every((x) => x.mode === 'single' || !dropOf(x.c).has(cv(r, x.c) ?? '')))
  const ctrl = ctrl0.filter((r) =>
    ctx.every((x) => (x.mode !== 'match' && x.mode !== 'pool') || !dropOf(x.c).has(cv(r, x.c) ?? ''))
  )

  const num: CondSelector = {}
  const den: CondSelector = {}
  for (const c of CMP) {
    num[c] = P[c]!.T
    den[c] = [P[c]!.r]
  }
  for (const x of ctx) {
    const drop = dropOf(x.c)
    const kept = (vs: string[]): string[] => vs.filter((v) => !drop.has(v))
    const out = x.Tv.some((v) => drop.has(v)) || x.Cv.some((v) => drop.has(v))
    if (x.mode === 'fixed') {
      if (x.Cv.length > 1) den[x.c] = [x.val]
      if (out) num[x.c] = kept(x.Tv)
    } else if ((x.mode === 'match' || x.mode === 'pool') && out) {
      num[x.c] = kept(x.Tv)
      den[x.c] = kept(x.Cv)
    }
  }
  const warnings: string[] = []
  if (any) {
    for (const c of CMP) if (!P[c]!.T.length) warnings.push(`${condLabel(c)}: pick at least one test value.`)
    for (const x of ctx)
      if (x.mode !== 'single' && x.Tv.length && x.Tv.every((v) => dropOf(x.c).has(v)))
        warnings.push(`${condLabel(x.c)}: every value is left out.`)
    if (!ctrl0.length) warnings.push(`No sample is ${controlName({ CMP, P })}: the control doesn't exist.`)
  }
  return {
    conds,
    CMP,
    P,
    test,
    ctrl,
    ctx,
    num,
    den,
    match: ctx.filter((x) => x.mode === 'match').map((x) => x.c),
    pool: ctx.filter((x) => x.mode === 'pool').map((x) => x.c),
    warnings
  }
}

/** A value list for a summary: past four, "first–last (n)". */
export const shortList = (vs: string[]): string =>
  !vs.length ? 'none' : vs.length > 4 ? `${vs[0]}–${vs[vs.length - 1]} (${vs.length})` : vs.join(', ')

/** A value with its condition, unless the value already names it ("DMSO", "cell A", "dose 0"). */
export const valueName = (c: ConditionKey, v: string): string =>
  c === 'cmpd' || v.startsWith(`${condLabel(c)} `) ? v : `${condLabel(c)} ${v}`

export const controlName = (m: Pick<CompareModel, 'CMP' | 'P'>): string =>
  m.CMP.map((c) => valueName(c, m.P[c]!.r)).join(' · ')

/** Several compared conditions confound only when the data could separate them: some sample differs
 *  from the control on one of them alone. DMSO only at dose 0 couples cmpd and dose: no confound. */
export function confounded(
  m: CompareModel,
  rows: readonly StandardRow[]
): { conds: ConditionKey[]; example: string } | null {
  if (m.CMP.length < 2) return null
  const alone = m.CMP.map((c) => ({
    c,
    row: rows.find(
      (r) =>
        m.P[c]!.T.includes(cv(r, c) ?? '') &&
        m.CMP.every((o) => o === c || cv(r, o) === m.P[o]!.r)
    )
  })).filter((a) => a.row)
  if (!alone.length) return null
  return {
    conds: alone.map((a) => a.c),
    example: m.CMP.map((o) => valueName(o, cv(alone[0].row!, o) ?? '')).join(' · ')
  }
}

/** A tip while every context condition is matched — or shared because the data force it (the
 *  control has one value there); a warning once one is shared or pooled by choice. */
export const controlKind = (m: CompareModel): 'info' | 'warn' =>
  m.ctx.every((x) => x.mode === 'match' || x.mode === 'single' || (x.mode === 'fixed' && !x.matchOk))
    ? 'info'
    : 'warn'

/**
 * The Control line, the same however the question is framed: the compared conditions and those the
 * data lock to the control's one value describe one control — named by its categorical values, "for
 * every" categorical condition and "at every" numeric one — then each other context condition by
 * mode. cmpd compared + dose shared, cmpd + dose compared, and dose compared with cmpd locked all
 * read "shared DMSO control for every cmpd at every dose".
 */
export function controlLine(m: CompareModel): string {
  const locked = m.ctx.filter((x) => x.mode === 'fixed' && !x.matchOk)
  const rest = m.ctx.filter((x) => !locked.includes(x))
  const by = (mode: CtxInfo['mode']): CtxInfo[] => rest.filter((x) => x.mode === mode)
  const one = (c: ConditionKey): string | null => {
    const v = valuesOf(m.test, c)
    return v.length === 1 ? valueName(c, v[0]) : null
  }
  let who: string
  if (m.CMP.length === 1 && !locked.length) {
    const X = m.CMP[0]
    const r = m.P[X]!.r
    if (isNumericCond(X)) {
      // its own baseline: "dose 0 of each cmpd for every cmpd" when cmpd is matched
      const cm = by('match').some((x) => x.c === 'cmpd')
      const lone = valuesOf(m.test, 'cmpd').length === 1
      who = cm
        ? `${valueName(X, r)} of ${lone ? one('cmpd') : `each ${condLabel('cmpd')}`} for ${lone ? one('cmpd') : `every ${condLabel('cmpd')}`}`
        : valueName(X, r)
    } else who = `shared ${valueName(X, r)} control for ${one(X) ?? `every ${condLabel(X)}`}`
  } else {
    const K = [...m.CMP, ...locked.map((x) => x.c)]
    const cat = orderConds(K).filter((c) => !isNumericCond(c))
    const numC = orderConds(K).filter((c) => isNumericCond(c))
    const ctrlVal = (c: ConditionKey): string => valuesOf(m.ctrl, c)[0] ?? m.P[c]?.r ?? ''
    const name = cat.length
      ? cat.map((c) => valueName(c, ctrlVal(c))).join(' · ')
      : numC.map((c) => valueName(c, ctrlVal(c))).join(' · ')
    const many = cat.filter((c) => !one(c))
    const single = cat.filter((c) => one(c))
    const forEvery = !cat.length
      ? ''
      : !many.length
        ? ` for ${single.map((c) => one(c)).join(' · ')}`
        : ` for every ${many.map(condLabel).join(' × ')}${single.length ? ` at ${single.map((c) => one(c)).join(' · ')}` : ''}`
    const atEvery = (cat.length ? numC : [])
      .filter((c) => valuesOf(m.test, c).length > 1)
      .map((c) => `at every ${condLabel(c)}`)
    who = `shared ${name} control${forEvery}${atEvery.length ? ' ' + atEvery.join(' and ') : ''}`
  }
  // the context: shared because the control has one value there ("at every dose"), shared at a level
  // picked from several ("with shared cell A control for every cell"), pooled, then matched ("per cell")
  const fixed = by('fixed')
  const at = fixed.filter((x) => x.Cv.length <= 1).map((x) => `at every ${condLabel(x.c)}`)
  const picked = fixed
    .filter((x) => x.Cv.length > 1)
    .map((x) => `, with shared ${valueName(x.c, x.val)} control for every ${condLabel(x.c)}`)
  const pooled = by('pool').map((x) => `${condLabel(x.c)}s`)
  const per = by('match')
    .map((x) => x.c)
    .filter((c) => !(m.CMP.length === 1 && !locked.length && isNumericCond(m.CMP[0]) && c === 'cmpd'))
  return (
    who +
    (at.length ? ' ' + at.join(' and ') : '') +
    picked.join('') +
    (pooled.length ? `, with ${pooled.join(' and ')} pooled` : '') +
    (per.length ? ', ' + per.map((c) => `per ${condLabel(c)}`).join(' ') : '')
  )
}

/** A fresh comparison: nothing compared yet — the user switches a condition on (its control then
 *  defaults to defaultControl's pick). */
export const emptyCompareState = (): CompareState => ({ cmp: {}, modes: {}, fixedVal: {}, drop: {} })

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v) => b.includes(v))

/**
 * A saved config as dialog state. A config the dialog wrote names its compared and pooled
 * conditions; one saved before is read as it ran: the compared condition inferred from the pins,
 * a condition picked alike on both sides matched, one with a single control value shared, and an
 * unmatched one pooled (unless the data lock it to shared).
 */
export function readCompareState(
  cfg: { num: CondSelector; den: CondSelector; match: ConditionKey[]; compared?: ConditionKey[]; pool?: ConditionKey[] },
  rows: readonly StandardRow[],
  active: readonly ConditionKey[]
): CompareState {
  const pinned = (s: CondSelector): boolean => Object.values(s).some((v) => v && v.length > 0)
  if (!pinned(cfg.num) && !pinned(cfg.den)) return emptyCompareState()
  const conds = orderConds(active).filter((c) => valuesOf(rows, c).length > 0)
  const compared = (cfg.compared ?? classifyConditions([...rows], cfg.num, cfg.den, [...active]).axis).filter((c) =>
    conds.includes(c)
  )
  const state: CompareState = { cmp: {}, modes: {}, fixedVal: {}, drop: {} }
  for (const c of compared) {
    const vs = valuesOf(rows, c)
    const r = cfg.den[c]?.[0] ?? defaultControl(rows, c)
    state.cmp[c] = { r, T: cfg.num[c]?.length ? [...cfg.num[c]!] : vs.filter((v) => v !== r) }
  }
  // the samples as compared, to tell a data lock (one control value) from a choice
  const test = rows.filter((r) => compared.every((c) => state.cmp[c]!.T.includes(cv(r, c) ?? '')))
  const ctrl = rows.filter((r) => compared.every((c) => cv(r, c) === state.cmp[c]!.r))
  for (const c of conds.filter((k) => !compared.includes(k))) {
    const vs = valuesOf(rows, c)
    const n = cfg.num[c]?.length ? cfg.num[c]! : null
    const d = cfg.den[c]?.length ? cfg.den[c]! : null
    const leftOut = (keep: string[] | null): string[] => (keep ? vs.filter((v) => !keep.includes(v)) : [])
    if (cfg.pool?.includes(c)) {
      state.modes[c] = 'pool'
      state.drop[c] = leftOut(n)
    } else if (cfg.match.includes(c) || (n && d && sameSet(n, d))) {
      state.modes[c] = 'match'
      state.drop[c] = leftOut(n)
    } else if (d && d.length === 1) {
      state.modes[c] = 'fixed'
      state.fixedVal[c] = d[0]
      state.drop[c] = leftOut(n)
    } else {
      // unmatched (saved before): pooled, unless the control holds one value there (shared)
      const locked = valuesOf(ctrl, c).length <= 1 && valuesOf(test, c).length > 1
      state.modes[c] = locked ? 'fixed' : 'pool'
      state.drop[c] = leftOut(n)
    }
    if (!state.drop[c]!.length) delete state.drop[c]
  }
  return state
}
