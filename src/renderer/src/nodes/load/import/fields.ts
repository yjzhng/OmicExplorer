/**
 * The interactive import's condition fields and the sample-name spans that teach them: presets and
 * custom fields, their colours, token bounds, and the anchors that carry a taught span to every
 * other name.
 */
import type { InteractiveSampleCond } from '../../../engine'

/** The five built-in condition fields. A custom condition adds a sixth, seventh, … — so a Field is
 *  any name, and the preset list is only what's ALWAYS offered. */
export const PRESET_FIELDS = ['cell', 'cmpd', 'dose', 'time', 'rep'] as const
type PresetField = (typeof PRESET_FIELDS)[number]
export type Field = string
export const isPresetField = (f: Field): f is PresetField =>
  (PRESET_FIELDS as readonly string[]).includes(f)

/** One sample's value for a field. Preset fields are columns of their own; a custom condition's
 *  value lives in the `extra` bag (keyed by the condition's name). */
export const condOf = (c: InteractiveSampleCond, f: Field): string =>
  isPresetField(f) ? String(c[f] ?? '') : (c.extra?.[f] ?? '')

/** `c` with field `f` set to `v` — routed to the column or the `extra` bag as appropriate. */
export const withCond = (c: InteractiveSampleCond, f: Field, v: string): InteractiveSampleCond =>
  isPresetField(f) ? { ...c, [f]: v } : { ...c, extra: { ...(c.extra ?? {}), [f]: v } }
/** `c` with condition `f` marked as set by hand (typed / renamed) — or, `on` false, as mapped. */
export const withEdited = (
  c: InteractiveSampleCond,
  f: Field,
  on: boolean
): InteractiveSampleCond => {
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
export type RowSpans = Partial<Record<Field, Span>>

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

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
export const fieldColorIn = (f: Field, customs: readonly string[]): string => {
  if (isPresetField(f)) return PRESET_COLORS[f]
  const i = customs.indexOf(f)
  return CUSTOM_COLORS[(i < 0 ? 0 : i) % CUSTOM_COLORS.length]
}

/** The colour lookup the painting components take, so they don't each need the custom list. */
export type ColorOf = (f: Field) => string

/** Default token separator for sample names (configurable per import — see `separator`). */
export const DEFAULT_DELIM = '_'

/** Review-grid columns (the active condition fields are chosen per-render in Stage2). */
export type Col = 'include' | 'sample' | Field
/** Extra px added to a measured content width so the input isn't cramped. */
export const COL_PAD = 12
/** The standard files an import generates (data, ID map, samplesheet) — grouped apart from raw data
 *  files in the data-file list. */
export const GENERATED_FILE = /_(datamatrix|samplesheet|metadata|wide|long|DB)\.(csv|tsv|txt)$/i
/** A condition column's starting width in the samplesheet table — the same for every condition;
 *  it grows only when a value (or the condition's name) needs more. */
export const COND_W = 90
/** Extra starting width for dose and time: room for the unit after each value. */
export const UNIT_EXTRA = 30

/** Tokens of a name plus each token's char-start offset, split on ANY of the `delims` (longest
 *  match wins where several could apply). `gaps[i]` is the separator found between tokens i and
 *  i+1, so a span's value can be re-joined exactly as it appears in the name. */
export function tokenBounds(
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
export function spanValue(name: string, span: Span, delims: string[]): string {
  const { tokens, gaps } = tokenBounds(name, delims)
  if (span[0] < 0 || span[1] > tokens.length || span[0] >= span[1]) return ''
  let out = tokens[span[0]]
  for (let i = span[0] + 1; i < span[1]; i++) out += gaps[i - 1] + tokens[i]
  return out
}

/** Char index → field, built directly from a row's applied token spans. Because the highlight and
 *  the extracted value come from the SAME spans, the highlight always faithfully reflects the
 *  condition applied (and survives a later value rename, which never touches the span). */
export function fieldMapFromSpans(
  name: string,
  rowSpans: RowSpans,
  delims: string[]
): (Field | null)[] {
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
export function deriveAnchor(
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
export function applyAnchor(
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
