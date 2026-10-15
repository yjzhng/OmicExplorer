/**
 * Body of the contrast window's inter-dataset mode. The tile may have any number of inputs
 * wired; the user picks which two are dataset A (y) and B (x), switches on the conditions to
 * match on, and sees — per condition — which values will pair across the two datasets, plus the
 * context groups the run would produce. Rendered inside ComparisonDialog's shell.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'

import { condLabel, previewContrastPair, type ConditionKey, type PairFix } from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { UI } from '../ui/theme'
import { isPairable, toContrastSide } from './contrastPair'
import { Select } from './NodeConfigPanel'
import { PreviewTable, selectorStyles as S } from './selectorParts'
import { SideRows, type SideKey, type SideRow } from './SideRows'
import type { NodeResult } from './types'

/** One wired input, as the tile sees it. */
export interface PairInput {
  id: string
  name: string
  result?: NodeResult
}

const kindLabel = (r?: NodeResult): string =>
  r?.kind === 'compare' ? 'Compare' : r?.kind === 'standardize' ? 'Clean data' : 'not run'

/** Dropdown over the tile's wired inputs (name · kind). `exclude` greys the other side's pick. */
export function DatasetPick({
  inputs,
  value,
  exclude,
  onPick,
  label,
  style
}: {
  inputs: PairInput[]
  value?: string
  exclude?: string
  onPick: (id: string) => void
  /** optional inline label to the left (used by the intra-dataset picker) */
  label?: string
  style?: CSSProperties
}): ReactNode {
  // The app's dropdown (not the OS <select>), at screen scale since the window is a fixed overlay.
  const select = (
    <div style={styles.select}>
      <Select
        value={value ?? ''}
        placeholder="—"
        unscaled
        onChange={onPick}
        options={inputs.map((i) => ({
          value: i.id,
          label: `${i.name} · ${kindLabel(i.result)}`,
          disabled: exclude === i.id
        }))}
      />
    </div>
  )
  if (!label) return <div style={style}>{select}</div>
  // Labelled form (intra-dataset): the CONTRAST ON / MATCH ON head style on the left, control
  // inline to the right.
  return (
    <div style={{ ...styles.pickRow, ...style }}>
      <span style={S.condsHeadSwitch}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{select}</div>
    </div>
  )
}

export function PairContrastBody({
  inputs,
  a,
  b,
  onPick,
  match,
  onMatch,
  picks,
  onPickValue
}: {
  inputs: PairInput[]
  /** chosen dataset ids (may be undefined while fewer than two inputs are wired) */
  a?: string
  b?: string
  onPick: (side: 'a' | 'b', id: string) => void
  match: ConditionKey[]
  onMatch: (c: ConditionKey, on: boolean) => void
  /** per dataset, the values each condition is narrowed to (absent = all of that dataset's) */
  picks: Record<SideKey, Partial<Record<ConditionKey, string[]>>>
  onPickValue: (side: SideKey, c: ConditionKey, next: string[]) => void
}): ReactNode {
  const A = inputs.find((i) => i.id === a)
  const B = inputs.find((i) => i.id === b)
  const ready =
    !!A && !!B && isPairable(A.result) && isPairable(B.result) && A.result!.kind === B.result!.kind
  const fix: PairFix = useMemo(() => ({ a: { ...picks.a }, b: { ...picks.b } }), [picks])
  const preview = useMemo(
    () =>
      ready
        ? previewContrastPair(
            toContrastSide(A!.result),
            toContrastSide(B!.result),
            match,
            { a: A!.name, b: B!.name },
            fix
          )
        : null,
    [ready, A, B, match, fix]
  )

  // The same rows as within one dataset: each dataset's values picked on its side. A matched
  // condition pairs its picked values across the two (green: on both; grey: no partner); an
  // unmatched one is a slice, one value per dataset — values are never pooled across datasets.
  const rowSpecs = (): SideRow[] =>
    preview!.conditions.map((c): SideRow => {
      const v = preview!.values[c]!
      const matchable = preview!.candidates.includes(c)
      const on = matchable && match.includes(c)
      const pickOf = (s: SideKey): string[] => {
        const p = picks[s][c]
        return p ? v[s].filter((x) => p.includes(x)) : v[s]
      }
      const picked = { a: pickOf('a'), b: pickOf('b') }
      const note: Partial<Record<SideKey, string>> = {}
      for (const s of ['a', 'b'] as const) {
        if (v[s].length === 0) continue
        if (picked[s].length === 0) note[s] = 'pick at least one'
        else if (!on && picked[s].length > 1) note[s] = `pick one — not matched, so not pooled`
      }
      return {
        cond: c,
        role: on ? 'matched' : 'fixed',
        values: { a: v.a, b: v.b },
        picked,
        match: {
          on,
          disabled: !matchable,
          title: !matchable
            ? `${condLabel(c)} is on one dataset only — pick one ${condLabel(c)} there`
            : on
              ? 'Matched like-for-like — switch off to take one slice per dataset'
              : 'One slice per dataset — switch on to match like-for-like'
        },
        chip: (s, x, isOn) => {
          if (!isOn) return { title: `Add ${condLabel(c)} ${x}` }
          if (!on) return { title: `${condLabel(c)} ${x} on this dataset — click to leave out` }
          const other = s === 'a' ? picked.b : picked.a
          return other.includes(x)
            ? {
                look: S.valChipIncluded,
                title: `${condLabel(c)} = ${x} is on both datasets — paired`
              }
            : {
                look: { ...S.valChipIdle, opacity: 0.6 },
                title: `${condLabel(c)} = ${x} has no partner on the other dataset — skipped`
              }
        },
        note
      }
    })

  return (
    <>
      {/* Left/right like the intra-mode group A | group B columns (and Compare's numerator |
          denominator): A on the left is y, B on the right is x. */}
      <div style={styles.pick}>
        {/* The MATCH ON head style on the left, the A | B columns inline to the right. */}
        <div style={styles.pickRowHead}>
          {/* The head sits level with the selects (not their small labels above): a hidden
              label placeholder, then the head centred in a box the select's height. */}
          <div style={{ ...S.condsHeadSwitch, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ ...styles.sideLabel, visibility: 'hidden' }}>·</span>
            <span style={styles.headMid}>dataset</span>
          </div>
          <div style={styles.sidePair}>
            <div style={styles.sideCol}>
              <span style={styles.sideLabel}>dataset A (y-axis)</span>
              <DatasetPick inputs={inputs} value={a} exclude={b} onPick={(id) => onPick('a', id)} />
            </div>
            <span style={styles.vsRule} />
            <div style={styles.sideCol}>
              <span style={styles.sideLabel}>dataset B (x-axis)</span>
              <DatasetPick inputs={inputs} value={b} exclude={a} onPick={(id) => onPick('b', id)} />
            </div>
          </div>
        </div>
        {!ready && (
          <StatusNote kind="warn" style={{ marginTop: 2 }}>
            {inputs.length < 2
              ? 'Connect a second input (drag another edge into this tile).'
              : !A || !B
                ? 'Pick two datasets.'
                : 'The two datasets must be the same kind and run — two Compares, or two Clean data.'}
          </StatusNote>
        )}
      </div>
      {ready && preview && (
        <>
          <div style={S.conds}>
            {preview.conditions.length === 0 ? (
              <StatusNote kind="info">no conditions — joins on gene id alone</StatusNote>
            ) : (
              <SideRows
                labels={{ a: `dataset A · ${A!.name}`, b: `dataset B · ${B!.name}` }}
                rows={rowSpecs()}
                onPick={onPickValue}
                onMatch={onMatch}
              />
            )}
            <StatusNote kind="ok" style={S.matchedLine}>
              {preview.matched.length
                ? `matched on ${preview.matched.map(condLabel).join(', ')}`
                : 'matched on gene id only — one point per gene'}
            </StatusNote>
          </div>
          <div style={S.preview}>
            <div style={S.previewHead}>Contrast ({preview.groups} in total)</div>
            {preview.unpinned.length === 0 && preview.rows.length > 0 && (
              <PreviewTable columns={preview.columns} rows={preview.rows} />
            )}
            {preview.warnings.map((w) => (
              <StatusNote key={w} kind="warn">
                {w}
              </StatusNote>
            ))}
          </div>
        </>
      )}
    </>
  )
}

/** Select control height, shared so the DATASET head can centre on it. */
const SELECT_H = 26

const styles: Record<string, CSSProperties> = {
  pick: { display: 'flex', flexDirection: 'column', gap: 6, padding: '14px 14px 0' },
  pickRow: { display: 'flex', alignItems: 'center', gap: 10 },
  pickRowHead: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  headMid: { display: 'flex', alignItems: 'center', height: SELECT_H },
  sidePair: { display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 },
  fixBlock: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 },
  sideCol: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 },
  sideLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: UI.textMuted },
  vsRule: { width: 1, alignSelf: 'stretch', background: UI.border, flex: '0 0 auto' },
  // Box for the themed Select (its trigger fills it); height shared with the DATASET head.
  select: { display: 'flex', width: '100%', height: SELECT_H, boxSizing: 'border-box' }
}
