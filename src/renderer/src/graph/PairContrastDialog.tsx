/**
 * Body of the contrast window's inter-dataset mode. The tile may have any number of inputs
 * wired; the user picks which two are dataset A (y) and B (x), switches on the conditions to
 * match on, and sees — per condition — which values will pair across the two datasets, plus the
 * context groups the run would produce. Rendered inside ComparisonDialog's shell.
 */
import { useMemo, type CSSProperties, type ReactNode } from 'react'

import { previewContrastPair, type ConditionKey, type PairFix } from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { UI } from '../ui/theme'
import { isPairable, toContrastSide } from './contrastPair'
import { Select } from './NodeConfigPanel'
import { PreviewTable, selectorStyles as S } from './selectorParts'
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
  onToggle,
  fix,
  onFix
}: {
  inputs: PairInput[]
  /** chosen dataset ids (may be undefined while fewer than two inputs are wired) */
  a?: string
  b?: string
  onPick: (side: 'a' | 'b', id: string) => void
  match: ConditionKey[]
  onToggle: (c: ConditionKey) => void
  /** the slice each unmatched condition is fixed to, per dataset */
  fix: PairFix
  onFix: (side: 'a' | 'b', c: ConditionKey, value: string) => void
}): ReactNode {
  const A = inputs.find((i) => i.id === a)
  const B = inputs.find((i) => i.id === b)
  const ready =
    !!A && !!B && isPairable(A.result) && isPairable(B.result) && A.result!.kind === B.result!.kind
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

  // One dataset's chips for an UNMATCHED condition: pick exactly one slice (a single value is
  // the slice by itself). Accent fill = picked, like a compared value in the intra layout.
  const sliceChips = (side: 'a' | 'b', c: ConditionKey, vals: string[]): ReactNode => {
    const picked = vals.length === 1 ? vals[0] : fix[side][c]
    return (
      <div style={S.chips}>
        {vals.length === 0 && <span style={S.anyTag}>—</span>}
        {vals.map((v) => {
          const on = picked === v
          return (
            <button
              key={v}
              className="oe-chip"
              onClick={() => onFix(side, c, v)}
              title={
                vals.length === 1
                  ? `Only ${c} on this dataset`
                  : on
                    ? `${c} fixed to ${v} on this dataset`
                    : `Fix ${c} to ${v} on this dataset`
              }
              style={{
                ...S.valChip,
                ...(on ? S.valChipOn : null),
                ...(vals.length === 1 ? { cursor: 'default' } : null)
              }}
            >
              {v}
            </button>
          )
        })}
      </div>
    )
  }

  const condRow = (c: ConditionKey): ReactNode => {
    const v = preview!.values[c]!
    const matchable = preview!.candidates.includes(c)
    const on = matchable && match.includes(c)
    return (
      <div key={c} style={S.condRow}>
        <div style={S.condHead}>
          <button
            role="switch"
            aria-checked={on}
            aria-label={`Match on ${c}`}
            disabled={!matchable}
            title={
              !matchable
                ? `${c} is on one dataset only — fix it to one slice there`
                : on
                  ? 'Matched like-for-like — switch off to fix one slice per dataset'
                  : 'Switch on to match like-for-like'
            }
            onClick={() => onToggle(c)}
            style={{
              ...S.switchTrack,
              background: on ? UI.accent : UI.border,
              justifyContent: on ? 'flex-end' : 'flex-start',
              opacity: matchable ? 1 : 0.35,
              cursor: matchable ? 'pointer' : 'not-allowed'
            }}
          >
            <span style={S.switchKnob} />
          </button>
          <span style={{ ...S.condName, ...(on ? S.condNameOn : null) }}>{c}</span>
        </div>
        {on ? (
          // Matched: values on both datasets pair (green); one-sided values have no partner (grey).
          <div style={S.chips}>
            {v.both.map((x) => (
              <span
                key={`b${x}`}
                style={{ ...S.valChip, ...S.valChipIncluded, cursor: 'default' }}
                title={`${c} = ${x} is on both datasets — paired`}
              >
                {x}
              </span>
            ))}
            {[
              ...v.onlyA.map((x) => [x, A!.name] as const),
              ...v.onlyB.map((x) => [x, B!.name] as const)
            ].map(([x, who]) => (
              <span
                key={`o${who}${x}`}
                style={{ ...S.valChip, ...S.valChipIdle, opacity: 0.6, cursor: 'default' }}
                title={`${c} = ${x} is only on ${who} — no partner, skipped`}
              >
                {x}
              </span>
            ))}
          </div>
        ) : (
          // Not matched: one slice per dataset, left/right like group A | group B, with the
          // why-a-pick-is-needed tip under this row only.
          <div style={styles.fixBlock}>
            <div style={styles.sidePair}>
              <div style={styles.sideCol}>{sliceChips('a', c, v.a)}</div>
              <span style={styles.vsRule} />
              <div style={styles.sideCol}>{sliceChips('b', c, v.b)}</div>
            </div>
            <StatusNote kind="info" style={{ marginTop: 8 }}>
              {matchable
                ? `not matched — pick one ${c} per dataset; nothing is pooled across ${c}`
                : `${c} is on one dataset only — pick one ${c} there; nothing is pooled across it`}
            </StatusNote>
          </div>
        )}
      </div>
    )
  }

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
            <div style={S.condsHead}>
              <span style={S.condsHeadSwitch}>match on</span>
              {preview.conditions.length === 0 && (
                <StatusNote kind="info" inline>
                  no conditions — joins on gene id alone
                </StatusNote>
              )}
            </div>
            {preview.conditions.map(condRow)}
            <StatusNote kind="ok" style={S.matchedLine}>
              {preview.matched.length
                ? `matched on ${preview.matched.join(', ')}`
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
