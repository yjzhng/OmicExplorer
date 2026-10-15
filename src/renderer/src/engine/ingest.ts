/**
 * Ingest + standardization: raw CSVs → tidy StandardTable.
 *
 * Reimplements the concept of omicViz scripts/ingest/{readers,standardize}.py
 * (format detection, well/sample alignment, samplesheet metadata merge, optional
 * ID mapping) — see [[omicviz-conceptual-reuse]]. Not a code port.
 */
import Papa from 'papaparse'

import type { SampleConds, StandardizeInput, StandardizeResult, StandardRow } from './types'
import {
  condsIn,
  customCond,
  customSlug,
  isCustomCond,
  RESERVED_COND_NAMES,
  validCondName,
  VALID_CONDITIONS,
  type ConditionKey
} from './types'
import { COLUMN_ALIASES, groupMembers, matchKey, pairsOf, unionRecords } from './accession'
import { condPresent } from './compare'
import { imputeMissing } from './impute'
import { normalizeSamples } from './normalize'
import {
  detectScale,
  histogram,
  outputScale,
  sampleValues,
  toLinear,
  type ScaleEvidence,
  type ValueScale
} from './scale'

type Row = Record<string, string>

const BOM = /^\uFEFF/

/** Parse CSV text into row objects, stripping a leading BOM. */
function parseCsv(text: string): { rows: Row[]; fields: string[] } {
  const clean = text.replace(BOM, '')
  const res = Papa.parse<Row>(clean, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.replace(BOM, '').trim()
  })
  return { rows: res.data, fields: (res.meta.fields ?? []).map((f) => f.replace(BOM, '').trim()) }
}

/** Wide or long, from the data file's columns: a long file carries a `value` column beside a
 *  `sample` column; anything else is a wide matrix. A legacy `_wide` /
 *  `_long` filename stem still decides outright, so older projects read as before. */
function detectFormat(filename: string, fields: string[]): 'wide' | 'long' {
  const stem = filename.replace(/\.[^.]+$/, '')
  if (stem.endsWith('_wide')) return 'wide'
  if (stem.endsWith('_long')) return 'long'
  return fields.includes('sample') && fields.includes('value') ? 'long' : 'wide'
}

/** Coerce a cell to a finite number, or null for blank/non-numeric. */
function num(v: string | undefined | null): number | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** A MEASURED value: as `num`, but 0 is missing too. Search engines write an unquantified protein
 *  as 0 (MaxQuant LFQ) as often as blank / NA / NaN, and all of them mean "not measured" — read as
 *  a real 0 it would count as present in the clean-up, escape imputation, and become −∞ on a log.
 *  Measured values only: a samplesheet's dose 0 (the vehicle) is a real 0. */
function measured(v: string | undefined | null): number | null {
  const n = num(v)
  return n === 0 ? null : n
}

/** Read the samplesheet: lowercase headers; its `sample` column names each sample.
 *  `strain` (the pre-rename name of the `cell` condition) is accepted as an alias so older
 *  samplesheets keep working; `cell` wins when both are present. */
function readSamplesheet(text: string): Row[] {
  const { rows, fields } = parseCsv(text)
  if (!fields.some((f) => f.toLowerCase() === 'sample'))
    throw new Error("Samplesheet: needs a 'sample' column naming each sample.")
  return rows.map((r) => {
    const lower: Row = {}
    for (const [k, v] of Object.entries(r)) lower[k.trim().toLowerCase()] = v
    if (lower.cell == null && lower.strain != null) lower.cell = lower.strain
    return lower
  })
}

/** A samplesheet problem that blocks an import: a condition in use left empty for some samples,
 *  or a dose / time that isn't a number. */
export interface SheetIssue {
  field: string
  kind: 'empty' | 'notNumber'
  /** notNumber: the offending values, each with the samples carrying it */
  values: Array<{ value: string; samples: string[] }>
  /** empty: the samples missing it */
  samples: string[]
}

/** The condition fields every sample must fill once any sample uses them (rep may stay empty —
 *  it's numbered automatically). */
const SHEET_FIELDS = ['cell', 'cmpd', 'dose', 'time'] as const
/** Dose and time must be numbers (a vehicle's dose is 0, not its name). */
const NUMERIC_FIELDS = new Set<string>(['dose', 'time'])

/**
 * What blocks a samplesheet, for the import's gate and the run's error alike: every condition in
 * use — cell, cmpd, dose, time and the custom ones, wherever ANY sample has a value — must have a
 * value for every sample, and dose and time must be numbers. A condition no sample uses is simply
 * absent, and fine. `rows` are the included samples, keyed by field name (custom ones by theirs).
 */
export function samplesheetIssues(
  rows: Array<{ sample: string } & Record<string, unknown>>,
  custom: string[] = []
): SheetIssue[] {
  const text = (v: unknown): string => (v == null ? '' : String(v).trim())
  const issues: SheetIssue[] = []
  for (const field of [...SHEET_FIELDS, ...custom]) {
    if (!rows.some((r) => text(r[field]) !== '')) continue
    const empty = rows.filter((r) => text(r[field]) === '').map((r) => r.sample)
    if (empty.length) issues.push({ field, kind: 'empty', values: [], samples: empty })
    if (!NUMERIC_FIELDS.has(field)) continue
    const bad = new Map<string, string[]>()
    for (const r of rows) {
      const v = text(r[field])
      if (v === '' || Number.isFinite(Number(v))) continue
      const a = bad.get(v)
      if (a) a.push(r.sample)
      else bad.set(v, [r.sample])
    }
    if (bad.size)
      issues.push({
        field,
        kind: 'notNumber',
        values: [...bad].map(([value, samples]) => ({ value, samples })),
        samples: []
      })
  }
  return issues
}

/** A manual samplesheet checked as the run will check it, for a warning before any run: whether it
 *  lacks the `sample` column (the run's hard stop), else its issues (samplesheetIssues) over the
 *  samples the data file carries — all of the sheet's when the data isn't given — with its custom
 *  conditions detected as the run detects them. */
export function manualSheetIssues(
  sheetText: string,
  dataText?: string | null,
  dataFilename?: string | null
): { noSample: boolean; issues: SheetIssue[] } {
  let ss: Row[]
  try {
    ss = readSamplesheet(sheetText)
  } catch {
    return { noSample: true, issues: [] }
  }
  let inData: Set<string> | null = null
  if (dataText && dataFilename) {
    const parsed = parseCsv(dataText)
    inData =
      detectFormat(dataFilename, parsed.fields) === 'wide'
        ? new Set(parsed.fields.slice(1))
        : new Set(parsed.rows.map((r) => String(r.sample ?? '')))
  }
  const rows = ss
    .filter((r) => r.sample != null && r.sample !== '' && (!inData || inData.has(String(r.sample))))
    .map((r) => ({ ...r, sample: String(r.sample) }))
  return { noSample: false, issues: samplesheetIssues(rows, detectCustomConditions(ss)) }
}

/** A samplesheet issue in a line: which field, what's wrong, and a few of the samples — at most
 *  three samples, and three bad values, so a large sheet still gives a short line. */
export function sheetIssueText(i: SheetIssue): string {
  const few = (a: string[]): string =>
    `${a.length} sample${a.length === 1 ? '' : 's'}: ${a.slice(0, 3).join(', ')}${a.length > 3 ? ', …' : ''}`
  if (i.kind === 'empty') return `${i.field} is empty for ${few(i.samples)}`
  const shown = i.values.slice(0, 3).map((v) => `“${v.value}” (${few(v.samples)})`)
  const more = i.values.length > 3 ? `; +${i.values.length - 3} more values` : ''
  return `${i.field} must be a number — ${shown.join('; ')}${more}`
}

/** The issues as lines to show, at most `max` of them, the rest counted in a last line — so a sheet
 *  with many broken columns stays readable. */
export function sheetIssueLines(issues: SheetIssue[], max = 5): string[] {
  const lines = issues.slice(0, max).map(sheetIssueText)
  if (issues.length > max) lines.push(`+${issues.length - max} more issues`)
  return lines
}

/** Which samplesheet columns to read as custom conditions when the caller didn't say.
 *
 *  A column qualifies when its name is a usable condition name, it carries at least one value, and
 *  it GROUPS the samples rather than identifying them — fewer distinct values than samples. That
 *  last test is what keeps a free-text `notes` or `acquired_at` column, unique per sample, from
 *  silently becoming a condition axis with one level per sample. */
export function detectCustomConditions(ss: Row[]): string[] {
  if (ss.length === 0) return []
  const names = [...new Set(ss.flatMap((r) => Object.keys(r)))].filter(validCondName)
  return names.filter((n) => {
    const vals = new Set<string>()
    for (const r of ss) {
      const v = String(r[n] ?? '').trim()
      if (v !== '') vals.add(v)
    }
    return vals.size > 0 && vals.size < ss.length
  })
}

/** The DB column the data's feature IDs are matched against: one of the same name as a data
 *  column, else the DB's `uniqID` — so a data file's `UniProtIDs` (a search engine's IDs, groups
 *  and all) matches a DB keyed one protein per row by `uniqID`. */
function detectIdColumn(
  fields: string[],
  dbFields: string[],
  customConds: string[] = []
): string | null {
  const nonId = new Set([...RESERVED_COND_NAMES, 'gene_label', ...customConds])
  const dbSet = new Set(dbFields)
  const shared = fields.find((c) => !nonId.has(c) && dbSet.has(c))
  return shared ?? (dbSet.has('uniqID') ? 'uniqID' : null)
}

/** The DB, indexed for matching data feature IDs: `matchKey` of each row's ID-column value → the
 *  rows carrying it. Matching is always on canonical accessions (see accession.ts), so a data ID
 *  `Q9ULV3-5` finds a DB keyed `Q9ULV3`, and a protein group finds each of its members' rows
 *  (an import DB has one row per protein). */
interface DbIndex {
  byKey: Map<string, Row[]>
  /** non-structural DB columns carried through as per-feature annotation (GO, KEGG, …): each
   *  DB column (`from`) and the name it's carried as (`as` — a COLUMN_ALIASES rename, else itself) */
  annCols: { from: string; as: string }[]
}

function buildDbIndex(dbRows: Row[], dbFields: string[], idColumn: string): DbIndex {
  const byKey = new Map<string, Row[]>()
  for (const raw of dbRows) {
    // uniqID is optional: a DB without it (or a blank cell) uses the ID column's own value.
    const own = (raw.uniqID ?? '').trim()
    const r = own ? raw : { ...raw, uniqID: (raw[idColumn] ?? '').trim() }
    if (r.uniqID === '') continue
    const key = matchKey(r[idColumn] ?? '')
    if (!key) continue
    const arr = byKey.get(key)
    if (arr) arr.push(r)
    else byKey.set(key, [r])
  }
  // uniqID and the ID column are structural; gene/locus drive the display label (`locus_tag` is
  // the older name of `locus`).
  const skip = new Set([idColumn, 'uniqID', 'gene', 'locus', 'locus_tag'])
  const fields = new Set(dbFields)
  const annCols = dbFields
    .filter((f) => !skip.has(f))
    .map((from) => ({ from, as: COLUMN_ALIASES[from] ?? from }))
    // an alias gives way to a real column of the new name, and to an earlier alias of it
    .filter((c, i, all) =>
      c.as === c.from ? true : !fields.has(c.as) && all.findIndex((d) => d.as === c.as) === i
    )
  return { byKey, annCols }
}

/** The DB rows a data feature ID matches: the whole ID (a group written the same way), and each of
 *  its member proteins on its own (a DB keyed per accession). */
function dbRowsFor(index: DbIndex, id: string): Row[] {
  const out = new Set<Row>()
  for (const k of new Set([matchKey(id), ...groupMembers(id)]))
    for (const r of index.byKey.get(k) ?? []) out.add(r)
  return [...out]
}

/**
 * Display labels and annotations for the features that made it through Clean data — and only those:
 * the gene selector lists exactly what was measured. A feature's label is its DB rows' distinct gene
 * names joined by "/" (a protein group reads `HDAC1/HDAC2`), else its locus (systematic name), else
 * its ID. Its annotation is the UNION of its rows' (see accession.ts): a group belongs to every
 * pathway, term and class any of its members does.
 */
function featureLabels(
  featureIds: Iterable<string>,
  rowsOf: (uid: string) => Row[],
  annCols: { from: string; as: string }[]
): { displayMap: Record<string, string>; annotationMap: Record<string, Record<string, string>> } {
  const displayMap: Record<string, string> = {}
  const annotationMap: Record<string, Record<string, string>> = {}
  const distinct = (rows: Row[], col: string): string[] => [
    ...new Set(
      rows.flatMap((r) =>
        (r[col] ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
      )
    )
  ]
  for (const uid of featureIds) {
    const rows = rowsOf(uid)
    const genes = distinct(rows, 'gene')
    const loci = distinct(rows, 'locus').length
      ? distinct(rows, 'locus')
      : distinct(rows, 'locus_tag')
    displayMap[uid] = genes.length ? genes.join('/') : loci.length ? loci.join('/') : uid
    if (annCols.length) {
      const rec = unionRecords(
        rows.map((r) => Object.fromEntries(annCols.map((c) => [c.as, (r[c.from] ?? '').trim()])))
      )
      if (rec) annotationMap[uid] = rec
    }
  }
  // Disambiguate duplicate labels: when two features map to the SAME display name, append their
  // uniqID so every plot's gene label stays distinguishable (unique names are left untouched).
  const nameCount = new Map<string, number>()
  for (const uid in displayMap)
    nameCount.set(displayMap[uid], (nameCount.get(displayMap[uid]) ?? 0) + 1)
  for (const uid in displayMap) {
    if (displayMap[uid] !== uid && (nameCount.get(displayMap[uid]) ?? 0) > 1)
      displayMap[uid] = `${displayMap[uid]} (${uid})`
  }
  return { displayMap, annotationMap }
}

/** The data scale of a data file, before any run: the scale its values look to be on, what that
 *  was judged from, and a sample of the values for a preview histogram. Reads the same values
 *  Clean data's run judges from (arrivedValues), so the two always agree. */
export interface ScalePreview {
  inputScale: ValueScale
  evidence: ScaleEvidence
  sample: number[]
}
export function previewScale(dataText: string, dataFilename: string): ScalePreview {
  const parsed = parseCsv(dataText)
  const values = arrivedValues(
    detectFormat(dataFilename, parsed.fields),
    parsed.fields,
    parsed.rows
  )
  const { scale, evidence } = detectScale(values)
  return { inputScale: scale, evidence, sample: sampleValues(values) }
}

/** Every numeric data value in a parsed data file, as it arrived: a wide file's sample columns
 *  (all but the first, the id), or a long file's `value` column. */
function arrivedValues(
  fmt: ReturnType<typeof detectFormat>,
  fields: string[],
  rows: Row[]
): number[] {
  const out: number[] = []
  const cols = fmt === 'wide' ? fields.slice(1) : ['value']
  for (const r of rows)
    for (const c of cols) {
      const n = measured(r[c])
      if (n != null) out.push(n)
    }
  return out
}

/**
 * Full standardization pipeline. Produces the tidy long table and a display map.
 */
export function standardize(input: StandardizeInput): StandardizeResult {
  const parsed = parseCsv(input.dataText)
  const fmt = detectFormat(input.dataFilename, parsed.fields)
  let fields = parsed.fields
  let dataRows = parsed.rows
  // The values as they arrived — what the data scale is judged from (the same set previewScale
  // reads, so the settings' preview and the run agree).
  const arrived = arrivedValues(fmt, fields, dataRows)

  // ── wide → long melt ─────────────────────────────────────────────────────────
  if (fmt === 'wide') {
    const idCol = fields[0]
    const sampleCols = fields.slice(1)
    const melted: Row[] = []
    for (const r of dataRows) {
      for (const sc of sampleCols) melted.push({ [idCol]: r[idCol], sample: sc, value: r[sc] })
    }
    dataRows = melted
    fields = [idCol, 'sample', 'value']
  } else if (!fields.includes('sample')) {
    throw new Error("Data file: a long file needs a 'sample' column naming each sample.")
  }

  // ── samplesheet: sample → conditions + rep ──────────────────────────────────
  const ss = readSamplesheet(input.samplesheetText)
  // Custom condition columns: what the caller declared (the interactive import knows exactly what
  // the user defined), else auto-detected from the sheet. readSamplesheet lowercases headers, so
  // declared names are matched in lower case too.
  const customConds = (
    input.customConditions?.map((n) => n.trim().toLowerCase()).filter(validCondName) ??
    detectCustomConditions(ss)
  ).filter((n) => ss.some((r) => String(r[n] ?? '').trim() !== ''))
  const ssBySample = new Map<string, Row>()
  for (const r of ss) if (r.sample != null) ssBySample.set(String(r.sample), r)
  const validSamples = new Set(ssBySample.keys())
  // The samplesheet must be complete for the samples the data carries: every condition in use
  // filled, dose and time numbers — else the import stops here, with what to fix.
  {
    const inData = new Set(dataRows.map((r) => String(r.sample ?? '')))
    const issues = samplesheetIssues(
      ss
        .filter((r) => r.sample != null && inData.has(String(r.sample)))
        .map((r) => ({ ...r, sample: String(r.sample) })),
      customConds
    )
    if (issues.length) throw new Error(`Samplesheet: ${sheetIssueLines(issues).join(' · ')}.`)
  }

  // ── filter to samplesheet samples, then attach metadata ─────────────────────
  const idColData = fields.find((f) => f !== 'sample' && f !== 'value') ?? fields[0]
  interface Merged {
    id: string
    sample: string
    value: number | null
    cell: string
    cmpd: string
    dose: number | null
    time: number | null
    rep: number | null
    /** custom condition slug → value, for the columns resolved above */
    extra: Record<string, string>
    peptides: number | null
  }
  const merged: Merged[] = []
  for (const r of dataRows) {
    const sample = String(r.sample ?? '')
    if (!validSamples.has(sample)) continue
    const meta = ssBySample.get(sample)!
    merged.push({
      id: String(r[idColData] ?? '').trim(),
      sample,
      value: measured(r.value),
      cell: meta.cell ?? '',
      cmpd: meta.cmpd ?? '',
      dose: num(meta.dose),
      time: num(meta.time),
      rep: num(meta.rep),
      extra: Object.fromEntries(customConds.map((c) => [c, String(meta[c] ?? '').trim()])),
      peptides: num(r.peptides)
    })
  }

  // ── replicate numbering ─────────────────────────────────────────────────────
  // Replicates are distinguished downstream (cluster/heatmap pivots) by (condition, rep). When
  // the samplesheet doesn't carry a `rep`, two replicate samples of one condition are otherwise
  // indistinguishable and collapse into one point/column. So auto-number distinct samples within
  // each condition by first appearance; an explicit rep is always kept.
  const repOf = new Map<string, number>()
  {
    const perCond = new Map<string, number>()
    const seen = new Set<string>()
    for (const m of merged) {
      if (seen.has(m.sample)) continue
      seen.add(m.sample)
      // Custom conditions join the key: two samples differing only in one are distinct
      // conditions, not replicates of a single one.
      const condKey = [
        m.cell,
        m.cmpd,
        m.dose ?? '',
        m.time ?? '',
        ...customConds.map((c) => m.extra[c])
      ].join('')
      const n = (perCond.get(condKey) ?? 0) + 1
      perCond.set(condKey, n)
      repOf.set(m.sample, m.rep != null ? m.rep : n)
    }
  }

  // ── optional ID mapping (feature ID → uniqID) ───────────────────────────────
  // Each data feature keeps its own ID — a protein group stays ONE feature, as it was measured. A
  // single-protein feature takes its DB row's uniqID instead (a UniProtID-keyed data file mapped
  // to locus-tag uniqIDs), as long as that uniqID is its own: two features folding to one entry
  // (separate isoform groups) stay apart rather than merging two measurements into one gene.
  let dbIndex: DbIndex | null = null
  if (input.dbText) {
    const db = parseCsv(input.dbText)
    const idCol = detectIdColumn([idColData], db.fields, customConds)
    if (idCol) dbIndex = buildDbIndex(db.rows, db.fields, idCol)
  }
  const dbRowsByFeature = new Map<string, Row[]>()
  const uniqOf = new Map<string, string>()
  if (dbIndex) {
    const index = dbIndex
    const matched = new Map<string, Row[]>()
    const claims = new Map<string, number>()
    const proposed = new Map<string, string>()
    for (const id of new Set(merged.map((m) => m.id))) {
      let rows = dbRowsFor(index, id)
      // A single protein the DB lists under several uniqIDs (one accession, two loci) takes the
      // last, as the ID lookup always has (and omicViz does).
      const single = groupMembers(id).length <= 1
      const uid = single && rows.length ? (rows[rows.length - 1].uniqID ?? '').trim() : id
      if (uid !== id) rows = rows.filter((r) => (r.uniqID ?? '').trim() === uid)
      matched.set(id, rows)
      proposed.set(id, uid)
      claims.set(uid, (claims.get(uid) ?? 0) + 1)
    }
    for (const [id, uid] of proposed) {
      const own = uid === id || claims.get(uid) === 1 ? uid : id
      uniqOf.set(id, own)
      const prev = dbRowsByFeature.get(own)
      const rows = matched.get(id) ?? []
      dbRowsByFeature.set(own, prev ? [...new Set([...prev, ...rows])] : rows)
    }
  }

  let rows: StandardRow[] = []
  // Per-gene presence: the distinct samples in which a uniqID has a non-null value.
  // Used by the optional low-coverage clean-up below.
  const presence = new Map<string, Set<string>>()
  const allSamples = new Set<string>()
  // sample → its clean-up group (the tuple of the `minSamplePctBy` conditions), so within-group
  // coverage can be computed from `presence` in the clean-up below. '' when pooling everything.
  const knownConds = new Set<ConditionKey>([...VALID_CONDITIONS, ...customConds.map(customCond)])
  const groupBy = (input.minSamplePctBy ?? []).filter((c) => knownConds.has(c))
  const groupOf = (m: Merged): string =>
    groupBy
      .map((c) =>
        isCustomCond(c)
          ? m.extra[customSlug(c)]
          : String((m as unknown as Record<string, unknown>)[c] ?? '')
      )
      .join('¦')
  const sampleGroup = new Map<string, string>()
  const samples: SampleConds[] = []
  for (const m of merged) {
    if (!allSamples.has(m.sample))
      samples.push({
        sample: m.sample,
        cell: m.cell,
        cmpd: m.cmpd,
        dose: m.dose,
        time: m.time,
        rep: repOf.get(m.sample) ?? m.rep,
        ...(customConds.length ? { extra: m.extra } : null)
      })
    allSamples.add(m.sample)
    if (!sampleGroup.has(m.sample)) sampleGroup.set(m.sample, groupOf(m))
    const uniqID = uniqOf.get(m.id) ?? m.id
    if (m.value != null) {
      let s = presence.get(uniqID)
      if (!s) presence.set(uniqID, (s = new Set()))
      s.add(m.sample)
    }
    rows.push({
      uniqID,
      cell: m.cell,
      cmpd: m.cmpd,
      dose: m.dose,
      time: m.time,
      rep: repOf.get(m.sample) ?? m.rep,
      ...(customConds.length ? { extra: m.extra } : null),
      value: m.value,
      peptides: m.peptides
    })
  }

  // ── data scale: detect what the values arrived on and convert them to linear ─────────────
  // Everything after this (clean-up, imputation, every downstream step) works on linear values, so
  // already-logged input is analysed correctly; the chosen log-transform only sets the scale the
  // result is presented on (see scale.ts / presentStd).
  const { scale: inputScale, evidence: scaleEvidence } = detectScale(arrived)
  const inputHistogram = histogram(sampleValues(arrived))
  if (inputScale !== 'linear')
    rows = rows.map((r) => (r.value == null ? r : { ...r, value: toLinear(r.value, inputScale) }))

  // ── clean-up: drop low-coverage genes (identified in < minSamplePct of samples) ──
  // Pooled mode (no grouping conditions) measures coverage over every sample and drops the gene
  // when it's below threshold. Grouped mode measures coverage WITHIN each group — samples sharing
  // the chosen conditions' values (e.g. per cell, or per cell × dose) — and drops the gene only
  // when it falls short in EVERY group. A gene that clears the bar in any one group is kept whole,
  // values in the other groups included: absent there may just mean below the detection limit
  // (a real biological difference), not a bad identification.
  const sampleCount = allSamples.size
  const minSamplePct = Math.min(100, Math.max(0, input.minSamplePct ?? 0))
  const grouped = groupBy.length > 0
  let droppedGenes = 0
  if (minSamplePct > 0 && sampleCount > 0) {
    const dropped = new Set<string>()
    if (grouped) {
      // Distinct samples per group (the denominators), and per-(gene, group) hit counts.
      const groupTotal = new Map<string, number>()
      for (const g of sampleGroup.values()) groupTotal.set(g, (groupTotal.get(g) ?? 0) + 1)
      const hitsByGene = new Map<string, Map<string, number>>()
      for (const [uniqID, samples] of presence) {
        const perGroupHits = new Map<string, number>()
        for (const s of samples) {
          const g = sampleGroup.get(s) ?? ''
          perGroupHits.set(g, (perGroupHits.get(g) ?? 0) + 1)
        }
        hitsByGene.set(uniqID, perGroupHits)
      }
      // A (gene, group) clears when its coverage within that group reaches the threshold.
      const clears = (uniqID: string, g: string): boolean => {
        const total = groupTotal.get(g) ?? 0
        const hits = hitsByGene.get(uniqID)?.get(g) ?? 0
        return total > 0 && (hits / total) * 100 >= minSamplePct
      }
      // Kept iff it clears in at least one group; a gene with no value anywhere isn't in
      // `presence` and so is dropped.
      const groups = [...groupTotal.keys()]
      const geneIds = new Set(rows.map((r) => r.uniqID))
      for (const uniqID of geneIds) {
        if (!groups.some((g) => clears(uniqID, g))) dropped.add(uniqID)
      }
    } else {
      for (const [uniqID, samples] of presence) {
        if ((samples.size / sampleCount) * 100 < minSamplePct) dropped.add(uniqID)
      }
      // A uniqID with no non-null value anywhere never enters `presence`; treat it as 0%.
      for (const r of rows) if (!presence.has(r.uniqID)) dropped.add(r.uniqID)
    }
    if (dropped.size > 0) {
      droppedGenes = dropped.size
      rows = rows.filter((r) => !dropped.has(r.uniqID))
    }
  }

  // ── normalisation: median-centre the samples (and their spread), on the kept genes ──
  // Before imputation, which draws each gap from its sample's distribution — so that draws from
  // an under-loaded sample aren't pushed further down than the normalised values beside them.
  let normalization: StandardizeResult['normalization']
  if (input.normalize) {
    const res = normalizeSamples(rows, input.normalize)
    rows = res.rows
    normalization = res.summary
  }

  // ── imputation: fill what's still missing after clean-up ─────────────────────
  let imputation: StandardizeResult['imputation']
  if (input.impute) {
    const res = imputeMissing(rows, input.impute)
    rows = res.rows
    imputation = res.summary
  }

  // ── which conditions are active (present with any non-empty value) ──────────
  const requested = input.activeConditions ?? condsIn(rows)
  const activeConditions = requested.filter((c) => condPresent(rows, c))

  const compounds = [...new Set(rows.map((r) => r.cmpd).filter((c) => c !== ''))].sort()

  const { displayMap, annotationMap } = featureLabels(
    new Set(rows.map((r) => r.uniqID)),
    (uid) => dbRowsByFeature.get(uid) ?? [],
    dbIndex?.annCols ?? []
  )

  return {
    rows,
    samples,
    displayMap,
    annotationMap,
    // Pathway → pathway category: from the data's own aligned KEGG / KEGG_cat columns, over any
    // map an older import handed over.
    keggCategories: { ...input.keggCategories, ...pairsOf(annotationMap, 'KEGG', 'KEGG_cat') },
    activeConditions,
    compounds,
    cleanup: { droppedGenes, sampleCount, minSamplePct, ...(grouped ? { by: groupBy } : {}) },
    ...(normalization ? { normalization } : {}),
    ...(imputation ? { imputation } : {}),
    scale: outputScale(input.logTransform, inputScale),
    inputScale,
    scaleEvidence,
    inputHistogram
  }
}
