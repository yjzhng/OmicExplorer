/**
 * Interactive comparison builder. One row per condition with a "compare on" switch: the switched-on
 * condition is compared (numerator values vs denominator values; two switches for 2-way ANOVA), and
 * every other condition is like-for-like context with its values as inclusion filters. Only as
 * many switches as the analysis allows can be on, so the structure is always a valid comparison.
 * A live preview (the comparisons that will run + any warnings) sits beneath. Mirrors the engine's
 * `previewCompare` / `classifyConditions`.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import {
  crossPairs,
  classifyConditions,
  previewCompare,
  previewContrastPair,
  previewTwoWay,
  VALID_CONDITIONS,
  type CondSelector,
  type ConditionKey,
  type PairFix,
  type StandardRow
} from '../engine'
import { useGraph } from './store'
import type { ContrastConfig } from './types'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { StatusNote } from '../ui/StatusNote'
import { PreviewTable, selectorStyles } from './selectorParts'
import { pairSides, selectorRowsOf, toContrastSide } from './contrastPair'
import { DatasetPick, PairContrastBody, type PairInput } from './PairContrastDialog'
import { useUiTheme } from '../ui/useUiTheme'

/** The two steps that share this window: Compare (t-test / two-way) and Contrast (divergence). */
export type SelectVariant = 'compare' | 'contrast'
export type ContrastSource = 'select' | 'pair'

type Analysis = 'compare' | 'two_way_anova'

type Side = 'num' | 'den'
type Combo = Record<ConditionKey, string>

/** Distinct condition-tuples ('' = absent) from the upstream table — the small "sample space"
 *  the value chips are derived from (far smaller than the gene×sample rows). */
function combosOf(rows: StandardRow[]): Combo[] {
  const seen = new Set<string>()
  const out: Combo[] = []
  for (const r of rows) {
    const rec = {} as Combo
    for (const c of VALID_CONDITIONS) rec[c] = r[c] == null || r[c] === '' ? '' : String(r[c])
    const key = VALID_CONDITIONS.map((c) => rec[c]).join('|')
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
    const v = r[c]
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
  const ctx = match.filter(
    (c) => A.some((r) => r[c] != null && r[c] !== '') && B.some((r) => r[c] != null && r[c] !== '')
  )
  const ctxKey = (r: Record<ConditionKey, unknown>): string =>
    ctx.map((c) => String(r[c] ?? '')).join('¦')
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
  const columns = ['group A', '', 'group B', ...ctx.map(String), 'paired genes']
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
  const axis = VALID_CONDITIONS.filter(
    (c) => active.includes(c) && pinnedOn(num, c) && pinnedOn(den, c) && !sameSetOf(num[c], den[c])
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
  initial,
  pair,
  onClose
}: {
  id: string
  variant?: SelectVariant
  /** gene-level rows with condition fields (Compare/Standardize rows) for combos + preview */
  rows: StandardRow[]
  /** conditions offered as selectable (Standardize's active set, or those present upstream) */
  active: ConditionKey[]
  initial: {
    num: CondSelector
    den: CondSelector
    match: ConditionKey[]
    analysis?: Analysis
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
  onClose: () => void
}): ReactNode {
  const update = useGraph((s) => s.updateConfig)
  const mode = useUiTheme((s) => s.mode)
  const contrast = variant === 'contrast'
  const [analysis, setAnalysis] = useState<Analysis>(
    initial.analysis === 'two_way_anova' ? 'two_way_anova' : 'compare'
  )
  const twoWay = !contrast && analysis === 'two_way_anova'
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
  const [pairFix, setPairFix] = useState<PairFix>(initial.pairFix ?? { a: {}, b: {} })
  const pairReady = (() => {
    const A = pair?.find((i) => i.id === pairPick.a)?.result
    const B = pair?.find((i) => i.id === pairPick.b)?.result
    if (!A || !B || !(A.kind === 'compare' || A.kind === 'standardize') || B.kind !== A.kind)
      return false
    // …and nothing left to pool: every unmatched condition fixed to one slice per dataset.
    return (
      previewContrastPair(
        toContrastSide(A),
        toContrastSide(B),
        pairMatch,
        { a: 'A', b: 'B' },
        pairFix
      ).unpinned.length === 0
    )
  })()

  const combos = useMemo(() => combosOf(rows), [rows])
  // All distinct values per condition (numeric-aware order).
  const allValues = useMemo(() => {
    const out = {} as Record<ConditionKey, string[]>
    for (const c of VALID_CONDITIONS) {
      const seen = new Set<string>()
      for (const combo of combos) if (combo[c] !== '') seen.add(combo[c])
      out[c] = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }
    return out
  }, [combos])

  // ── roles ──────────────────────────────────────────────────────────────────────
  // Every active condition is either COMPARED (its switch on: numerator values vs denominator
  // values) or MATCHED (context: one comparison per combination of its included values). A t-test
  // compares exactly one condition, so once a switch is on the others are disabled; 2-way ANOVA
  // allows two (the factors, in switch-on order).
  const [compared, setCompared] = useState<ConditionKey[]>(() => {
    const ax = contrast
      ? active.filter(
          (c) =>
            pinnedOn(initial.num, c) &&
            pinnedOn(initial.den, c) &&
            !sameSetOf(initial.num[c], initial.den[c])
        )
      : classifyConditions(rows, initial.num, initial.den, active).axis
    return VALID_CONDITIONS.filter((c) => ax.includes(c))
  })
  const ordered = useMemo(() => VALID_CONDITIONS.filter((c) => active.includes(c)), [active])
  const matched = useMemo(() => ordered.filter((c) => !compared.includes(c)), [ordered, compared])
  // Compared values per side; matched values to INCLUDE (absent = every value).
  const [numVals, setNumVals] = useState<CondSelector>(() => {
    const out: CondSelector = {}
    for (const c of compared)
      if (pinnedOn(initial.num, c)) out[c] = [...(initial.num[c] as string[])]
    return out
  })
  const [denVals, setDenVals] = useState<CondSelector>(() => {
    const out: CondSelector = {}
    for (const c of compared)
      if (pinnedOn(initial.den, c)) out[c] = [...(initial.den[c] as string[])]
    return out
  })
  const [include, setInclude] = useState<CondSelector>(() => {
    // A matched condition pinned to the same subset on both sides was an inclusion filter.
    const out: CondSelector = {}
    for (const c of matched)
      if (pinnedOn(initial.num, c) && sameSetOf(initial.num[c], initial.den[c]))
        out[c] = [...(initial.num[c] as string[])]
    return out
  })
  const includedOf = (c: ConditionKey): string[] => include[c] ?? allValues[c]

  // The engine's num/den selectors, assembled from the roles: compared → each side's values;
  // matched with a subset → that subset pinned on BOTH sides (context, to the engine).
  const { num, den } = useMemo(() => {
    const num: CondSelector = {}
    const den: CondSelector = {}
    for (const c of compared) {
      if (numVals[c]?.length) num[c] = numVals[c]
      if (denVals[c]?.length) den[c] = denVals[c]
    }
    for (const c of matched) {
      const inc = include[c]
      if (inc && inc.length > 0 && inc.length < allValues[c].length) {
        num[c] = inc
        den[c] = inc
      }
    }
    return { num, den }
  }, [compared, matched, numVals, denVals, include, allValues])

  // Values a compared condition can take on a side, given that side's OTHER pins (the other
  // compared conditions' values on that side + the matched inclusions).
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

  // Numerator: multi-select (each level is its own comparison). Denominator: exactly ONE
  // reference level — the other chips grey out while one is chosen (see sideChips).
  const toggleCompared = (side: Side, c: ConditionKey, v: string): void => {
    const setter = side === 'num' ? setNumVals : setDenVals
    setter((prev) => {
      const cur = prev[c] ?? []
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
      return { ...prev, [c]: next }
    })
  }
  const toggleIncluded = (c: ConditionKey, v: string): void => {
    setInclude((prev) => {
      const cur = prev[c] ?? allValues[c]
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
      if (next.length === 0) return prev // at least one value stays included
      const out = { ...prev }
      if (next.length === allValues[c].length) delete out[c]
      else out[c] = next
      return out
    })
  }

  const maxCompared = twoWay ? 2 : 1
  const setComparedOn = (c: ConditionKey, on: boolean): void => {
    setCompared((prev) => {
      if (on) return prev.includes(c) || prev.length >= maxCompared ? prev : [...prev, c]
      return prev.filter((x) => x !== c)
    })
    // Reset the condition's values for its new role.
    for (const set of [setNumVals, setDenVals, setInclude])
      set((p) => {
        const n = { ...p }
        delete n[c]
        return n
      })
  }
  // ── derived: axis, match set, preview ──────────────────────────────────────────
  // The compared conditions ARE the axis; every matched condition is matched like-for-like (the engine
  // drops those the denominator is invariant on). No pooling.
  const axis = compared
  const match = matched
  const preview = useMemo(
    () =>
      contrast
        ? previewContrast(rows, num, den, match, active, compared)
        : previewCompare({ rows, num, den, match, activeConditions: active }),
    [contrast, rows, num, den, match, active, compared]
  )
  // Role-level problems the engine can't see (it only gets selectors).
  const roleWarnings: string[] = []
  if (!twoWay && axis.length === 0) roleWarnings.push('Switch on the condition to be compared.')
  for (const c of axis) {
    if (!(numVals[c]?.length ?? 0)) roleWarnings.push(`${c}: pick the numerator value(s).`)
    if (!(denVals[c]?.length ?? 0)) roleWarnings.push(`${c}: pick the denominator value(s).`)
  }

  // Two-way ANOVA needs exactly two compared conditions (two factors). Each factor may carry
  // MULTIPLE numerator and/or denominator levels — every numerator × denominator level pair runs
  // as its own 2×2 interaction. Cheap to compute inline (≤4 conditions), so no memo.
  const twoWayCheck = ((): { warnings: string[]; ok: boolean } => {
    const warnings: string[] = []
    if (axis.length !== 2)
      warnings.push('2-way ANOVA needs two conditions switched on (the two factors).')
    for (const c of axis) {
      if (crossPairs(num[c] ?? [], den[c] ?? []).length === 0)
        warnings.push(`Factor “${c}”: pick at least one numerator and one denominator level.`)
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
    ? [...twoWayCheck.warnings, ...(twoWayView?.warnings ?? [])]
    : [...roleWarnings, ...preview.warnings]
  const canApply = pairMode ? pairReady : activeWarnings.length === 0

  const apply = (): void => {
    if (contrast) {
      // Contrast: inter-dataset → just the match context (A/B are the edges); intra → group A = num
      // selection, group B = den selection, aligned on the matched context.
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
    if (twoWay) {
      // Derive the two factors from the compared conditions for the existing two-way run path.
      const [a, b] = axis
      update(id, {
        analysis: 'two_way_anova',
        num,
        den,
        match,
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
    } else {
      update(id, { analysis: 'compare', num, den, match })
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
    // Context = the other matched conditions the engine actually matches on — not those it has
    // found invariant on a side (dose on a vehicle), which never take part in matching.
    const invariant = new Set('invariant' in preview ? preview.invariant : [])
    const others = matched.filter((k) => k !== c && !invariant.has(k))
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
  const condSwitch = (c: ConditionKey): ReactNode => {
    const on = axis.includes(c)
    const disabled = !on && axis.length >= maxCompared
    return (
      <button
        role="switch"
        aria-checked={on}
        aria-label={`Compare on ${c}`}
        disabled={disabled}
        title={
          on
            ? `${contrast ? 'Contrasted' : 'Compared'} — switch off to use as context`
            : disabled
              ? twoWay
                ? 'Two factors are already chosen'
                : `A ${contrast ? 'contrast' : 'comparison'} is on one condition — switch the other off first`
              : `Switch on to ${contrast ? 'contrast' : 'compare'} on this condition`
        }
        onClick={() => setComparedOn(c, !on)}
        style={{
          ...styles.switchTrack,
          background: on ? UI.accent : UI.border,
          justifyContent: on ? 'flex-end' : 'flex-start',
          opacity: disabled ? 0.35 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        <span style={styles.switchKnob} />
      </button>
    )
  }
  const sideChips = (side: Side, c: ConditionKey): ReactNode => {
    const chosen = (side === 'num' ? numVals : denVals)[c] ?? []
    const other = (side === 'num' ? denVals : numVals)[c] ?? []
    const avail = availableFor(side, c)
    return (
      <>
        <div style={styles.chips}>
          {allValues[c].map((v) => {
            const on = chosen.includes(v)
            // Greyed (not hidden): a value on the other side (a value can't be compared against
            // itself), or one that doesn't co-occur with this side's other selections.
            let disabled = false
            let reason: string | undefined
            if (!on) {
              if (other.includes(v)) {
                disabled = true
                reason = 'Already on the other side — a value can’t be compared against itself'
              } else if (!avail.has(v)) {
                disabled = true
                reason = 'Not present with this side’s current selection'
              } else if (side === 'num' && chosen.length + 1 >= allValues[c].length) {
                // Taking the last free value would leave nothing for the denominator.
                disabled = true
                reason = 'Leave at least one value for the denominator'
              } else if (side === 'den' && chosen.length >= 1) {
                // One reference only: the rest wait until it's deselected.
                disabled = true
                reason = 'One reference value only — deselect the current one first'
              }
            }
            return (
              <button
                key={v}
                className="oe-chip"
                disabled={disabled}
                title={reason}
                onClick={() => toggleCompared(side, c, v)}
                style={{
                  ...styles.valChip,
                  ...(on ? styles.valChipOn : null),
                  ...(disabled ? styles.valChipDisabled : null)
                }}
              >
                {v}
              </button>
            )
          })}
        </div>
        {/* The side's own problem, right where it's fixed. */}
        {chosen.length === 0 && (
          <StatusNote kind="info" style={{ marginTop: 2 }}>
            {side === 'num' ? 'pick the value(s) to compare' : 'pick the one reference value'}
          </StatusNote>
        )}
      </>
    )
  }
  const condRow = (c: ConditionKey): ReactNode => {
    const on = axis.includes(c)
    const inc = includedOf(c)
    return (
      <div key={c} style={styles.condRow}>
        <div style={styles.condHead}>
          {condSwitch(c)}
          <span style={{ ...styles.condName, ...(on ? styles.condNameOn : null) }}>{c}</span>
        </div>
        {on ? (
          <div style={styles.sidePair}>
            <div style={styles.sideCol}>
              <span style={styles.sideLabel}>{contrast ? 'group A (y-axis)' : 'numerator'}</span>
              {sideChips('num', c)}
            </div>
            <span style={styles.vsRule} />
            <div style={styles.sideCol}>
              <span style={styles.sideLabel}>{contrast ? 'group B (x-axis)' : 'denominator'}</span>
              {sideChips('den', c)}
            </div>
          </div>
        ) : (
          // Matched context: which values to include (all by default; at least one stays).
          (() => {
            const live = axis.length > 0
            const N = live ? contextsOf('num', c) : null
            const D = live ? contextsOf('den', c) : null
            // Invariant on a side: that side has ≤1 value → not matched, its slice is fixed.
            const nCount = N?.byValue.size ?? 0
            const dCount = D?.byValue.size ?? 0
            const fixedOn: Side | null = !live
              ? null
              : dCount <= 1 && nCount > 1
                ? 'den'
                : nCount <= 1 && dCount > 1
                  ? 'num'
                  : null
            const fixedLabel =
              fixedOn === 'den'
                ? contrast
                  ? 'group B'
                  : 'denominator'
                : contrast
                  ? 'group A'
                  : 'numerator'
            // The contexts actually compared: those present on both sides.
            const shared = N && D ? [...N.contexts].filter((x) => D.contexts.has(x)) : []
            return (
              <div style={styles.chips}>
                {allValues[c].length === 0 && <span style={styles.anyTag}>—</span>}
                {allValues[c].map((v) => {
                  const vOn = inc.includes(v)
                  let look: CSSProperties | null = null
                  let title = vOn ? 'Included — click to leave out' : 'Left out — click to include'
                  if (vOn && live && N && D) {
                    if (fixedOn) {
                      // Fan out on the varying side against the fixed side's single slice —
                      // a partial match by nature, so it takes the partial look.
                      look = styles.valChipPartial
                      title = `Runs against the ${fixedLabel}'s single slice (${c} is fixed there) — click to leave out`
                    } else {
                      const nC = N.byValue.get(v) ?? new Set<string>()
                      const dC = D.byValue.get(v) ?? new Set<string>()
                      const paired = shared.filter((x) => nC.has(x) && dC.has(x))
                      if (paired.length === 0) {
                        // No sample pair anywhere → stays plain grey (nothing to match).
                        look = styles.valChipIdle
                        title = `No matching sample pair at ${c} = ${v} in any context — skipped`
                      } else if (paired.length < shared.length) {
                        look = styles.valChipPartial
                        title = `${c} = ${v} is compared in ${paired.length} of ${shared.length} contexts — missing on a side in the rest`
                      } else look = styles.valChipIncluded
                    }
                  } else if (vOn) look = styles.valChipIdle
                  return (
                    <button
                      key={v}
                      className="oe-chip"
                      onClick={() => toggleIncluded(c, v)}
                      title={title}
                      style={{ ...styles.valChip, ...look }}
                    >
                      {v}
                    </button>
                  )
                })}
              </div>
            )
          })()
        )}
      </div>
    )
  }

  return createPortal(
    // Re-establish the theme CSS variables inside the portal (document.body is outside the app
    // root where they're defined), otherwise UI.* (var(--panel) …) resolve to transparent.
    <div style={cssVars(PALETTES[mode])}>
      {/* Chips are buttons: no focus ring after a click (it lingered as a dark outline), but keep
          one for keyboard focus. */}
      <style>{`.oe-chip:focus{outline:none}.oe-chip:focus-visible{box-shadow:0 0 0 2px var(--accent)}`}</style>
      <div style={styles.scrim} onClick={onClose} />
      <div
        style={styles.modal}
        role="dialog"
        aria-label={contrast ? 'Configure contrast' : 'Configure comparison'}
      >
        <div style={styles.head}>
          <span style={styles.title}>
            {contrast ? 'Configure contrast' : 'Configure comparison'}
          </span>
          {/* Mode toggle: Compare picks the analysis (plain two-level vs 2×2 interaction); Contrast
              picks its inputs (two groups from one upstream vs two upstreams). */}
          {contrast ? (
            <div style={styles.pill}>
              {(['select', 'pair'] as ContrastSource[]).map((s) => {
                // Inter-dataset needs two inputs wired; intra-dataset always works.
                const off = s === 'pair' && inputCount < 2
                return (
                  <button
                    key={s}
                    disabled={off}
                    title={
                      off ? 'Wire a second input into the tile to contrast two datasets' : undefined
                    }
                    onClick={() => setSource(s)}
                    style={{
                      ...styles.pillBtn,
                      ...(source === s ? styles.pillBtnOn : off ? styles.pillBtnOff : null)
                    }}
                  >
                    {s === 'select' ? 'intra-dataset' : 'inter-dataset'}
                  </button>
                )
              })}
            </div>
          ) : (
            <div style={styles.pill}>
              {(['compare', 'two_way_anova'] as Analysis[]).map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    setAnalysis(a)
                    // t-test compares one condition: drop any second factor left from 2-way.
                    if (a === 'compare') setCompared((p) => p.slice(0, 1))
                  }}
                  style={{ ...styles.pillBtn, ...(analysis === a ? styles.pillBtnOn : null) }}
                >
                  {a === 'compare' ? 't-test' : '2-way ANOVA'}
                </button>
              ))}
            </div>
          )}
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
            onToggle={(c) =>
              setPairMatch((m) => (m.includes(c) ? m.filter((x) => x !== c) : [...m, c]))
            }
            fix={pairFix}
            onFix={(side, c, value) =>
              setPairFix((f) => ({ ...f, [side]: { ...f[side], [c]: value } }))
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
                  <div style={styles.condsHead}>
                    <span style={styles.condsHeadSwitch}>
                      {contrast ? 'contrast on' : 'compare on'}
                    </span>
                    {axis.length < maxCompared && (
                      <StatusNote kind="info" inline>
                        {twoWay
                          ? 'switch on the two factors'
                          : 'switch on the condition to be compared'}
                      </StatusNote>
                    )}
                  </div>
                  {ordered.map(condRow)}
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
                          : 'numerator'
                        : contrast
                          ? 'group B'
                          : 'denominator'
                    const parts: string[] = [
                      `matched on ${matchedOn.length ? matchedOn.join(', ') : '—'}`
                    ]
                    if (fixed.length > 0) {
                      if (twoWay) parts.push(`fixed in ${fixed.join(', ')}`)
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
                              ? `fixed in ${conds.join(', ')}`
                              : `fixed ${sideName(s)} in ${conds.join(', ')}`
                          )
                      }
                    }
                    return (
                      <StatusNote kind="ok" style={styles.matchedLine}>
                        {parts.join(' · ')}
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
                          log₂ abundance ~ {axis[0]} + {axis[1]} + {axis[0]} × {axis[1]}
                        </div>
                        <div style={styles.previewItemNote}>
                          Welch t-test on the {axis[0]} × {axis[1]} interaction
                          {twoWayView && twoWayView.context.length
                            ? `, for each ${twoWayView.context.join(' × ')}`
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
                      {contrast ? 'Contrast' : 'Comparisons'} ({preview.groups} in total)
                    </div>
                    {!contrast && axis.length === 1 && (
                      <div style={styles.previewItem}>
                        <div>log₂ abundance ~ {axis[0]}</div>
                        <div style={styles.previewItemNote}>
                          Welch t-test
                          {preview.matched.length
                            ? `, for each ${preview.matched.join(' × ')}`
                            : ''}
                        </div>
                      </div>
                    )}
                    {/* One row per context combination actually compared. */}
                    {preview.rows.length > 0 && (
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
    document.body
  )
}

const styles: Record<string, CSSProperties> = {
  ...selectorStyles,
  scrim: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 70 },
  modal: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
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
  pill: {
    marginLeft: 'auto',
    display: 'inline-flex',
    gap: 4,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: 3,
    background: UI.panel
  },
  pillBtn: {
    border: 'none',
    borderRadius: 999,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    background: 'transparent',
    color: UI.text
  },
  pillBtnOn: { background: UI.accent, color: UI.accentText },
  pillBtnOff: { opacity: 0.4, cursor: 'default' },
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
