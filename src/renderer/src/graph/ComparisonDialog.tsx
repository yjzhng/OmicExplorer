/**
 * Interactive comparison builder. The user declares BOTH sides explicitly — no vehicle-name
 * guessing, no dose-0 assumption: numerator cond-value selection on the left, denominator on
 * the right, a match toggle per non-axis condition at the bottom, and a live preview (the
 * comparisons that will run + any warnings) beneath. Mirrors the engine's `previewCompare`.
 */
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

import {
  crossPairs,
  previewCompare,
  previewTwoWay,
  VALID_CONDITIONS,
  type CondSelector,
  type ConditionKey,
  type StandardRow
} from '../engine'
import { useGraph } from './store'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'

/** The two steps that share this window: Compare (t-test / two-way) and Contrast (divergence). */
export type SelectVariant = 'compare' | 'contrast'

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

/** True when the element is scrolled to (or doesn't overflow past) its bottom. */
const isAtEnd = (el: HTMLElement): boolean =>
  el.scrollHeight - el.scrollTop - el.clientHeight < 2

/** Scrollable preview table (one column per field, one row per context group) with a bottom
 *  fade that shows while there are more rows below, and disappears once scrolled to the end. */
function PreviewTable({ columns, rows }: { columns: string[]; rows: string[][] }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setAtEnd(isAtEnd(el))
  }, [columns, rows])
  return (
    <div style={styles.tableOuter}>
      <div ref={ref} style={styles.tableWrap} onScroll={(e) => setAtEnd(isAtEnd(e.currentTarget))}>
        <table style={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} style={styles.th}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} style={styles.td}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!atEnd && <div style={styles.fade} />}
    </div>
  )
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

/** Contrast preview: split the rows into the two explicit selections, join on the match context,
 *  and report how many genes pair per context group (the Contrast analogue of `previewCompare`). */
function previewContrast(
  rows: StandardRow[],
  num: CondSelector,
  den: CondSelector,
  match: ConditionKey[],
  active: ConditionKey[]
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
  if (!pinned(num) || !pinned(den)) warnings.push('Pin at least one value on each side (FC1 and FC2).')
  const recs = rows as unknown as Record<ConditionKey, unknown>[]
  const A = recs.filter((r) => rowMatchesSel(r, num, active))
  const B = recs.filter((r) => rowMatchesSel(r, den, active))
  // Only align on match dims both sides actually carry.
  const ctx = match.filter(
    (c) =>
      A.some((r) => r[c] != null && r[c] !== '') && B.some((r) => r[c] != null && r[c] !== '')
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
  const columns = [...ctx.map(String), 'genes paired']
  const tableRows: string[][] = ctxKeys.slice(0, 50).map((k) => {
    const aSet = aG.get(k)!
    const bSet = bG.get(k)!
    let n = 0
    for (const g of aSet) if (bSet.has(g)) n++
    return [...(ctx.length ? k.split('¦') : []), String(n)]
  })
  if (pinned(num) && pinned(den) && ctxKeys.length === 0)
    warnings.push('No genes pair across the two sides with the current match context.')
  const pooled = active.filter((c) => !ctx.includes(c))
  return { groups: ctxKeys.length, columns, rows: tableRows, matched: ctx, pooled, warnings }
}

export function ComparisonDialog({
  id,
  variant = 'compare',
  rows,
  active,
  initial,
  onClose
}: {
  id: string
  variant?: SelectVariant
  /** gene-level rows with condition fields (Compare/Standardize rows) for combos + preview */
  rows: StandardRow[]
  /** conditions offered as selectable (Standardize's active set, or those present upstream) */
  active: ConditionKey[]
  initial: { num: CondSelector; den: CondSelector; match: ConditionKey[]; analysis?: Analysis }
  onClose: () => void
}): ReactNode {
  const update = useGraph((s) => s.updateConfig)
  const mode = useUiTheme((s) => s.mode)
  const contrast = variant === 'contrast'
  const [analysis, setAnalysis] = useState<Analysis>(
    initial.analysis === 'two_way_anova' ? 'two_way_anova' : 'compare'
  )
  const [num, setNum] = useState<CondSelector>(() => ({ ...initial.num }))
  const [den, setDen] = useState<CondSelector>(() => ({ ...initial.den }))
  const [match, setMatch] = useState<ConditionKey[]>(() => [...initial.match])
  // Conditions the user has explicitly emptied on each side — auto-fill leaves these alone so a
  // forced single value can still be deselected (otherwise it would be re-pinned immediately).
  const [clearedNum, setClearedNum] = useState<Set<ConditionKey>>(() => new Set())
  const [clearedDen, setClearedDen] = useState<Set<ConditionKey>>(() => new Set())

  const combos = useMemo(() => combosOf(rows), [rows])
  // All distinct values per condition (every chip is always shown; non-co-occurring / invalid
  // ones are greyed out rather than hidden).
  const allValues = useMemo(() => {
    const out = {} as Record<ConditionKey, string[]>
    for (const c of VALID_CONDITIONS) {
      const seen = new Set<string>()
      for (const combo of combos) if (combo[c] !== '') seen.add(combo[c])
      out[c] = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    }
    return out
  }, [combos])
  const twoWay = !contrast && analysis === 'two_way_anova'

  // Values available for condition `c` on a side = distinct values of `c` among the sample-space
  // tuples that satisfy the side's OTHER pinned conditions. So pinning cmpd=dmso narrows dose to
  // the doses that actually co-occur with dmso (e.g. just 0).
  const availableFor = (sel: CondSelector, c: ConditionKey): string[] => {
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
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }
  // After a selection change, drop any other condition's chosen values that no longer co-occur.
  const pruneSelector = (sel: CondSelector, keep: ConditionKey): CondSelector => {
    const out: CondSelector = { ...sel }
    for (const c of active) {
      if (c === keep) continue
      const chosen = out[c]
      if (!chosen || chosen.length === 0) continue
      const avail = new Set(availableFor(out, c))
      const kept = chosen.filter((v) => avail.has(v))
      if (kept.length) out[c] = kept
      else delete out[c]
    }
    return out
  }
  // Once a side is constrained, any condition left with exactly one co-occurring value is forced —
  // so auto-select it (e.g. pin cmpd=dmso ⇒ dose has only 0 left ⇒ dose=0). Iterates to a fixpoint
  // since one auto-pick can collapse another. An unconstrained (fully "any") side is left alone.
  const autoFill = (sel: CondSelector, cleared: Set<ConditionKey>): CondSelector => {
    if (!active.some((c) => (sel[c]?.length ?? 0) > 0)) return sel
    let out = sel
    let changed = true
    while (changed) {
      changed = false
      for (const c of active) {
        if ((out[c]?.length ?? 0) > 0 || cleared.has(c)) continue
        const avail = availableFor(out, c)
        if (avail.length === 1) {
          out = { ...out, [c]: [avail[0]] }
          changed = true
        }
      }
    }
    return out
  }
  const finalizeSide = (sel: CondSelector, keep: ConditionKey, cleared: Set<ConditionKey>): CondSelector =>
    autoFill(pruneSelector(sel, keep), cleared)

  // How many comparison groups a num/den pair yields — evaluated on the tiny sample space so it's
  // cheap to run per candidate chip. 0 groups ⇒ the selection produces no valid comparison.
  const comparisonGroups = (n: CondSelector, d: CondSelector): number =>
    previewCompare({
      rows: combos as unknown as StandardRow[],
      num: n,
      den: d,
      match,
      activeConditions: active
    }).groups

  // Axis = conditions pinned on both sides with differing values → what's being compared. Those
  // rows are NOT offered a match toggle (they define the comparison, not the context).
  const pinnedOn = (sel: CondSelector, c: ConditionKey): boolean => (sel[c]?.length ?? 0) > 0
  const sameVals = (c: ConditionKey): boolean => {
    const a = new Set((num[c] ?? []).map(String))
    const b = new Set((den[c] ?? []).map(String))
    return a.size === b.size && [...a].every((x) => b.has(x))
  }
  const axis = active.filter((c) => pinnedOn(num, c) && pinnedOn(den, c) && !sameVals(c))
  const matchable = active.filter((c) => !axis.includes(c))

  const preview = useMemo(
    () =>
      contrast
        ? previewContrast(rows, num, den, match, active)
        : previewCompare({ rows, num, den, match, activeConditions: active }),
    [contrast, rows, num, den, match, active]
  )
  // Two-way ANOVA needs exactly two axes (two factors). Each factor may carry MULTIPLE numerator
  // and/or denominator levels — every numerator × denominator level pair runs as its own 2×2
  // interaction. Cheap to compute inline (≤4 conditions), so no memo.
  const twoWayCheck = ((): { warnings: string[]; label: string; ok: boolean } => {
    const warnings: string[] = []
    if (axis.length !== 2)
      warnings.push('2-way ANOVA needs exactly two conditions pinned (with differing values) on both sides.')
    for (const c of axis) {
      if (crossPairs(num[c] ?? [], den[c] ?? []).length === 0)
        warnings.push(`Factor “${c}”: pick at least one numerator and one denominator level.`)
    }
    const label = axis.length === 2 ? `${axis[0]} × ${axis[1]} interaction` : ''
    return { warnings, label, ok: axis.length === 2 && warnings.length === 0 }
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
      activeConditions: active
    })
  })()

  // Compare's preview carries the distinct comparison labels (axes); Contrast's doesn't.
  const axisLabels: string[] = !contrast && 'labels' in preview ? (preview.labels as string[]) : []
  // Apply is gated on a clean preview: any warning in the active mode blocks it.
  const activeWarnings = twoWay
    ? [...twoWayCheck.warnings, ...(twoWayView?.warnings ?? [])]
    : preview.warnings
  const canApply = activeWarnings.length === 0

  const toggleValue = (side: Side, c: ConditionKey, v: string): void => {
    const sel = side === 'num' ? num : den
    const cleared = side === 'num' ? clearedNum : clearedDen
    const cur = sel[c] ?? []
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]
    // Track explicit clears so auto-fill won't re-pin a value the user just removed.
    const nextCleared = new Set(cleared)
    if (next.length === 0) nextCleared.add(c)
    else nextCleared.delete(c)
    // Prune other conditions to co-occurring values, then auto-select any now forced to one.
    const finalized = finalizeSide({ ...sel, [c]: next }, c, nextCleared)
    if (side === 'num') {
      setNum(finalized)
      setClearedNum(nextCleared)
    } else {
      setDen(finalized)
      setClearedDen(nextCleared)
    }
  }
  const toggleMatch = (c: ConditionKey): void =>
    setMatch((m) => (m.includes(c) ? m.filter((x) => x !== c) : [...m, c]))

  const apply = (): void => {
    const clean = (sel: CondSelector): CondSelector => {
      const out: CondSelector = {}
      for (const c of active) if ((sel[c]?.length ?? 0) > 0) out[c] = sel[c]
      return out
    }
    const cleanNum = clean(num)
    const cleanDen = clean(den)
    if (contrast) {
      // Contrast: FC1 = num selection, FC2 = den selection, aligned on the matchable context.
      update(id, { num: cleanNum, den: cleanDen, match: match.filter((c) => matchable.includes(c)) })
      onClose()
      return
    }
    if (twoWay) {
      // Derive the two factors from the pinned axes for the existing two-way engine/run path.
      const [a, b] = axis
      update(id, {
        analysis: 'two_way_anova',
        num: cleanNum,
        den: cleanDen,
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
      update(id, {
        analysis: 'compare',
        num: cleanNum,
        den: cleanDen,
        match: match.filter((c) => matchable.includes(c))
      })
    }
    onClose()
  }

  const selector = (side: Side, sel: CondSelector): ReactNode => {
    const otherSel = side === 'num' ? den : num
    const otherPinned = active.some((k) => pinnedOn(otherSel, k))
    const cleared = side === 'num' ? clearedNum : clearedDen
    return (
      <div style={styles.side}>
        <div style={styles.sideHead}>
          {side === 'num' ? (contrast ? 'FC1 (side A)' : 'Numerator') : contrast ? 'FC2 (side B)' : 'Denominator'}
        </div>
        {active.map((c) => {
          const chosen = sel[c] ?? []
          // Every value is shown; those that don't co-occur with this side's other pins are greyed.
          const coOccur = new Set(availableFor(sel, c))
          const vals = allValues[c]
          return (
            <div key={c} style={styles.condRow}>
              <span style={styles.condLabel}>{c}</span>
              <div style={styles.chips}>
                {vals.length === 0 && <span style={styles.anyTag}>—</span>}
                {vals.map((v) => {
                  const on = chosen.includes(v)
                  // Grey out (don't hide) a value that either doesn't co-occur with this side's
                  // other pins, or would leave no valid comparison against the other side.
                  let disabled = false
                  let reason: string | undefined
                  if (!on) {
                    if (!coOccur.has(v)) {
                      disabled = true
                      reason = 'Not present with this side’s current selection'
                    } else if (!contrast && otherPinned) {
                      const nextThis = finalizeSide({ ...sel, [c]: [...chosen, v] }, c, cleared)
                      const nextNum = side === 'num' ? nextThis : num
                      const nextDen = side === 'den' ? nextThis : den
                      if (comparisonGroups(nextNum, nextDen) === 0) {
                        disabled = true
                        reason = 'No valid comparison with the current other side'
                      }
                    }
                  }
                  return (
                    <button
                      key={v}
                      disabled={disabled}
                      title={reason}
                      onClick={() => toggleValue(side, c, v)}
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
                {chosen.length === 0 && vals.length > 0 && <span style={styles.anyTag}>any</span>}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return createPortal(
    // Re-establish the theme CSS variables inside the portal (document.body is outside the app
    // root where they're defined), otherwise UI.* (var(--panel) …) resolve to transparent.
    <div style={cssVars(PALETTES[mode])}>
      <div style={styles.scrim} onClick={onClose} />
      <div style={styles.modal} role="dialog" aria-label={contrast ? 'Configure contrast' : 'Configure comparison'}>
        <div style={styles.head}>
          <span style={styles.title}>{contrast ? 'Configure contrast' : 'Configure comparison'}</span>
          {/* Analysis toggle (Compare only): a plain two-level comparison, or a 2×2 interaction. */}
          {!contrast && (
            <div style={styles.pill}>
              {(['compare', 'two_way_anova'] as Analysis[]).map((a) => (
                <button
                  key={a}
                  onClick={() => setAnalysis(a)}
                  style={{ ...styles.pillBtn, ...(analysis === a ? styles.pillBtnOn : null) }}
                >
                  {a === 'compare' ? 't-test' : '2-way ANOVA'}
                </button>
              ))}
            </div>
          )}
          <button style={{ ...styles.close, ...(contrast ? { marginLeft: 'auto' } : null) }} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={styles.sides}>
          {selector('num', num)}
          <div style={styles.vsRule} />
          {selector('den', den)}
        </div>

        {!twoWay && (
          <div style={styles.matchRow}>
            <span style={styles.matchLabel}>Match on</span>
            {matchable.length === 0 && <span style={styles.anyTag}>— (no context conditions)</span>}
            {matchable.map((c) => {
              const on = match.includes(c)
              return (
                <label key={c} style={styles.matchItem}>
                  <input type="checkbox" checked={on} onChange={() => toggleMatch(c)} />
                  {c}
                </label>
              )
            })}
          </div>
        )}

        {twoWay ? (
          <div style={styles.preview}>
            <div style={styles.previewHead}>
              Interaction (2-way ANOVA)
              {twoWayView ? ` · ${twoWayView.groups} context${twoWayView.groups === 1 ? '' : 's'}` : ''}
            </div>
            {twoWayCheck.label && <div style={styles.previewItem}>{twoWayCheck.label}</div>}
            {/* One X×Y interaction per combination of the non-factor (context) conditions. */}
            {twoWayView && twoWayView.rows.length > 0 && (
              <PreviewTable columns={twoWayView.columns} rows={twoWayView.rows} />
            )}
            <div style={styles.previewMeta}>
              Pin exactly two conditions (the two factors), one numerator + one denominator level
              each. The interaction is (A₁·B₁ − A₁·B₀) − (A₀·B₁ − A₀·B₀), computed once per context
              {twoWayView && twoWayView.context.length ? ` (${twoWayView.context.join(', ')})` : ''}.
              {twoWayView?.doseExcluded ? ' Vehicle side matched with dose excluded.' : ''}
            </div>
            {twoWayCheck.warnings.map((w) => (
              <div key={w} style={styles.warn}>
                ⚠ {w}
              </div>
            ))}
            {twoWayView?.warnings.map((w) => (
              <div key={w} style={styles.warn}>
                ⚠ {w}
              </div>
            ))}
          </div>
        ) : (
          <div style={styles.preview}>
            <div style={styles.previewHead}>
              {contrast ? 'Contrast' : 'Comparisons'} ({preview.groups} context
              {preview.groups === 1 ? '' : 's'}
              {axisLabels.length > 1 ? ` · ${axisLabels.length} axes` : ''})
            </div>
            {preview.rows.length === 0 ? (
              <div style={styles.previewEmpty}>Nothing yet — pin a value on each side.</div>
            ) : (
              // One row per context combination actually compared.
              <PreviewTable columns={preview.columns} rows={preview.rows} />
            )}
            <div style={styles.previewMeta}>
              matched: {preview.matched.length ? preview.matched.join(', ') : '—'} · pooled:{' '}
              {preview.pooled.length ? preview.pooled.join(', ') : '—'}
            </div>
            {preview.warnings.map((w) => (
              <div key={w} style={styles.warn}>
                ⚠ {w}
              </div>
            ))}
          </div>
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
  close: {
    marginLeft: 12,
    background: 'transparent',
    border: 'none',
    color: UI.textMuted,
    fontSize: 14,
    cursor: 'pointer'
  },
  sides: { display: 'flex', gap: 0, padding: 14, overflow: 'auto' },
  side: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  sideHead: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700
  },
  vsRule: { width: 1, background: UI.border, margin: '0 14px', alignSelf: 'stretch' },
  condRow: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  condLabel: { width: 44, flex: '0 0 auto', fontSize: 12, color: UI.textMuted, paddingTop: 3 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  valChip: {
    background: 'transparent',
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    padding: '2px 9px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  valChipOn: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  valChipDisabled: { opacity: 0.3, cursor: 'not-allowed' },
  anyTag: { fontSize: 11, color: UI.textMuted, fontStyle: 'italic' },
  matchRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    borderTop: `1px solid ${UI.border}`,
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  matchLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    fontWeight: 700
  },
  matchItem: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  preview: { padding: '12px 16px', overflow: 'auto', flex: 1, minHeight: 0 },
  previewHead: { fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 },
  previewEmpty: { fontSize: 12, color: UI.textMuted },
  previewItem: { fontSize: 12, color: UI.text, fontFamily: 'ui-monospace, monospace', marginBottom: 6 },
  tableOuter: { position: 'relative' },
  tableWrap: {
    maxHeight: 200,
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  // Bottom fade cue: sits inside the table's border, hinting there are more rows below.
  fade: {
    position: 'absolute',
    left: 1,
    right: 1,
    bottom: 1,
    height: 28,
    pointerEvents: 'none',
    borderRadius: '0 0 6px 6px',
    background: `linear-gradient(to bottom, rgba(0,0,0,0), ${UI.panel})`
  },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 11 },
  th: {
    position: 'sticky',
    top: 0,
    background: UI.panelAlt,
    color: UI.textMuted,
    textAlign: 'left',
    padding: '4px 8px',
    fontWeight: 700,
    borderBottom: `1px solid ${UI.border}`,
    whiteSpace: 'nowrap'
  },
  td: {
    padding: '3px 8px',
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    whiteSpace: 'nowrap',
    fontFamily: 'ui-monospace, monospace'
  },
  previewMeta: { fontSize: 11, color: UI.textMuted, marginTop: 8 },
  warn: { fontSize: 12, color: '#e2b93b', marginTop: 6 },
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
