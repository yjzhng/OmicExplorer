/** The Conditions stage's samplesheet mode: map a samplesheet in any layout onto the samples. */
import { type ReactNode, useRef, useState } from 'react'
import { UI } from '../../../ui/app/theme'
import { ScrollFade } from '../../../ui/table/ScrollFade'
import { VirtualTbody } from '../../../ui/table/VirtualRows'
import type { LoadedSheet } from '../../../graph/config/load'
import { mapColumn, pinRow, setNameColumn, sheetMatches } from '../../../graph/models/sheetMap'
import { type ColorOf, type Field, MONO } from './fields'
import { styles } from './styles'
import { ConditionPainter, NAME_CHIP, NAME_CHIP_COLOR } from './ConditionPainter'

/** No samplesheet yet: an empty one, so the samples show as they will beside one. */
const NO_SHEET: LoadedSheet = {
  file: '',
  columns: [],
  rows: [],
  nameCol: null,
  map: {},
  pinned: {}
}

/** The Conditions step's samplesheet mode: the sample names as they are, each beside its matched
 *  row of the samplesheet, then the rows that matched no sample, in red. The same painter as the
 *  names (ConditionPainter), a column at a time: arm a condition and click the column holding it —
 *  again to unmap; the Sample name chip marks the column naming each row's sample. A red row
 *  dragged onto a sample is matched to it (× undoes that). */
export function SheetMapper({
  sheet: loaded,
  sampleCols,
  activeFields,
  colorOf,
  armed,
  setArmed,
  onLoad,
  onSheet
}: {
  sheet: LoadedSheet | undefined
  sampleCols: string[]
  /** the conditions switched on (left panel) — the ones offered for mapping, and shown mapped */
  activeFields: Field[]
  colorOf: ColorOf
  armed: Field | null
  setArmed: (f: Field | null) => void
  onLoad: () => void
  onSheet: (next: LoadedSheet) => void
}): ReactNode {
  // Marking the sample-name column: a mode of its own, exclusive with a condition armed.
  const [armName, setArmName] = useState(false)
  if (armName && armed) setArmName(false)
  const [dropOn, setDropOn] = useState<string | null>(null)
  // The column under the pointer while painting: tinted in the armed chip's colour.
  const [hoverCol, setHoverCol] = useState<string | null>(null)
  const dragRow = useRef<number | null>(null)
  // Before a sheet is loaded: the samples alone, under the same painter, waiting for one.
  const sheet = loaded ?? NO_SHEET
  const rowOf = sheetMatches(sheet, sampleCols)
  const matched = new Set(rowOf.values())
  const unmatched = sheet.rows.map((_, i) => i).filter((i) => !matched.has(i))
  // The columns mapped to a condition that's on: one switched off keeps its column (switching it
  // back on restores it) but isn't shown, as a switched-off condition's painted names aren't.
  const fieldOf = new Map(
    Object.entries(sheet.map)
      .filter(([f]) => activeFields.includes(f))
      .map(([f, c]) => [c, f])
  )
  const clickColumn = (col: string): void => {
    if (armName) {
      onSheet(setNameColumn(sheet, col))
      setArmName(false)
    } else if (armed) onSheet(mapColumn(sheet, armed, col))
  }
  const drop = (sample: string): void => {
    if (dragRow.current != null) onSheet(pinRow(sheet, sample, dragRow.current))
    dragRow.current = null
    setDropOn(null)
  }
  const cells = (i: number | undefined): ReactNode =>
    sheet.columns.map((c, j) => {
      const f = fieldOf.get(c)
      return (
        <td
          key={c}
          style={{
            ...styles.td,
            ...styles.sampleCell,
            ...(f ? { background: `${colorOf(f)}1f` } : null)
          }}
        >
          {i == null ? '' : sheet.rows[i][j]}
        </td>
      )
    })
  return (
    <>
      {/* In the separator's place: the sheet to map from. */}
      <div style={styles.sheetBar}>
        <button style={styles.sheetBtn} onClick={onLoad}>
          {loaded ? 'Load another…' : 'Load samplesheet…'}
        </button>
        {loaded && (
          <span style={styles.hint}>
            {loaded.file} · {rowOf.size} of {sampleCols.length} samples matched
          </span>
        )}
      </div>
      <ConditionPainter
        activeFields={activeFields}
        colorOf={colorOf}
        armed={armed}
        setArmed={setArmed}
        applied={(f) => f in sheet.map}
        nameChip={{
          on: armName,
          applied: sheet.nameCol != null,
          onClick: () => {
            setArmName(!armName)
            setArmed(null)
          }
        }}
        info={
          <>
            Click a condition, then click the samplesheet column that holds it — the whole column
            maps to it. Click the column again to clear it. <b>sample name</b> marks the column
            naming each sample, if the guess is wrong. Drag a red row (one matching no sample) onto
            the sample it belongs to.
          </>
        }
      >
        <ScrollFade>
          <table style={{ ...styles.grid, tableLayout: 'auto' }}>
            <thead>
              <tr>
                <th style={styles.th}>Sample</th>
                {sheet.columns.map((c) => {
                  const f = fieldOf.get(c)
                  const isName = c === sheet.nameCol
                  return (
                    <th
                      key={c}
                      style={{
                        ...styles.th,
                        ...(armName || armed ? styles.sheetTh : null),
                        ...(f ? { color: colorOf(f) } : null),
                        ...(hoverCol === c && (armName || armed)
                          ? { background: `${armName ? NAME_CHIP_COLOR : colorOf(armed!)}33` }
                          : null)
                      }}
                      onClick={() => clickColumn(c)}
                      onMouseEnter={() => setHoverCol(c)}
                      onMouseLeave={() => setHoverCol((h) => (h === c ? null : h))}
                    >
                      {c}
                      {/* the painted column's bar, which its chip's connector points at */}
                      {(f || isName) && (
                        <span
                          data-ruler-field={f ?? NAME_CHIP}
                          style={{
                            ...styles.sheetBar3,
                            background: f ? colorOf(f) : NAME_CHIP_COLOR
                          }}
                        />
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            {/* Windowed (ui/table/VirtualRows): the samples, then the sheet rows matching none. */}
            <VirtualTbody
              count={sampleCols.length + unmatched.length}
              span={sheet.columns.length + 1}
              row={(k) => {
                if (k >= sampleCols.length) {
                  const i = unmatched[k - sampleCols.length]
                  return (
                    <tr
                      key={`row-${i}`}
                      draggable
                      onDragStart={(e) => {
                        dragRow.current = i
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', String(i))
                      }}
                      onDragEnd={() => setDropOn(null)}
                      style={{ ...styles.removedRow, cursor: 'grab' }}
                      title="Matches no sample — drag it onto the sample it belongs to"
                    >
                      <td style={{ ...styles.td, ...styles.sampleCell, ...styles.sheetMissing }}>
                        no sample
                      </td>
                      {cells(i)}
                    </tr>
                  )
                }
                const h = sampleCols[k]
                const i = rowOf.get(h)
                const pinned = sheet.pinned[h] === i && i != null
                return (
                  <tr
                    key={h}
                    draggable={i != null}
                    onDragStart={(e) => {
                      dragRow.current = i ?? null
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(i))
                    }}
                    onDragOver={(e) => {
                      if (dragRow.current == null || dragRow.current === i) return
                      e.preventDefault()
                      setDropOn(h)
                    }}
                    onDragLeave={() => setDropOn((d) => (d === h ? null : d))}
                    onDrop={() => drop(h)}
                    style={dropOn === h ? { outline: `2px solid ${UI.accent}` } : undefined}
                  >
                    <td
                      style={{
                        ...styles.td,
                        ...styles.sampleCell,
                        fontFamily: MONO,
                        ...(i == null && loaded ? styles.sheetMissing : null)
                      }}
                      title={i == null && loaded ? 'Not in the samplesheet: left out' : undefined}
                    >
                      {h}
                      {pinned && (
                        <button
                          style={styles.sheetUnpin}
                          title="Undo this match"
                          onClick={() => onSheet(pinRow(sheet, h, null))}
                        >
                          ×
                        </button>
                      )}
                    </td>
                    {cells(i)}
                  </tr>
                )
              }}
            />
          </table>
        </ScrollFade>
      </ConditionPainter>
    </>
  )
}
