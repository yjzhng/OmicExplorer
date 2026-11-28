/** Conditions card 2: the editable samplesheet grid — include box and per-cell overrides. */
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { InteractiveSampleCond } from '../../../engine'
import { ScrollFade } from '../../../ui/table/ScrollFade'
import { VirtualTbody } from '../../../ui/table/VirtualRows'
import type { CondUnits } from '../../../graph/config/units'
import {
  type Col,
  COL_PAD,
  type ColorOf,
  COND_W,
  condOf,
  type Field,
  isPresetField,
  type RowSpans,
  spanValue,
  UNIT_EXTRA
} from './fields'
import { styles } from './styles'
import { UnitChip } from './UnitChip'
import { unitSpec, type UnitSpec } from './units'
import { RenameBar, type RenamePreview } from './RenameBar'
import { findRanges, type MarkRange } from './findRanges'
import { MatchInput } from './MatchInput'

/** The Refine table's empty last column is this wide. */
const ADD_COL_W = 150

/** A condition's type above its name in the Refine table: num (dose, time, a custom one switched to
 *  num) or cat. A custom one's switches on a click, as its chip in the left panel; the presets'
 *  are fixed. The replicate has none. */
function CondTypeChip({
  field,
  numeric,
  onNumeric
}: {
  field: Field
  numeric: string[]
  onNumeric: (name: string, on: boolean) => void
}): ReactNode {
  if (field === 'rep') return null
  const num = field === 'dose' || field === 'time' || numeric.includes(field)
  const what = num
    ? 'Numeric: its values are numbers on a scale, with a unit'
    : 'Categorical: its values are labels'
  return isPresetField(field) ? (
    <span style={styles.typeChip} title={`${what} (fixed for ${field}).`}>
      {num ? 'num' : 'cat'}
    </span>
  ) : (
    <button
      type="button"
      style={{ ...styles.typeChip, ...styles.typeChipBtn }}
      title={`${what}. Click to make it ${num ? 'categorical' : 'numeric'}.`}
      onClick={() => onNumeric(field, !num)}
    >
      {num ? 'num' : 'cat'}
    </button>
  )
}

/** The Refine table's empty last column: a name box — Enter (or leaving it) adds a condition of
 *  your own, as the left panel's "new condition" row does; a name that can't be used says why. */
function AddConditionField({
  taken,
  onAdd
}: {
  taken: readonly Field[]
  onAdd: (name: string) => string | null
}): ReactNode {
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const commit = (): void => {
    const name = text.trim().toLowerCase()
    if (name === '') return setErr(null)
    if (taken.includes(name)) return setErr(`“${name}” is already a condition`)
    const problem = onAdd(name)
    if (problem) setErr(problem)
    else {
      setText('')
      setErr(null)
    }
  }
  return (
    <>
      <input
        aria-label="new condition"
        placeholder="+ new condition"
        style={styles.addColInput}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setErr(null)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') {
            setText('')
            setErr(null)
          }
        }}
      />
      {err && <span style={styles.addColErr}>{err}</span>}
    </>
  )
}

/** Stage 2: editable grid — include checkbox + per-cell overrides for naming exceptions, plus a
 *  rename bar to change a condition value across every sample at once. */
export function Stage2({
  samples,
  spans,
  colorOf,
  delims,
  setCell,
  setInclude,
  onRenameValue,
  units,
  onUnits,
  numeric,
  onNumeric,
  onAddCondition,
  activeFields
}: {
  samples: InteractiveSampleCond[]
  /** sample header → field → applied token span (the source of the raw "original" value) */
  spans: Record<string, RowSpans>
  colorOf: ColorOf
  /** token separators the spans were painted under */
  delims: string[]
  setCell: (i: number, field: Field, value: string) => void
  setInclude: (i: number, on: boolean) => void
  onRenameValue: (field: Field, map: Record<string, string>) => void
  /** the numeric conditions' units (kept on the Load tile) */
  units: CondUnits
  onUnits: (units: CondUnits) => void
  /** the custom conditions declared numeric (each takes a unit, as dose and time), and switching
   *  one (its cat / num chip, above its name) */
  numeric: string[]
  onNumeric: (name: string, on: boolean) => void
  /** add a custom condition (the empty column at the right): why the name can't be used, or null */
  onAddCondition: (name: string) => string | null
  /** the conditions switched on (the left panel) — one column each, in that order */
  activeFields: Field[]
}): ReactNode {
  // Dose and time are the numeric conditions: each shows its unit chip by its name.
  const unitFor = (f: Field): UnitSpec | undefined => unitSpec(f, units, onUnits, numeric)
  // The rename bar's choices: each condition, with its distinct values (numeric-aware order, blank
  // last — so empty cells can be filled in one go) and how many samples carry each.
  // The refactor bar's pending matches, highlighted in the table until applied or cleared.
  const [renamePreview, setRenamePreview] = useState<RenamePreview | null>(null)
  const renameOptions = activeFields
    .map((f) => {
      const counts = new Map<string, number>()
      for (const s of samples) {
        const v = condOf(s, f).trim()
        counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      return {
        field: f,
        values: [...counts.entries()]
          .sort((a, b) =>
            a[0] === '' || b[0] === ''
              ? Number(a[0] === '') - Number(b[0] === '')
              : a[0].localeCompare(b[0], undefined, { numeric: true })
          )
          .map(([value, count]) => ({ value, count }))
      }
    })
    .filter((o) => o.values.length > 0)
  // A cell set by hand (typed, or renamed — `edited`) and now differing from what its sample name
  // maps to (its tagged span; nothing when untagged): its text box is outlined. Returns the
  // mapped value (for the tooltip), else undefined.
  const parsedAs = (s: InteractiveSampleCond, f: Field): string | undefined => {
    if (!s.edited?.includes(f)) return undefined
    const span = spans[s.sample]?.[f]
    const orig = span ? spanValue(s.sample, span, delims) : ''
    return orig !== condOf(s, f).trim() ? orig : undefined
  }
  // A column per condition switched on (the left panel), so the table is just what's in use.
  const cols: Col[] = ['include', 'sample', ...activeFields]

  const headRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const [widths, setWidths] = useState<(number | null)[]>(() => cols.map(() => null))
  // A different set of columns (a condition switched on or off) re-fits them all.
  const colKey = cols.join('|')
  const [fittedKey, setFittedKey] = useState(colKey)
  if (fittedKey !== colKey) {
    setFittedKey(colKey)
    setWidths(cols.map(() => null))
  }
  const fixed = widths.length === cols.length && widths.every((w) => w != null)
  // Pinned, the table is exactly its columns' widths: no column stretches to fill the box.
  const pinnedSum = widths.reduce<number>((a, w) => a + (w ?? 0), 0)

  // A null width means "(re)fit to content": while any column is null the table lays out `auto`
  // (that column sizes to its content); we then measure it (+ padding) and pin it, returning to
  // a fixed layout. Runs on mount (all null), after a column set change, and after a reset.
  // Fitted widths. The sample column is exactly as wide as its longest name. Every condition column
  // starts from one shared width (dose and time a bit more, for the unit beside the value) and grows
  // only when a value — or its name in the header — needs more. Text is measured in the cells' font.
  useLayoutEffect(() => {
    if (widths.length === cols.length && widths.some((w) => w == null)) {
      const el = headRefs.current[1]
      const ctx = document.createElement('canvas').getContext('2d')
      const family = el ? getComputedStyle(el).fontFamily : 'sans-serif'
      const textW = (t: string, font: string): number => {
        if (!ctx) return 0
        ctx.font = `${font} ${family}`
        return ctx.measureText(t).width
      }
      const CELL_PAD = 16 // the cell's 8px each side
      const INPUT_PAD = 12 // the text box's 5px padding + 1px border, each side
      const sampleW =
        Math.ceil(
          Math.max(...['sample', ...samples.map((sm) => sm.sample)].map((t) => textW(t, '12px')))
        ) +
        CELL_PAD +
        2
      const condW = (f: Field): number => {
        // a numeric condition (dose, time, a custom one switched to num) shows its unit
        const preset = f === 'dose' || f === 'time'
        const unit = preset || numeric.includes(f)
        const base = COND_W + (unit ? UNIT_EXTRA : 0)
        // the longest value in its text box (+ the unit after it, for a numeric one)
        const unitName = (units as Record<string, string | undefined>)[preset ? f : `@${f}`]
        const unitText = unit ? textW(unitName ?? '', '11px') + 4 : 0
        const longest = Math.max(0, ...samples.map((sm) => textW(condOf(sm, f), '12px')))
        const value = Math.ceil(longest) + INPUT_PAD + unitText + CELL_PAD
        // its name in the header (bold), with the unit chip beside it for a numeric one
        const head = Math.ceil(textW(f, '600 12px')) + (unit ? 44 : 0) + CELL_PAD
        return Math.max(base, value, head)
      }
      setWidths((prev) =>
        // columns: include, sample, then the conditions in `fields` order
        prev.map((w, i) => {
          if (w != null) return w
          if (i === 0) return (headRefs.current[0]?.offsetWidth ?? 0) + COL_PAD
          if (i === 1) return sampleW
          return condW(activeFields[i - 2])
        })
      )
    }
  }, [widths, cols.length, activeFields, samples, units, numeric])

  const startResize = (i: number, startX: number): void => {
    const startW = widths[i] ?? headRefs.current[i]?.offsetWidth ?? 60
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(28, startW + (ev.clientX - startX))
      setWidths((prev) => prev.map((x, k) => (k === i ? w : x)))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Nothing pins to the panel here: the rename bar above the table, the table scrolling inside its
  // own box (its header pinned there).
  return (
    <>
      {/* The rename bar above the table: rename a value everywhere at once. */}
      {renameOptions.length > 0 && (
        <RenameBar
          options={renameOptions}
          colorOf={colorOf}
          onRename={onRenameValue}
          onPreview={setRenamePreview}
        />
      )}
      {/* Its own scroll box, filling the rest of the panel: the table scrolls inside it (sideways
          when wider, down when longer), its header pinned to the box, its edges fading. */}
      <ScrollFade>
        {/* Columns fit their content. */}
        <table
          style={{
            ...styles.grid,
            // Fitting (auto layout): natural widths, no stretching to the box — or the spare would
            // be spread over the columns and pinned into them. Pinned: exactly the columns' widths.
            ...(fixed
              ? { tableLayout: 'fixed', width: pinnedSum + ADD_COL_W, minWidth: 0 }
              : { tableLayout: 'auto', minWidth: 0 })
          }}
        >
          <colgroup>
            {cols.map((c, i) => (
              <col key={c} style={{ width: widths[i] != null ? `${widths[i]}px` : undefined }} />
            ))}
            <col style={{ width: `${ADD_COL_W}px` }} />
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => {
                const field = c !== 'include' && c !== 'sample'
                return (
                  <th
                    key={c}
                    ref={(el) => {
                      headRefs.current[i] = el
                    }}
                    style={{
                      ...styles.th,
                      top: 0,
                      // One line: a condition's name and its unit chip stay together, so the
                      // fitted width includes the chip rather than wrapping it under the name.
                      whiteSpace: 'nowrap',
                      ...(field ? { color: colorOf(c) } : null)
                    }}
                    aria-label={c === 'include' ? 'include' : undefined}
                  >
                    {!field ? (
                      c === 'include' ? (
                        ''
                      ) : (
                        c
                      )
                    ) : (
                      // Its type chip (cat / num) above; its name in its colour, with its unit chip
                      // for a numeric one.
                      <span style={styles.headStack}>
                        <CondTypeChip field={c} numeric={numeric} onNumeric={onNumeric} />
                        <span style={styles.condName}>
                          {c}
                          {unitFor(c) && <UnitChip spec={unitFor(c)!} color={colorOf(c)} />}
                        </span>
                      </span>
                    )}
                    <span
                      style={styles.resizer}
                      title="Drag to resize · double-click to fit content"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        startResize(i, e.clientX)
                      }}
                      onDoubleClick={() =>
                        setWidths((prev) => prev.map((w, k) => (k === i ? null : w)))
                      }
                    />
                  </th>
                )
              })}
              {/* An empty column at the right: type a name to add a condition of your own */}
              <th style={{ ...styles.th, ...styles.addColHead, top: 0 }}>
                <AddConditionField taken={activeFields} onAdd={onAddCondition} />
              </th>
            </tr>
          </thead>
          {/* Windowed (ui/table/VirtualRows): every sample scrolls, only those in view are drawn. Edits
              are kept as typed (setCell), so a row scrolled away loses nothing. */}
          <VirtualTbody
            count={samples.length}
            span={activeFields.length + 3}
            row={(i) => {
              const s = samples[i]
              const on = s.include !== false
              return (
                <tr key={s.sample} style={{ opacity: on ? 1 : 0.45 }}>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => setInclude(i, e.target.checked)}
                      style={styles.rowCheck}
                    />
                  </td>
                  <td
                    style={{ ...styles.td, ...styles.sampleCell, ...(fixed ? styles.clip : null) }}
                    title={s.sample}
                  >
                    {s.sample}
                  </td>
                  {activeFields.map((f) => {
                    // A numeric condition's unit trails its value (a.u. while none is set).
                    const spec = condOf(s, f).trim() !== '' ? unitFor(f) : undefined
                    const raw = condOf(s, f)
                    const matched =
                      renamePreview?.field === f && renamePreview.values.includes(raw.trim())
                    // A match marks just its text: the found text (text mode) or the value; a
                    // blank value has none, so its whole cell is tinted instead.
                    const marks = !matched
                      ? null
                      : renamePreview.find
                        ? findRanges(raw, renamePreview.find)
                        : raw.trim()
                          ? [
                              [
                                raw.indexOf(raw.trim()),
                                raw.indexOf(raw.trim()) + raw.trim().length
                              ] as MarkRange
                            ]
                          : null
                    return (
                      <td key={f} style={styles.td}>
                        <div style={styles.cellWithUnit}>
                          <MatchInput
                            marks={marks}
                            wrapStyle={fixed ? { flex: '1 1 auto', minWidth: 0 } : undefined}
                            style={{
                              ...styles.cellInput,
                              ...(fixed ? { flex: '1 1 auto', minWidth: 0, width: '100%' } : null),
                              // Edited (renamed or typed over): outlined (2px, border + ring) in
                              // the condition's colour, the value read off the sample name in its
                              // tooltip.
                              ...(parsedAs(s, f) !== undefined
                                ? {
                                    borderColor: colorOf(f),
                                    boxShadow: `0 0 0 1px ${colorOf(f)}`
                                  }
                                : null),
                              // A blank match: no text to mark, so the cell is tinted.
                              ...(matched && !marks ? styles.cellMatched : null)
                            }}
                            title={(() => {
                              const was = parsedAs(s, f)
                              return was !== undefined
                                ? was
                                  ? `Edited — read off the sample name as “${was}”`
                                  : 'Edited by hand'
                                : undefined
                            })()}
                            size={Math.max(condOf(s, f).length, f.length, 3)}
                            value={condOf(s, f)}
                            disabled={!on}
                            onChange={(e) => setCell(i, f, e.target.value)}
                          />
                          {/* The picked unit trails the value (nothing until one is picked). */}
                          {spec?.value && <span style={styles.cellUnit}>{spec.value}</span>}
                        </div>
                      </td>
                    )
                  })}
                  <td style={{ ...styles.td, ...styles.addColCell }} />
                </tr>
              )
            }}
          />
        </table>
      </ScrollFade>
    </>
  )
}
