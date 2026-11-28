/**
 * Painting a sample name's tokens into condition fields: the painted name, its ruler and
 * connectors, the teacher row, and a new custom condition's row.
 */
import { Fragment, type ReactNode, useRef, useState } from 'react'
import { UI } from '../../../ui/app/theme'
import { OnOffSwitch } from '../../../ui/controls/ToggleSwitch'
import { type ColorOf, type Field, tokenBounds } from './fields'
import { styles } from './styles'

/** Invert (a circle split black / white) — the names table's "invert the row selection" button. */
export function IconInvert(): ReactNode {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M12 2.5a9.5 9.5 0 0 1 0 19z" fill="currentColor" />
    </svg>
  )
}

/** A wide, flat paintbrush (stroke icon on currentColor): the Columns step's "Set column type" — a
 *  column type is painted onto headers. */
export function IconPaint(): ReactNode {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* a wide, flat brush: handle, ferrule, bristles (split into strands) — drawn upright,
          tilted 40° so the bristles lean down-left, mid-stroke */}
      <g transform="rotate(40 12 12)">
        <rect x="10" y="2" width="4" height="8" rx="2" />
        <rect x="5" y="10" width="14" height="3" rx="0.5" />
        <path d="M5 13h14v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" />
        <path d="M10 17v4M14 17v4" />
      </g>
    </svg>
  )
}

/** The Conditions step's last row: a condition of your own, listed like the others — a switch beside
 *  a greyed "custom" label. Switch it on and a name box takes the label's place; name it (Enter, or
 *  click away) and it becomes a condition, switched on, with this row off and empty again for the
 *  next. Left unnamed (or switched back off), it flips back. Names are validated against the
 *  engine's rule (lowercase identifier, not a reserved samplesheet column) because the name becomes
 *  a samplesheet column and a `@name` condition key downstream. */
export function NewConditionRow({
  taken,
  onAdd
}: {
  taken: Field[]
  onAdd: (name: string) => string | null
}): ReactNode {
  const [on, setOn] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const reset = (): void => {
    setOn(false)
    setText('')
    setErr(null)
  }
  const commit = (): void => {
    const name = text.trim().toLowerCase()
    if (name === '') return reset() // not named: back to off
    if (taken.includes(name)) {
      setErr(`“${name}” is already a condition`)
      return
    }
    const problem = onAdd(name)
    if (problem) setErr(problem)
    else reset()
  }
  return (
    <span style={styles.condToggle}>
      <span
        style={{ display: 'inline-flex' }}
        title={on ? 'Switch off to cancel' : 'Switch on to add a condition of your own'}
        // Keep the name box focused through a click here: its blur would add the typed name before
        // the switch-off could cancel it.
        onMouseDown={(e) => e.preventDefault()}
      >
        <OnOffSwitch
          on={on}
          size="lg"
          label="new condition"
          title=""
          onChange={(v) => (v ? setOn(true) : reset())}
        />
      </span>
      {on ? (
        <span style={styles.addCondBox}>
          <input
            autoFocus
            value={text}
            placeholder="custom"
            spellCheck={false}
            title="Lowercase letters, digits and _ (it becomes a samplesheet column)"
            style={styles.addCondInput}
            onChange={(e) => {
              setText(e.target.value)
              setErr(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') reset()
            }}
            onBlur={commit}
          />
          {err && <span style={styles.addCondErr}>{err}</span>}
        </span>
      ) : (
        <span style={{ color: UI.textMuted }}>custom</span>
      )}
    </span>
  )
}

/** Split a name into consecutive same-field runs. */
function fieldRuns(
  name: string,
  map: (Field | null)[]
): Array<{ text: string; field: Field | null }> {
  const out: Array<{ text: string; field: Field | null }> = []
  let i = 0
  while (i < name.length) {
    const f = map[i]
    let j = i + 1
    while (j < name.length && map[j] === f) j++
    out.push({ text: name.slice(i, j), field: f })
    i = j
  }
  return out
}

/** Static name with each region coloured by a char→field map. `faint` uses a lower-opacity fill for
 *  the greyed-out inactive rows (region still shown, just de-emphasised). */
export function PaintedName({
  name,
  map,
  colorOf,
  faint
}: {
  name: string
  map: (Field | null)[]
  colorOf: ColorOf
  faint?: boolean
}): ReactNode {
  const alpha = faint ? '2b' : '59'
  return (
    <>
      {fieldRuns(name, map).map((r, i) =>
        r.field ? (
          <mark
            key={i}
            style={{ background: `${colorOf(r.field)}${alpha}`, color: 'inherit', padding: 0 }}
          >
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        )
      )}
    </>
  )
}

/** The space a Map conditions connector leaves at either end (below the chip, above the token). */
export const CONNECTOR_GAP = 5

/** A Map conditions connector's arrowhead length (and so, its width: ~0.9 of it). */
export const ARROW_LEN = 9

/** Ruler for the strip above the table: the first sample's text, hidden (reserving identical
 *  monospace widths), so each annotated region lines up with its substring in the first row below.
 *  A region carries `data-ruler-field`: where the Map conditions connector from that condition's
 *  chip points (Stage1). */
export function RulerName({ name, map }: { name: string; map: (Field | null)[] }): ReactNode {
  return (
    <>
      {fieldRuns(name, map).map((r, i) =>
        r.field ? (
          <span key={i} data-ruler-field={r.field} style={{ visibility: 'hidden' }}>
            {r.text}
          </span>
        ) : (
          <span key={i} style={{ visibility: 'hidden' }}>
            {r.text}
          </span>
        )
      )}
    </>
  )
}

/** Interactive first row: each delimiter-separated token is a clickable span. With a field
 *  active, click a token to tag it, or drag across tokens to tag a multi-token chunk. Applied
 *  regions show in their field colour; hover/drag previews in the active field's colour. */
export function TeacherRow({
  name,
  map,
  armed,
  colorOf,
  onAnnotate,
  hovered = false,
  delims
}: {
  name: string
  /** char→field of this row's ALREADY-APPLIED regions (per-row, so painting one subset never
   *  changes another row's highlight). */
  map: (Field | null)[]
  armed: Field | null
  colorOf: ColorOf
  onAnnotate: (tokStart: number, tokEnd: number) => void
  /** the row is under the mouse — tint the cell to match the rest of the row */
  hovered?: boolean
  /** token separators */
  delims: string[]
}): ReactNode {
  const [drag, setDrag] = useState<{ a: number; f: number } | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  // A paint drag that ends on empty cell space still fires a click (on the drag's common
  // ancestor). The row toggles on empty-space clicks, so that one click is swallowed.
  const paintedRef = useRef(false)
  const { tokens, starts, gaps } = tokenBounds(name, delims)
  const lo = drag ? Math.min(drag.a, drag.f) : -1
  const hi = drag ? Math.max(drag.a, drag.f) : -1

  const finish = (): void => {
    if (drag && armed) {
      onAnnotate(lo, hi + 1)
      paintedRef.current = true
    }
    setDrag(null)
  }
  // `fallback` is the idle background: a faint chip for tokens (so token boundaries read as
  // discrete units), transparent for the delimiters between them (the visual gap).
  const bgFor = (applied: Field | null, active: boolean, fallback: string): string =>
    active && armed ? `${colorOf(armed)}80` : applied ? `${colorOf(applied)}59` : fallback

  return (
    <td
      style={{ ...styles.nameCell, ...styles.teachCell, ...(hovered ? styles.hoverCell : null) }}
      onMouseUp={finish}
      onMouseLeave={() => {
        setHover(null)
        setDrag(null)
      }}
      onClickCapture={(e) => {
        if (!paintedRef.current) return
        paintedRef.current = false
        e.stopPropagation()
      }}
    >
      {tokens.map((tok, i) => {
        const tokenActive = drag ? i >= lo && i <= hi : hover === i
        const delimActive = drag ? i >= lo && i < hi : false
        return (
          <Fragment key={i}>
            <span
              data-token=""
              onMouseDown={armed ? () => setDrag({ a: i, f: i }) : undefined}
              onMouseEnter={() => {
                setHover(i)
                setDrag((d) => (d ? { a: d.a, f: i } : d))
              }}
              style={{
                background: bgFor(map[starts[i]], tokenActive, CHIP_BG),
                cursor: armed ? 'pointer' : 'default',
                borderRadius: 3,
                padding: '1px 0'
              }}
            >
              {tok}
            </span>
            {i < tokens.length - 1 && (
              <span
                style={{
                  background: bgFor(map[starts[i] + tok.length], delimActive, 'transparent')
                }}
              >
                {gaps[i]}
              </span>
            )}
          </Fragment>
        )
      })}
    </td>
  )
}

/** Faint idle background so each token reads as a discrete chip. */
const CHIP_BG = 'rgba(128,128,128,0.16)'
