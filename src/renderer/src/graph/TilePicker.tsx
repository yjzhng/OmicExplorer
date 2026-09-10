import { useState, type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'
import {
  accentOf,
  type AxisAvail,
  categoryOf,
  CATEGORIES,
  entryKey,
  gatePlotEntries,
  NODE_SPECS,
  plotEntriesFor,
  PLOT_SECTIONS,
  type PlotMenuEntry
} from './registry'
import type { NodeCategory, NodeKind } from './types'

/** What the picker commits: a kind plus any config override (e.g. dr's axis). */
export type TilePick = { kind: NodeKind; override?: Record<string, unknown> }

const CATS: NodeCategory[] = ['data', 'processing', 'plotting']

/**
 * Tile-shaped picker for a new step. Shows the primary category first, then the
 * exact operation — so a placeholder never dumps a dozen options at once. Mirrors
 * the real node card so a pending placeholder reads as the tile it will become.
 */
export function TilePicker({
  ops,
  onPick,
  header = 'New step',
  axes,
  style
}: {
  ops: NodeKind[]
  /** Chosen picks. One → a single node; two or more plotting picks → a group tile. Each pick may
   *  carry a config override (e.g. a dr pick seeds its axis) — see TilePick. */
  onPick: (picks: TilePick[]) => void
  header?: string
  /** Response axes the upstream data supports — gates the dose/time-response options. Omitted
   *  (or unknown upstream) ⇒ show all. */
  axes?: AxisAvail
  style?: CSSProperties
}) {
  const avail: AxisAvail = axes ?? { dose: true, time: true }
  // `plotGroup` is never user-pickable — checking several plots in the plotting list
  // is what creates a group, so it must not appear as an option here.
  const byCat = CATS.map((cat) => ({
    cat,
    ops: ops.filter((o) => o !== 'plotGroup' && categoryOf(o) === cat)
  })).filter((g) => g.ops.length > 0)
  // If only one category is offered, drop straight to its operations.
  const [cat, setCat] = useState<NodeCategory | null>(byCat.length === 1 ? byCat[0].cat : null)
  const [hovered, setHovered] = useState<string | null>(null)
  // Multi-select is offered only in the plotting category (to build a group tile). Keyed by
  // entryKey (not kind), so dr's Dose-response and Time-response can be checked independently.
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const toggle = (key: string): void =>
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const row = (
    key: string,
    accent: string,
    label: string,
    tag: string | number,
    onClick: () => void
  ) => (
    <button
      key={key}
      onMouseEnter={() => setHovered(key)}
      onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={{ ...item, background: hovered === key ? UI.panelAlt : 'transparent' }}
    >
      <span style={{ ...dot, background: accent }} />
      <span style={opLabel}>{label}</span>
      <span style={{ ...catName, color: accent }}>{tag}</span>
    </button>
  )

  // A checkbox row for a plotting entry — toggles into `chosen` instead of committing, so several
  // plots can be batched into one group. An entry may be a config variant of a kind (dr's axes).
  const optRow = (entry: PlotMenuEntry, accent: string): ReactNode => {
    const ek = entryKey(entry)
    const checked = chosen.has(ek)
    const key = `opt-${ek}`
    return (
      <button
        key={key}
        onMouseEnter={() => setHovered(key)}
        onMouseLeave={() => setHovered((h) => (h === key ? null : h))}
        onClick={(e) => {
          e.stopPropagation()
          toggle(ek)
        }}
        style={{ ...item, background: hovered === key || checked ? UI.panelAlt : 'transparent' }}
      >
        <span
          style={{
            ...checkbox,
            borderColor: checked ? accent : UI.border,
            background: checked ? accent : 'transparent'
          }}
        >
          {checked ? '✓' : ''}
        </span>
        <span style={opLabel}>{entry.label}</span>
      </button>
    )
  }

  const current = cat ? byCat.find((g) => g.cat === cat) : null
  const plotting = current?.cat === 'plotting'
  const canGoBack = cat != null && byCat.length > 1

  // The visualisation list is grouped into the SAME sections as the plot-selector menu (shared
  // PLOT_SECTIONS), with any uncategorised op falling into a trailing "Other" section. Each kind is
  // fanned into its menu entries (dr → Dose-response / Time-response) via the shared plotEntriesFor.
  const plotSections = ((): { label: string; entries: PlotMenuEntry[] }[] => {
    if (!plotting || !current) return []
    const present = new Set(current.ops)
    const used = new Set<NodeKind>()
    const secs = PLOT_SECTIONS.map((s) => {
      const kinds = s.kinds.filter((k) => present.has(k))
      kinds.forEach((k) => used.add(k))
      return { label: s.label, entries: gatePlotEntries(kinds.flatMap(plotEntriesFor), avail) }
    }).filter((s) => s.entries.length > 0)
    const rest = current.ops.filter((k) => !used.has(k))
    if (rest.length)
      secs.push({ label: 'Other', entries: gatePlotEntries(rest.flatMap(plotEntriesFor), avail) })
    return secs.filter((s) => s.entries.length > 0)
  })()
  // All present plotting entries in declared order (gated) — to resolve the checked keys on commit.
  const allEntries =
    plotting && current ? gatePlotEntries(current.ops.flatMap(plotEntriesFor), avail) : []

  return (
    <div className="nodrag" style={{ ...card, ...style }}>
      <div style={headerRow}>
        {canGoBack && (
          <button
            title="Back to categories"
            onMouseEnter={() => setHovered('__back')}
            onMouseLeave={() => setHovered((h) => (h === '__back' ? null : h))}
            onClick={(e) => {
              e.stopPropagation()
              setCat(null)
            }}
            style={{ ...backBtn, background: hovered === '__back' ? UI.panelAlt : 'transparent' }}
          >
            <span style={backArrow}>‹</span>
            <span style={backText}>Back</span>
          </button>
        )}
        <span style={catTag}>{current ? CATEGORIES[current.cat].label : header}</span>
      </div>
      <div style={body}>
        {current
          ? plotting
            ? plotSections.map((s) => (
                <div key={s.label}>
                  <div style={sectionHead}>{s.label}</div>
                  {s.entries.map((e) => optRow(e, accentOf(current.cat)))}
                </div>
              ))
            : current.ops.map((op) =>
                row(op, accentOf(current.cat), NODE_SPECS[op].label, '', () => onPick([{ kind: op }]))
              )
          : byCat.map((g) =>
              row(g.cat, accentOf(g.cat), CATEGORIES[g.cat].label, g.ops.length, () => {
                if (g.ops.length === 1) onPick([{ kind: g.ops[0] }])
                else setCat(g.cat)
              })
            )}
      </div>
      {plotting && (
        <div style={footer}>
          <button
            disabled={chosen.size === 0}
            onClick={(e) => {
              e.stopPropagation()
              // Preserve the declared entry order so subcards read predictably.
              onPick(allEntries.filter((en) => chosen.has(entryKey(en))))
            }}
            style={{ ...addBtn, opacity: chosen.size === 0 ? 0.45 : 1 }}
          >
            {chosen.size > 1
              ? `Add ${chosen.size} visualisations as a group`
              : chosen.size === 1
                ? 'Add visualisation'
                : 'Select visualisation…'}
          </button>
        </div>
      )}
    </div>
  )
}

const card: CSSProperties = {
  width: 230,
  background: UI.panelRaised,
  border: `1px solid ${UI.border}`,
  borderTop: `3px dashed ${UI.accent}`,
  borderRadius: 8,
  color: UI.text,
  fontSize: 12,
  boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
  overflow: 'hidden'
}
const headerRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '5px 8px 5px 10px',
  borderBottom: `1px solid ${UI.border}`
}
const catTag: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: UI.textMuted
}
const backBtn: CSSProperties = {
  ...catTag,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  color: UI.text,
  border: `1px solid ${UI.border}`,
  borderRadius: 5,
  padding: '2px 8px',
  cursor: 'pointer'
}
const backArrow: CSSProperties = { fontSize: 16, lineHeight: 1, fontWeight: 700, display: 'block' }
const backText: CSSProperties = { lineHeight: 1, display: 'block' }
const body: CSSProperties = { padding: 4, display: 'flex', flexDirection: 'column', gap: 2 }
const sectionHead: CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: UI.textMuted,
  padding: '6px 8px 2px'
}
const item: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  border: 'none',
  borderRadius: 5,
  padding: '7px 8px',
  fontSize: 12,
  color: UI.text,
  cursor: 'pointer',
  textAlign: 'left',
  width: '100%'
}
const dot: CSSProperties = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' }
const checkbox: CSSProperties = {
  width: 13,
  height: 13,
  flex: '0 0 auto',
  borderRadius: 3,
  border: `1px solid ${UI.border}`,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  fontWeight: 700,
  color: UI.accentText,
  lineHeight: 1
}
const footer: CSSProperties = { padding: 6, borderTop: `1px solid ${UI.border}` }
const addBtn: CSSProperties = {
  width: '100%',
  background: UI.accent,
  color: UI.accentText,
  border: 'none',
  borderRadius: 5,
  padding: '6px 8px',
  fontSize: 11,
  fontWeight: 700,
  cursor: 'pointer'
}
const opLabel: CSSProperties = { fontWeight: 600 }
const catName: CSSProperties = {
  marginLeft: 'auto',
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5
}
