/** Illustrations for the User Guide (UserGuide.tsx): small schematic pictures of the app's parts —
 *  drawn from theme tokens (the Run button's states are the app's own button), so they follow light and dark mode, and simple enough to stay true as
 *  the real UI evolves. None of them is interactive. */
import type { CSSProperties, ReactNode } from 'react'

import { RUN_FACES, runButtonStyle, type RunState } from '../../app/runFaces'
import { FileIcon, IconFolder } from '../app/fileIcons'
import { CATEGORICAL, UI } from '../app/theme'

const mono = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** Numbered step cards in a row, joined by arrows — a pipeline or a wizard's steps. */
export function StepCards({ steps }: { steps: { title: string; text: string }[] }): ReactNode {
  return (
    <div style={s.cards}>
      {steps.map((st, i) => (
        <div key={st.title} style={s.cardWrap}>
          <div style={s.card}>
            <div style={s.cardHead}>
              <span style={s.num}>{i + 1}</span>
              <span style={s.cardTitle}>{st.title}</span>
            </div>
            <div style={s.cardText}>{st.text}</div>
          </div>
          {i < steps.length - 1 && <span style={s.arrow}>→</span>}
        </div>
      ))}
    </div>
  )
}

/** The Run button's states — the app's own button in each (see RunButton), with what it does. */
export function RunStates(): ReactNode {
  const states: [RunState, string][] = [
    ['run', 'run all steps'],
    ['rerun', 'run again'],
    ['retry', 'retry failed'],
    ['stop', 'stop']
  ]
  return (
    <div style={s.runRow}>
      {states.map(([state, label]) => (
        <span key={state} style={s.runItem}>
          <span aria-hidden style={{ ...runButtonStyle(state), cursor: 'default' }}>
            {RUN_FACES[state].icon}
          </span>
          <span style={s.runLabel}>{label}</span>
        </span>
      ))}
    </div>
  )
}

/** A folder tree: each entry an icon, a name and a note. `depth` indents it; `stem` is a part
 *  of the name drawn faint before it — a placeholder, or a part that's up to the user. */
export function FolderTree({
  entries
}: {
  entries: { name: string; stem?: string; depth: number; folder?: boolean; note?: string }[]
}): ReactNode {
  return (
    <div style={s.tree}>
      {entries.map((e) => (
        <div
          key={`${e.depth}-${e.stem ?? ''}${e.name}`}
          style={{ ...s.treeRow, paddingLeft: 8 + e.depth * 18 }}
        >
          {/* The project folder viewer's icons: a folder, or a file marked by its kind. */}
          <span style={s.treeIcon}>
            {e.folder ? (
              <IconFolder size={15} />
            ) : (
              <FileIcon name={e.name.replace(/\/$/, '')} size={15} />
            )}
          </span>
          <span style={{ ...s.treeName, fontWeight: e.folder ? 700 : 500 }}>
            {e.stem && <span style={s.treeStem}>{e.stem}</span>}
            {e.name}
          </span>
          {e.note && <span style={s.treeNote}>{e.note}</span>}
        </div>
      ))}
    </div>
  )
}

/** What a column of a sample table is, for its tint. */
type ColKind = 'id' | 'sample' | 'cond' | 'label' | 'plain'
const COL_TINT: Record<ColKind, string | undefined> = {
  id: CATEGORICAL[0],
  sample: CATEGORICAL[2],
  cond: CATEGORICAL[1],
  label: CATEGORICAL[4],
  plain: undefined
}
const COL_NAME: Record<ColKind, string> = {
  id: 'ID',
  sample: 'sample',
  cond: 'condition',
  label: 'label',
  plain: ''
}

/** A small example table, columns tinted by what they are, with a legend; empty cells (and `0`,
 *  when `missing` says so) shown as missing. */
export function MiniTable({
  head,
  kinds,
  rows,
  missingZero = false
}: {
  head: string[]
  kinds: ColKind[]
  rows: string[][]
  missingZero?: boolean
}): ReactNode {
  const used = [...new Set(kinds)].filter((k) => k !== 'plain')
  const isMissing = (v: string): boolean =>
    v === '' || v === 'NA' || v === 'NaN' || (missingZero && v === '0')
  return (
    <div style={s.tableWrap}>
      <table style={s.table}>
        <thead>
          <tr>
            {head.map((h, i) => {
              const t = COL_TINT[kinds[i]]
              return (
                <th
                  key={h}
                  style={{ ...s.th, ...(t ? { background: `${t}2e`, color: UI.text } : {}) }}
                >
                  {h}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((v, ci) => {
                const t = COL_TINT[kinds[ci]]
                return (
                  <td key={ci} style={{ ...s.td, ...(t ? { background: `${t}12` } : {}) }}>
                    {isMissing(v) ? <span style={s.missing}>{v || '·'}</span> : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {used.length > 0 && (
        <div style={s.legend}>
          {used.map((k) => (
            <span key={k} style={s.legendItem}>
              <span style={{ ...s.swatch, background: COL_TINT[k] }} />
              {COL_NAME[k]}
            </span>
          ))}
          {rows.some((r) => r.some(isMissing)) && (
            <span style={s.legendItem}>
              <span style={s.missing}>·</span> missing
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/** A protein group read as one feature: its ID → its member proteins → one labelled gene. */
export function GroupDiagram(): ReactNode {
  return (
    <div style={s.group}>
      <div style={s.groupCol}>
        <span style={s.groupCap}>in the data</span>
        <span style={{ ...s.pill, fontFamily: mono }}>Q13547;Q92769-2</span>
      </div>
      <span style={s.arrow}>→</span>
      <div style={s.groupCol}>
        <span style={s.groupCap}>its proteins (DB rows)</span>
        <span style={{ ...s.pill, fontFamily: mono }}>Q13547 · HDAC1</span>
        <span style={{ ...s.pill, fontFamily: mono }}>
          Q92769 · HDAC2 <span style={s.dim}>(isoform -2 folded)</span>
        </span>
      </div>
      <span style={s.arrow}>→</span>
      <div style={s.groupCol}>
        <span style={s.groupCap}>one feature</span>
        <span style={{ ...s.pill, ...s.pillStrong }}>HDAC1/HDAC2</span>
        <span style={s.groupNote}>with both proteins' pathways</span>
      </div>
    </div>
  )
}

/** One annotation hierarchy as a breadcrumb: its levels left to right, the tested term last. */
export function Levels({
  source,
  levels
}: {
  source: string
  levels: { label: string; example: string }[]
}): ReactNode {
  return (
    <div style={s.levels}>
      <span style={s.levelSource}>{source}</span>
      {levels.map((l, i) => (
        <span key={l.label} style={s.levelRow}>
          {i > 0 && <span style={s.levelSep}>›</span>}
          <span
            style={{
              ...s.level,
              ...(i === levels.length - 1 ? { borderColor: UI.accent, color: UI.text } : {})
            }}
          >
            <span style={s.levelLabel}>{l.label}</span>
            {l.example}
          </span>
        </span>
      ))}
    </div>
  )
}

/** Two histograms side by side — raw intensities (non-normal) and their log (normal). */
export function ShapePair(): ReactNode {
  const skew = [30, 22, 14, 9, 6, 4, 3, 2, 2, 1, 1, 1, 0.5, 0.5]
  const bell = [1, 2, 4, 8, 13, 18, 20, 18, 13, 8, 4, 2, 1, 0.5]
  const hist = (counts: number[], color: string): ReactNode => {
    const max = Math.max(...counts)
    const w = 120 / counts.length
    return (
      <svg viewBox="0 0 120 40" style={s.histSvg} aria-hidden>
        {counts.map((c, i) => (
          <rect
            key={i}
            x={i * w + 0.5}
            y={40 - (c / max) * 38}
            width={w - 1}
            height={(c / max) * 38}
            fill={color}
            opacity={0.8}
          />
        ))}
        <line x1={0} y1={39.5} x2={120} y2={39.5} stroke={UI.border} />
      </svg>
    )
  }
  return (
    <div style={s.shapes}>
      <figure style={s.shape}>
        {hist(skew, UI.accent)}
        <figcaption style={{ ...s.cap, color: UI.warn }}>⚠ raw intensities — non-normal</figcaption>
      </figure>
      <figure style={s.shape}>
        {hist(bell, UI.accent)}
        <figcaption style={{ ...s.cap, color: UI.ok }}>✓ after log10 — normal</figcaption>
      </figure>
    </div>
  )
}

const box: CSSProperties = {
  background: UI.panelAlt,
  border: `1px solid ${UI.border}`,
  borderRadius: 8
}

const s: Record<string, CSSProperties> = {
  cards: { display: 'flex', flexWrap: 'wrap', alignItems: 'stretch', gap: 6, margin: '0 0 14px' },
  cardWrap: { display: 'flex', alignItems: 'center', gap: 6 },
  card: {
    ...box,
    width: 128,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4
  },
  cardHead: { display: 'flex', alignItems: 'center', gap: 6 },
  num: {
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: UI.accent,
    color: UI.accentText,
    fontSize: 11,
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto'
  },
  cardTitle: { fontSize: 12, fontWeight: 700, color: UI.text },
  cardText: { fontSize: 11, lineHeight: 1.45, color: UI.textMuted },
  arrow: { color: UI.textMuted, fontSize: 13, flex: '0 0 auto' },
  cap: { fontSize: 11, lineHeight: 1.45, color: UI.textMuted, marginTop: 6 },
  capTitle: { color: UI.text },
  runRow: { display: 'flex', flexWrap: 'wrap', gap: 14, margin: '0 0 14px' },
  runItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  runLabel: { fontSize: 12, color: UI.textMuted },
  tree: { ...box, padding: '8px 0', margin: '0 0 14px', fontSize: 12 },
  treeRow: { display: 'flex', alignItems: 'baseline', gap: 6, padding: '2px 10px' },
  treeIcon: { display: 'inline-flex', alignSelf: 'center', flex: '0 0 auto', color: UI.textMuted },
  treeName: { fontFamily: mono, color: UI.text, flex: '0 0 auto' },
  treeStem: { color: UI.textMuted, opacity: 0.6, fontWeight: 500 },
  treeNote: { color: UI.textMuted, fontSize: 11 },
  tableWrap: { margin: '0 0 14px', overflowX: 'auto' },
  table: {
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: 11.5,
    fontFamily: mono,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    overflow: 'hidden'
  },
  th: {
    padding: '4px 10px',
    textAlign: 'left',
    color: UI.textMuted,
    background: UI.panelAlt,
    borderBottom: `1px solid ${UI.border}`,
    whiteSpace: 'nowrap'
  },
  td: { padding: '3px 10px', color: UI.text, whiteSpace: 'nowrap' },
  missing: { color: UI.textMuted, fontStyle: 'italic', opacity: 0.8 },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 6,
    fontSize: 11,
    color: UI.textMuted
  },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 5 },
  swatch: { width: 10, height: 10, borderRadius: 2, display: 'inline-block' },
  group: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '0 0 14px' },
  groupCol: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  groupCap: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: UI.textMuted },
  groupNote: { fontSize: 11, color: UI.textMuted },
  pill: {
    fontSize: 12,
    color: UI.text,
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 14,
    padding: '3px 10px',
    whiteSpace: 'nowrap'
  },
  pillStrong: { borderColor: UI.accent, fontWeight: 700 },
  dim: { color: UI.textMuted, fontSize: 11 },
  levels: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '0 0 8px' },
  levelSource: { fontSize: 12, fontWeight: 700, color: UI.text, width: 70, flex: '0 0 auto' },
  levelRow: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  levelSep: { color: UI.textMuted },
  level: {
    ...box,
    borderRadius: 6,
    padding: '3px 8px',
    fontSize: 12,
    color: UI.textMuted,
    display: 'inline-flex',
    flexDirection: 'column'
  },
  levelLabel: { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.8 },
  shapes: { display: 'flex', flexWrap: 'wrap', gap: 14, margin: '0 0 14px' },
  shape: { ...box, margin: 0, padding: 10, width: 200 },
  histSvg: { width: '100%', height: 44, display: 'block' }
}
