/**
 * The condition rows of the selector window, one system for every mode — Compare (t-test / 2-way
 * ANOVA), Curve fit, and Contrast within one dataset or across two. Each condition is a row with
 * its values picked EXPLICITLY on both sides (numerator | denominator, treatment | control,
 * group A | group B, dataset A | dataset B): where the two sides' picks differ, the condition is
 * what's compared; where they're the same, it's context — matched like-for-like or pooled, by the
 * row's match switch. Every value starts picked; narrowing a side is how the slice is defined.
 */
import type { CSSProperties, ReactNode } from 'react'

import { condLabel, type ConditionKey } from '../engine'
import { StatusNote } from '../ui/StatusNote'
import { OnOffSwitch } from '../ui/ToggleSwitch'
import { UI } from '../ui/theme'
import { ChipSet, type ChipItem } from './ChipSet'
import { selectorStyles as S } from './selectorParts'
import type { SideKey } from './sides'

export type { SideKey }

/** What a row's condition is doing, as the tag beside its name says. */
export type RowRole = 'compared' | 'matched' | 'pooled' | 'axis' | 'fixed'

export interface SideRow {
  cond: ConditionKey
  role: RowRole
  /** the values each side can take ([] = the condition isn't on that side at all) */
  values: Record<SideKey, string[]>
  picked: Record<SideKey, string[]>
  /** the match switch; absent = none on this row (a curve's axis) */
  match?: { on: boolean; disabled?: boolean; title: string }
  /** a value's chip beyond picked/unpicked: its look, greyed, and why */
  chip?: (side: SideKey, value: string, on: boolean) => Partial<ChipItem>
  /** a side's own problem, under its chips */
  note?: Partial<Record<SideKey, string>>
  /** shown instead of the chips (e.g. a surface's time axis: every time, no pick) */
  fixedText?: string
}

const ROLE_TEXT: Record<RowRole, string> = {
  compared: 'compared',
  matched: 'matched',
  pooled: 'pooled',
  axis: 'axis',
  fixed: 'one slice'
}

export function SideRows({
  labels,
  rows,
  onPick,
  onMatch
}: {
  labels: Record<SideKey, string>
  rows: SideRow[]
  onPick: (side: SideKey, c: ConditionKey, next: string[]) => void
  onMatch: (c: ConditionKey, on: boolean) => void
}): ReactNode {
  const side = (r: SideRow, s: SideKey): ReactNode => {
    const vals = r.values[s]
    if (vals.length === 0) return <span style={S.anyTag}>—</span>
    const picked = r.picked[s]
    const all = vals.every((v) => picked.includes(v))
    const toggle = (v: string): void =>
      onPick(s, r.cond, picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v])
    return (
      <>
        <ChipSet
          label={condLabel(r.cond)}
          onToggle={toggle}
          items={vals.map((v) => {
            const on = picked.includes(v)
            return { value: v, on, ...r.chip?.(s, v, on) }
          })}
        />
        {/* The one shortcut a side needs: back to every value, or clear to pick up from none. */}
        {vals.length > 1 && (
          <button
            className="oe-chip"
            style={styles.quick}
            onClick={() => onPick(s, r.cond, all ? [] : [...vals])}
            title={all ? 'Clear, to pick the values from none' : 'Pick every value again'}
          >
            {all ? 'none' : 'all'}
          </button>
        )}
        {r.note?.[s] && (
          <StatusNote kind="info" style={{ marginTop: 2 }}>
            {r.note[s]}
          </StatusNote>
        )}
      </>
    )
  }
  return (
    <>
      <div style={{ ...S.condRow, borderTop: 'none', paddingBottom: 0 }}>
        <div style={S.condHead} />
        <div style={styles.sidePair}>
          <span style={{ ...styles.sideLabel, flex: 1 }}>{labels.a}</span>
          <span style={{ ...styles.vsRule, visibility: 'hidden' }} />
          <span style={{ ...styles.sideLabel, flex: 1 }}>{labels.b}</span>
        </div>
      </div>
      {rows.map((r) => (
        <div key={r.cond} style={S.condRow}>
          <div style={{ ...S.condHead, flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
            <span style={{ ...S.condName, ...(r.role === 'compared' ? S.condNameOn : null) }}>
              {condLabel(r.cond)}
            </span>
            <span style={styles.matchLine}>
              {r.match && (
                <OnOffSwitch
                  on={r.match.on}
                  disabled={r.match.disabled}
                  onChange={(on) => onMatch(r.cond, on)}
                  label={`Match on ${condLabel(r.cond)}`}
                  title={r.match.title}
                />
              )}
              <span style={{ ...styles.role, ...(r.role === 'compared' ? styles.roleOn : null) }}>
                {ROLE_TEXT[r.role]}
              </span>
            </span>
          </div>
          {r.fixedText ? (
            <span style={{ ...S.anyTag, paddingTop: 2 }}>{r.fixedText}</span>
          ) : (
            <div style={styles.sidePair}>
              <div style={styles.sideCol}>{side(r, 'a')}</div>
              <span style={styles.vsRule} />
              <div style={styles.sideCol}>{side(r, 'b')}</div>
            </div>
          )}
        </div>
      ))}
    </>
  )
}

const styles: Record<string, CSSProperties> = {
  sidePair: { display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 },
  sideCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    flex: 1,
    minWidth: 0
  },
  sideLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: UI.textMuted },
  vsRule: { width: 1, alignSelf: 'stretch', background: UI.border, flex: '0 0 auto' },
  matchLine: { display: 'flex', alignItems: 'center', gap: 6 },
  role: { fontSize: 10, color: UI.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 },
  roleOn: { color: UI.accent, fontWeight: 700 },
  quick: {
    background: 'transparent',
    border: 'none',
    padding: 0,
    fontSize: 10,
    color: UI.textMuted,
    textDecoration: 'underline',
    cursor: 'pointer'
  }
}
