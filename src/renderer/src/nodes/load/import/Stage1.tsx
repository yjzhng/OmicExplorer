/** Conditions card 1: field chips over every sample name, the learned regions highlighted. */
import { type ReactNode, useMemo, useRef, useState } from 'react'
import type { InteractiveSampleCond } from '../../../engine'
import { ScrollFade } from '../../../ui/table/ScrollFade'
import { longestText } from '../../../ui/table/useVirtualRows'
import { ProbeRow, VirtualTbody } from '../../../ui/table/VirtualRows'
import { Select as AppSelect } from '../../../ui/controls/Select'
import { type ColorOf, type Field, fieldMapFromSpans, type RowSpans } from './fields'
import { selectWidthFor } from './measure'
import { COMMON_SEPARATORS } from './units'
import { styles } from './styles'
import { ConditionPainter } from './ConditionPainter'
import { IconInvert, PaintedName, RulerName, TeacherRow } from './NamePainting'

/** Stage 1: field chips + a monospace list of every sample name with the learned regions
 *  colour-highlighted. Only the first (bright) row is interactive — the rest are dimmed to
 *  point the user at where to highlight. */
export function Stage1({
  samples,
  spans,
  colorOf,
  armed,
  setArmed,
  activeFields,
  onAnnotate,
  delims,
  separator,
  onSeparator
}: {
  samples: InteractiveSampleCond[]
  spans: Record<string, RowSpans>
  colorOf: ColorOf
  armed: Field | null
  setArmed: (f: Field | null) => void
  /** the conditions switched on (left panel) — the ones offered for mapping */
  activeFields: Field[]
  onAnnotate: (refName: string, tokStart: number, tokEnd: number, activeSamples: string[]) => void
  /** effective token separator(s) (never empty) */
  delims: string[]
  /** the separator as typed (may be blank mid-edit) */
  separator: string
  onSeparator: (sep: string) => void
}): ReactNode {
  // Rows the paint action applies to (and that are editable). Tracked as the INACTIVE set so a
  // freshly-appearing sample defaults to active — empty set = all active = the original behaviour.
  // Uncheck rows whose names follow a different token layout to tag them independently.
  const [inactive, setInactive] = useState<Set<string>>(() => new Set())
  // Anchor for shift-click range selection: the last row toggled by a plain click.
  const anchorRef = useRef<number | null>(null)
  // Toggle one row, or — with Shift held — apply the clicked row's resulting state to every row
  // between the anchor and this one (inclusive), like a typical list multi-select.
  const clickRow = (index: number, shift: boolean): void => {
    const name = samples[index].sample
    const willActivate = inactive.has(name) // currently inactive ⇒ this click activates it
    if (shift && anchorRef.current != null) {
      const [a, b] = [anchorRef.current, index].sort((x, y) => x - y)
      setInactive((prev) => {
        const next = new Set(prev)
        for (let i = a; i <= b; i++) {
          const nm = samples[i].sample
          if (willActivate) next.delete(nm)
          else next.add(nm)
        }
        return next
      })
    } else {
      setInactive((prev) => {
        const next = new Set(prev)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        return next
      })
    }
    anchorRef.current = index
  }
  // Flip every row's active state — the quick way to tag "everything else" after painting one
  // layout. The shift-click anchor is dropped since its meaning inverted with it.
  const invertSelection = (): void => {
    setInactive(new Set(samples.filter((s) => !inactive.has(s.sample)).map((s) => s.sample)))
    anchorRef.current = null
  }
  const activeSamples = samples.filter((s) => !inactive.has(s.sample)).map((s) => s.sample)
  // Row under the mouse (tinted, so the whole row reads as one clickable unit).
  const [hoverRow, setHoverRow] = useState<string | null>(null)
  // Clicking a row's empty space toggles it, like its checkbox. The checkbox handles itself, and
  // tokens (`data-token`) are reserved for painting.
  const rowClick = (e: React.MouseEvent, index: number): void => {
    const t = e.target as HTMLElement
    if (t.tagName === 'INPUT' || t.closest('[data-token]')) return
    clickRow(index, e.shiftKey)
  }
  // The separator: typed in its box, which is always editable; the dropdown follows it — the
  // preset it matches, else Custom.
  const sepInputRef = useRef<HTMLInputElement>(null)
  // Just wide enough for its longest option.
  const sepSelectW = useMemo(
    () => selectWidthFor([...COMMON_SEPARATORS.map((c) => c.label), 'custom']),
    []
  )
  const customSep = !COMMON_SEPARATORS.some((c) => c.value === separator)
  return (
    <>
      {/* The token separator the names are split on — first, as the tokens it makes are what
          conditions are painted onto. Changing it re-tokenises the names and clears the painted
          spans (they're token indexes). */}
      <div style={styles.chips}>
        {/* The common separators by name, or Custom for any other — typed in the box beside. */}
        <span style={styles.sepLabel}>
          Separator
          <span style={{ ...styles.sepSelect, width: sepSelectW }}>
            <AppSelect
              value={customSep ? 'custom' : separator}
              onChange={(v) => {
                if (v === 'custom') {
                  // Custom: an empty box, ready to type into.
                  onSeparator('')
                  window.setTimeout(() => sepInputRef.current?.focus(), 0)
                } else onSeparator(v)
              }}
              options={[
                ...COMMON_SEPARATORS.map((c) => ({ value: c.value, label: c.label })),
                { value: 'custom', label: 'custom' }
              ]}
            />
          </span>
          {/* The separator itself, in quotes (so a space has visible edges), always editable — typing
              a preset's character selects it above, anything else Custom. The quotes hug the text
              (the field is exactly its width) and meet when it's empty (""). */}
          <span
            style={styles.sepQuoted}
            // A click anywhere in the box types into it (empty, the field itself is 1px wide).
            onMouseDown={(e) => {
              const input = e.currentTarget.querySelector('input')
              if (input && e.target !== input) {
                e.preventDefault()
                input.focus()
              }
            }}
          >
            <span style={styles.sepQuote}>"</span>
            <input
              ref={sepInputRef}
              type="text"
              value={separator}
              spellCheck={false}
              onChange={(e) => onSeparator(e.target.value)}
              title="Sample names are split into tokens at this separator"

              aria-label="Separator"
              // 1ch per character (the font is monospace) — a `size` attribute adds slack, which
              // read as a trailing space — + 1px for the caret at the end, which would otherwise
              // scroll the text.
              style={{
                ...styles.sepInput,
                width: `calc(${separator.length}ch + 1px)`
              }}
            />
            <span style={styles.sepQuote}>"</span>
          </span>
        </span>
      </div>
      <ConditionPainter
        activeFields={activeFields}
        colorOf={colorOf}
        armed={armed}
        setArmed={setArmed}
        applied={(f) => samples.some((s) => spans[s.sample]?.[f] != null)}
        info={
          <>
            Click a condition, then click or drag tokens on a row to tag it. A tag is applied to
            every <b>checked</b> row — uncheck rows whose names use a different layout (their
            existing tags are kept) and tag them separately. Click a tag again to clear it.
          </>
        }
      >
        {/* Its own scroll box, filling the rest of the panel; the header row pins to its top, and
            the edges fade where more rows / columns are scrolled out of view. */}
        <ScrollFade>
          <table style={styles.nameTable}>
            <thead>
              <tr>
                <td style={{ ...styles.checkCell, ...styles.rulerCheckCell }}>
                  {/* Select all, then invert the selection beside it. */}
                  <span style={styles.selectTools}>
                    {/* Select / deselect all rows (indeterminate when only some are active). */}
                    <label style={styles.allCheck} title="Select / deselect all rows">
                      <input
                        type="checkbox"
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              activeSamples.length > 0 && activeSamples.length < samples.length
                        }}
                        checked={activeSamples.length === samples.length}
                        onChange={() =>
                          setInactive(
                            activeSamples.length === samples.length
                              ? new Set(samples.map((s) => s.sample)) // all active → deselect all
                              : new Set() // some/none active → select all
                          )
                        }
                        style={styles.rowCheck}
                      />
                    </label>
                    <button
                      style={styles.invertLink}
                      onClick={invertSelection}
                      title="Invert the selection: check every unchecked row and uncheck every checked one"
                      aria-label="Invert selection"
                    >
                      <IconInvert />
                    </button>
                  </span>
                </td>
                <td style={styles.rulerCell}>
                  <RulerName
                    name={samples[0].sample}
                    map={fieldMapFromSpans(
                      samples[0].sample,
                      spans[samples[0].sample] ?? {},
                      delims
                    )}
                  />
                </td>
              </tr>
            </thead>
            {/* Windowed (ui/table/VirtualRows): every sample scrolls, only those in view are drawn;
                the probe row keeps the name column as wide as the longest name. */}
            <VirtualTbody
              count={samples.length}
              span={2}
              tail={
                <ProbeRow
                  texts={['', longestText(samples.length, (i) => samples[i].sample)]}
                  cellStyle={styles.nameCell}
                />
              }
              row={(index) => {
                const s = samples[index]
                const active = !inactive.has(s.sample)
                const hovered = hoverRow === s.sample
                return (
                  <tr
                    key={s.sample}
                    style={styles.sampleRow}
                    onMouseEnter={() => setHoverRow(s.sample)}
                    onMouseLeave={() => setHoverRow((h) => (h === s.sample ? null : h))}
                    onClick={(e) => rowClick(e, index)}
                  >
                    <td style={{ ...styles.checkCell, ...(hovered ? styles.hoverCell : null) }}>
                      <input
                        type="checkbox"
                        checked={active}
                        // Handle in onClick (carries shiftKey); onChange is a no-op to keep it a
                        // controlled input. Space-toggling fires a click too, so keyboard still works.
                        onChange={() => {}}
                        onClick={(e) => clickRow(index, e.shiftKey)}
                        title={
                          active
                            ? 'Active — a paint applies to this row (Shift-click to select a range)'
                            : 'Inactive — excluded from a paint (Shift-click to select a range)'
                        }
                        style={styles.rowCheck}
                      />
                    </td>
                    {active ? (
                      // Active: editable, highlighted by its OWN applied spans. Painting derives the
                      // region from this row and re-places it on every active row.
                      <TeacherRow
                        name={s.sample}
                        map={fieldMapFromSpans(s.sample, spans[s.sample] ?? {}, delims)}
                        armed={armed}
                        colorOf={colorOf}
                        onAnnotate={(st, en) => onAnnotate(s.sample, st, en, activeSamples)}
                        hovered={hovered}
                        delims={delims}
                      />
                    ) : (
                      // Inactive: greyed-out, non-editable, but still shows its ALREADY-painted spans
                      // (faint) — excluded from the paint, its existing tags are left untouched.
                      <td
                        style={{
                          ...styles.nameCell,
                          ...styles.dimCell,
                          ...(hovered ? styles.hoverCell : null)
                        }}
                      >
                        <PaintedName
                          name={s.sample}
                          map={fieldMapFromSpans(s.sample, spans[s.sample] ?? {}, delims)}
                          colorOf={colorOf}
                          faint
                        />
                      </td>
                    )}
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
