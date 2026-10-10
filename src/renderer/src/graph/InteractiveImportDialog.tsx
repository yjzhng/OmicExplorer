/** Modal for interactive import — a wizard that recreates the standard input format from a raw
 *  data matrix, fully interactively:
 *   1. Columns  — classify each column: ID / Name / Sample / Metadata / Filter.
 *   2. Filtering — drop rows by a Filter column (skipped when there's none).
 *   3. Conditions — two cards: switch conditions on and tag each sample's cell/cmpd/dose/time/rep
 *      by clicking tokens; then review / correct the per-sample conditions (the samplesheet). The
 *      one in use lies flat, the other parked at its side at an angle.
 *   4. Metadata — review the DB (uniqID → gene + metadata) and convert.
 *  Portalled to <body> and flex-centred (crisp text). */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type ReactNode,
  type SetStateAction
} from 'react'
import { createPortal } from 'react-dom'

import {
  columnFacet,
  groupMembers,
  MATRIX_PRESETS,
  parseMatrix,
  RESERVED_COND_NAMES,
  validCondName,
  type ColumnFacet,
  type FilterSpec,
  type InteractiveRole,
  type InteractiveSampleCond,
  type MatrixPreset
} from '../engine'
import { cssVars, PALETTES, UI } from '../ui/theme'
import { useUiTheme } from '../ui/useUiTheme'
import { InfoTip } from '../ui/InfoTip'
import { StatusNote, type StatusKind } from '../ui/StatusNote'
import { Select as AppSelect } from '../ui/Select'
import { OnOffSwitch, ToggleSwitch } from '../ui/ToggleSwitch'
import { DOCKED_CARD, DOCKED_WRAP, useDialogDock } from './dialogDock'
import { useGraph } from './store'
import {
  AU,
  DOSE_UNITS,
  isStep,
  TIME_UNITS,
  type AnnotationSet,
  type CondUnits,
  type LoadConfig
} from './types'

/** The five built-in condition fields. A custom condition adds a sixth, seventh, … — so a Field is
 *  any name, and the preset list is only what's ALWAYS offered. */
const PRESET_FIELDS = ['cell', 'cmpd', 'dose', 'time', 'rep'] as const
type PresetField = (typeof PRESET_FIELDS)[number]
type Field = string
const isPresetField = (f: Field): f is PresetField =>
  (PRESET_FIELDS as readonly string[]).includes(f)

/** One sample's value for a field. Preset fields are columns of their own; a custom condition's
 *  value lives in the `extra` bag (keyed by the condition's name). */
const condOf = (c: InteractiveSampleCond, f: Field): string =>
  isPresetField(f) ? String(c[f] ?? '') : (c.extra?.[f] ?? '')

/** `c` with field `f` set to `v` — routed to the column or the `extra` bag as appropriate. */
const withCond = (c: InteractiveSampleCond, f: Field, v: string): InteractiveSampleCond =>
  isPresetField(f) ? { ...c, [f]: v } : { ...c, extra: { ...(c.extra ?? {}), [f]: v } }
/** `c` with condition `f` marked as set by hand (typed / renamed) — or, `on` false, as mapped. */
const withEdited = (c: InteractiveSampleCond, f: Field, on: boolean): InteractiveSampleCond => {
  const rest = (c.edited ?? []).filter((e) => e !== f)
  const edited = on ? [...rest, f] : rest
  return { ...c, edited: edited.length ? edited : undefined }
}
/** A field's location in a sample name as a token-index range [start, end). This is the SINGLE
 *  source of truth for the Conditions step — the value, the highlight and the samplesheet
 *  "original" all derive from it (never a separately-coded value-matching heuristic). */
type Span = [number, number]
/** Per-sample: which token range each assigned field occupies. Stored per row (never one global
 *  rule), so a paint on one group of rows can't disturb another group's regions. */
type RowSpans = Partial<Record<Field, Span>>

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** One colour per preset condition field, shared by the chips and the highlighted regions. */
const PRESET_COLORS: Record<PresetField, string> = {
  cell: '#4e79a7',
  cmpd: '#59a14f',
  dose: '#c99700',
  time: '#b07aa1',
  rep: '#e15759'
}
/** Colours custom conditions cycle through — distinct from every preset colour above, so a custom
 *  condition's regions never read as one of the built-in fields. */
const CUSTOM_COLORS = ['#76b7b2', '#ff9da7', '#9c755f', '#bab0ac', '#86bcb6', '#d37295']

/** A field's colour. `customs` is the ordered custom condition list, so each keeps a stable colour
 *  as long as the list's order doesn't change. */
const fieldColorIn = (f: Field, customs: readonly string[]): string => {
  if (isPresetField(f)) return PRESET_COLORS[f]
  const i = customs.indexOf(f)
  return CUSTOM_COLORS[(i < 0 ? 0 : i) % CUSTOM_COLORS.length]
}

/** The colour lookup the painting components take, so they don't each need the custom list. */
type ColorOf = (f: Field) => string

/** Default token separator for sample names (configurable per import — see `separator`). */
const DEFAULT_DELIM = '_'

/** How many feature rows the step-4 DB review renders (a preview — the full DB is written on
 *  convert). Rendering every row of a large matrix is slow and needless. */
const PREVIEW_ROWS = 200

/** Review-grid columns (the active condition fields are chosen per-render in Stage2). */
type Col = 'include' | 'sample' | Field
/** Extra px added to a measured content width so the input isn't cramped. */
const COL_PAD = 12
/** The standard files an import generates (data, ID map, samplesheet) — grouped apart from raw data
 *  files in the data-file list. */
const GENERATED_FILE = /_(wide|long|DB|samplesheet)\.(csv|tsv|txt)$/i
/** A condition column's starting width in the samplesheet table — the same for every condition;
 *  it grows only when a value (or the condition's name) needs more. */
const COND_W = 90
/** Extra starting width for dose and time: room for the unit after each value. */
const UNIT_EXTRA = 30

/** Tokens of a name plus each token's char-start offset, split on ANY of the `delims` (longest
 *  match wins where several could apply). `gaps[i]` is the separator found between tokens i and
 *  i+1, so a span's value can be re-joined exactly as it appears in the name. */
function tokenBounds(
  name: string,
  delims: string[]
): { tokens: string[]; starts: number[]; gaps: string[] } {
  const seps = [...delims].filter(Boolean).sort((a, b) => b.length - a.length)
  const tokens: string[] = []
  const starts: number[] = []
  const gaps: string[] = []
  let cur = ''
  let start = 0
  let i = 0
  while (i < name.length) {
    const sep = seps.find((d) => name.startsWith(d, i))
    if (sep) {
      tokens.push(cur)
      starts.push(start)
      gaps.push(sep)
      cur = ''
      i += sep.length
      start = i
    } else cur += name[i++]
  }
  tokens.push(cur)
  starts.push(start)
  return { tokens, starts, gaps }
}
/** Number of tokens a name splits into. */
const tokenCount = (name: string, delims: string[]): number =>
  tokenBounds(name, delims).tokens.length

/** Char range [start, end) covered by a token-index span (null if out of range / empty). */
function spanChars(name: string, [i, j]: Span, delims: string[]): [number, number] | null {
  const { tokens, starts } = tokenBounds(name, delims)
  if (i < 0 || j > tokens.length || i >= j) return null
  return [starts[i], starts[j - 1] + tokens[j - 1].length]
}

/** The value a span extracts from a name (its tokens re-joined by the separators between them). */
function spanValue(name: string, span: Span, delims: string[]): string {
  const { tokens, gaps } = tokenBounds(name, delims)
  if (span[0] < 0 || span[1] > tokens.length || span[0] >= span[1]) return ''
  let out = tokens[span[0]]
  for (let i = span[0] + 1; i < span[1]; i++) out += gaps[i - 1] + tokens[i]
  return out
}

/** Char index → field, built directly from a row's applied token spans. Because the highlight and
 *  the extracted value come from the SAME spans, the highlight always faithfully reflects the
 *  condition applied (and survives a later value rename, which never touches the span). */
function fieldMapFromSpans(name: string, rowSpans: RowSpans, delims: string[]): (Field | null)[] {
  const m: (Field | null)[] = new Array(name.length).fill(null)
  // Driven by the row's own painted fields rather than a fixed field list, so a custom condition
  // paints, anchors and highlights exactly like a preset one with no list to keep in sync.
  for (const f of Object.keys(rowSpans)) {
    const span = rowSpans[f]
    if (!span) continue
    const cs = spanChars(name, span, delims)
    if (!cs) continue
    for (let k = cs[0]; k < cs[1] && k < name.length; k++) m[k] = f
  }
  return m
}

/** How a painted region sits relative to the conditions ALREADY painted around it (and the name's
 *  ends), so the same paint can be re-placed on rows whose token layout differs. The reference row
 *  tells us which painted conds sit to the RIGHT of the selection (`right`); every other painted cond
 *  is a LEFT anchor. At apply time each row anchors to the end of the LAST (right-most) left-anchor it
 *  carries and the start of the first right-anchor it carries — so a new cond counts from the end of
 *  ANY existing cond on that row, not one fixed field. A side is FIRM when the selection touches its
 *  nearest landmark with no unpainted gap (a reliable anchor); an unpainted gap is NOT reliable
 *  across layouts, so that side isn't firm. */
interface AnchorDesc {
  /** painted fields the reference row had to the RIGHT of the selection (bound the region's right
   *  edge on each row); every OTHER painted cond is treated as a left anchor. */
  right: Field[]
  leftFirm: boolean
  leftGap: number
  rightFirm: boolean
  rightGap: number
  /** selection length in tokens (used for fixed-length one-sided anchoring) */
  len: number
}

/** Derive an anchor for the token range [tokStart, tokEnd) painted on `name`, from that row's other
 *  painted spans (the field being painted is excluded so its own prior region never anchors it). The
 *  string's start/end are the implicit outermost landmarks. */
function deriveAnchor(
  name: string,
  tokStart: number,
  tokEnd: number,
  rowSpans: RowSpans,
  field: Field,
  delims: string[]
): AnchorDesc {
  const N = tokenCount(name, delims)
  const right: Field[] = []
  let leftEnd = 0 // nearest painted-cond end to the left of the selection (string start if none)
  let rightStart = N // nearest painted-cond start to the right (string end if none)
  for (const f of Object.keys(rowSpans)) {
    if (f === field) continue
    const span = rowSpans[f]
    if (!span) continue
    if (span[0] >= tokEnd) {
      right.push(f)
      if (span[0] < rightStart) rightStart = span[0]
    } else if (span[1] <= tokStart && span[1] > leftEnd) {
      leftEnd = span[1]
    }
  }
  return {
    right,
    leftFirm: tokStart === leftEnd,
    leftGap: tokStart - leftEnd,
    rightFirm: tokEnd === rightStart,
    rightGap: rightStart - tokEnd,
    len: tokEnd - tokStart
  }
}

/** Place an anchor on a row: the left base is the end of the LAST (right-most) painted cond that
 *  isn't a right-anchor; the right base is the start of the nearest painted right-anchor present
 *  (else the string end). So the paint counts from the end of any existing cond the row carries, not
 *  a fixed field. Then:
 *   • both sides firm  → fill the gap between them (variable length — captures internal delimiters
 *                        that appear on only some rows, e.g. `cell_typeA`);
 *   • one side firm     → keep the selection's token length from that firm side;
 *   • neither firm      → anchor from the closer landmark, fixed length.
 *  Finally trim to the contiguous run of tokens NOT already claimed by another field, so a paint can
 *  never overwrite an existing one. Returns null when no placeable tokens remain. */
function applyAnchor(
  name: string,
  rowSpans: RowSpans,
  desc: AnchorDesc,
  field: Field,
  delims: string[]
): Span | null {
  const N = tokenCount(name, delims)
  const rightSet = new Set<Field>(desc.right)
  let leftBase = 0
  let rightBase = N
  for (const f of Object.keys(rowSpans)) {
    if (f === field) continue
    const span = rowSpans[f]
    if (!span) continue
    if (rightSet.has(f)) {
      if (span[0] < rightBase) rightBase = span[0] // nearest right-anchor start
    } else if (span[1] > leftBase) {
      leftBase = span[1] // end of the last left-anchor cond
    }
  }
  let a: number
  let b: number
  if (desc.leftFirm && desc.rightFirm) {
    a = leftBase
    b = rightBase
  } else if (desc.leftFirm) {
    a = leftBase
    b = leftBase + desc.len
  } else if (desc.rightFirm) {
    b = rightBase
    a = rightBase - desc.len
  } else if (desc.leftGap <= desc.rightGap) {
    a = leftBase + desc.leftGap
    b = a + desc.len
  } else {
    b = rightBase - desc.rightGap
    a = b - desc.len
  }
  a = Math.max(0, Math.min(a, N))
  b = Math.max(0, Math.min(b, N))
  if (a >= b) return null
  const occupied = new Set<number>()
  for (const f of Object.keys(rowSpans)) {
    if (f === field) continue
    const span = rowSpans[f]
    if (!span) continue
    for (let k = span[0]; k < span[1]; k++) occupied.add(k)
  }
  while (a < b && occupied.has(a)) a++
  let end = a
  while (end < b && !occupied.has(end)) end++
  return a < end ? [a, end] : null
}

/** Invert (a circle split black / white) — the names table's "invert the row selection" button. */
function IconInvert(): ReactNode {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth={2} />
      <path d="M12 2.5a9.5 9.5 0 0 1 0 19z" fill="currentColor" />
    </svg>
  )
}

/** A wide, flat paintbrush (stroke icon on currentColor): the Columns step's "Set column type" — a
 *  column type is painted onto headers. */
function IconPaint(): ReactNode {
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
function NewConditionRow({
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
function PaintedName({
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
const CONNECTOR_GAP = 5

/** A Map conditions connector from a chip's bottom (x1, y1) to a token (x2, y2): one smooth
 *  S-curve, tangent to vertical at both ends, with its arrowhead drawn as the last stretch of it —
 *  the dashed line stops an arrowhead's length short, and the head spans from there to the tip, so
 *  it leans with the curve over its length (a marker would take only the end's vertical tangent). */
function connectorPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { line: string; head: string } {
  const k = (y2 - y1) * 0.6
  type P = [number, number]
  const p0: P = [x1, y1]
  const p1: P = [x1, y1 + k]
  const p2: P = [x2, y2 - k]
  const p3: P = [x2, y2]
  const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  // De Casteljau at t: the point on the curve, and the control points of its first part.
  const split = (t: number): { at: P; c1: P; c2: P } => {
    const a = lerp(p0, p1, t)
    const b = lerp(p1, p2, t)
    const c = lerp(p2, p3, t)
    const d = lerp(a, b, t)
    const e = lerp(b, c, t)
    return { at: lerp(d, e, t), c1: a, c2: d }
  }
  // The point an arrowhead's length back from the tip (the distance falls as t → 1).
  let lo = 0
  let hi = 1
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2
    const [px, py] = split(mid).at
    if (Math.hypot(x2 - px, y2 - py) > ARROW_LEN) lo = mid
    else hi = mid
  }
  const { at: base, c1, c2 } = split(lo)
  const f = (n: number): string => String(Math.round(n * 10) / 10)
  const line = `M${f(x1)} ${f(y1)}C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(base[0])} ${f(base[1])}`
  // The head: tip at the token, its base across the curve at `base`.
  const len = Math.hypot(x2 - base[0], y2 - base[1]) || 1
  const ux = (x2 - base[0]) / len
  const uy = (y2 - base[1]) / len
  const w = ARROW_LEN * 0.45
  const head =
    `M${f(x2)} ${f(y2)}` +
    `L${f(base[0] - uy * w)} ${f(base[1] + ux * w)}` +
    `L${f(base[0] + uy * w)} ${f(base[1] - ux * w)}Z`
  return { line, head }
}

/** A Map conditions connector's arrowhead length (and so, its width: ~0.9 of it). */
const ARROW_LEN = 9

/** Ruler for the strip above the table: the first sample's text, hidden (reserving identical
 *  monospace widths), so each annotated region lines up with its substring in the first row below.
 *  A region carries `data-ruler-field`: where the Map conditions connector from that condition's
 *  chip points (Stage1). */
function RulerName({ name, map }: { name: string; map: (Field | null)[] }): ReactNode {
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
function TeacherRow({
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

/** A scroll box (with a max height) that shows a soft shadow on any edge where content is
 *  scrolled out of view — so it's clear when the table extends past the visible area. */
/** The nearest ancestor that scrolls horizontally (a header's table viewport). */
function scrollParentX(el: HTMLElement | null | undefined): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const ox = getComputedStyle(p).overflowX
    if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) return p
  }
  return null
}

function ScrollFade({
  children,
  fill = true,
  title,
  colNav = false,
  maxHeight
}: {
  children: ReactNode
  fill?: boolean
  /** cap the scroll box's height (with fill=false: a fixed-size preview inside a scrolling page) */
  maxHeight?: number
  /** a heading above the table (needed for colNav, whose arrows share its row) */
  title?: string
  /** arrow buttons, right of the title, that step the view one column left / right — for tables
   *  far wider than the window. Above the table rather than on it, so they never cover a header. */
  colNav?: boolean
}): ReactNode {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ top: false, bottom: false, left: false, right: false })
  // Height of a sticky header (if any) so the top/side fades start below it, not over it.
  const [headerH, setHeaderH] = useState(0)
  // The scrollbars' thickness (horizontal bar's height, vertical bar's width), so the bottom/right
  // fades end at the table's visible edge, not over a scrollbar. 0 where a bar is absent.
  const [bars, setBars] = useState({ x: 0, y: 0 })
  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const thead = el.querySelector('thead')
    setHeaderH((h) => {
      const nh = thead instanceof HTMLElement ? thead.offsetHeight : 0
      return h === nh ? h : nh
    })
    // offset − client size − the two border widths = the bar
    const border = el.clientLeft
    const nb = {
      x: Math.max(0, el.offsetHeight - el.clientHeight - 2 * border),
      y: Math.max(0, el.offsetWidth - el.clientWidth - 2 * border)
    }
    setBars((b) => (b.x === nb.x && b.y === nb.y ? b : nb))
    const next = {
      top: el.scrollTop > 0,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    }
    setEdges((prev) =>
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.left === next.left &&
      prev.right === next.right
        ? prev
        : next
    )
  }, [])
  useLayoutEffect(() => {
    update()
    const ro = new ResizeObserver(update)
    if (scrollRef.current) ro.observe(scrollRef.current)
    if (contentRef.current) ro.observe(contentRef.current)
    return () => ro.disconnect()
  }, [update])
  const heading =
    title != null ? (
      <div style={styles.tableHead}>
        <span style={styles.tableTitle}>{title}</span>
        {colNav && (edges.left || edges.right) && (
          <span style={styles.colSteps}>
            <ColStep
              dir={-1}
              disabled={!edges.left}
              onStep={() => stepColumn(scrollRef.current, -1)}
            />
            <ColStep
              dir={1}
              disabled={!edges.right}
              onStep={() => stepColumn(scrollRef.current, 1)}
            />
          </span>
        )}
      </div>
    ) : null
  const body = (
    // fill=false: take natural height (no flex cap) so the surrounding page scrolls as one, instead
    // of this box shrinking to a nested scroll region.
    <div style={{ ...styles.fadeWrap, ...(fill ? null : { flex: '0 0 auto' }) }}>
      {/* The vertical scrollbar starts below the sticky header row (app.css .oe-headscroll), so it
          scrolls the body it moves, not the header that stays put. */}
      <div
        ref={scrollRef}
        onScroll={update}
        className="oe-scroll oe-headscroll"
        style={{ ...styles.fadeScroll, maxHeight, ['--head-h' as string]: `${headerH}px` }}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {/* Inset by the 1px border and the scrollbars, so each fade sits on the table's visible
          edge (just above the horizontal bar, left of the vertical one). */}
      {edges.top && (
        <div style={{ ...styles.fade, ...styles.fadeTop, top: headerH + 1, right: 1 + bars.y }} />
      )}
      {edges.bottom && (
        <div
          style={{ ...styles.fade, ...styles.fadeBottom, bottom: 1 + bars.x, right: 1 + bars.y }}
        />
      )}
      {edges.left && (
        <div style={{ ...styles.fade, ...styles.fadeLeft, top: headerH + 1, bottom: 1 + bars.x }} />
      )}
      {edges.right && (
        <div
          style={{
            ...styles.fade,
            ...styles.fadeRight,
            top: headerH + 1,
            right: 1 + bars.y,
            bottom: 1 + bars.x
          }}
        />
      )}
    </div>
  )
  return heading ? (
    <>
      {heading}
      {body}
    </>
  ) : (
    body
  )
}

/** Where each table viewport's column-step scroll is heading while its smooth scroll runs — so a
 *  quick second click steps on from the target instead of re-measuring mid-animation. Cleared when
 *  the scroll ends. */
const stepTarget = new WeakMap<HTMLElement, number>()

/** Step a table viewport by column. The view's LEFT edge always lands on a column's start (never
 *  mid-column). Next (dir 1): the first column not FULLY in view on the right (cut off by the edge,
 *  or past it) comes fully into view — the smallest such step. Previous (dir −1): the column
 *  before the left-most one in view comes in at the left. */
function stepColumn(el: HTMLDivElement | null, dir: 1 | -1): void {
  const table = el?.querySelector('table')
  if (!el || !table) return
  // Each header's span in the viewport's own scroll coordinates (0 = the content's left edge), from
  // its on-screen box: offsetLeft can't be trusted here — the headers are sticky, which makes their
  // offsetParent a box outside the viewport (its border then shifts every column by a pixel).
  const origin = el.getBoundingClientRect().left + el.clientLeft - el.scrollLeft
  const spans = [...table.querySelectorAll<HTMLElement>('thead th')].map((th) => {
    const r = th.getBoundingClientRect()
    return { left: r.left - origin, right: r.right - origin }
  })
  if (spans.length === 0) return
  const at = stepTarget.get(el) ?? el.scrollLeft
  const view = el.clientWidth
  const max = el.scrollWidth - view
  let target: number
  if (dir > 0) {
    const next = spans.find((c) => c.right > at + view + 0.5)
    // the first column start far enough right to show `next` whole
    const fit = next ? spans.find((c) => c.left >= next.right - view - 0.5) : undefined
    target = fit ? fit.left : max
  } else {
    const prev = [...spans].reverse().find((c) => c.left < at - 0.5)
    target = prev ? prev.left : 0
  }
  target = Math.round(Math.max(0, Math.min(max, target)))
  if (target === Math.round(el.scrollLeft)) {
    stepTarget.delete(el)
    return
  }
  stepTarget.set(el, target)
  el.addEventListener('scrollend', () => stepTarget.delete(el), { once: true })
  el.scrollTo({ left: target, behavior: 'smooth' })
}

/** A small round arrow button beside a table's title, for stepping a wide table a column. */
function ColStep({
  dir,
  disabled,
  onStep
}: {
  dir: 1 | -1
  disabled: boolean
  onStep: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onStep}
      disabled={disabled}
      title={dir > 0 ? 'Next column' : 'Previous column'}
      aria-label={dir > 0 ? 'Next column' : 'Previous column'}
      style={{ ...styles.colStep, opacity: disabled ? 0.35 : 1 }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path
          d={dir > 0 ? 'M3.5 1.5 L7 5 L3.5 8.5' : 'M6.5 1.5 L3 5 L6.5 8.5'}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

/** Wizard stages: Columns · Filtering · Conditions · Metadata. Numbered 1, 2, 3, 5: stage 4 (a
 *  separate Samplesheet step) merged into Conditions, and the numbers are what a project saves
 *  (`interactive.step`) — so an old 4 still means "the conditions" and 5 still "metadata". */
type Stage = 1 | 2 | 3 | 5
const STAGES: Array<{ stage: Stage; name: string }> = [
  { stage: 1, name: 'Columns' },
  { stage: 2, name: 'Filtering' },
  { stage: 3, name: 'Conditions' },
  { stage: 5, name: 'Metadata' }
]

/** Next/previous stage, skipping Filtering (stage 2) when no column is a filter. */
function nextStage(s: Stage, hasFilters: boolean): Stage {
  if (s === 1) return hasFilters ? 2 : 3
  if (s === 2) return 3
  return 5
}
function prevStage(s: Stage, hasFilters: boolean): Stage {
  if (s === 5) return 3
  if (s === 3) return hasFilters ? 2 : 1
  return 1
}

/** Completed-stage green, matching the tile status dot. */
const DONE_GREEN = '#3fae5a'

/** Top-of-modal roadmap: the 4 wizard stages as numbered pills joined by connectors. A stage
 *  the user has finished (before the current one) reads green with a ✓; the current stage is
 *  accent-highlighted; stages not yet reached stay grey. When `allDone` (the import was already
 *  converted), every stage reads green. Display-only. */
function Roadmap({
  stage,
  steps,
  allDone,
  onJump
}: {
  stage: number
  /** each step's stage number (what's saved and jumped to) and name; shown numbered 1, 2, … */
  steps: Array<{ stage: number; name: string }>
  allDone: boolean
  onJump: (stage: number) => void
}): ReactNode {
  return (
    <div style={styles.roadmap}>
      {steps.map(({ stage: n, name }, i) => {
        const done = allDone || n < stage
        // The stage the user is on — marked even when every stage is complete, so "you are here"
        // stays visible among all-green pills (accent ring + accent label).
        const current = n === stage
        // Completed (green) stages are clickable to jump straight there; the current stage and
        // not-yet-reached stages aren't.
        const clickable = !current && done
        // The current pill always uses the accent look (ring + accent fill + number), whether or
        // not the import is complete — so "you are here" reads identically in both states.
        const dotBg = current ? UI.accent : done ? DONE_GREEN : 'transparent'
        const dotBorder = current ? UI.accent : done ? DONE_GREEN : UI.border
        const dotFg = done || current ? '#fff' : UI.textMuted
        return (
          <Fragment key={name}>
            {i > 0 && (
              <div
                style={{
                  ...styles.roadLine,
                  background: allDone || n <= stage ? DONE_GREEN : UI.border
                }}
              />
            )}
            <div
              style={{ ...styles.roadStep, cursor: clickable ? 'pointer' : 'default' }}
              onClick={clickable ? () => onJump(n) : undefined}
              role={clickable ? 'button' : undefined}
              title={clickable ? `Go to ${name}` : undefined}
            >
              <span
                style={{
                  ...styles.roadDot,
                  background: dotBg,
                  borderColor: dotBorder,
                  color: dotFg,
                  // A ring around the current pill so it reads as "here" even when it's green.
                  ...(current ? { boxShadow: `0 0 0 3px ${UI.accent}55` } : null)
                }}
              >
                {done && !current ? '✓' : i + 1}
              </span>
              <span
                style={{
                  ...styles.roadLabel,
                  color: current ? UI.accent : done ? UI.ok : UI.textMuted,
                  fontWeight: current ? 700 : 600
                }}
              >
                {name}
              </span>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}

/** Fields offered by the annotation fetch (id → display label + resulting DB column(s)). Most come
 *  straight from UniProt; COG, MSigDB and Reactome are resolved in the main process from a UniProt
 *  cross-reference (see main/annotate.ts). A fetch always pulls ALL of these and caches them, so
 *  toggling which are shown never refetches. */
const UNIPROT_FIELDS: { id: string; label: string; cols: string[] }[] = [
  { id: 'protein_name', label: 'Protein name', cols: ['proteinName'] },
  { id: 'gene_names', label: 'Gene name', cols: ['geneName'] },
  // GO as ONE pick: its three aspects are fetched together (UniProt serves them as three fields,
  // stored as three columns) and pooled by enrichment anyway — see sourceIds.
  { id: 'go', label: 'GO', cols: ['GO_BP', 'GO_MF', 'GO_CC'] },
  // Orthologous group via eggNOG → NCBI COG2020 (prokaryotes) / KOG (eukaryotes), each its own
  // pick: the group name, functional category and area, in the COG_* / KOG_* columns.
  { id: 'cog', label: 'COG', cols: ['COG', 'COG_cat', 'COG_area'] },
  { id: 'kog', label: 'KOG (human)', cols: ['KOG', 'KOG_cat', 'KOG_area'] },
  { id: 'msigdb', label: 'MSigDB', cols: ['MSigDB'] },
  // Each pathway with its pathway category and group (aligned columns).
  { id: 'kegg', label: 'KEGG', cols: ['KEGG', 'KEGG_cat', 'KEGG_grp'] },
  // Each level-3 pathway with its level-2 group and top-level category (aligned columns).
  {
    id: 'reactome',
    label: 'Reactome (human)',
    cols: ['Reactome', 'Reactome_grp', 'Reactome_cat']
  },
  { id: 'string', label: 'STRING', cols: ['stringId'] },
  // Local joins by UniProt accession — no network. DEG is a cross-organism union of screens
  // (essential-only); CEG/NEG is the curated human gold standard and also reports non-essential.
  { id: 'essentiality', label: 'DEG', cols: ['DEG'] },
  { id: 'ceg', label: 'CEG-NEG (human)', cols: ['CEG_NEG'] }
]
const colsForIds = (ids: string[]): string[] =>
  UNIPROT_FIELDS.filter((f) => ids.includes(f.id)).flatMap((f) => f.cols)
/** The fetch's own field ids for the picked ones: the single GO pick is the three aspects the
 *  fetch knows separately (main/annotate.ts — go_bp / go_mf / go_cc). */
const sourceIds = (ids: string[]): string[] =>
  ids.flatMap((id) => (id === 'go' ? ['go_bp', 'go_mf', 'go_cc'] : [id]))

/** The fetch options grouped by what they annotate. A member is either a fetchable field id from
 *  UNIPROT_FIELDS or a placeholder (`soon`) for a source not wired up yet — listed so the category
 *  structure is complete, but shown disabled. */
interface AnnGroup {
  id: string
  label: string
  members: { id: string; label: string; soon?: boolean }[]
}
const fieldLabel = (id: string): string => UNIPROT_FIELDS.find((f) => f.id === id)?.label ?? id
const ANN_GROUPS: AnnGroup[] = [
  {
    id: 'identifiers',
    label: 'Identifiers',
    members: [
      { id: 'protein_name', label: fieldLabel('protein_name') },
      { id: 'gene_names', label: fieldLabel('gene_names') }
    ]
  },
  {
    id: 'function',
    label: 'Function',
    members: [
      { id: 'go', label: fieldLabel('go') },
      { id: 'cog', label: fieldLabel('cog') },
      { id: 'kog', label: fieldLabel('kog') },
      { id: 'msigdb', label: fieldLabel('msigdb') }
    ]
  },
  {
    id: 'pathway',
    label: 'Pathway',
    members: [
      { id: 'kegg', label: fieldLabel('kegg') },
      { id: 'reactome', label: fieldLabel('reactome') }
    ]
  },
  {
    id: 'essentiality',
    label: 'Essentiality',
    members: [
      { id: 'essentiality', label: fieldLabel('essentiality') },
      { id: 'ceg', label: fieldLabel('ceg') }
    ]
  },
  {
    id: 'interactions',
    label: 'Interactions',
    members: [{ id: 'string', label: fieldLabel('string') }]
  }
]

/** Open/close plumbing for a floating menu portalled next to a trigger button: positions it under
 *  the button (right-aligned so it never spills past the dialog), and dismisses on outside click,
 *  any scroll, resize or Escape. */
function useFloatingMenu(
  isOpen: boolean,
  setOpen: (o: boolean) => void
): {
  btnRef: React.RefObject<HTMLElement | null>
  menuRef: React.RefObject<HTMLDivElement | null>
  rect: { right: number; top: number; width: number } | null
} {
  const [rect, setRect] = useState<{ right: number; top: number; width: number } | null>(null)
  const btnRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const b = btnRef.current?.getBoundingClientRect()
    if (b) setRect({ right: window.innerWidth - b.right, top: b.bottom + 4, width: b.width })
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const close = (): void => setOpen(false)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true) // capture: any ancestor scroll dismisses
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, setOpen])
  return { btnRef, menuRef, rect }
}

/** A numeric condition's unit, for a UnitChip: dose and time have one, every other field none. */
interface UnitSpec {
  value: string | undefined
  options: readonly string[]
  onChange: (u: string | undefined) => void
}
function unitSpec(
  f: Field,
  units: CondUnits,
  onUnits: (u: CondUnits) => void
): UnitSpec | undefined {
  if (f === 'dose')
    return {
      value: units.dose,
      options: [AU, ...Object.keys(DOSE_UNITS)],
      onChange: (u) => onUnits({ dose: u as CondUnits['dose'] })
    }
  if (f === 'time')
    return {
      value: units.time,
      options: [AU, ...TIME_UNITS],
      onChange: (u) => onUnits({ time: u as CondUnits['time'] })
    }
  return undefined
}

/** The separators offered by name in the Conditions step's dropdown (then custom, which shows its
 *  text in quotes beside it). */
const COMMON_SEPARATORS: Array<{ value: string; label: string }> = [
  { value: '_', label: 'underscore' },
  { value: '-', label: 'hyphen' },
  { value: ' ', label: 'space' }
]

/** What an unpicked unit's chip says — a prompt: the import won't go on until one is picked. */
const UNIT_PROMPT = 'unit'

/** A minimal chip naming a numeric condition's unit ("unit" until one is picked — a.u. is one of
 *  the choices); a click opens the units as a floating list. Its clicks stay its own, so it can
 *  sit inside another clickable chip. */
function UnitChip({
  spec,
  color,
  prompt = UNIT_PROMPT
}: {
  spec: UnitSpec
  color?: string
  /** what it says until a unit is picked (default "unit"; the Set unit rows, after their
   *  "Select unit:" tip, show a dash) */
  prompt?: string
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const [open, setOpen] = useState(false)
  const { btnRef, menuRef, rect } = useFloatingMenu(open, setOpen)
  const pick = (u: string | undefined): void => {
    spec.onChange(u)
    setOpen(false)
  }
  return (
    <>
      <span
        ref={btnRef as React.RefObject<HTMLSpanElement | null>}
        role="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Unit of these values — click to change"
        // Borderless at rest; the border shows on hover (CSS :hover — app.css `.oe-unit-chip` — which
        // the browser keeps true, unlike tracked mouseenter/leave that a re-render or a portalled
        // menu could leave stuck) and in the field colour while open.
        className="oe-unit-chip"
        style={{
          ...styles.unitChip,
          ...(spec.value ? null : styles.unitChipUnset),
          // Always set, never dropped: React removes a dropped `borderColor` by clearing it, which
          // also wipes the shorthand's transparent colour — the border then fell back to the text
          // colour, an outline that stayed after a unit was picked.
          borderColor: open ? (color ?? UI.border) : 'transparent'
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        {spec.value ?? prompt}
      </span>
      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            // Portalled, but React still bubbles its events up the component tree — keep them from
            // reaching a host chip (a condition chip would otherwise arm on every pick).
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              ...cssVars(PALETTES[mode]),
              ...styles.dropdownMenu,
              ...styles.unitMenu,
              left: window.innerWidth - rect.right - rect.width,
              top: rect.top
            }}
          >
            {spec.options.map((u) => {
              const on = u === spec.value
              return (
                <button
                  key={u}
                  role="option"
                  aria-selected={on}
                  style={{ ...styles.unitItem, ...(on ? styles.unitItemOn : null) }}
                  onClick={() => pick(u)}
                >
                  {u}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}

/** One annotation category: a checkbox that (de)selects every fetchable member at once
 *  (indeterminate when only some are picked) and a caret that opens the member list to pick
 *  individually. Placeholder members are shown disabled. */
function AnnCategory({
  group,
  picked,
  disabled,
  onChange
}: {
  group: AnnGroup
  picked: Set<string>
  disabled: boolean
  onChange: (next: Set<string>) => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const [open, setOpen] = useState(false)
  const isOpen = open && !disabled
  const { btnRef, menuRef, rect } = useFloatingMenu(isOpen, setOpen)
  const available = group.members.filter((m) => !m.soon)
  const on = available.filter((m) => picked.has(m.id)).length
  const all = available.length > 0 && on === available.length
  const toggleAll = (): void => {
    const next = new Set(picked)
    for (const m of available) {
      if (all) next.delete(m.id)
      else next.add(m.id)
    }
    onChange(next)
  }
  const toggleOne = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <>
      {/* A button-styled chip holding the checkbox (a real <button> can't contain one): the box
          toggles the whole category; the label/caret opens the member list. */}
      <span
        ref={btnRef}
        style={{
          ...styles.annCatBtn,
          borderColor: isOpen ? UI.accent : UI.border,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? 'default' : 'pointer'
        }}
      >
        <input
          type="checkbox"
          ref={(el) => {
            if (el) el.indeterminate = on > 0 && !all
          }}
          checked={all}
          disabled={disabled}
          onChange={toggleAll}
          title={
            all
              ? `Deselect all ${group.label.toLowerCase()}`
              : `Select all ${group.label.toLowerCase()}`
          }
          style={{ margin: 0, cursor: disabled ? 'default' : 'pointer' }}
        />
        <span
          role="button"
          aria-disabled={disabled}
          aria-expanded={isOpen}
          style={styles.annCatLabel}
          onClick={() => {
            if (!disabled) setOpen((o) => !o)
          }}
          title="Choose which to fetch"
        >
          {group.label}
          {on > 0 && !all && (
            <span style={styles.annCatCount}>
              {on}/{available.length}
            </span>
          )}
          <span style={styles.dropdownCaret}>{isOpen ? '▲' : '▼'}</span>
        </span>
      </span>
      {isOpen &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...cssVars(PALETTES[mode]),
              ...styles.dropdownMenu,
              right: rect.right,
              top: rect.top,
              minWidth: Math.max(rect.width, 160)
            }}
          >
            <div style={styles.dropdownList}>
              {group.members.map((m) => (
                <label
                  key={m.id}
                  style={{ ...styles.dropdownItem, ...(m.soon ? { cursor: 'default' } : null) }}
                  title={m.soon ? 'Not available yet' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={!m.soon && picked.has(m.id)}
                    disabled={!!m.soon}
                    onChange={() => toggleOne(m.id)}
                  />
                  <span style={m.soon ? styles.dropdownItemOff : undefined}>{m.label}</span>
                  {m.soon && <span style={styles.annSoon}>soon</span>}
                </label>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}

export function InteractiveImportDialog({
  id,
  onClose
}: {
  id: string
  onClose: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  // Docked (the form workflow's details column): rendered into that pane, with no scrim.
  const dock = useDialogDock()
  const cfg = useGraph((s) => {
    const n = s.nodes.find((x) => x.id === id)
    return n && isStep(n) && n.data.kind === 'load' ? (n.data.config as LoadConfig) : null
  })
  const dataDir = useGraph((s) => s.dataDir)
  const inputFiles = useGraph((s) => s.inputFiles)
  const inputFileFolders = useGraph((s) => s.inputFileFolders)
  const update = useGraph((s) => s.updateConfig)
  const detectInteractive = useGraph((s) => s.detectInteractive)
  const convertInteractive = useGraph((s) => s.convertInteractive)
  const setInteractive = useGraph((s) => s.setInteractive)
  const setLoadUnits = useGraph((s) => s.setLoadUnits)

  // Wizard step + preset are restored from config so reopening lands on the last stage the user
  // was on (roadmap included), with the same column preset — mirroring how roles/conditions persist.
  const [stage, setStage] = useState<Stage>(() => {
    const s = cfg?.interactive?.step
    // An old saved 4 (the former Samplesheet step) is part of Conditions now.
    return s === 4 ? 3 : s === 1 || s === 2 || s === 3 || s === 5 ? s : 1
  })
  const [armed, setArmed] = useState<Field | null>(null)
  // Conditions switched on with no values yet — shared by the Conditions and Samplesheet steps (a
  // condition holding values is on by its values). See Stage1 / Stage2.
  const [activated, setActivated] = useState<Set<Field>>(() => new Set())
  const [preview, setPreview] = useState<{
    rows: Record<string, string>[]
    total: number
  } | null>(null)
  // The FULL parsed matrix rows (not just the capped preview), so the Filtering step can compute
  // distinct-value facets and kept-row counts over every row. Set once per matrix load.
  const [allRows, setAllRows] = useState<Record<string, string>[]>([])
  const [detecting, setDetecting] = useState(false)
  const [converting, setConverting] = useState(false)
  const [confirmedSheet, setConfirmedSheet] = useState(false)
  // Which way the last step turn went: the new step swipes in from the right going forward, from
  // the left going back (or jumping back on the roadmap).
  const [shownStage, setShownStage] = useState(stage)
  const [swipe, setSwipe] = useState<'next' | 'back'>('next')
  if (shownStage !== stage) {
    setShownStage(stage)
    setSwipe(stage > shownStage ? 'next' : 'back')
  }
  // The Conditions step's card in front (see ConditionsStage): 0 · switch on + map, 1 · Refine &
  // edit. The step is gated on the second — Next on the first turns to it, and only there can it
  // be confirmed and left; Back on the second turns back to the first.
  const [condCard, setCondCard] = useState<CondCard>(0)
  const [confirmed, setConfirmed] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Annotation fetch (Metadata step): status text + in-flight flag.
  const [annBusy, setAnnBusy] = useState(false)
  // The fetch's status line and how it reads: progress (info), done (ok), partly done (warn), failed.
  const [annMsg, setAnnNote] = useState<{ text: string; kind: StatusKind } | null>(null)
  const setAnnMsg = (text: string | null, kind: StatusKind = 'info'): void =>
    setAnnNote(text == null ? null : { text, kind })
  // Active classification mode: 'none' (default, nothing painted) or a tool preset re-runs
  // detection; 'custom' is set automatically once the user hand-edits any column's role.
  const [preset, setPreset] = useState<MatrixPreset | 'custom'>(
    () => cfg?.interactive?.preset ?? 'none'
  )
  // Persist the current stage + preset so reopening the wizard restores them. Only write once the
  // import spec exists (columns detected), so we never create a degenerate interactive object.
  useEffect(() => {
    if (cfg?.interactive && cfg.interactive.step !== stage) setInteractive(id, { step: stage })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])
  useEffect(() => {
    if (cfg?.interactive && cfg.interactive.preset !== preset) setInteractive(id, { preset })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset])

  const matrix = cfg?.matrix ?? null
  // Load the matrix once for previews: the data rows for step 1 and the DB rows for step 4.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!matrix || !dataDir) {
        if (!cancelled) {
          setPreview(null)
          setAllRows([])
        }
        return
      }
      const text = await window.api.readDataFile(dataDir, matrix)
      if (cancelled) return
      try {
        // Cap the rendered preview rows (step 1 shows a handful, step 4 a review sample) — rendering
        // every feature row is slow and needless; the full DB is written from the matrix on convert.
        const info = text ? parseMatrix(text) : null
        setAllRows(info?.rows ?? [])
        setPreview(
          info ? { rows: info.rows.slice(0, PREVIEW_ROWS), total: info.rows.length } : null
        )
      } catch {
        setAllRows([])
        setPreview(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [matrix, dataDir])

  // Auto-read columns when the dialog opens with a matrix already chosen (from the tile) and
  // nothing classified yet — so step 1 is populated without a manual "Read columns" click. Only
  // fires while unclassified, so it never overwrites an existing classification (flips false once
  // detect populates columns).
  const needsDetect = !!matrix && !!dataDir && (cfg?.interactive?.columns?.length ?? 0) === 0
  useEffect(() => {
    if (!needsDetect) return
    let cancelled = false
    void (async () => {
      setDetecting(true)
      setMsg(null)
      const res = await detectInteractive(id)
      // Always clear the busy flag (else the preset chips stay disabled); only skip the message
      // when this run has been superseded (e.g. columns already populated → needsDetect flipped).
      setDetecting(false)
      if (!cancelled) {
        setMsg(res.ok ? `Found ${res.count} sample columns` : `Error: ${res.error}`)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needsDetect, id, detectInteractive])

  if (!cfg) return null
  const interactive = cfg.interactive
  // A previously-completed import has its three standard files generated (see convertInteractive);
  // reopening it shows every roadmap stage green.
  const completed = !!(cfg.data && cfg.samplesheet && cfg.db)
  const roles = interactive?.roles ?? {}
  const conditions = interactive?.conditions ?? {}
  const columns = interactive?.columns ?? []
  const sampleCols = columns.filter((c) => roles[c] === 'sample')
  const idCol = columns.find((c) => roles[c] === 'id') ?? null
  const labelCol = columns.find((c) => roles[c] === 'label') ?? null
  const metaCols = columns.filter((c) => roles[c] === 'meta')
  const filterCols = columns.filter((c) => roles[c] === 'filter')
  const filters = interactive?.filters ?? {}
  // Per-sample applied token spans (Conditions step). Persisted in config like column roles, so
  // reopening restores the highlights; the value, highlight and "original" all derive from these.
  const spans: Record<string, RowSpans> = (interactive?.spans as Record<string, RowSpans>) ?? {}
  // Token separator for the Conditions step. Spans are token indexes under it, so a change of the
  // EFFECTIVE separator drops every span (the extracted values stay; the user re-paints under the
  // new tokenisation). A blank box falls back to the default.
  const separator = interactive?.separator ?? DEFAULT_DELIM
  const delims = [separator || DEFAULT_DELIM]
  const setSeparator = (sep: string): void => {
    const same = (sep || DEFAULT_DELIM) === delims[0]
    setInteractive(id, same ? { separator: sep } : { separator: sep, spans: {} })
  }
  // Bulk commit — the Filtering step edits a local draft and writes it all at once on Apply/Reset.
  const setFilters = (next: Record<string, FilterSpec>): void => {
    setInteractive(id, { filters: next })
  }
  const blank = (h: string): InteractiveSampleCond => ({
    sample: h,
    include: true,
    cell: '',
    cmpd: '',
    dose: '',
    time: '',
    rep: ''
  })
  const samples: InteractiveSampleCond[] = sampleCols.map((sc) => conditions[sc] ?? blank(sc))

  // Assign a role to one or more columns in a single merge (so a drag over several headers
  // applies to all of them, rather than each write clobbering the previous).
  const setRoles = (headers: string[], role: InteractiveRole): void => {
    if (headers.length === 0) return
    const next: Record<string, InteractiveRole> = { ...roles }
    for (const h of headers) next[h] = role
    // Exactly one id / label — keep the last selected and demote any other holder to metadata.
    if (role === 'id' || role === 'label') {
      const keep = headers[headers.length - 1]
      for (const c of columns) if (c !== keep && next[c] === role) next[c] = 'meta'
    }
    setInteractive(id, { roles: next })
  }

  // The custom condition axes the user added beyond the five presets, and the full field list.
  const customConditions = interactive?.customConditions ?? []
  const fields: Field[] = [...PRESET_FIELDS, ...customConditions]
  const colorOf = (f: Field): string => fieldColorIn(f, customConditions)

  /** Add a custom condition. Returns why the name can't be used, or null on success. The name
   *  becomes a samplesheet column and a `@name` condition key, so it goes through the engine's own
   *  rule rather than a second copy of it here. */
  const addCustomCondition = (name: string): string | null => {
    if (!validCondName(name))
      return RESERVED_COND_NAMES.includes(name)
        ? `“${name}” is reserved`
        : 'Use lowercase letters, digits and _ (starting with a letter)'
    setInteractive(id, { customConditions: [...customConditions, name] })
    return null
  }

  /** Drop a custom condition: the axis itself, every sample's value for it, and its painted spans
   *  (which are keyed by field name and would otherwise linger and re-highlight a stale region). */
  const removeCustomCondition = (name: string): void => {
    const nextConditions: Record<string, InteractiveSampleCond> = {}
    for (const [sc, c] of Object.entries(conditions)) {
      if (c.extra?.[name] == null) {
        nextConditions[sc] = c
        continue
      }
      const extra = { ...c.extra }
      delete extra[name]
      nextConditions[sc] = { ...c, extra }
    }
    const nextSpans: Record<string, RowSpans> = {}
    for (const [sc, rs] of Object.entries(spans)) {
      const next = { ...rs }
      delete next[name]
      nextSpans[sc] = next
    }
    if (armed === name) setArmed(null)
    setInteractive(id, {
      customConditions: customConditions.filter((n) => n !== name),
      conditions: nextConditions,
      spans: nextSpans as Record<string, Partial<Record<string, [number, number]>>>
    })
  }

  const setCell = (i: number, field: Field, value: string): void => {
    const h = sampleCols[i]
    const cur = conditions[h] ?? blank(h)
    setInteractive(id, {
      conditions: { ...conditions, [h]: withEdited(withCond(cur, field, value), field, true) }
    })
  }

  const setInclude = (i: number, on: boolean): void => {
    const h = sampleCols[i]
    const cur = conditions[h] ?? blank(h)
    setInteractive(id, { conditions: { ...conditions, [h]: { ...cur, include: on } } })
  }

  // Refactor (bulk-rename) one condition value across every sample that carries it — e.g. rename
  // "drugA" → "Drug A" in the cmpd column everywhere in one edit.
  const renameConditionValue = (field: Field, oldVal: string, newVal: string): void => {
    if (oldVal === newVal) return
    const next: Record<string, InteractiveSampleCond> = { ...conditions }
    for (const sc of sampleCols) {
      const cur = conditions[sc] ?? blank(sc)
      if (condOf(cur, field) === oldVal)
        next[sc] = withEdited(withCond(cur, field, newVal), field, true)
    }
    setInteractive(id, { conditions: next })
  }

  // Tag the active field from a token range painted on `refName` (any active row). The region is
  // anchored relative to that row's already-painted neighbours (see deriveAnchor) and re-placed on
  // each ACTIVE row against ITS OWN layout — so rows with internal underscores on only some names
  // (cellA vs cell_typeA) are tagged correctly without disturbing an existing paint. Each row keeps
  // its own span; nothing is applied globally. Re-tagging a field's exact region clears it.
  const annotate = (
    refName: string,
    tokStart: number,
    tokEnd: number,
    activeSamples: string[]
  ): void => {
    const field = armed
    if (!field || activeSamples.length === 0) return
    const refSpans = spans[refName] ?? {}
    // Re-painting a field's own current region (on the row it was derived from) clears it.
    const existing = refSpans[field]
    const same = !!existing && existing[0] === tokStart && existing[1] === tokEnd
    const desc = deriveAnchor(refName, tokStart, tokEnd, refSpans, field, delims)
    const nextConditions: Record<string, InteractiveSampleCond> = { ...conditions }
    const nextSpans: Record<string, RowSpans> = { ...spans }
    let hit = 0
    for (const sc of activeSamples) {
      const base = nextConditions[sc] ?? blank(sc)
      const rowSpans: RowSpans = { ...(nextSpans[sc] ?? {}) }
      if (same) {
        delete rowSpans[field]
        nextConditions[sc] = withEdited(withCond(base, field, ''), field, false)
      } else {
        const span = applyAnchor(sc, rowSpans, desc, field, delims)
        if (!span) continue
        rowSpans[field] = span
        nextConditions[sc] = withEdited(
          withCond(base, field, spanValue(sc, span, delims)),
          field,
          false
        )
        hit++
      }
      nextSpans[sc] = rowSpans
    }
    setInteractive(id, {
      conditions: nextConditions,
      spans: nextSpans as Record<string, Partial<Record<string, [number, number]>>>
    })
    setMsg(
      same
        ? `Cleared ${field} on ${activeSamples.length} sample${activeSamples.length > 1 ? 's' : ''}`
        : `Applied ${field} to ${hit} sample${hit === 1 ? '' : 's'}`
    )
  }

  // Read the current matrix and (re)seed the column classification using a preset.
  const detectWith = async (p: MatrixPreset): Promise<void> => {
    setDetecting(true)
    setMsg(null)
    const res = await detectInteractive(id, p)
    setDetecting(false)
    if (!res.ok) setMsg(`Error: ${res.error}`)
    else
      setMsg(
        p === 'none'
          ? 'Cleared — assign columns or pick a preset.'
          : `Found ${res.count} sample columns`
      )
  }
  // A 'custom' state has no detector — re-reading falls back to 'none' (paint nothing).
  const detectPreset: MatrixPreset = preset === 'custom' ? 'none' : preset
  const runDetect = (): Promise<void> => detectWith(detectPreset)
  // Pick a preset: remember it and re-classify the columns for that tool's export shape.
  const applyPreset = async (p: MatrixPreset): Promise<void> => {
    setPreset(p)
    await detectWith(p)
  }
  // Manual role edits flip the mode to 'custom' (see the preset toggle).
  const assignRoles = (headers: string[], role: InteractiveRole): void => {
    setRoles(headers, role)
    setPreset('custom')
  }
  // Switch the source data file from within the dialog, then re-read its columns.
  const changeMatrix = async (file: string): Promise<void> => {
    if (!file || file === matrix) return
    update(id, { matrix: file })
    setPreset(detectPreset)
    await detectWith(detectPreset)
  }
  // Browse the whole filesystem for a matrix (not restricted to the data folder), then switch to it.
  const browseMatrix = async (): Promise<void> => {
    const path = await window.api.pickDataFile()
    if (path) await changeMatrix(path)
  }

  const hasFilters = filterCols.length > 0
  // Filtering (stage 2) is skipped entirely when no column is classified `filter`: Next from
  // Columns jumps to Conditions, and Back from Conditions jumps to Columns.
  const goNext = (): void => {
    setMsg(null)
    if (stage === 3 && condCard === 0) return setCondCard(1)
    const to = nextStage(stage, hasFilters)
    if (to === 3) setCondCard(0)
    setStage(to)
  }
  const goBack = (): void => {
    setMsg(null)
    if (stage === 3 && condCard === 1) return setCondCard(0)
    const to = prevStage(stage, hasFilters)
    // Back from Metadata lands where the step was left: the samplesheet.
    if (to === 3) setCondCard(1)
    setStage(to)
  }
  // The numeric conditions carrying values with no unit picked yet — the Conditions and Samplesheet
  // steps ask for one (a.u. counts) before going on, so every dose / time reaches the analyses with
  // its unit. (The chips on both steps pick it.)
  const unitsMissing = (['dose', 'time'] as const).filter(
    (f) =>
      !cfg?.units?.[f] && samples.some((s) => s.include !== false && condOf(s, f).trim() !== '')
  )
  const canNext =
    stage === 1
      ? !!idCol && sampleCols.length > 0
      : stage === 3
        ? condCard === 0 || (confirmedSheet && unitsMissing.length === 0)
        : true
  // Why Next is blocked (shown next to the button), so it's clear what's still needed.
  const nextBlock =
    canNext || stage >= 5
      ? ''
      : stage === 1
        ? !idCol && sampleCols.length === 0
          ? 'Mark an ID column and at least one Sample column'
          : !idCol
            ? 'Mark an ID column'
            : 'Mark at least one Sample column'
        : unitsMissing.length
          ? `Pick a unit for ${unitsMissing.join(' and ')}`
          : stage === 3
            ? 'Tick “Everything is correct” to continue'
            : ''

  // Metadata preview must reflect the Filtering step — rows dropped by an active filter must not
  // appear in (or be counted for) the generated DB. Computed only on the Metadata step (a single
  // pass over the full matrix); with no active filters it's the plain preview.
  const metaPreview = ((): { rows: Record<string, string>[]; total: number } | null => {
    if (stage !== 5) return preview
    const active = filterCols
      .filter((c) => filters[c]?.active)
      .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
    if (active.length === 0) return preview
    const rows: Record<string, string>[] = []
    let total = 0
    for (const r of allRows) {
      let ok = true
      for (const { col, drop, spec } of active) {
        const raw = (r[col] ?? '').trim()
        if (drop.size > 0 && drop.has(raw)) {
          ok = false
          break
        }
        if (spec.min != null || spec.max != null) {
          const x = Number(raw)
          if (
            !Number.isFinite(x) ||
            (spec.min != null && x < spec.min) ||
            (spec.max != null && x > spec.max)
          ) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        total++
        if (rows.length < PREVIEW_ROWS) rows.push(r)
      }
    }
    return { rows, total }
  })()

  const annotations = interactive?.annotations
  // Toggling which annotation columns are shown just re-slices the cached data — no refetch.
  const setAnnotationFields = (selectedIds: string[]): void => {
    if (!annotations) return
    // Only columns the fetched data actually holds: annotations fetched before a column existed
    // (COG_area, say) would otherwise show it, empty, until the next fetch.
    const held = new Set(Object.values(annotations.byId).flatMap((rec) => Object.keys(rec)))
    const fields = colsForIds(selectedIds).filter((c) => held.has(c))
    setInteractive(id, { annotations: { ...annotations, fields } })
  }
  // Fetch annotations for every kept feature and merge them into the DB (persisted in config,
  // written on convert). Runs in the main process (no renderer CSP) via window.api. Only the
  // SELECTED fields are fetched, but results are MERGED into any previously-fetched columns — so
  // a plain re-slice of already-fetched fields (see setAnnotationFields) never hits the network.
  const runFetchAnnotations = async (selectedIds: string[], refresh = false): Promise<void> => {
    if (!idCol || annBusy) return
    const wantsString = selectedIds.includes('string')
    setAnnBusy(true)
    setAnnMsg(
      wantsString ? '1/3 Fetching annotations & STRING ids (UniProt)…' : 'Fetching from UniProt…'
    )
    try {
      const active = filterCols
        .filter((c) => filters[c]?.active)
        .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
      const passes = (r: Record<string, string>): boolean => {
        for (const { col, drop, spec } of active) {
          const raw = (r[col] ?? '').trim()
          if (drop.size > 0 && drop.has(raw)) return false
          if (spec.min != null || spec.max != null) {
            const x = Number(raw)
            if (
              !Number.isFinite(x) ||
              (spec.min != null && x < spec.min) ||
              (spec.max != null && x > spec.max)
            )
              return false
          }
        }
        return true
      }
      // Every distinct protein the kept features name: each member of a `;`-group, unwrapped
      // from `sp|ACC|NAME`, isoforms folded into their entry (accession.ts). Annotation is
      // fetched and saved per protein; a group carries its members' union downstream.
      const accSet = new Set<string>()
      for (const r of allRows) {
        if (active.length && !passes(r)) continue
        for (const acc of groupMembers((r[idCol] ?? '').trim())) accSet.add(acc)
      }
      if (accSet.size === 0) {
        setAnnMsg('No accessions found in the ID column.', 'warn')
        return
      }
      const base = refresh
        ? 'Re-querying UniProt (ignoring cache)…'
        : wantsString
          ? '1/3 Fetching annotations & STRING ids (UniProt)…'
          : 'Fetching from UniProt…'
      const offAnn = window.api.onAnnotProgress((p) => {
        // A `stage` means the UniProt pass is done and a downstream source is resolving — those
        // steps have no per-accession count, so show what they're doing instead of a stale 0/0.
        if (p.stage) setAnnMsg(p.stage)
        else setAnnMsg(p.total > 0 ? `${base} ${p.done}/${p.total}` : base)
      })
      let res: Awaited<ReturnType<typeof window.api.fetchUniprot>>
      try {
        res = await window.api.fetchUniprot([...accSet], sourceIds(selectedIds), { refresh })
      } finally {
        offAnn()
      }
      // Merge onto any previously-fetched columns so this fetch only adds/refreshes the selected
      // ones instead of wiping the rest of the cache.
      const prev = annotations?.byId ?? {}
      const byId: Record<string, Record<string, string>> = {}
      for (const acc of accSet) {
        const rec = res.byId[acc]
        if (prev[acc] || rec) byId[acc] = { ...(prev[acc] ?? {}), ...(rec ?? {}) }
      }
      // Keep any species / KEGG-org / categories already learned from a prior fetch if this one
      // didn't resolve them (a fully-cached fetch returns no new categories).
      const taxon = res.taxon && res.taxon > 0 ? res.taxon : annotations?.taxon
      const keggOrg = res.keggOrg || annotations?.keggOrg
      const keggCategories =
        res.keggCategories && Object.keys(res.keggCategories).length
          ? { ...annotations?.keggCategories, ...res.keggCategories }
          : annotations?.keggCategories
      setInteractive(id, {
        annotations: {
          source: 'uniprot',
          fields: colsForIds(selectedIds),
          byId,
          taxon,
          keggOrg,
          keggCategories
        }
      })
      const n = Object.keys(byId).length
      const sp = taxon ? ` • species taxon ${taxon}` : ''
      const catN = keggCategories ? Object.keys(keggCategories).length : 0
      const cat = catN ? ` • ${catN} KEGG pathway categories` : ''
      // When STRING is selected, download the organism's interactome so the network builds offline.
      if (wantsString && taxon) {
        setAnnMsg(`2/3 Resolving species — taxon ${taxon}…`)
        const stageLabel: Record<string, string> = {
          links: 'interactome',
          info: 'gene names',
          aliases: 'gene-name map'
        }
        const off = window.api.onStringProgress((p) => {
          const pct = p.total > 0 ? ` ${Math.round((p.loaded / p.total) * 100)}%` : ''
          setAnnMsg(`3/3 STRING data — ${stageLabel[p.stage] ?? p.stage} for taxon ${taxon}…${pct}`)
        })
        try {
          const r = await window.api.ensureStringOrg(taxon)
          setAnnMsg(
            r.error
              ? `Annotated ${n} proteins${sp}${cat}. STRING download failed: ${r.error}`
              : `Annotated ${n} proteins${sp}${cat}. STRING v${r.version} ${r.cached ? 'ready (cached)' : 'downloaded'}.`,
            r.error ? 'warn' : 'ok'
          )
        } finally {
          off()
        }
      } else {
        setAnnMsg(
          res.error
            ? `Partial: ${n}/${accSet.size} proteins annotated (${res.error})${sp}${cat}`
            : `Annotated ${n} of ${accSet.size} proteins.${sp}${cat}`,
          res.error ? 'warn' : 'ok'
        )
      }
    } catch (e) {
      setAnnMsg(e instanceof Error ? e.message : 'Fetch failed.', 'error')
    } finally {
      setAnnBusy(false)
    }
  }
  const clearAnnotations = (): void => {
    setInteractive(id, { annotations: undefined })
    setAnnMsg(null)
  }

  return createPortal(
    <div style={{ ...cssVars(PALETTES[mode]), ...(dock ? DOCKED_WRAP : styles.overlay) }}>
      {!dock && <div style={styles.scrim} onClick={onClose} />}
      <div
        style={{
          ...styles.modal,
          ...(dock ? DOCKED_CARD : null)
        }}
        role="dialog"
        aria-label="Interactive import"
      >
        <div style={styles.head}>
          Interactive import
          <div style={{ flex: 1 }} />
          <button style={styles.closeBtn} onClick={onClose} title="Close" aria-label="Close">
            ✕
          </button>
        </div>

        <Roadmap
          stage={stage}
          steps={STAGES}
          allDone={completed}
          onJump={(target) => {
            setMsg(null)
            if (target === 3) setCondCard(0)
            setStage(target as Stage)
          }}
        />

        <div style={styles.body}>
          {/* Keyed by the step, so each turn mounts afresh and swipes in from the side it comes
              from (see .oe-step-in). */}
          <div
            key={stage}
            className={`oe-step-in ${swipe === 'back' ? 'oe-step-in-back' : ''}`}
            style={styles.stepPane}
          >
            {stage === 1 && (
              <Step1Columns
                matrix={matrix}
                inputFiles={inputFiles}
                inputFileFolders={inputFileFolders}
                onMatrix={changeMatrix}
                onBrowse={browseMatrix}
                preset={preset}
                onPreset={applyPreset}
                detecting={detecting}
                onDetect={runDetect}
                columns={columns}
                roles={roles}
                rows={preview?.rows ?? []}
                onAssign={assignRoles}
              />
            )}
            {stage === 2 && (
              <FilterStage
                filterCols={filterCols}
                allRows={allRows}
                filters={filters}
                setFilters={setFilters}
                columns={columns}
              />
            )}
            {stage === 3 &&
              (sampleCols.length > 0 ? (
                <ConditionsStage
                  samples={samples}
                  spans={spans}
                  fields={fields}
                  colorOf={colorOf}
                  armed={armed}
                  setArmed={setArmed}
                  activated={activated}
                  setActivated={setActivated}
                  onAddCustom={addCustomCondition}
                  onRemoveCustom={removeCustomCondition}
                  onAnnotate={annotate}
                  delims={delims}
                  separator={separator}
                  onSeparator={setSeparator}
                  units={cfg?.units ?? {}}
                  onUnits={(u) => setLoadUnits(id, u)}
                  setCell={setCell}
                  setInclude={setInclude}
                  onRenameValue={renameConditionValue}
                  card={condCard}
                  onCard={setCondCard}
                />
              ) : (
                <div style={styles.hint}>Mark at least one Sample column in step 1.</div>
              ))}
            {stage === 5 && (
              <Step4Metadata
                idCol={idCol}
                labelCol={labelCol}
                metaCols={metaCols}
                rows={metaPreview?.rows ?? null}
                annotations={annotations}
                annBusy={annBusy}
                annMsg={annMsg}
                onFetch={runFetchAnnotations}
                onSelectFields={setAnnotationFields}
                onClearAnnotations={clearAnnotations}
              />
            )}
            {msg && <div style={styles.hint}>{msg}</div>}
          </div>
        </div>

        <div style={styles.foot}>
          {stage > 1 && (
            <button style={styles.btn} onClick={goBack}>
              ← Back
            </button>
          )}
          <div style={{ flex: 1 }} />
          {stage === 3 && condCard === 1 && (
            <label style={styles.confirm}>
              <input
                type="checkbox"
                checked={confirmedSheet}
                onChange={(e) => setConfirmedSheet(e.target.checked)}
              />
              Everything is correct
            </label>
          )}
          {stage === 3 && condCard === 0 ? null : stage < 5 ? (
            // (On the Conditions step's first card, its own arrow over the parked card is Next.)
            <>
              {nextBlock && <span style={styles.nextBlock}>{nextBlock}</span>}
              <button
                style={{ ...styles.btnPrimary, opacity: canNext ? 1 : 0.5 }}
                disabled={!canNext}
                onClick={goNext}
              >
                Next →
              </button>
            </>
          ) : (
            <>
              <label style={styles.confirm}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Everything is correct
              </label>
              <button
                style={{ ...styles.btnPrimary, opacity: !confirmed || converting ? 0.5 : 1 }}
                disabled={!confirmed || converting}
                onClick={async () => {
                  setConverting(true)
                  setMsg(null)
                  const res = await convertInteractive(id)
                  setConverting(false)
                  if (res.ok) onClose()
                  else setMsg(`Error: ${res.error}`)
                }}
              >
                {converting ? 'Saving…' : 'Confirm & save'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    dock ?? document.body
  )
}

/** One colour per assignable column role — shared by the chips, header tints, and labels. */
const ROLE_COLORS: Partial<Record<InteractiveRole, string>> = {
  id: '#e15759',
  sample: '#4e79a7',
  label: '#59a14f',
  meta: '#c99700',
  filter: '#8a5cf6'
}
/** Display names for the assignable roles (Ignore is the unassigned default — it has no chip). */
const ROLE_LABEL: Partial<Record<InteractiveRole, string>> = {
  id: 'ID',
  sample: 'Sample',
  label: 'Name',
  meta: 'Metadata',
  filter: 'Filter'
}
const ROLE_CHIPS: InteractiveRole[] = ['id', 'label', 'meta', 'filter', 'sample']

/** Step 1: show the tile-selected matrix (auto-read on open), then classify columns by arming a
 *  role chip and clicking column headers. The preview is in normal (untransposed) form — columns
 *  across the top, first rows below — with each column's assigned role labelled above its header,
 *  mirroring the condition-tagging step. */
function Step1Columns({
  matrix,
  inputFiles,
  inputFileFolders,
  onMatrix,
  onBrowse,
  preset,
  onPreset,
  detecting,
  onDetect,
  columns,
  roles,
  rows,
  onAssign
}: {
  matrix: string | null
  inputFiles: string[]
  /** each file's folder, relative to the data folder ('' = the folder itself) */
  inputFileFolders: Record<string, string>
  onMatrix: (file: string) => void
  onBrowse: () => void
  preset: MatrixPreset | 'custom'
  onPreset: (p: MatrixPreset) => void
  detecting: boolean
  onDetect: () => void
  columns: string[]
  roles: Record<string, InteractiveRole>
  rows: Record<string, string>[]
  onAssign: (headers: string[], role: InteractiveRole) => void
}): ReactNode {
  const [armed, setArmed] = useState<InteractiveRole | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  // A data file in the list: its folder (muted) before its name, so files in different subfolders
  // read apart.
  const fileOption = (f: string): { value: string; label: string; render?: ReactNode } => {
    const dir = inputFileFolders[f]
    return dir
      ? {
          value: f,
          label: `${dir}/${f}`,
          render: (
            <span>
              <span style={styles.fileDir}>{dir}/</span>
              {f}
            </span>
          )
        }
      : { value: f, label: f }
  }
  // Column-header drag range (indices into `columns`): `a` = anchor, `f` = current end.
  const [drag, setDrag] = useState<{ a: number; f: number } | null>(null)
  // Enough rows to fill the (full-height) dialog and scroll a little; not all 200 previewed, as a
  // wide matrix makes every row hundreds of cells.
  const shown = rows.slice(0, 50)
  const lo = drag ? Math.min(drag.a, drag.f) : -1
  const hi = drag ? Math.max(drag.a, drag.f) : -1
  // The last header clicked without Shift: a Shift-click labels everything from it to the one
  // clicked, like a list's range select.
  const anchorRef = useRef<number | null>(null)
  // Press on a header: start a range (from the anchor when Shift is held) and follow the pointer
  // at document level until release — so a drag can run past the table's edge, which scrolls the
  // table and keeps extending the range: a long run of sample columns is one sweep.
  const startDrag = (i: number, e: React.MouseEvent): void => {
    if (!armed) return
    e.preventDefault()
    const role = armed
    const a = e.shiftKey && anchorRef.current != null ? anchorRef.current : i
    if (!e.shiftKey) anchorRef.current = i
    let range = { a, f: i }
    setDrag(range)
    const scroller = scrollParentX(headRefs.current[i])
    let x = e.clientX
    // The header under x, clamped into the visible part of the table (beyond an edge = the edge
    // column, while the auto-scroll brings more in).
    const colAt = (): number => {
      const box = scroller?.getBoundingClientRect()
      const cx = box ? Math.min(box.right - 2, Math.max(box.left + 2, x)) : x
      const heads = headRefs.current
      for (let k = 0; k < columns.length; k++) {
        const r = heads[k]?.getBoundingClientRect()
        if (r && cx < r.right) return k
      }
      return columns.length - 1
    }
    const track = (): void => {
      const f = colAt()
      if (f !== range.f) setDrag((range = { a, f }))
    }
    // Auto-scroll while the pointer is within EDGE px of an edge (or past it), faster the further.
    const EDGE = 40
    let raf = 0
    const tick = (): void => {
      raf = 0
      if (!scroller) return
      const box = scroller.getBoundingClientRect()
      const over =
        x > box.right - EDGE
          ? x - (box.right - EDGE)
          : x < box.left + EDGE
            ? x - (box.left + EDGE)
            : 0
      if (over === 0) return
      const before = scroller.scrollLeft
      scroller.scrollLeft += Math.sign(over) * Math.min(40, 4 + Math.abs(over) / 3)
      track()
      if (scroller.scrollLeft !== before) raf = requestAnimationFrame(tick)
    }
    const onMove = (ev: MouseEvent): void => {
      x = ev.clientX
      track()
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      if (raf) cancelAnimationFrame(raf)
      const cols = columns.slice(Math.min(range.a, range.f), Math.max(range.a, range.f) + 1)
      // A single header that already holds the armed role toggles back to Ignore.
      const clear = cols.length === 1 && roles[cols[0]] === role
      onAssign(cols, clear ? 'ignore' : role)
      setDrag(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Column widths (like the review grid): null = fit-to-content, which measures + pins the
  // column; a number is a user-set width. Reset to fit whenever the column set changes — done
  // during render (React's adjust-state-on-prop-change pattern) rather than in an effect.
  const headRefs = useRef<(HTMLTableCellElement | null)[]>([])
  const [widths, setWidths] = useState<(number | null)[]>(() => columns.map(() => null))
  const [colCount, setColCount] = useState(columns.length)
  if (colCount !== columns.length) {
    setColCount(columns.length)
    setWidths(columns.map(() => null))
  }
  const sized = widths.length === columns.length
  const fixed = sized && widths.every((w) => w != null)
  useLayoutEffect(() => {
    if (widths.length === columns.length && widths.some((w) => w == null)) {
      setWidths((prev) =>
        prev.map((w, i) => (w != null ? w : (headRefs.current[i]?.offsetWidth ?? 0) + COL_PAD))
      )
    }
  }, [widths, columns.length])
  const startResize = (i: number, startX: number): void => {
    const startW = widths[i] ?? headRefs.current[i]?.offsetWidth ?? 60
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(40, startW + (ev.clientX - startX))
      setWidths((prev) => prev.map((x, k) => (k === i ? w : x)))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  return (
    <>
      <div style={styles.row}>
        <span style={styles.label}>Data file</span>
        {/* The data file is chosen in the tile, but can be swapped here — the app's dropdown, so
            the user can re-point the import without leaving the wizard. An external file (picked
            via Browse, an absolute path outside the data folder) shows as its own option. */}
        <span style={styles.fileSelect} title={matrix ?? 'Choose a data file'}>
          <AppSelect
            value={matrix ?? ''}
            placeholder="— choose a data file —"
            onChange={onMatrix}
            options={[
              ...(matrix && !inputFiles.includes(matrix)
                ? [{ value: matrix, label: `${matrix.replace(/^.*[\\/]/, '')} (external)` }]
                : []),
              // Raw data files first; the standard files an import generates (…_wide, …_long, …_DB,
              // …_samplesheet) grouped below under their own heading.
              ...inputFiles.filter((f) => !GENERATED_FILE.test(f)).map(fileOption),
              ...(inputFiles.some((f) => GENERATED_FILE.test(f))
                ? [
                    {
                      value: '__generated__',
                      label: 'Generated files',
                      disabled: true,
                      render: <span style={styles.fileGroupHead}>Generated files</span>
                    },
                    ...inputFiles.filter((f) => GENERATED_FILE.test(f)).map(fileOption)
                  ]
                : [])
            ]}
          />
        </span>
        <button
          style={styles.btn}
          onClick={onBrowse}
          title="Choose a data file from anywhere on disk"
        >
          Browse…
        </button>
        <button
          style={{ ...styles.btn, opacity: !matrix || detecting ? 0.5 : 1 }}
          disabled={!matrix || detecting}
          onClick={onDetect}
          title="Re-read the data file columns"
        >
          {detecting ? 'Reading…' : 'Re-read'}
        </button>
      </div>
      {/* Preset: 'None' paints nothing; a tool preset auto-classifies for that export shape;
          'Custom' lights up automatically once columns are hand-edited. */}
      {/* A little air before the column-type chips, now that no hint paragraph sits between. */}
      <div style={{ ...styles.row, marginBottom: 6 }}>
        <span style={styles.label}>Preset</span>
        <ToggleSwitch
          label="Preset"
          value={preset}
          disabled={!matrix || detecting}
          options={[
            ...MATRIX_PRESETS.map(({ value, label }) => ({
              value: value as MatrixPreset | 'custom',
              label,
              title:
                value === 'none'
                  ? 'Clear all column labels'
                  : `Auto-detect columns as ${label} output`
            })),
            // Indicator only — set automatically on manual edits, not directly clickable.
            {
              value: 'custom' as const,
              label: 'Custom',
              disabled: true,
              title: 'Set automatically when you edit the column labels'
            }
          ]}
          onChange={(v) => {
            if (v !== 'custom') onPreset(v)
          }}
        />
      </div>
      {columns.length === 0 ? (
        <div style={styles.hint}>
          {matrix
            ? detecting
              ? 'Reading columns…'
              : 'No columns read yet — click Re-read, or pick a matrix in the Load tile.'
            : 'Pick a raw data matrix in the Load tile to begin.'}
        </div>
      ) : (
        <>
          <div style={styles.chips}>
            {/* What the chips do: pick one, then paint it onto column headers — how, in the (i). */}
            <span style={styles.paintLabel}>
              <IconPaint />
              Set column type
              <InfoTip label="How to set column types">
                Click a role, then click a column header — drag across several (past the edge to
                scroll), or Shift-click to take every column since the last one — to label them.
                Exactly one <b>ID</b> and one <b>Name</b>; any number of <b>Sample</b> and{' '}
                <b>Metadata</b>. Unlabelled columns are ignored.
              </InfoTip>
            </span>
            {ROLE_CHIPS.map((role) => {
              const on = armed === role
              const color = ROLE_COLORS[role]!
              const n = columns.filter((c) => roles[c] === role).length
              return (
                <button
                  key={role}
                  onClick={() => setArmed(on ? null : role)}
                  style={{
                    ...styles.chip,
                    background: on ? `${color}33` : 'transparent',
                    color: UI.text,
                    borderColor: on ? color : UI.border
                  }}
                >
                  <span style={{ ...styles.chipDot, background: color }} />
                  {ROLE_LABEL[role]}
                  {n > 0 && <span style={styles.chipCount}>{n}</span>}
                </button>
              )
            })}
          </div>
          <ScrollFade>
            <table style={{ ...styles.grid, tableLayout: fixed ? 'fixed' : 'auto' }}>
              <colgroup>
                {columns.map((c, i) => (
                  <col
                    key={c}
                    style={{ width: sized && widths[i] != null ? `${widths[i]}px` : undefined }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columns.map((c, i) => {
                    const role = roles[c] ?? 'ignore'
                    // Preview the armed role while dragging across the range, or hovering a header.
                    const inRange = drag ? i >= lo && i <= hi : hover === c
                    const preview = !!armed && inRange
                    const shownRole = preview ? armed! : role
                    const shownColor = ROLE_COLORS[shownRole]
                    return (
                      <th
                        key={c}
                        ref={(el) => {
                          headRefs.current[i] = el
                        }}
                        onMouseDown={armed ? (e) => startDrag(i, e) : undefined}
                        onMouseEnter={() => setHover(c)}
                        onMouseLeave={() => setHover((h) => (h === c ? null : h))}
                        title={
                          armed ? `Click, drag or Shift-click to label as ${ROLE_LABEL[armed]}` : c
                        }
                        style={{
                          ...styles.th,
                          ...styles.colHead,
                          cursor: armed ? 'pointer' : 'default',
                          // The role tint is translucent; laid over the header's solid colour so
                          // the sticky row stays opaque (rows scrolling under it don't show through).
                          background: shownColor
                            ? `linear-gradient(${shownColor}${preview ? '55' : '22'}, ${shownColor}${preview ? '55' : '22'}), ${UI.panelAlt}`
                            : UI.panelAlt
                        }}
                      >
                        <div style={{ ...styles.colRole, color: shownColor ?? 'transparent' }}>
                          {ROLE_LABEL[shownRole] ?? ' '}
                        </div>
                        <div style={styles.colName}>{c}</div>
                        <span
                          style={styles.resizer}
                          title="Drag to resize · double-click to fit content"
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            startResize(i, e.clientX)
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            setWidths((prev) => prev.map((w, k) => (k === i ? null : w)))
                          }}
                        />
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => {
                      const color = ROLE_COLORS[roles[c] ?? 'ignore']
                      return (
                        <td
                          key={c}
                          style={{
                            ...styles.td,
                            ...styles.sampleCell,
                            ...(fixed ? styles.clip : null),
                            color: UI.textMuted,
                            background: color ? `${color}0d` : undefined
                          }}
                          title={r[c]}
                        >
                          {r[c] ?? ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFade>
        </>
      )}
    </>
  )
}

// Default DB column widths, computed from content string length (deterministic — no DOM
// measurement, so it can't be inflated by a slow/stretched layout). ~7px per char at 12px.
const DB_CHAR_PX = 7
const DB_MIN_COL = 52
const DB_MAX_COL = 260

/** Step 4: preview the DB (ID map) that will be generated and confirm. Columns default to a
 *  content-fit width (capped) and are drag-resizable / double-click-to-refit. Always fixed
 *  layout, so long free-text never blows a column out. */
function Step4Metadata({
  idCol,
  labelCol,
  metaCols,
  rows,
  annotations,
  annBusy,
  annMsg,
  onFetch,
  onSelectFields,
  onClearAnnotations
}: {
  idCol: string | null
  labelCol: string | null
  metaCols: string[]
  rows: Record<string, string>[] | null
  annotations?: AnnotationSet
  annBusy: boolean
  annMsg: { text: string; kind: StatusKind } | null
  onFetch: (fields: string[], refresh?: boolean) => void
  onSelectFields: (fields: string[]) => void
  onClearAnnotations: () => void
}): ReactNode {
  // Which fields are ticked — seeded from an already-fetched set so a reopened wizard matches.
  const [picked, setPicked] = useState<Set<string>>(() =>
    annotations
      ? new Set(
          UNIPROT_FIELDS.filter((f) => f.cols.some((c) => annotations.fields.includes(c))).map(
            (f) => f.id
          )
        )
      : new Set(['protein_name', 'gene_names'])
  )
  const annCols = annotations?.fields ?? []
  // The DB exactly as it will be written (buildStandardInputs): one row per PROTEIN, keyed by its
  // canonical accession — a protein group's members each get their own row, with that protein's
  // own gene name and annotation; a protein named by two groups appears once.
  const cols = idCol ? ['uniqID', 'gene', ...metaCols, ...annCols] : []
  const dbRows: Record<string, string>[] = []
  if (idCol) {
    const written = new Set<string>()
    for (const r of rows ?? []) {
      const id = (r[idCol] ?? '').trim()
      const label = labelCol ? (r[labelCol] ?? '').trim() : ''
      const members = groupMembers(id)
      for (const uniqID of members.length ? members : [id]) {
        if (!uniqID || written.has(uniqID)) continue
        written.add(uniqID)
        const ann = annotations?.byId[uniqID]
        const out: Record<string, string> = { uniqID, gene: label || (ann?.geneName ?? '').trim() }
        for (const c of metaCols) out[c] = r[c] ?? ''
        for (const f of annCols) out[f] = ann?.[f] ?? ''
        dbRows.push(out)
      }
    }
  }
  const accessors = cols.map((c) => (r: Record<string, string>) => r[c] ?? '')

  // Per-column user override (px); null = the computed content-fit default. Reset when the
  // column set changes (adjust-state-during-render).
  const [widths, setWidths] = useState<(number | null)[]>(() => cols.map(() => null))
  const [colCount, setColCount] = useState(cols.length)
  if (colCount !== cols.length) {
    setColCount(cols.length)
    setWidths(cols.map(() => null))
  }

  if (!idCol) return <div style={styles.hint}>Pick an ID column in step 1.</div>
  const shown = dbRows
  // Content-fit width from the longest value (header or any shown cell), capped.
  const fitWidth = (i: number): number => {
    let maxLen = cols[i].length
    for (const r of shown) {
      const l = accessors[i](r).length
      if (l > maxLen) maxLen = l
    }
    return Math.max(DB_MIN_COL, Math.min(maxLen * DB_CHAR_PX + COL_PAD, DB_MAX_COL))
  }
  const colWidth = (i: number): number =>
    (widths.length === cols.length ? widths[i] : null) ?? fitWidth(i)
  const startResize = (i: number, startX: number): void => {
    const startW = colWidth(i)
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(40, startW + (ev.clientX - startX))
      setWidths((prev) => prev.map((x, k) => (k === i ? w : x)))
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <>
      {/* Fetch external annotations (UniProt) by feature accession — merged into the DB and saved
          with the project. */}
      <div style={styles.annPanel}>
        <span style={styles.annTitle}>Fetch annotations</span>
        <div style={styles.annFields}>
          {ANN_GROUPS.map((g) => (
            <AnnCategory
              key={g.id}
              group={g}
              picked={picked}
              disabled={annBusy}
              onChange={(next) => {
                setPicked(next)
                // Already fetched → just re-slice the cached data, no network round-trip.
                if (annotations) onSelectFields([...next])
              }}
            />
          ))}
        </div>
        {/* Clear on the options' row, at its right end. Disabled rather than hidden during a
            fetch, so nothing shifts as it starts. */}
        {annotations && (
          <button
            style={{ ...styles.btn, marginLeft: 'auto', opacity: annBusy ? 0.5 : 1 }}
            disabled={annBusy}
            onClick={onClearAnnotations}
          >
            Clear
          </button>
        )}
        {/* Fetch / Re-fetch as one unit, on a row of their own below. */}
        <span style={styles.annActions}>
          <button
            style={{ ...styles.btnPrimary, opacity: annBusy || picked.size === 0 ? 0.5 : 1 }}
            disabled={annBusy || picked.size === 0}
            onClick={() => onFetch([...picked])}
          >
            {/* Both labels share one grid cell, the idle one hidden: the button is always as wide as
              "Fetching…", so going busy doesn't widen it and push Re-fetch onto the next row. */}
            <span style={{ display: 'inline-grid', justifyItems: 'center' }}>
              <span style={{ gridArea: '1 / 1', visibility: annBusy ? 'hidden' : 'visible' }}>
                Fetch
              </span>
              <span style={{ gridArea: '1 / 1', visibility: annBusy ? 'visible' : 'hidden' }}>
                Fetching…
              </span>
            </span>
          </button>
          {/* Annotations are cached per accession app-wide, so a value can be stale even in a project
            that has never fetched — hence a re-query that ignores the cache entirely. */}
          <button
            style={{ ...styles.btn, opacity: annBusy || picked.size === 0 ? 0.5 : 1 }}
            disabled={annBusy || picked.size === 0}
            title="Ignore cached annotations and query every source again"
            onClick={() => onFetch([...picked], true)}
          >
            Re-fetch
          </button>
          {/* The fetch's status, right of its buttons: in progress while it runs, then the
              outcome — done, partly done, or failed. */}
          {annMsg && (
            <StatusNote kind={annBusy ? 'progress' : annMsg.kind} style={styles.annNote}>
              {annMsg.text}
            </StatusNote>
          )}
        </span>
      </div>
      <ScrollFade title="Metadata DB" colNav>
        {/* Always fixed layout with computed widths + minWidth:0 (not the shared grid's 100%), so
            long values clip instead of stretching the column and the table doesn't fill the width. */}
        <table style={{ ...styles.grid, tableLayout: 'fixed', minWidth: 0 }}>
          <colgroup>
            {cols.map((c, i) => (
              <col key={c} style={{ width: `${colWidth(i)}px` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th key={c} style={{ ...styles.th, ...styles.clip }}>
                  {c}
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
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {accessors.map((get, ci) => {
                  const v = get(r)
                  return (
                    <td
                      key={cols[ci]}
                      style={{ ...styles.td, ...styles.sampleCell, ...styles.clip }}
                      title={v}
                    >
                      {v}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFade>
    </>
  )
}

/** The Conditions step's left panel: which conditions the samples carry — a switch each, in a
 *  vertical list, then a "custom" row to add one; below, Set unit for every condition that's on
 *  (each with its colour dot): dose / time pick theirs (a "Select unit:" tip, then "Unit
 *  selected:" in success style, before the chip), the rest are greyed — a unit doesn't apply. A condition is on once it holds values (tagged or typed) or when switched on here to be
 *  mapped; a preset holding values stays on, and switching a custom one off removes it. No
 *  condition colours yet: they come in at mapping. */
function ConditionSwitches({
  fields,
  colorOf,
  cond,
  armed,
  setArmed,
  setActivated,
  onRemoveCustom,
  units,
  onUnits
}: {
  fields: Field[]
  /** each condition's colour — the Set unit rows' dots (the switches have none yet) */
  colorOf: ColorOf
  cond: ConditionState
  armed: Field | null
  setArmed: (f: Field | null) => void
  setActivated: Dispatch<SetStateAction<Set<Field>>>
  onRemoveCustom: (name: string) => void
  units: CondUnits
  onUnits: (units: CondUnits) => void
}): ReactNode {
  const { isActive, hasValues, addCondition } = cond
  // Every condition that's on, in the list's order; only dose / time take a unit.
  const unitRows = fields.filter(isActive)
  return (
    <>
      <div style={styles.switchSec}>
        <div style={styles.panelHead}>Active conditions</div>
        <div style={styles.condList}>
          {fields.map((f) => {
            const active = isActive(f)
            const custom = !isPresetField(f)
            const locked = !custom && hasValues(f)
            return (
              <span
                key={f}
                style={styles.condToggle}
                title={
                  custom
                    ? `Switch off to delete the “${f}” condition (and its values)`
                    : locked
                      ? `${f} has values — clear them to switch it off`
                      : active
                        ? `Switch ${f} off`
                        : `Switch ${f} on to map it`
                }
              >
                {/* Neutral (the accent), no condition colour yet: colours come in at mapping. */}
                <OnOffSwitch
                  size="lg"
                  on={active}
                  label={f}
                  title=""
                  disabled={locked}
                  onChange={(on) => {
                    if (!on && armed === f) setArmed(null)
                    if (custom && !on) {
                      setActivated((prev) => {
                        const next = new Set(prev)
                        next.delete(f)
                        return next
                      })
                      onRemoveCustom(f)
                    } else
                      setActivated((prev) => {
                        const next = new Set(prev)
                        if (on) next.add(f)
                        else next.delete(f)
                        return next
                      })
                  }}
                />
                <span style={{ color: active ? UI.text : UI.textMuted }}>{f}</span>
              </span>
            )
          })}
          <NewConditionRow taken={fields} onAdd={addCondition} />
        </div>
      </div>
      {/* Set units: dose / time, each while it's on — the import needs one before it goes on. The
          bottom 45% of the column, there even when empty so it never moves. */}
      <div style={styles.unitSec}>
        {unitRows.length > 0 && (
          <div style={styles.unitBlock}>
            <div style={styles.panelHead}>Set unit</div>
            {unitRows.map((f) => {
              const spec = unitSpec(f, units, onUnits)
              // A condition a unit doesn't apply to (anything but dose / time): listed, greyed.
              if (!spec)
                return (
                  <span
                    key={f}
                    style={{ ...styles.unitRow, ...styles.unitRowNA }}
                    title={`${f} takes no unit`}
                  >
                    <span style={{ ...styles.chipDot, background: colorOf(f) }} />
                    <span style={styles.unitName}>{f}</span>
                    <span style={styles.unitNA}>unit not applicable</span>
                  </span>
                )
              return (
                <span key={f} style={styles.unitRow}>
                  <span style={{ ...styles.chipDot, background: colorOf(f) }} />
                  <span style={styles.unitName}>{f}</span>
                  {/* A note right against the chip: a tip asking for a unit (the import needs one),
                    then — once picked — a success note saying it's set. */}
                  <span style={styles.unitPick}>
                    <StatusNote kind={spec.value ? 'ok' : 'info'} inline style={{ fontSize: 12 }}>
                      {spec.value ? 'Unit selected:' : 'Select unit:'}
                    </StatusNote>
                    <UnitChip spec={spec} color={colorOf(f)} prompt="—" />
                  </span>
                </span>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}

/** Conditions on/off, shared by the Conditions step's panels: a condition is on once it carries a
 *  value (tagged or typed), or when switched on (`activated`, kept by the dialog) with none yet. */
interface ConditionState {
  hasValues: (f: Field) => boolean
  isActive: (f: Field) => boolean
  activeFields: Field[]
  /** add a custom condition, switched on; an error message when the name isn't usable */
  addCondition: (name: string) => string | null
}
function conditionState(
  samples: InteractiveSampleCond[],
  fields: Field[],
  activated: Set<Field>,
  setActivated: Dispatch<SetStateAction<Set<Field>>>,
  onAddCustom: (name: string) => string | null
): ConditionState {
  const hasValues = (f: Field): boolean => samples.some((s) => condOf(s, f).trim() !== '')
  const isActive = (f: Field): boolean => hasValues(f) || activated.has(f)
  return {
    hasValues,
    isActive,
    activeFields: fields.filter(isActive),
    addCondition: (name) => {
      const problem = onAddCustom(name)
      if (!problem) setActivated((prev) => new Set(prev).add(name))
      return problem
    }
  }
}

/** The Conditions step's cards, left to right: 0 · conditions (switch on + map), 1 · Refine & edit. */
type CondCard = 0 | 1
/** A card's pose in the Conditions step's deck: flat when in use, else parked at that side —
 *  turned on its outer edge (as a translate · rotate · translate about the centre, so a card going
 *  from one side to the other turns smoothly through flat) to angle back into the screen. */
const PARK_ANGLE = 62
function deckPose(i: CondCard, focus: CondCard): string {
  const side = Math.sign(i - focus) // -1: parked left, hinged on its left edge; 1: right
  return `perspective(1600px) translateX(${side * 50}%) rotateY(${-side * PARK_ANGLE}deg) translateX(${-side * 50}%)`
}
/** The gap between one card starting to swing and the next (rippling out from the old one). */
const CARD_RIPPLE = 70

/** The Conditions step: two cards — which conditions are on beside mapping them onto the sample
 *  names' tokens (with the separator); then the samplesheet to refine (rename values) and edit by
 *  hand. The one in use lies flat on top, the other parked at its side at an angle, swung flat
 *  when picked. */
function ConditionsStage(props: {
  samples: InteractiveSampleCond[]
  spans: Record<string, RowSpans>
  fields: Field[]
  colorOf: ColorOf
  armed: Field | null
  setArmed: (f: Field | null) => void
  activated: Set<Field>
  setActivated: Dispatch<SetStateAction<Set<Field>>>
  onAddCustom: (name: string) => string | null
  onRemoveCustom: (name: string) => void
  onAnnotate: (refName: string, tokStart: number, tokEnd: number, activeSamples: string[]) => void
  delims: string[]
  separator: string
  onSeparator: (sep: string) => void
  units: CondUnits
  onUnits: (units: CondUnits) => void
  setCell: (i: number, field: Field, value: string) => void
  setInclude: (i: number, on: boolean) => void
  onRenameValue: (field: Field, oldVal: string, newVal: string) => void
  /** the card in front — kept by the dialog, whose Next / Back turn the cards too */
  card: CondCard
  onCard: (card: CondCard) => void
}): ReactNode {
  const cond = conditionState(
    props.samples,
    props.fields,
    props.activated,
    props.setActivated,
    props.onAddCustom
  )
  // Two cards, each 90% of the width (so nothing reflows), card i at i × 10%: the one in use lies
  // flat on top; the other is parked at its side, turned on its outer edge to angle back into the
  // screen, its outer 10% showing — 0 · Active conditions + Map conditions, 1 · Refine & edit. The
  // parked card is a button to pick it: its content is inert (one card in use at a time), and
  // picking it swings it flat as the one in use swings aside.
  const focus = props.card
  const pick = props.onCard
  // Where the last turn came from: the cards swing one after another, rippling out from it.
  const [shown, setShown] = useState(focus)
  const [from, setFrom] = useState(focus)
  if (shown !== focus) {
    setFrom(shown)
    setShown(focus)
  }
  // The map's connectors are measured from the screen, so redraw them once a card has settled
  // (measured mid-swing, they'd be foreshortened): any re-render redraws them.
  const [, setSettled] = useState(0)
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    []
  )
  const card = (i: CondCard, name: string, body: ReactNode): ReactNode => {
    const on = focus === i
    return (
      <div
        style={{
          ...styles.deckCard,
          left: `${i * 10}%`,
          ...(on ? null : styles.deckCardAway),
          transform: deckPose(i, focus),
          transitionDelay: `${CARD_RIPPLE * Math.abs(i - from)}ms`,
          ...(reduceMotion ? { transition: 'none' } : null),
          zIndex: 10 - Math.abs(i - focus)
        }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform')
            setSettled((n) => n + 1)
        }}
      >
        <section
          style={{
            ...styles.condPanel,
            ...styles.deckFace,
            ...(on ? null : styles.deckFaceAway)
          }}
          inert={!on}
          aria-label={name}
        >
          <div style={{ ...styles.panelHead, ...styles.cardHead }}>
            <span style={{ ...styles.condNum, ...(on ? styles.condNumOn : null) }}>{i + 1}</span>
            {name}
          </div>
          {body}
        </section>
        {!on && (
          <button
            style={styles.deckPick}
            onClick={() => pick(i)}
            title={`Show ${name}`}
            aria-label={`Show ${name}`}
          />
        )}
      </div>
    )
  }
  return (
    <>
      <div style={styles.condPanels}>
        {card(
          0,
          'Map conditions',
          <div style={styles.condSplit}>
            <div style={styles.condSplitLeft}>
              <ConditionSwitches
                fields={props.fields}
                colorOf={props.colorOf}
                cond={cond}
                armed={props.armed}
                setArmed={props.setArmed}
                setActivated={props.setActivated}
                onRemoveCustom={props.onRemoveCustom}
                units={props.units}
                onUnits={props.onUnits}
              />
            </div>
            <div style={styles.condSplitRight}>
              <div style={styles.panelHead}>Map conditions to samples</div>
              <Stage1
                samples={props.samples}
                spans={props.spans}
                colorOf={props.colorOf}
                armed={props.armed}
                setArmed={props.setArmed}
                activeFields={cond.activeFields}
                onAnnotate={props.onAnnotate}
                delims={props.delims}
                separator={props.separator}
                onSeparator={props.onSeparator}
              />
            </div>
          </div>
        )}
        {card(
          1,
          'Refine & edit',
          <Stage2
            samples={props.samples}
            spans={props.spans}
            colorOf={props.colorOf}
            delims={props.delims}
            setCell={props.setCell}
            setInclude={props.setInclude}
            onRenameValue={props.onRenameValue}
            units={props.units}
            onUnits={props.onUnits}
            activeFields={cond.activeFields}
          />
        )}
        {/* Over the parked card's strip: a chevron to turn to it — forward on the first card,
            back on the second. Keyed by the card, so it fades in afresh after each turn. */}
        <div
          key={focus}
          style={{ ...styles.deckNextWrap, ...(focus === 0 ? { right: 0 } : { left: 0 }) }}
        >
          <button
            className={focus === 0 ? 'oe-deck-next' : 'oe-deck-next oe-deck-back'}
            style={styles.deckNext}
            onClick={() => pick(focus === 0 ? 1 : 0)}
            title={focus === 0 ? 'Next: Refine & edit' : 'Back: map conditions'}
            aria-label={focus === 0 ? 'Next: Refine & edit' : 'Back: map conditions'}
          >
            <svg width="28" height="56" viewBox="0 0 28 56" fill="none" aria-hidden>
              <path
                d={focus === 0 ? 'M6 4l16 24-16 24' : 'M22 4L6 28l16 24'}
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </>
  )
}

/** Stage 1: field chips + a monospace list of every sample name with the learned regions
 *  colour-highlighted. Only the first (bright) row is interactive — the rest are dimmed to
 *  point the user at where to highlight. */
function Stage1({
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
  // The connectors from each Set condition chip to its painted region (in the ruler), measured
  // from the live layout (see connectorPath). A region scrolled out of the table's view sideways
  // gets no line.
  const mapRef = useRef<HTMLDivElement>(null)
  const chipRefs = useRef(new Map<Field, HTMLElement>())
  const [connectors, setConnectors] = useState<Array<{ field: Field; d: string; head: string }>>([])
  const drawConnectors = useCallback((): void => {
    const box = mapRef.current
    if (!box) return
    const at = box.getBoundingClientRect()
    const view = box.querySelector('.oe-headscroll')?.getBoundingClientRect()
    const next: Array<{ field: Field; d: string; head: string }> = []
    for (const [field, chip] of chipRefs.current) {
      const bar = box.querySelector(`[data-ruler-field="${CSS.escape(field)}"]`)
      if (!bar) continue
      const c = chip.getBoundingClientRect()
      const b = bar.getBoundingClientRect()
      const x2 = b.left + b.width / 2
      if (view && (x2 < view.left || x2 > view.right)) continue
      const x1 = Math.round(c.left + c.width / 2 - at.left)
      // Starting a little below the chip, not touching it.
      const y1 = Math.round(c.bottom + CONNECTOR_GAP - at.top)
      const tx = Math.round(x2 - at.left)
      // The tip a small gap above the token's text in the first row: past the region's bottom by
      // the header's bottom padding (2) and border (1) and the row's top padding (3).
      const ty = Math.round(b.bottom + 6 - CONNECTOR_GAP - at.top)
      const { line, head } = connectorPath(x1, y1, tx, ty)
      next.push({ field, d: line, head })
    }
    setConnectors((prev) =>
      prev.length === next.length &&
      prev.every(
        (p, k) => p.d === next[k].d && p.head === next[k].head && p.field === next[k].field
      )
        ? prev
        : next
    )
  }, [])
  // After every render (chips, painted regions, columns can all move), and on resize.
  useLayoutEffect(drawConnectors)
  useLayoutEffect(() => {
    const box = mapRef.current
    if (!box) return
    const ro = new ResizeObserver(drawConnectors)
    ro.observe(box)
    return () => ro.disconnect()
  }, [drawConnectors])
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
      {/* The Set condition chips and the names table, with the connectors drawn over both: a dashed
          line in each condition's colour from its chip to the region it's painted on (in the ruler,
          just above the first row). Redrawn as the table scrolls or the panel resizes. */}
      <div ref={mapRef} style={styles.mapArea} onScrollCapture={drawConnectors}>
        {/* 2 · Map conditions: arm one, then paint it onto name tokens. Pinned under the title while
            the names scroll; only the conditions switched on are offered. */}
        <div style={styles.chips}>
          <span style={styles.paintLabel}>
            <IconPaint />
            Set condition
            <InfoTip label="How to map conditions">
              Click a condition, then click or drag tokens on a row to tag it. A tag is applied to
              every <b>checked</b> row — uncheck rows whose names use a different layout (their
              existing tags are kept) and tag them separately. Click a tag again to clear it.
            </InfoTip>
          </span>
          {activeFields.length === 0 && (
            <span style={styles.chipsLabel}>Switch a condition on above to map it.</span>
          )}
          {activeFields.map((f) => {
            const on = armed === f
            // `applied` = at least one sample has this field tagged. An applied chip is tinted in the
            // field colour; the currently-armed chip is the SAME colour but a stronger opacity, so the
            // current selection stands out from the merely-applied ones.
            const applied = samples.some((s) => spans[s.sample]?.[f] != null)
            const col = colorOf(f)
            return (
              <button
                key={f}
                ref={(el) => {
                  if (el) chipRefs.current.set(f, el)
                  else chipRefs.current.delete(f)
                }}
                onClick={() => setArmed(on ? null : f)}
                title={applied ? `${f} applied — click to re-tag` : `Tag ${f}`}
                style={{
                  ...styles.chip,
                  background: on ? `${col}aa` : applied ? `${col}26` : 'transparent',
                  color: UI.text,
                  borderColor: on || applied ? col : UI.border
                }}
              >
                <span style={{ ...styles.chipDot, background: col }} />
                {f}
              </button>
            )
          })}
        </div>
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
            <tbody>
              {samples.map((s, index) => {
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
              })}
            </tbody>
          </table>
        </ScrollFade>
        <svg style={styles.connectors} aria-hidden>
          {connectors.map((c) => (
            <path
              key={c.field}
              d={c.d}
              fill="none"
              stroke={colorOf(c.field)}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {connectors.map((c) => (
            <path key={`${c.field}-head`} d={c.head} fill={colorOf(c.field)} />
          ))}
        </svg>
      </div>
    </>
  )
}

/** The samplesheet's rename bar: pick a condition and one of its current values, type the new
 *  name, Rename — every sample carrying that value takes the new one. Says how many samples it
 *  changes before it's applied. */
/** The width of an app select (ui/Select) just wide enough for its longest option: that label in the
 *  select's 12px text, plus the button's padding (7 + 7), gap (6), chevron (11) and border (1 + 1),
 *  and 2px so rounding never ellipsizes it. */
let measureCtx: CanvasRenderingContext2D | null | undefined
function selectWidthFor(labels: string[]): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 120
  measureCtx.font = `12px ${getComputedStyle(document.body).fontFamily}`
  const ctx = measureCtx
  const text = Math.max(0, ...labels.map((l) => ctx.measureText(l).width))
  return Math.ceil(text) + 7 + 7 + 6 + 11 + 2 + 2
}

/** The colour dot and its gap ahead of a condition's name in the rename bar's condition select. */
const RENAME_DOT_W = 9 + 6

function RenameBar({
  options,
  colorOf,
  onRename
}: {
  /** each condition that carries values, with its distinct values (sorted) and how many samples
   *  carry each */
  options: Array<{ field: Field; values: Array<{ value: string; count: number }> }>
  colorOf: ColorOf
  onRename: (field: Field, oldVal: string, newVal: string) => void
}): ReactNode {
  const [pickField, setPickField] = useState<Field | null>(null)
  const [pickValue, setPickValue] = useState<string | null>(null)
  const [next, setNext] = useState('')
  // Fall back to the first condition / value when the pick is gone (renamed away, untagged).
  const opt = options.find((o) => o.field === pickField) ?? options[0]
  const val = opt?.values.find((v) => v.value === pickValue) ?? opt?.values[0]
  if (!opt || !val) return null
  const target = next.trim()
  const ready = target !== '' && target !== val.value
  const apply = (): void => {
    if (!ready) return
    onRename(opt.field, val.value, target)
    setPickValue(target)
    setNext('')
  }
  return (
    <div style={styles.renameBar}>
      <span style={styles.renameLabel}>rename</span>
      <span
        // + the colour dot and its gap before each name
        style={{
          ...styles.renameSelect,
          width: selectWidthFor(options.map((o) => o.field)) + RENAME_DOT_W
        }}
        title="The condition whose value to rename"
      >
        <AppSelect
          value={opt.field}
          options={options.map((o) => ({
            value: o.field,
            label: o.field,
            render: (
              <span style={styles.renameFieldOpt}>
                <span style={{ ...styles.chipDot, background: colorOf(o.field) }} />
                {o.field}
              </span>
            )
          }))}
          onChange={(f) => {
            setPickField(f)
            setPickValue(null)
          }}
        />
      </span>
      <span style={styles.renameLabel}>value</span>
      <span
        style={{ ...styles.renameSelect, width: selectWidthFor(opt.values.map((v) => v.value)) }}
        title="The value to rename, in every sample that carries it"
      >
        <AppSelect
          value={val.value}
          options={opt.values.map((v) => ({ value: v.value, label: v.value }))}
          onChange={setPickValue}
        />
      </span>
      <span style={styles.renameArrow}>→</span>
      <input
        style={styles.renameInput}
        value={next}
        placeholder="new name"
        spellCheck={false}
        onChange={(e) => setNext(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
          else if (e.key === 'Escape') setNext('')
        }}
      />
      {/* The count and the action at the bar's right end. */}
      <span style={styles.renameEnd}>
        <span style={styles.renameCount}>
          {val.count} sample{val.count === 1 ? '' : 's'}
        </span>
        <button
          style={{ ...styles.btnPrimary, ...styles.renameBtn, opacity: ready ? 1 : 0.45 }}
          disabled={!ready}
          onClick={apply}
        >
          Rename
        </button>
      </span>
    </div>
  )
}

/** Stage 2: editable grid — include checkbox + per-cell overrides for naming exceptions, plus a
 *  rename bar to change a condition value across every sample at once. */
function Stage2({
  samples,
  spans,
  colorOf,
  delims,
  setCell,
  setInclude,
  onRenameValue,
  units,
  onUnits,
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
  onRenameValue: (field: Field, oldVal: string, newVal: string) => void
  /** the numeric conditions' units (kept on the Load tile) */
  units: CondUnits
  onUnits: (units: CondUnits) => void
  /** the conditions switched on (the left panel) — one column each, in that order */
  activeFields: Field[]
}): ReactNode {
  // Dose and time are the numeric conditions: each shows its unit chip by its name.
  const unitFor = (f: Field): UnitSpec | undefined => unitSpec(f, units, onUnits)
  // The rename bar's choices: each condition carrying values, with its distinct values
  // (numeric-aware order) and how many samples carry each.
  const renameOptions = activeFields
    .map((f) => {
      const counts = new Map<string, number>()
      for (const s of samples) {
        const v = condOf(s, f).trim()
        if (v !== '') counts.set(v, (counts.get(v) ?? 0) + 1)
      }
      return {
        field: f,
        values: [...counts.entries()]
          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
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
        const unit = f === 'dose' || f === 'time'
        const base = COND_W + (unit ? UNIT_EXTRA : 0)
        // the longest value in its text box (+ the unit after it, for dose / time)
        const unitText = unit ? textW(units[f] ?? '', '11px') + 4 : 0
        const longest = Math.max(0, ...samples.map((sm) => textW(condOf(sm, f), '12px')))
        const value = Math.ceil(longest) + INPUT_PAD + unitText + CELL_PAD
        // its name in the header (bold), with the unit chip beside it for dose / time
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
  }, [widths, cols.length, activeFields, samples, units])

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
        <RenameBar options={renameOptions} colorOf={colorOf} onRename={onRenameValue} />
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
              ? { tableLayout: 'fixed', width: pinnedSum, minWidth: 0 }
              : { tableLayout: 'auto', minWidth: 0 })
          }}
        >
          <colgroup>
            {cols.map((c, i) => (
              <col key={c} style={{ width: widths[i] != null ? `${widths[i]}px` : undefined }} />
            ))}
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
                      // A condition's name in its colour, with its unit chip for dose / time.
                      <span style={styles.condName}>
                        {c}
                        {unitFor(c) && <UnitChip spec={unitFor(c)!} color={colorOf(c)} />}
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
            </tr>
          </thead>
          <tbody>
            {samples.map((s, i) => {
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
                    return (
                      <td key={f} style={styles.td}>
                        <div style={styles.cellWithUnit}>
                          <input
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
                                : null)
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
                </tr>
              )
            })}
          </tbody>
        </table>
      </ScrollFade>
    </>
  )
}

/** A select-style button whose multiselect list floats (portalled) just below it — so it isn't
 *  clipped by the modal's scroll area. Checked = kept; unchecked values are dropped. */
function ValueDropdown({
  values,
  dropped,
  disabled,
  color,
  truncated,
  onToggle,
  onSelectAll,
  onClearAll
}: {
  values: string[]
  dropped: Set<string>
  disabled: boolean
  color: string
  truncated: boolean
  onToggle: (v: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}): ReactNode {
  const mode = useUiTheme((s) => s.mode)
  const [open, setOpen] = useState(false)
  const kept = values.filter((v) => !dropped.has(v)).length
  const summary =
    kept === values.length
      ? 'All values'
      : kept === 0
        ? 'None kept'
        : `${kept}/${values.length} kept`
  // Deactivating the tile closes the menu without a state sync (derive rather than setState-in-effect).
  const isOpen = open && !disabled
  const { btnRef, menuRef, rect } = useFloatingMenu(isOpen, setOpen)

  return (
    <>
      <button
        ref={btnRef as React.RefObject<HTMLButtonElement | null>}
        disabled={disabled}
        style={{ ...styles.dropdownBtn, borderColor: isOpen ? color : UI.border }}
        onClick={() => setOpen((o) => !o)}
      >
        {summary}
        <span style={styles.dropdownCaret}>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              ...cssVars(PALETTES[mode]),
              ...styles.dropdownMenu,
              right: rect.right,
              top: rect.top,
              minWidth: Math.max(rect.width, 180)
            }}
          >
            <div style={styles.dropdownTools}>
              <button style={styles.filterLink} onClick={onSelectAll}>
                Select all
              </button>
              <button style={styles.filterLink} onClick={onClearAll}>
                Clear all
              </button>
            </div>
            <div style={styles.dropdownList}>
              {values.map((v) => {
                const isKept = !dropped.has(v)
                return (
                  <label key={v} style={styles.dropdownItem}>
                    <input type="checkbox" checked={isKept} onChange={() => onToggle(v)} />
                    <span style={isKept ? undefined : styles.dropdownItemOff}>
                      {v === '' ? '(empty)' : v}
                    </span>
                  </label>
                )
              })}
            </div>
            {truncated && (
              <div style={styles.hint}>
                Showing the first {values.length} distinct values; rarer values are kept.
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

/** Stage 2 (Filtering): one card per `filter`-role column. A categorical column picks its kept
 *  values from a floating multiselect dropdown; a numeric column offers a min/max range.
 *  Rows failing any active filter are dropped on convert. Only shown when ≥1 filter column. */
function FilterStage({
  filterCols,
  allRows,
  filters,
  setFilters,
  columns
}: {
  filterCols: string[]
  allRows: Record<string, string>[]
  filters: Record<string, FilterSpec>
  setFilters: (next: Record<string, FilterSpec>) => void
  columns: string[]
}): ReactNode {
  const colKey = filterCols.join(' ')
  // Filter edits sync live: every control writes straight to the import config, and the stats +
  // data table below recompute immediately.
  const setFilter = (col: string, spec: FilterSpec): void => setFilters({ ...filters, [col]: spec })
  // The per-tile checkbox: activate/deactivate a column's filter (keeping any edited values).
  const setActive = (col: string, on: boolean): void =>
    setFilters({ ...filters, [col]: { ...(filters[col] ?? {}), active: on } })
  // Distinct-value / numeric-range facet per filter column, computed over ALL rows once.
  const facets = useMemo(() => {
    const m: Record<string, ColumnFacet> = {}
    for (const c of filterCols) m[c] = columnFacet(allRows, c)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey, allRows])
  const total = allRows.length
  // One pass over every row: count survivors and collect a capped sample of the DROPPED rows for
  // the preview below (so the user can see exactly what a filter is removing).
  const { kept, removedTotal, displayRows } = useMemo(() => {
    const active = filterCols
      .filter((c) => filters[c]?.active)
      .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
    let keptN = 0
    let removedN = 0
    // Capped samples for the table below — removed rows first (shown on top, red), then kept.
    const removedRows: Record<string, string>[] = []
    const keptRows: Record<string, string>[] = []
    for (const r of allRows) {
      let ok = true
      for (const { col, drop, spec } of active) {
        const raw = (r[col] ?? '').trim()
        if (drop.size > 0 && drop.has(raw)) {
          ok = false
          break
        }
        if (spec.min != null || spec.max != null) {
          const x = Number(raw)
          if (
            !Number.isFinite(x) ||
            (spec.min != null && x < spec.min) ||
            (spec.max != null && x > spec.max)
          ) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        keptN++
        if (keptRows.length < KEPT_PREVIEW_CAP) keptRows.push(r)
      } else {
        removedN++
        if (removedRows.length < REMOVED_PREVIEW_CAP) removedRows.push(r)
      }
    }
    const displayRows = [
      ...removedRows.map((r) => ({ r, removed: true })),
      ...keptRows.map((r) => ({ r, removed: false }))
    ]
    return { kept: keptN, removedTotal: removedN, displayRows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey, filters, allRows, total])

  const pct = total > 0 ? Math.round((kept / total) * 1000) / 10 : 0
  // Filter columns first (leftmost) so the values driving each drop are easy to scan, then the
  // rest of the matrix columns in their original order.
  const filterSet = new Set(filterCols)
  const orderedCols = [...filterCols, ...columns.filter((c) => !filterSet.has(c))]
  const numColor = ROLE_COLORS.filter!
  return (
    <>
      {/* A heading, as the other sections have; how filtering works is in its (i). */}
      <div style={{ ...styles.tableTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
        Filtering conditions
        <InfoTip label="How filtering works">
          These columns filter which feature rows are kept. Uncheck values to drop them, or set a
          numeric range — rows matching <b>all</b> filters are written; the rest are dropped.
        </InfoTip>
      </div>
      {filterCols.map((col) => {
        const facet = facets[col]
        const spec = filters[col]
        if (!facet) return null
        const isActive = spec?.active === true
        const dropSet = new Set(spec?.drop ?? [])
        return (
          <div
            key={col}
            style={isActive ? styles.filterCard : { ...styles.filterCard, ...styles.filterCardOff }}
          >
            {/* Checkbox at the far left turns the filter active; label next; controls at the right. */}
            <div style={styles.filterHead}>
              <input
                type="checkbox"
                checked={isActive}
                title={
                  isActive ? 'Active — uncheck to ignore this filter' : 'Inactive — check to enable'
                }
                onChange={(e) => setActive(col, e.target.checked)}
              />
              <span style={{ ...styles.chipDot, background: numColor }} />
              <span style={{ ...styles.filterName, ...(isActive ? null : styles.offText) }}>
                {col}
              </span>
              <span style={styles.filterMeta}>
                {facet.numeric
                  ? `numeric · ${facet.min}–${facet.max}`
                  : `${facet.values.length}${facet.truncated ? '+' : ''} value${facet.values.length === 1 ? '' : 's'}`}
              </span>
              <div
                style={{ ...styles.filterControls, ...(isActive ? null : styles.controlsOff) }}
                aria-disabled={!isActive}
              >
                {facet.numeric ? (
                  <>
                    <label style={styles.numLabel}>
                      min
                      <input
                        style={styles.numInput}
                        type="number"
                        disabled={!isActive}
                        placeholder={String(facet.min)}
                        value={spec?.min ?? ''}
                        onChange={(e) => {
                          // Blank (or a partial entry like "-") = no bound, never NaN.
                          const raw = Number(e.target.value)
                          const v = e.target.value === '' || !Number.isFinite(raw) ? null : raw
                          setFilter(col, { ...spec, active: true, min: v })
                        }}
                      />
                    </label>
                    <label style={styles.numLabel}>
                      max
                      <input
                        style={styles.numInput}
                        type="number"
                        disabled={!isActive}
                        placeholder={String(facet.max)}
                        value={spec?.max ?? ''}
                        onChange={(e) => {
                          const raw = Number(e.target.value)
                          const v = e.target.value === '' || !Number.isFinite(raw) ? null : raw
                          setFilter(col, { ...spec, active: true, max: v })
                        }}
                      />
                    </label>
                  </>
                ) : (
                  // Categorical values are chosen from a floating multiselect dropdown.
                  <ValueDropdown
                    values={facet.values}
                    dropped={dropSet}
                    disabled={!isActive}
                    color={numColor}
                    truncated={facet.truncated}
                    onToggle={(v) => {
                      const nd = new Set(spec?.drop ?? [])
                      if (nd.has(v)) nd.delete(v)
                      else nd.add(v)
                      setFilter(
                        col,
                        nd.size > 0 ? { ...spec, active: true, drop: [...nd] } : { active: true }
                      )
                    }}
                    onSelectAll={() => setFilter(col, { active: true })}
                    onClearAll={() => setFilter(col, { active: true, drop: [...facet.values] })}
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}

      {/* Row stats, below the filter sections. */}
      <div style={styles.filterStats}>
        Removing <b style={styles.removingNum}>{removedTotal.toLocaleString()}</b> rows. Keeping{' '}
        <b>{kept.toLocaleString()}</b> of {total.toLocaleString()} rows ({pct}%).
      </div>

      {/* Full data below: removed rows on top (red), then the kept rows. Both are capped samples —
          every filtered row is applied on convert regardless of what's shown here. */}
      <ScrollFade fill={false} maxHeight={300}>
        <table style={{ ...styles.grid, tableLayout: 'auto' }}>
          <thead>
            <tr>
              {orderedCols.map((c) => (
                <th
                  key={c}
                  style={filterSet.has(c) ? { ...styles.th, color: numColor } : styles.th}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ r, removed }, i) => (
              <tr key={i} style={removed ? styles.removedRow : undefined}>
                {orderedCols.map((c) => (
                  <td key={c} style={{ ...styles.td, ...styles.sampleCell }} title={r[c]}>
                    {r[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollFade>
    </>
  )
}

/** How many removed / kept rows the Filtering-step data table renders (a sample — every filtered
 *  row is applied on convert regardless; the cap just keeps the DOM light). */
const REMOVED_PREVIEW_CAP = 200
const KEPT_PREVIEW_CAP = 200

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60
  },
  scrim: { position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)' },
  modal: {
    position: 'relative',
    width: 1040,
    maxWidth: '94vw',
    // One size for every step (the step's own content scrolls inside), so it doesn't jump.
    height: '88vh',
    display: 'flex',
    flexDirection: 'column',
    background: UI.panel,
    border: `1px solid ${UI.border}`,
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    zIndex: 1,
    overflow: 'hidden'
  },
  head: {
    padding: '10px 12px 10px 16px',
    fontWeight: 700,
    fontSize: 14,
    color: UI.text,
    borderBottom: `1px solid ${UI.border}`,
    background: UI.panelAlt,
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  // Roadmap stepper bar under the header: numbered stage pills + labels, joined by connectors.
  roadmap: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    padding: '12px 20px',
    background: UI.panelAlt,
    borderBottom: `1px solid ${UI.border}`
  },
  roadStep: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 5,
    flex: '0 0 auto'
  },
  roadDot: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    border: '2px solid',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1
  },
  roadLabel: { fontSize: 11, letterSpacing: 0.2, whiteSpace: 'nowrap' },
  // Connector between two stage pills — vertically centred on the 26px dot row.
  roadLine: { flex: 1, height: 2, marginTop: 13, borderRadius: 1, minWidth: 16 },
  closeBtn: {
    flex: '0 0 auto',
    width: 26,
    height: 26,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    color: UI.textMuted,
    border: 'none',
    borderRadius: 5,
    fontSize: 14,
    cursor: 'pointer'
  },
  body: {
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    overflow: 'auto',
    // A step swiping in never scrolls it sideways (each step's wide tables scroll in their own box).
    overflowX: 'hidden',
    flex: 1,
    minHeight: 0
  },
  // One step's content, filling the body (laid out as the body was before it was wrapped).
  stepPane: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 },
  foot: {
    padding: '12px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTop: `1px solid ${UI.border}`,
    background: UI.panelAlt
  },
  row: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { fontSize: 11, color: UI.textMuted, width: 54, flex: '0 0 54px' },
  select: {
    flex: 1,
    minWidth: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '5px 8px',
    fontSize: 12
  },
  hint: { color: UI.textMuted, fontSize: 12, lineHeight: 1.45 },
  chips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chipsLabel: { fontSize: 12, fontWeight: 600, color: UI.textMuted, marginRight: 2 },
  condList: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
  condToggle: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 },
  // The left panel's Set units section: one row per numeric condition that's on, its name then
  // its unit chip.
  unitBlock: { display: 'flex', flexDirection: 'column', gap: 6 },
  // The left column's two sections: the switches over its top 55%, Set unit the bottom 45% —
  // each scrolling on its own if it runs over.
  switchSec: {
    flex: '11 1 0',
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  unitSec: { flex: '9 1 0', minHeight: 0, overflow: 'auto' },
  unitRow: { display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 },
  unitName: { minWidth: 40 },
  // "(i) Select unit:" and its chip, close together.
  unitPick: { display: 'inline-flex', alignItems: 'center', gap: 2 },
  // A condition that takes no unit: shown for completeness, faded.
  unitRowNA: { opacity: 0.4, color: UI.textMuted },
  unitNA: { fontSize: 12, fontStyle: 'italic' },
  // "Separator [_]" at the right of the Sample names heading.
  sepLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted
  },
  sepSelect: { display: 'inline-flex' },
  // The custom separator's box: quote, the text, quote — styled as one text box, the quotes inside.
  // The quote marks around the separator: fainter than it, so they read as framing, not text.
  sepQuote: { opacity: 0.45 },
  sepQuoted: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 6px',
    fontFamily: MONO,
    fontSize: 12,
    color: UI.textMuted,
    background: UI.panelRaised,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    cursor: 'text'
  },
  // The text inside sepQuoted: bare, as wide as what's typed, so the quotes sit right against it.
  sepInput: {
    padding: 0,
    margin: 0,
    fontSize: 12,
    fontFamily: MONO,
    color: UI.text,
    background: 'transparent',
    border: 'none',
    outline: 'none'
  },
  // The Conditions step's deck of panels (see ConditionsStage), each scrolling on its own.
  // Clipped (with room for the cards' edge), so a card's animation never spills past the deck.
  condPanels: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    containerType: 'inline-size',
    overflow: 'clip',
    overflowClipMargin: 4
  },
  condPanel: {
    minWidth: 0,
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    padding: '10px 12px 12px',
    border: `1px solid ${UI.border}`,
    borderRadius: 8
  },
  // The conditions card: the switches in a column of their own (scrolling in it), the map beside
  // them (its names table fills it and scrolls inside, so the column doesn't).
  condSplit: { flex: 1, minHeight: 0, display: 'flex', gap: 14 },
  condSplitLeft: {
    flex: '0 0 230px',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    paddingRight: 14,
    borderRight: `1px solid ${UI.border}`
  },
  condSplitRight: {
    flex: '1 1 0',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  // A card of the deck: 90% of the width, full height, at its own fixed offset and pose (inline).
  deckCard: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '90%',
    display: 'flex',
    borderRadius: 8,
    background: UI.panel,
    // A faint edge and a soft lift, just enough to tell the overlapping cards apart.
    boxShadow: `0 0 0 1px color-mix(in srgb, ${UI.border} 60%, transparent), 0 2px 8px rgba(0, 0, 0, 0.08)`,
    transition: 'transform 600ms cubic-bezier(0.22, 1, 0.36, 1), background 300ms'
  },
  // No outline: the veil over the others is what marks the card in use.
  deckFace: {
    flex: 1,
    overflow: 'hidden',
    border: 'none',
    transition: 'opacity 300ms, filter 300ms'
  },
  // A chevron floating over the parked card's strip (faint; see .oe-deck-next), turning to it:
  // on the first card it's the step's Next, on the second it goes back. The strip around it still picks the card as well.
  deckNextWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '10cqw',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    pointerEvents: 'none'
  },
  deckNext: {
    pointerEvents: 'auto',
    display: 'flex',
    padding: 8,
    color: UI.text,
    background: 'transparent',
    border: 'none',
    cursor: 'pointer'
  },
  // A card not in use is greyed all over: its colours drained and faded onto a grey card.
  deckFaceAway: { opacity: 0.4, filter: 'grayscale(1)' },
  deckCardAway: { background: UI.panelAlt },
  // Over a card not in use: picks it (its content beneath is inert and greyed, see deckFaceAway).
  deckPick: {
    position: 'absolute',
    inset: 0,
    padding: 0,
    background: 'transparent',
    border: 'none',
    borderRadius: 8,
    font: 'inherit',
    cursor: 'pointer'
  },
  condNum: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    marginRight: 6,
    borderRadius: 8,
    fontSize: 10,
    background: UI.border,
    color: UI.text,
    transition: 'background 200ms, color 200ms'
  },
  condNumOn: { background: UI.accent, color: UI.accentText },
  // A card's title: a little more room under it than a section heading gets.
  cardHead: { marginBottom: 6 },
  panelHead: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  // The samplesheet's rename bar (RenameBar).
  // A control strip like the dashboard's switch bars: one tinted, bordered row of labelled controls.
  renameBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: '6px 10px',
    background: UI.panelAlt,
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  // Labels as the switch bars label theirs (small caps, muted).
  renameLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  renameArrow: { fontSize: 12, color: UI.textMuted },
  // A fixed-width slot for the app's Select (which fills its container).
  // A condition option: its colour dot, then its name.
  renameFieldOpt: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  // Width set per select, to fit its longest option (selectWidthFor).
  renameSelect: { display: 'inline-flex', flex: '0 0 auto' },
  renameInput: {
    width: 140,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 8px',
    fontSize: 12
  },
  renameBtn: { padding: '4px 12px' },
  renameEnd: { display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  renameCount: { fontSize: 11, color: UI.textMuted, fontVariantNumeric: 'tabular-nums' },

  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  chipDot: { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' },
  // The "custom" row while naming (NewConditionRow): the input where its label was, error beside it.
  addCondBox: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  addCondInput: {
    width: 96,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px dashed ${UI.accent}`,
    borderRadius: 12,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    outline: 'none'
  },
  addCondErr: { fontSize: 11, color: UI.err },
  // ── Filtering stage ──
  filterStats: {
    fontSize: 13,
    color: UI.text,
    fontVariantNumeric: 'tabular-nums',
    paddingTop: 4
  },
  removingNum: { color: '#e15759' },
  // Red-tinted background marking a dropped row in the data table.
  removedRow: { background: 'rgba(225,87,89,0.18)' },
  filterCard: {
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    background: UI.panelAlt
  },
  // Inactive filter tile: greyed out until its checkbox is ticked (the default).
  filterCardOff: { opacity: 0.55 },
  offText: { color: UI.textMuted },
  // Controls in an inactive tile: dimmed and inert (the checkbox stays clickable).
  controlsOff: { opacity: 0.5, pointerEvents: 'none' },
  filterHead: { display: 'flex', alignItems: 'center', gap: 8 },
  filterName: { fontSize: 13, fontWeight: 700, color: UI.text, fontFamily: MONO },
  filterMeta: { fontSize: 11, color: UI.textMuted },
  // Filter control cluster, pushed to the right end of the tile (wraps right-aligned if long).
  filterControls: {
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 8
  },
  // Apply / Reset row beneath the filter cards.
  filterActions: { display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 },
  filterDirty: { fontSize: 11, color: UI.warn, fontStyle: 'italic' },
  // Reason the Next button is disabled, shown just to its left.
  nextBlock: {
    fontSize: 11,
    color: UI.warn,
    alignSelf: 'center',
    textAlign: 'right',
    maxWidth: 320
  },
  stageTitle: { fontSize: 15, fontWeight: 700, color: UI.text, marginBottom: 2 },
  filterTools: { display: 'flex', gap: 10 },
  filterLink: {
    background: 'transparent',
    color: UI.accent,
    border: 'none',
    padding: 0,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer'
  },
  // "all ☐" select-all control in the sample-name table's header cell.
  allCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    color: UI.textMuted,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  // Compact "invert" button in the sample-name table's header cell, on top of the select-all box.
  // The Map conditions chips + names table, with the connector overlay drawn over both.
  mapArea: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  },
  connectors: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 6
  },
  // The names table's select-all checkbox with the (square) invert button to its right.
  selectTools: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  invertLink: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 'none',
    width: 18,
    height: 18,
    padding: 0,
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 4,
    boxSizing: 'border-box',
    cursor: 'pointer'
  },
  valueChip: {
    border: '1px solid',
    borderRadius: 12,
    padding: '3px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontVariantNumeric: 'tabular-nums'
  },
  // Categorical filter: a select-style button that opens an in-card multiselect list.
  dropdownBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 120,
    justifyContent: 'space-between',
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  dropdownCaret: { fontSize: 8, color: UI.textMuted },
  // Floating menu portalled to <body>, positioned just below the button (fixed, so the modal's
  // scroll area can't clip it).
  dropdownMenu: {
    position: 'fixed',
    zIndex: 9999,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panel,
    padding: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)'
  },
  dropdownTools: { display: 'flex', gap: 12 },
  dropdownList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    maxHeight: 200,
    overflow: 'auto'
  },
  dropdownItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer',
    padding: '2px 4px',
    fontVariantNumeric: 'tabular-nums'
  },
  dropdownItemOff: { color: UI.textMuted, textDecoration: 'line-through' },
  // Bounded scroll box for the data table (removed rows on top). Scrolls both axes so the full
  // set of columns is reachable without stretching the modal.
  // The unit chip: small and quiet beside a condition's name; muted italic while unset (a.u.).
  unitChip: {
    display: 'inline-flex',
    alignItems: 'center',
    marginLeft: 4,
    padding: '0 6px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 8,
    background: 'transparent',
    color: UI.text,
    fontSize: 10,
    fontWeight: 600,
    lineHeight: '15px',
    letterSpacing: 0,
    textTransform: 'none',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  unitChipUnset: { color: UI.textMuted, fontStyle: 'italic', fontWeight: 500 },
  unitMenu: { padding: 4, gap: 0, minWidth: 64 },
  unitItem: {
    background: 'transparent',
    border: 'none',
    borderRadius: 4,
    color: UI.text,
    fontSize: 12,
    textAlign: 'left',
    padding: '3px 8px',
    cursor: 'pointer'
  },
  unitItemOn: { background: UI.border, fontWeight: 700 },
  numRow: { display: 'flex', gap: 14 },
  numLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted
  },
  numInput: {
    width: 100,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '4px 8px',
    fontSize: 12
  },

  // Chip-style select for swapping the source data file inside the wizard.
  // The Columns step's data-file dropdown (the app's Select fills this slot).
  // The data-file list's "Generated files" heading (an unselectable option).
  fileGroupHead: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted
  },
  // A data file's folder, before its name in the data-file list.
  // Fainter than muted text, so the file name leads (opacity, so it also fades on a highlighted row).
  fileDir: { color: UI.textMuted, opacity: 0.6 },
  fileSelect: { display: 'inline-flex', flex: '0 1 360px', minWidth: 160 },
  chipCount: {
    marginLeft: 2,
    fontSize: 10,
    fontWeight: 700,
    opacity: 0.75,
    fontVariantNumeric: 'tabular-nums'
  },
  // Clickable column header for the step-1 classifier: centred, with the role label stacked above
  // the column name (like the ruler labels over the condition step).
  colHead: {
    textAlign: 'center',
    // Name centres vertically in the cell; the field label is lifted out of flow (below) and
    // pinned to the top, with the top padding reserving its row. NB: no `position` here — that
    // would override the sticky header's `position: sticky` and break stickiness.
    verticalAlign: 'middle',
    padding: '17px 10px 6px',
    userSelect: 'none',
    // Wide enough to fit the widest role label (METADATA), since the label is out of flow and so
    // doesn't push the fit-to-content width of a short-named column.
    minWidth: 82,
    maxWidth: 200
  },
  // Absolutely pinned to the top of the header cell (the sticky `th` is its containing block), so
  // labels line up along one row regardless of how tall each header wraps. Inert to the pointer so
  // it never blocks the header click/drag.
  colRole: {
    position: 'absolute',
    top: 4,
    left: 0,
    right: 0,
    textAlign: 'center',
    whiteSpace: 'nowrap',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1.3,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    pointerEvents: 'none'
  },
  // Wrap long headers (e.g. run file paths), breaking unbroken strings so a long path folds
  // in-column; centred horizontally (vertical centring comes from the cell's middle alignment).
  colName: {
    color: UI.text,
    fontSize: 12,
    fontFamily: MONO,
    textAlign: 'center',
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    wordBreak: 'break-word'
  },
  nameTable: {
    borderCollapse: 'collapse',
    width: 'max-content',
    minWidth: '100%',
    fontFamily: MONO,
    fontSize: 12
  },
  // Label strip above the table; same left padding + monospace as the rows so the hidden text
  // reserves matching widths and the centred labels line up with the first row's substrings.
  rulerCell: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    // Little headroom: the Map conditions connectors curve down through the gap above the table and
    // this row's (hidden) text, ending just over the first row.
    padding: '4px 10px 2px',
    whiteSpace: 'nowrap',
    background: UI.panel,
    borderBottom: `1px solid ${UI.border}`
  },
  nameCell: { padding: '3px 10px', whiteSpace: 'nowrap', borderBottom: `1px solid ${UI.border}` },
  // Narrow leading column holding each row's active-checkbox (content-sized).
  // Left-aligned (not centred), so each row's checkbox sits under the header's select-all — which
  // shares its cell with the invert button.
  // Every row / select-all checkbox in the Conditions step's tables: the same look (accent tick)
  // and no browser margin, so they line up.
  rowCheck: { accentColor: UI.accent, cursor: 'pointer', margin: 0, verticalAlign: 'middle' },
  checkCell: {
    width: 1,
    padding: '3px 6px 3px 4px',
    textAlign: 'left',
    verticalAlign: 'middle',
    borderBottom: `1px solid ${UI.border}`
  },
  // Header cell for the select-all checkbox: sticky like the ruler, checkbox at the bottom so it
  // sits by the sample-name baseline rather than up in the angled-label headroom.
  rulerCheckCell: {
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: UI.panel,
    verticalAlign: 'bottom',
    paddingBottom: 3
  },
  // Active sample row: light/raised; tokens are clicked to tag (not text-selected).
  teachCell: { userSelect: 'none', background: UI.panelRaised },
  // Whole row is a click target (toggles active) — pointer everywhere but the paintable tokens.
  sampleRow: { cursor: 'pointer' },
  // Hovered-row tint: a translucent wash layered over whichever base background the cell has, so
  // it reads in both themes without a per-theme colour.
  hoverCell: { backgroundImage: 'linear-gradient(rgba(128,128,128,0.14), rgba(128,128,128,0.14))' },
  // Inactive row: greyed background + muted text, non-editable — shows its faint existing tags only.
  dimCell: { userSelect: 'none', background: UI.panelAlt, color: UI.textMuted },
  confirm: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.text,
    cursor: 'pointer'
  },
  tableTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    color: UI.textMuted
  },
  annPanel: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    padding: '8px 10px',
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    background: UI.panelAlt
  },
  annTitle: { fontSize: 12, fontWeight: 700, color: UI.text, flex: '0 0 auto' },
  annFields: { display: 'inline-flex', flexWrap: 'wrap', gap: 10 },
  // Fetch / Re-fetch on a row of their own, below the options.
  annActions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 10,
    flex: '1 1 100%'
  },
  // One annotation category chip: [☐ Label n/m ▾] — the box picks the whole category, the label
  // opens its member list.
  annCatBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '3px 8px 3px 6px',
    fontSize: 12,
    fontWeight: 600,
    userSelect: 'none'
  },
  annCatLabel: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  annCatCount: { fontSize: 10, fontWeight: 500, color: UI.textMuted },
  annSoon: { marginLeft: 'auto', fontSize: 10, color: UI.textMuted, fontStyle: 'italic' },
  // beside the buttons, taking the rest of the row and wrapping within it
  annNote: { flex: '1 1 0', minWidth: 0, marginTop: 0 },
  fadeWrap: { position: 'relative', flex: 1, minHeight: 0, display: 'flex' },
  fadeScroll: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    border: `1px solid ${UI.border}`,
    borderRadius: 6
  },
  fade: { position: 'absolute', pointerEvents: 'none', zIndex: 2 },
  tableHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  colSteps: { display: 'inline-flex', gap: 4 },
  colStep: {
    width: 20,
    height: 20,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    border: `1px solid ${UI.border}`,
    background: UI.panel,
    color: UI.text,
    cursor: 'pointer'
  },
  fadeTop: {
    top: 0,
    left: 1,
    right: 0,
    height: 10,
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), transparent)'
  },
  fadeBottom: {
    bottom: 0,
    left: 1,
    right: 0,
    height: 10,
    background: 'linear-gradient(to top, rgba(0,0,0,0.1), transparent)'
  },
  fadeLeft: {
    top: 0,
    bottom: 0,
    left: 1,
    width: 10,
    background: 'linear-gradient(to right, rgba(0,0,0,0.1), transparent)'
  },
  fadeRight: {
    top: 0,
    bottom: 0,
    right: 0,
    width: 10,
    background: 'linear-gradient(to left, rgba(0,0,0,0.1), transparent)'
  },
  // width:max-content so each column sizes to its content (the row scrolls if wide).
  // border-collapse: separate (not collapse) so the sticky header actually sticks in Chromium.
  grid: {
    borderCollapse: 'separate',
    borderSpacing: 0,
    width: 'max-content',
    minWidth: '100%',
    fontSize: 12
  },
  th: {
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: UI.panelAlt,
    color: UI.textMuted,
    fontWeight: 600,
    textAlign: 'left',
    padding: '6px 8px',
    borderBottom: `1px solid ${UI.border}`
  },
  td: { padding: '3px 8px', borderBottom: `1px solid ${UI.border}`, color: UI.text },
  // Fit to content by default; when a column is narrowed the sample name clips with an ellipsis.
  sampleCell: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' },
  clip: { overflow: 'hidden', textOverflow: 'ellipsis' },
  // Drag handle on a header's right edge to resize its column: a wide invisible hit area with a
  // visible 2px grip line centred on the column boundary.
  resizer: {
    position: 'absolute',
    top: 0,
    right: -5,
    width: 10,
    height: '100%',
    cursor: 'col-resize',
    userSelect: 'none',
    zIndex: 1,
    background: `linear-gradient(to right, transparent 4.5px, ${UI.border} 4.5px, ${UI.border} 5.5px, transparent 5.5px)`
  },
  cellWithUnit: { display: 'flex', alignItems: 'center', gap: 4 },
  condName: { display: 'inline-flex', alignItems: 'center' },
  // The Columns step's "Set column type" label, left of the type chips.
  paintLabel: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: UI.textMuted,
    marginRight: 2
  },
  // A bare text button (the "+ condition" column header).
  colToggle: {
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    color: 'inherit',
    textAlign: 'inherit'
  },
  cellUnit: { flex: '0 0 auto', fontSize: 11, color: UI.textMuted, whiteSpace: 'nowrap' },
  cellInput: {
    boxSizing: 'border-box',
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 3,
    padding: '3px 5px',
    fontSize: 12
  },
  btn: {
    background: UI.panelAlt,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer'
  },
  btnPrimary: {
    background: UI.accent,
    color: UI.accentText,
    border: `1px solid ${UI.accent}`,
    borderRadius: 5,
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
