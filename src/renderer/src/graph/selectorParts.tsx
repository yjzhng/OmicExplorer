/** Pieces shared by the selector window's two contrast modes (and Compare): the context-group
 *  preview table, and the condition-row / switch / value-chip styles so intra- and inter-dataset
 *  read as one system (green = paired, dotted = partly, grey = nothing to pair). */
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { UI } from '../ui/theme'

/** A trailing parenthetical — "1204 (1310 vs 1288)" — is supporting detail: rendered faint, like a
 *  separator, so the headline number reads first. */
function renderCell(cell: string): ReactNode {
  const m = /^(.*?)(\s*\(.*\))$/.exec(cell)
  if (!m) return cell
  return (
    <>
      {m[1]}
      <span style={selectorStyles.tdFaint}>{m[2]}</span>
    </>
  )
}

/** True when the element is scrolled to (or doesn't overflow past) its bottom. */
const isAtEnd = (el: HTMLElement): boolean => el.scrollHeight - el.scrollTop - el.clientHeight < 2

/** Scrollable preview table (one column per field, one row per context group) with a bottom
 *  fade that shows while there are more rows below, and disappears once scrolled to the end. */
export function PreviewTable({
  columns,
  rows
}: {
  columns: string[]
  rows: string[][]
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [atEnd, setAtEnd] = useState(true)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) setAtEnd(isAtEnd(el))
  }, [columns, rows])
  return (
    <div style={selectorStyles.tableOuter}>
      <div
        ref={ref}
        style={selectorStyles.tableWrap}
        onScroll={(e) => setAtEnd(isAtEnd(e.currentTarget))}
      >
        <table style={selectorStyles.table}>
          <thead>
            <tr>
              {columns.map((c, j) => (
                <th key={`${c}${j}`} style={selectorStyles.th}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td
                    key={j}
                    // A column with no header is a UI-only separator (e.g. "vs"): muted, centred.
                    style={{
                      ...selectorStyles.td,
                      ...(columns[j] === '' ? selectorStyles.tdSep : null)
                    }}
                  >
                    {renderCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!atEnd && <div style={selectorStyles.fade} />}
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const selectorStyles: Record<string, CSSProperties> = {
  // ── section shells shared by both contrast modes and Compare ──
  conds: { display: 'flex', flexDirection: 'column', gap: 4, padding: 14, overflow: 'auto' },
  condsHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 },
  condsHeadSwitch: {
    flex: '0 0 auto',
    width: 110,
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted
  },
  matchedLine: { paddingTop: 6, borderTop: `1px solid ${UI.border}` },
  anyTag: { fontSize: 11, color: UI.textMuted, fontStyle: 'italic' },
  preview: { padding: '12px 16px', overflow: 'auto', flex: 1, minHeight: 0 },
  previewHead: { fontSize: 12, fontWeight: 700, color: UI.text, marginBottom: 6 },
  condRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '6px 0',
    borderTop: `1px solid ${UI.border}`
  },
  condHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',
    width: 110,
    paddingTop: 1
  },
  condName: { fontSize: 12, fontWeight: 600, color: UI.textMuted },
  condNameOn: { color: UI.text },
  switchTrack: {
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    width: 28,
    height: 15,
    borderRadius: 8,
    padding: 2,
    border: 'none',
    boxSizing: 'border-box',
    transition: 'background 120ms'
  },
  switchKnob: {
    width: 11,
    height: 11,
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,0.4)'
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' },
  // Border as LONGHANDS, not the `border` shorthand: the partial look overrides borderStyle, and
  // when a chip returns to another look React only clears that one property — with a shorthand
  // base the button would fall back to the UA default (border-style: outset) and grow a dark
  // bottom/right edge. Explicit longhands are re-applied on every transition.
  valChip: {
    background: 'transparent',
    color: UI.text,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: UI.border,
    borderRadius: 10,
    padding: '2px 9px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  valChipOn: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  valChipIncluded: { background: 'rgba(63,174,90,0.22)', color: UI.text, borderColor: UI.ok },
  valChipIdle: { background: UI.panelAlt, color: UI.text, borderColor: UI.panelAlt },
  valChipPartial: {
    background: 'rgba(63,174,90,0.10)',
    color: UI.text,
    borderColor: UI.ok,
    borderStyle: 'dotted'
  },
  tableOuter: { position: 'relative' },
  tableWrap: {
    maxHeight: 200,
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
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
  // A column with no header is a UI-only separator ("vs"): muted, centred, not monospace.
  tdSep: { color: UI.textMuted, textAlign: 'center', fontFamily: 'inherit', padding: '3px 4px' },
  tdFaint: { color: UI.textMuted }
}
