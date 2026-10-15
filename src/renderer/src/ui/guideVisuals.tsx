/** Illustrations for the User Guide (UserGuide.tsx): small schematic pictures of the app's parts —
 *  drawn from theme tokens, so they follow light and dark mode, and simple enough to stay true as
 *  the real UI evolves. None of them is interactive. */
import type { CSSProperties, ReactNode } from 'react'

import { IconCopy, IconGear } from './icons'
import { CATEGORICAL, UI } from './theme'

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

/** The two layouts as small schematics: Flowchart (wired nodes + a dashboard) and Form (a step list +
 *  the selected step beside it). */
export function LayoutCards(): ReactNode {
  const node = (x: number, y: number, c: string): ReactNode => (
    <rect x={x} y={y} width={26} height={14} rx={3} fill={c} opacity={0.85} />
  )
  const wire = (x1: number, y1: number, x2: number, y2: number): ReactNode => (
    <path
      d={`M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`}
      fill="none"
      stroke={UI.textMuted}
      strokeWidth={1.2}
    />
  )
  return (
    <div style={s.layouts}>
      <figure style={s.layoutCard}>
        <svg viewBox="0 0 160 70" style={s.layoutSvg} aria-hidden>
          {wire(32, 22, 50, 22)}
          {wire(76, 22, 94, 14)}
          {wire(76, 22, 94, 36)}
          {wire(120, 14, 130, 50)}
          {node(6, 15, CATEGORICAL[0])}
          {node(50, 15, CATEGORICAL[1])}
          {node(94, 7, CATEGORICAL[2])}
          {node(94, 29, CATEGORICAL[2])}
          <rect x={112} y={46} width={42} height={18} rx={3} fill="none" stroke={UI.border} />
          <rect x={115} y={49} width={17} height={12} rx={2} fill={CATEGORICAL[4]} opacity={0.6} />
          <rect x={134} y={49} width={17} height={12} rx={2} fill={CATEGORICAL[4]} opacity={0.6} />
        </svg>
        <figcaption style={s.cap}>
          <b style={s.capTitle}>Flowchart</b> — tiles wired on a canvas; results on a dashboard.
        </figcaption>
      </figure>
      <figure style={s.layoutCard}>
        <svg viewBox="0 0 160 70" style={s.layoutSvg} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={6}
              y={6 + i * 15}
              width={44}
              height={12}
              rx={3}
              fill={i === 1 ? UI.accent : UI.panelAlt}
              stroke={UI.border}
            />
          ))}
          <rect x={56} y={6} width={44} height={57} rx={3} fill={UI.panelAlt} stroke={UI.border} />
          {[0, 1, 2].map((i) => (
            <rect key={i} x={61} y={12 + i * 9} width={34} height={4} rx={2} fill={UI.border} />
          ))}
          <rect x={106} y={6} width={48} height={57} rx={3} fill="none" stroke={UI.border} />
          <polyline
            points="112,54 122,44 130,48 140,26 148,30"
            fill="none"
            stroke={CATEGORICAL[0]}
            strokeWidth={1.6}
          />
        </svg>
        <figcaption style={s.cap}>
          <b style={s.capTitle}>Form</b> — steps in a list; the selected one's settings and plot
          beside it.
        </figcaption>
      </figure>
    </div>
  )
}

/** The run button's states, as chips. */
export function RunStates(): ReactNode {
  const chip = (icon: string, bg: string, fg: string, label: string): ReactNode => (
    <span style={s.runItem}>
      <span style={{ ...s.runChip, background: bg, color: fg }}>{icon}</span>
      <span style={s.runLabel}>{label}</span>
    </span>
  )
  return (
    <div style={s.runRow}>
      {chip('▶', UI.accent, UI.accentText, 'run all steps')}
      {chip('↻', UI.accent, UI.accentText, 'run again')}
      {chip('↻', '#e15759', '#fff', 'retry failed')}
      {chip('■', '#e2b93b', '#1a1a1a', 'stop')}
    </div>
  )
}

/** A folder tree: each entry an icon, a name and a note. `depth` indents it. */
export function FolderTree({
  entries
}: {
  entries: { name: string; depth: number; folder?: boolean; note?: string }[]
}): ReactNode {
  return (
    <div style={s.tree}>
      {entries.map((e) => (
        <div key={`${e.depth}-${e.name}`} style={{ ...s.treeRow, paddingLeft: 8 + e.depth * 18 }}>
          <span style={{ ...s.treeIcon, color: e.folder ? CATEGORICAL[1] : UI.textMuted }}>
            {e.folder ? '▰' : '▭'}
          </span>
          <span style={{ ...s.treeName, fontWeight: e.folder ? 700 : 500 }}>{e.name}</span>
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

/** The gene selector: its pill and the three tabs inside. */
export function SelectorMock(): ReactNode {
  return (
    <div style={s.mockRow}>
      <span style={{ ...s.pill, ...s.pillStrong }}>Cell cycle (124) ▾</span>
      <span style={s.arrow}>→</span>
      <span style={s.tabs}>
        {['Function', 'Pathway', 'Essentiality'].map((t, i) => (
          <span key={t} style={{ ...s.tab, ...(i === 1 ? s.tabOn : {}) }}>
            {t}
          </span>
        ))}
      </span>
    </div>
  )
}

/** A results tile's header with its three buttons, each labelled. */
export function TileMock(): ReactNode {
  return (
    <div style={s.tileMock}>
      <div style={s.tileHead}>
        <span style={s.tileTitle}>Volcano · X | DMSO</span>
        <span style={s.tileBtns}>
          {[
            [<IconCopy key="c" />, 'Copy'],
            [<span key="d">⤓</span>, 'Download'],
            [<IconGear key="g" />, 'Settings']
          ].map(([icon, label]) => (
            <span key={label as string} style={s.tileBtn}>
              <span style={s.tileIcon}>{icon}</span>
              <span style={s.tileBtnLabel}>{label}</span>
            </span>
          ))}
        </span>
      </div>
      <svg viewBox="0 0 200 50" style={s.tileSvg} aria-hidden>
        {Array.from({ length: 60 }, (_, i) => {
          const x = 100 + Math.sin(i * 2.3) * (40 + (i % 7) * 7)
          const y = 46 - Math.abs(Math.sin(i * 1.7)) * (10 + (i % 5) * 7)
          const c = x > 140 && y < 30 ? '#e15759' : x < 60 && y < 30 ? '#4e79a7' : '#8a8f98'
          return <circle key={i} cx={x} cy={y} r={1.8} fill={c} />
        })}
      </svg>
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
  layouts: { display: 'flex', flexWrap: 'wrap', gap: 10, margin: '0 0 14px' },
  layoutCard: { ...box, margin: 0, padding: 10, width: 240 },
  layoutSvg: { width: '100%', height: 'auto', display: 'block' },
  cap: { fontSize: 11, lineHeight: 1.45, color: UI.textMuted, marginTop: 6 },
  capTitle: { color: UI.text },
  runRow: { display: 'flex', flexWrap: 'wrap', gap: 14, margin: '0 0 14px' },
  runItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  runChip: {
    width: 26,
    height: 22,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700
  },
  runLabel: { fontSize: 12, color: UI.textMuted },
  tree: { ...box, padding: '8px 0', margin: '0 0 14px', fontSize: 12 },
  treeRow: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 10px' },
  treeIcon: { fontSize: 11, width: 12, flex: '0 0 auto' },
  treeName: { fontFamily: mono, color: UI.text, flex: '0 0 auto' },
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
  histSvg: { width: '100%', height: 44, display: 'block' },
  mockRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '0 0 14px' },
  tabs: { ...box, display: 'inline-flex', padding: 2, gap: 2 },
  tab: { fontSize: 12, padding: '3px 10px', borderRadius: 6, color: UI.textMuted },
  tabOn: { background: UI.accent, color: UI.accentText, fontWeight: 600 },
  tileMock: { ...box, margin: '0 0 14px', width: 360, overflow: 'hidden' },
  tileHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderBottom: `1px solid ${UI.border}`
  },
  tileTitle: { fontSize: 12, fontWeight: 700, color: UI.text },
  tileBtns: { marginLeft: 'auto', display: 'inline-flex', gap: 10 },
  tileBtn: { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 },
  tileIcon: { color: UI.text, display: 'inline-flex', fontSize: 13, lineHeight: 1 },
  tileBtnLabel: { fontSize: 9.5, color: UI.textMuted },
  tileSvg: { width: '100%', height: 70, display: 'block', background: UI.panel }
}
