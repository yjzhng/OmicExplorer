/**
 * Interactive matrix adapter: convert a general wide data matrix (one value column per
 * sample, plus annotation columns) into OmicExplorer's three standard inputs, so the
 * existing Load + Standardize pipeline consumes it unchanged. The user classifies columns
 * and assigns conditions in the wizard; the constants below are only default guesses (tuned
 * for a DIA-NN protein-group table) that the user can override. Emits:
 *   • data        — wide CSV (uniqID + one column per sample); ingest melts it
 *   • samplesheet — sample -> conditions (assigned by the user; there is no reliable
 *                   automatic rule for condition naming)
 *   • db          — uniqID -> gene / product (drives gene-name display labels)
 */
import Papa from 'papaparse'

const BOM = /^\uFEFF/

/** Default annotation columns to exclude from the sample guess (id + gene/description +
 *  count columns of a DIA-NN table). Everything else numeric defaults to a sample column. */
const ID_COL = 'Protein.Group'
const GENE_COL = 'Genes'
const DESC_COL = 'First.Protein.Description'
const NON_SAMPLE_COLS = new Set([
  ID_COL,
  'Protein.Names',
  GENE_COL,
  DESC_COL,
  'N.Sequences',
  'N.Proteotypic.Sequences'
])

export interface InteractiveSampleCond {
  sample: string
  /** false = the user excluded this column (e.g. a QC column); dropped on convert. */
  include?: boolean
  strain: string
  cmpd: string
  dose: string
  time: string
  rep: string
}

export interface InteractiveAdapted {
  dataText: string
  /** stem ends with `_wide` so ingest detects the wide format */
  dataFilename: string
  samplesheetText: string
  dbText: string
}

type Row = Record<string, string>

/** True when most non-empty cells in a column parse as finite numbers. */
function isNumericColumn(rows: Row[], field: string, threshold = 0.8): boolean {
  let nonEmpty = 0
  let numeric = 0
  for (const r of rows) {
    const v = (r[field] ?? '').trim()
    if (v === '') continue
    nonEmpty++
    if (Number.isFinite(Number(v))) numeric++
  }
  return nonEmpty > 0 && numeric / nonEmpty >= threshold
}

/** Pick the delimiter from the header row (whichever separator occurs most): tab for a TSV/DIA-NN
 *  export, comma for a CSV, or semicolon. Counting the header is reliable — the real delimiter
 *  appears once per column there. Defaults to tab if the file is a single column. */
function detectDelimiter(text: string): string {
  const nl = text.indexOf('\n')
  const header = nl >= 0 ? text.slice(0, nl) : text
  const count = (d: string): number => header.split(d).length - 1
  const candidates: string[] = ['\t', ',', ';']
  let best = '\t'
  let bestN = -1
  for (const d of candidates) {
    const n = count(d)
    if (n > bestN) {
      bestN = n
      best = d
    }
  }
  return best
}

function parse(matrixText: string): { fields: string[]; rows: Row[] } {
  const clean = matrixText.replace(BOM, '')
  const res = Papa.parse<Row>(clean, {
    header: true,
    delimiter: detectDelimiter(clean),
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(BOM, '').trim()
  })
  return { fields: (res.meta.fields ?? []).map((f) => f.trim()), rows: res.data }
}

/** A header that looks like an MS run: a file path (either separator) or a known
 *  acquisition extension. When present this is a strong default sample-column signal and,
 *  unlike numeric density, excludes plain-named numeric QC columns. */
const RUN_HEADER = /[\\/]|\.(d|raw|mzml|mzxml|wiff|dia|htrms|tdf)$/i

/** Intensity (sample) columns, most-specific signal first:
 *   1. headers that look like run files/paths (excludes QC/annotation columns), else
 *   2. numeric-dense columns (fallback when headers are bare run names).
 *  Known annotation/count columns are always excluded. The result is reviewable in the
 *  import editor, so an odd QC column that slips through can be removed by the user. */
function sampleColumns(fields: string[], rows: Row[]): string[] {
  const candidates = fields.filter((f) => !NON_SAMPLE_COLS.has(f))
  const runLike = candidates.filter((f) => RUN_HEADER.test(f))
  if (runLike.length > 0) return runLike
  return candidates.filter((f) => isNumericColumn(rows, f))
}

/** A token boundary anchored to the closer end of the name (so it stays put when the token
 *  count changes). `n` delimiters in from that end. */
export interface Anchor {
  fromEnd: boolean
  n: number
}

/** A learned extraction rule: the value is the tokens between the `left` and `right`
 *  boundaries, joined by `delim`. Each boundary is anchored independently, so a value with
 *  an internal delimiter on some rows is still captured (the extra tokens fall in the middle),
 *  while leading/trailing fields stay pinned to their own end. */
export interface FieldRule {
  delim: string
  left: Anchor
  right: Anchor
}

function resolveAnchor(a: Anchor, tokenCount: number): number {
  return a.fromEnd ? tokenCount - a.n : a.n
}

/** Anchor a boundary at token index `edge` to whichever end is closer (ties favour start). */
function anchorEdge(edge: number, tokenCount: number): Anchor {
  const fromStart = edge
  const fromEnd = tokenCount - edge
  return fromEnd < fromStart ? { fromEnd: true, n: fromEnd } : { fromEnd: false, n: fromStart }
}

/** Derive a rule from a character selection on one sample name: the token range the selection
 *  covers, with each edge anchored from its closer end. */
export function deriveFieldRule(
  name: string,
  selStart: number,
  selEnd: number,
  delim = '_'
): FieldRule | null {
  if (selEnd <= selStart) return null
  const tokens = name.split(delim)
  const spans: Array<[number, number]> = []
  let pos = 0
  for (const t of tokens) {
    spans.push([pos, pos + t.length])
    pos += t.length + delim.length
  }
  let first = -1
  let last = -1
  for (let i = 0; i < spans.length; i++) {
    const [s, e] = spans[i]
    if (s < selEnd && e > selStart) {
      if (first < 0) first = i
      last = i
    }
  }
  if (first < 0) {
    // Selection landed entirely inside a delimiter — snap to the next token.
    const idx = spans.findIndex(([s]) => s >= selStart)
    if (idx < 0) return null
    first = idx
    last = idx
  }
  const N = tokens.length
  return { delim, left: anchorEdge(first, N), right: anchorEdge(last + 1, N) }
}

/** Apply a learned rule to a sample name (blank if the resolved range is empty/out of range). */
export function applyFieldRule(name: string, rule: FieldRule): string {
  const tokens = name.split(rule.delim)
  const l = resolveAnchor(rule.left, tokens.length)
  const r = resolveAnchor(rule.right, tokens.length)
  if (l < 0 || r > tokens.length || l >= r) return ''
  return tokens.slice(l, r).join(rule.delim)
}

/** Character span [start, end) of the region a rule selects within a name (for highlighting). */
export function fieldRuleSpan(name: string, rule: FieldRule): [number, number] | null {
  const tokens = name.split(rule.delim)
  const l = resolveAnchor(rule.left, tokens.length)
  const r = resolveAnchor(rule.right, tokens.length)
  if (l < 0 || r > tokens.length || l >= r) return null
  let start = 0
  for (let k = 0; k < l; k++) start += tokens[k].length + rule.delim.length
  let end = start
  for (let k = l; k < r; k++) end += tokens[k].length + (k < r - 1 ? rule.delim.length : 0)
  return [start, end]
}

/** How the user classifies each matrix column. Exactly one `id`, at most one `label`.
 *  `filter` columns don't appear in any output — they gate which feature ROWS are kept
 *  (by value), in the wizard's Filtering step. */
export type InteractiveRole = 'id' | 'sample' | 'label' | 'meta' | 'filter' | 'ignore'

/** Per-column row filter. Categorical columns exclude a set of values (`drop`); numeric columns
 *  constrain to a range. Empty/absent = keep every row (a no-op). `drop` (rather than a keep-list)
 *  means values the facet didn't surface stay kept by default. */
export interface FilterSpec {
  /** the column's filter is applied only when this is true (the wizard's per-tile checkbox);
   *  absent/false = the column is present but inactive (greyed, ignored). */
  active?: boolean
  /** categorical: exact values to exclude */
  drop?: string[]
  /** numeric: inclusive lower bound (null/absent = unbounded) */
  min?: number | null
  /** numeric: inclusive upper bound (null/absent = unbounded) */
  max?: number | null
}

/** Distinct-value summary of one column, for building the Filtering step's controls. */
export interface ColumnFacet {
  /** most values parse as finite numbers → offer a min/max range instead of value chips */
  numeric: boolean
  /** distinct non-empty values (sorted; capped at `cap`) */
  values: string[]
  /** true when the column has more distinct values than the cap (list is partial) */
  truncated: boolean
  /** numeric range over finite values (0/0 when none) */
  min: number
  max: number
}

/** Summarize a column's values so the Filtering step can render the right control. */
export function columnFacet(rows: Row[], col: string, cap = 200): ColumnFacet {
  const numeric = isNumericColumn(rows, col)
  const seen = new Set<string>()
  let truncated = false
  let min = Infinity
  let max = -Infinity
  for (const r of rows) {
    const v = (r[col] ?? '').trim()
    if (v === '') continue
    if (numeric) {
      const n = Number(v)
      if (Number.isFinite(n)) {
        if (n < min) min = n
        if (n > max) max = n
      }
    }
    if (seen.size < cap) seen.add(v)
    else if (!seen.has(v)) truncated = true
  }
  const values = [...seen].sort((a, b) =>
    numeric ? Number(a) - Number(b) : a.localeCompare(b, undefined, { numeric: true })
  )
  return {
    numeric,
    values,
    truncated,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0
  }
}

/** Does a feature row pass every active column filter? */
function rowPasses(row: Row, filters: Array<{ col: string; drop: Set<string>; spec: FilterSpec }>): boolean {
  for (const { col, drop, spec } of filters) {
    const raw = (row[col] ?? '').trim()
    if (drop.size > 0 && drop.has(raw)) return false
    if (spec.min != null || spec.max != null) {
      const n = Number(raw)
      if (!Number.isFinite(n)) return false
      if (spec.min != null && n < spec.min) return false
      if (spec.max != null && n > spec.max) return false
    }
  }
  return true
}

export interface MatrixInfo {
  columns: string[]
  rows: Row[]
  /** first data row per column — shown in step 1 to help identify columns */
  sample: Record<string, string>
}

/** Parse a matrix into columns + rows (no assumptions about which columns are what). */
export function parseMatrix(matrixText: string): MatrixInfo {
  const { fields, rows } = parse(matrixText)
  if (fields.length === 0) throw new Error('The file has no columns.')
  const first = rows[0] ?? {}
  const sample: Record<string, string> = {}
  for (const c of fields) sample[c] = (first[c] ?? '').trim()
  return { columns: fields, rows, sample }
}

/** Column-classification mode: `none` paints nothing (all Ignore); the rest are known upstream
 *  tools whose protein/peptide matrix has a recognisable column shape. */
export type MatrixPreset = 'none' | 'diann' | 'spectronaut' | 'maxquant'

interface PresetSpec {
  label: string
  /** candidate id columns, in preference order — the first one present wins (no fallback) */
  idCols: string[]
  /** candidate gene/label columns, in preference order */
  geneCols: string[]
  /** known annotation columns worth keeping in the ID map — the ONLY columns marked Metadata;
   *  anything not id / label / sample / meta is left Ignore for the user to promote */
  metaCols: string[]
  /** the tool's intensity (sample) columns, given the matrix shape */
  sampleCols: (fields: string[], rows: Row[]) => string[]
}

/** Per-tool column conventions used to auto-classify columns. Presets only paint what they can
 *  name: the id, the gene/label, the intensity columns, and a fixed set of known annotation
 *  columns (Metadata). Every other column is left Ignore (no id fallback, no bulk-metadata). */
const PRESETS: Record<MatrixPreset, PresetSpec> = {
  none: { label: 'None', idCols: [], geneCols: [], metaCols: [], sampleCols: () => [] },
  diann: {
    label: 'DIA-NN',
    idCols: [ID_COL, 'Protein.Ids'],
    geneCols: [GENE_COL],
    metaCols: ['Protein.Ids', 'Protein.Names', DESC_COL],
    // Run columns are file paths / acquisition files, else numeric-dense (see sampleColumns).
    sampleCols: (fields, rows) => sampleColumns(fields, rows)
  },
  spectronaut: {
    label: 'Spectronaut',
    idCols: ['PG.ProteinGroups', 'PG.ProteinAccessions', 'PG.UniProtIds'],
    geneCols: ['PG.Genes'],
    metaCols: [
      'PG.ProteinAccessions',
      'PG.ProteinNames',
      'PG.ProteinDescriptions',
      'PG.UniProtIds',
      'PG.Organisms'
    ],
    // Pivot report quantity columns end in `.PG.Quantity` (or reference a raw/htrms run file).
    sampleCols: (fields) => fields.filter((f) => /PG\.(?:MS2)?Quantity$|\.(?:raw|htrms|d)$/i.test(f))
  },
  maxquant: {
    label: 'MaxQuant',
    idCols: ['Protein IDs', 'Majority protein IDs'],
    geneCols: ['Gene names'],
    metaCols: ['Majority protein IDs', 'Protein names', 'Fasta headers'],
    // proteinGroups.txt intensity columns: prefer LFQ, else raw Intensity, else iBAQ. The bare
    // summary columns ("Intensity", "iBAQ") lack the trailing sample name, so the space excludes them.
    sampleCols: (fields) => {
      for (const re of [/^LFQ intensity /i, /^Intensity /i, /^iBAQ /i]) {
        const hit = fields.filter((f) => re.test(f))
        if (hit.length > 0) return hit
      }
      return []
    }
  }
}

/** Presets offered in the import wizard (value + display label), in menu order. */
export const MATRIX_PRESETS: { value: MatrixPreset; label: string }[] = (
  Object.keys(PRESETS) as MatrixPreset[]
).map((value) => ({ value, label: PRESETS[value].label }))

/** Editable role guess for a given tool preset: the tool's intensity columns → sample, its id /
 *  gene columns (or a text/gene-ish fallback) → id / label, everything else → metadata. */
export function guessRolesPreset(
  info: MatrixInfo,
  preset: MatrixPreset
): Record<string, InteractiveRole> {
  const roles: Record<string, InteractiveRole> = {}
  // `none` leaves everything unclassified (no id/label fallback) — the user paints manually.
  if (preset === 'none') {
    for (const c of info.columns) roles[c] = 'ignore'
    return roles
  }
  const spec = PRESETS[preset]
  const samples = new Set(spec.sampleCols(info.columns, info.rows))
  const rest = info.columns.filter((c) => !samples.has(c))
  const firstPresent = (names: string[]): string | undefined =>
    names.find((n) => rest.includes(n))
  // id only from a known column (no "first leftover" fallback); label falls back to a gene-ish
  // name; metadata is ONLY the preset's known annotation columns — everything else stays Ignore.
  const idCol = firstPresent(spec.idCols)
  const labelCol =
    firstPresent(spec.geneCols) ?? rest.find((c) => /gene/i.test(c) && c !== idCol)
  const metaSet = new Set(spec.metaCols)
  for (const c of info.columns) {
    roles[c] = samples.has(c)
      ? 'sample'
      : c === idCol
        ? 'id'
        : c === labelCol
          ? 'label'
          : metaSet.has(c)
            ? 'meta'
            : 'ignore'
  }
  return roles
}

/** Default (DIA-NN) role guess — the zero-config entry point used before a preset is picked. */
export function guessRoles(info: MatrixInfo): Record<string, InteractiveRole> {
  return guessRolesPreset(info, 'diann')
}

/** Columns of a given role, in matrix order. */
export function colsWithRole(
  columns: string[],
  roles: Record<string, InteractiveRole>,
  role: InteractiveRole
): string[] {
  return columns.filter((c) => roles[c] === role)
}

/** Build the three standard inputs from the user's column roles + per-sample conditions.
 *  Sample IDs are the raw column headers; the `label` column becomes the DB `gene` (display name)
 *  column — or, when no Name column was assigned, the UniProt-fetched gene name if annotations
 *  were fetched. */
export function buildStandardInputs(
  matrixText: string,
  spec: {
    roles: Record<string, InteractiveRole>
    conditions: Record<string, InteractiveSampleCond>
    /** per-column row filters, keyed by matrix header (only `filter`-role columns apply) */
    filters?: Record<string, FilterSpec>
    /** fetched external annotations to append to the DB, keyed by the uniqID (trimmed ID value):
     *  `fields` are the extra column names, `byId[uniqID][field]` the value. `taxon` (if set) is
     *  written as a hidden per-row `taxon` DB column so the STRING plot can learn the species. */
    annotations?: { fields: string[]; byId: Record<string, Record<string, string>>; taxon?: number }
  }
): InteractiveAdapted {
  const { columns, rows: allRows } = parseMatrix(matrixText)
  const { roles, conditions } = spec
  const idCol = colsWithRole(columns, roles, 'id')[0] ?? null
  const labelCol = colsWithRole(columns, roles, 'label')[0] ?? null
  const metaCols = colsWithRole(columns, roles, 'meta')
  const sampleCols = colsWithRole(columns, roles, 'sample').filter(
    (sc) => conditions[sc]?.include !== false
  )
  if (!idCol) throw new Error('Pick an ID column in step 1.')
  if (sampleCols.length === 0) throw new Error('Pick at least one sample column in step 1.')

  // Drop feature rows that fail any active filter column (a column classified `filter` with a
  // value/range constraint). Columns whose role isn't `filter` are ignored even if a stale spec
  // lingers in config.
  const activeFilters = colsWithRole(columns, roles, 'filter')
    .filter((c) => spec.filters?.[c]?.active)
    .map((c) => ({ col: c, spec: spec.filters![c], drop: new Set(spec.filters![c].drop ?? []) }))
  const rows = activeFilters.length > 0 ? allRows.filter((r) => rowPasses(r, activeFilters)) : allRows

  // data (wide): uniqID + one column per sample (raw header names).
  const dataRows = rows.map((r) => {
    const out: Row = { uniqID: (r[idCol] ?? '').trim() }
    for (const sc of sampleCols) out[sc] = r[sc] ?? ''
    return out
  })
  const dataText = Papa.unparse(dataRows, { columns: ['uniqID', ...sampleCols] })

  // db: uniqID + gene (from the label column) + the other metadata columns + fetched annotations.
  // The dataset species (taxon) rides along as a hidden per-row column when known.
  const annFields = spec.annotations?.fields ?? []
  const annById = spec.annotations?.byId ?? {}
  const annTaxon = spec.annotations?.taxon
  const dbCols = ['uniqID', 'gene', ...metaCols, ...annFields, ...(annTaxon ? ['taxon'] : [])]
  const dbRows = rows.map((r) => {
    const uniqID = (r[idCol] ?? '').trim()
    const ann = annById[uniqID]
    // Display name (DB `gene`) priority: the user's Name column value, else — when no Name column
    // was assigned, or the cell is blank — the UniProt-fetched gene name (annotation `geneName`).
    // Still empty ⇒ ingest falls back to locus_tag, then the ID.
    const labelVal = labelCol ? (r[labelCol] ?? '').trim() : ''
    const out: Row = { uniqID, gene: labelVal || (ann?.geneName ?? '').trim() }
    for (const c of metaCols) out[c] = (r[c] ?? '').trim()
    for (const f of annFields) out[f] = ann?.[f] ?? ''
    if (annTaxon) out.taxon = String(annTaxon)
    return out
  })
  const dbText = Papa.unparse(dbRows, { columns: dbCols })

  // samplesheet: sample (raw header) + conditions.
  const ssRows = sampleCols.map((sc) => {
    const c = conditions[sc]
    return {
      sample: sc,
      strain: c?.strain ?? '',
      cmpd: c?.cmpd ?? '',
      dose: c?.dose ?? '',
      time: c?.time ?? '',
      rep: c?.rep ?? ''
    }
  })
  const samplesheetText = Papa.unparse(ssRows, {
    columns: ['sample', 'strain', 'cmpd', 'dose', 'time', 'rep']
  })

  return { dataText, dataFilename: 'interactive_wide.csv', samplesheetText, dbText }
}
