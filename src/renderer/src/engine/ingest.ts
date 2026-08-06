/**
 * Ingest + standardization: raw CSVs → tidy StandardTable.
 *
 * Reimplements the concept of omicViz scripts/ingest/{readers,standardize}.py
 * (format detection, well/sample alignment, samplesheet metadata merge, optional
 * ID mapping) — see [[omicviz-conceptual-reuse]]. Not a code port.
 */
import Papa from 'papaparse'

import type { StandardizeInput, StandardizeResult, StandardRow } from './types'
import { VALID_CONDITIONS } from './types'

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

function detectFormat(filename: string): 'wide' | 'long' {
  const stem = filename.replace(/\.[^.]+$/, '')
  if (stem.endsWith('_wide')) return 'wide'
  if (stem.endsWith('_long')) return 'long'
  throw new Error(
    `Cannot detect format from filename '${filename}'. The stem must end with '_wide' or '_long'.`
  )
}

/** Coerce a cell to a finite number, or null for blank/non-numeric. */
function num(v: string | undefined | null): number | null {
  if (v == null) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Read the samplesheet: lowercase headers, synthesize `sample` from well/position/plate. */
function readSamplesheet(text: string): Row[] {
  const { rows } = parseCsv(text)
  return rows.map((r) => {
    const lower: Row = {}
    for (const [k, v] of Object.entries(r)) lower[k.trim().toLowerCase()] = v
    if (lower.sample == null || lower.sample === '') {
      if (lower.position != null && lower.position !== '') lower.sample = String(lower.position)
      else if (lower.plate != null && lower.well != null)
        lower.sample = `${lower.plate}_${lower.well}`
      else if (lower.well != null) lower.sample = String(lower.well)
    }
    return lower
  })
}

/** Detect the feature-ID column by matching a data column name to a DB column name. */
function detectIdColumn(fields: string[], dbFields: string[]): string | null {
  const nonId = new Set([
    'position',
    'value',
    'sample',
    'rep',
    'strain',
    'cmpd',
    'dose',
    'time',
    'gene_label',
    'peptides',
    'well'
  ])
  const dbSet = new Set(dbFields)
  return fields.find((c) => !nonId.has(c) && dbSet.has(c)) ?? null
}

interface IdMap {
  lookup: Map<string, string>
  displayMap: Record<string, string>
  idColumn: string
}

/** Build a UniProtID/locus_tag/... → uniqID map and uniqID → display label. */
function buildIdMap(dbRows: Row[], dbFields: string[], idColumn: string): IdMap {
  const lookup = new Map<string, string>()
  for (const r of dbRows) {
    const key = (r[idColumn] ?? '').trim()
    const uid = (r.uniqID ?? '').trim()
    if (key !== '' && uid !== '') lookup.set(key, uid)
  }
  // display label: gene name(s) joined by "/", else locus_tag, else uniqID
  const byUid = new Map<string, { genes: Set<string>; loci: Set<string> }>()
  for (const r of dbRows) {
    const uid = (r.uniqID ?? '').trim()
    if (uid === '') continue
    let e = byUid.get(uid)
    if (!e) {
      e = { genes: new Set(), loci: new Set() }
      byUid.set(uid, e)
    }
    const gene = (r.gene ?? '').trim()
    const locus = (r.locus_tag ?? '').trim()
    if (gene !== '') e.genes.add(gene)
    if (locus !== '') e.loci.add(locus)
  }
  const displayMap: Record<string, string> = {}
  for (const [uid, e] of byUid) {
    if (e.genes.size > 0) displayMap[uid] = [...e.genes].join('/')
    else if (e.loci.size > 0) displayMap[uid] = [...e.loci].join('/')
    else displayMap[uid] = uid
  }
  void dbFields
  return { lookup, displayMap, idColumn }
}

/**
 * Full standardization pipeline. Produces the tidy long table and a display map.
 */
export function standardize(input: StandardizeInput): StandardizeResult {
  const fmt = detectFormat(input.dataFilename)
  const parsed = parseCsv(input.dataText)
  let fields = parsed.fields
  let dataRows = parsed.rows

  // ── wide → long melt, or long: rename well/position → sample ────────────────
  if (fmt === 'wide') {
    const idCol = fields[0]
    const sampleCols = fields.slice(1)
    const melted: Row[] = []
    for (const r of dataRows) {
      for (const sc of sampleCols) melted.push({ [idCol]: r[idCol], sample: sc, value: r[sc] })
    }
    dataRows = melted
    fields = [idCol, 'sample', 'value']
  } else {
    if (!fields.includes('sample')) {
      const alias = fields.find((f) => f === 'position') ?? fields.find((f) => f === 'well')
      if (alias) {
        dataRows = dataRows.map((r) => {
          const { [alias]: aliasVal, ...rest } = r
          return { ...rest, sample: aliasVal }
        })
        fields = fields.map((f) => (f === alias ? 'sample' : f))
      }
    }
  }

  // ── samplesheet: sample → conditions + rep ──────────────────────────────────
  const ss = readSamplesheet(input.samplesheetText)
  const ssBySample = new Map<string, Row>()
  for (const r of ss) if (r.sample != null) ssBySample.set(String(r.sample), r)
  const validSamples = new Set(ssBySample.keys())

  // ── filter to samplesheet samples, then attach metadata ─────────────────────
  const idColData = fields.find((f) => f !== 'sample' && f !== 'value') ?? fields[0]
  interface Merged {
    id: string
    sample: string
    value: number | null
    strain: string
    cmpd: string
    dose: number | null
    time: number | null
    rep: number | null
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
      value: num(r.value),
      strain: meta.strain ?? '',
      cmpd: meta.cmpd ?? '',
      dose: num(meta.dose),
      time: num(meta.time),
      rep: num(meta.rep),
      peptides: num(r.peptides)
    })
  }

  // ── optional ID mapping (feature ID → uniqID) ───────────────────────────────
  let displayMap: Record<string, string> = {}
  let idMap: IdMap | null = null
  if (input.dbText) {
    const db = parseCsv(input.dbText)
    const idCol = detectIdColumn([idColData], db.fields)
    if (idCol) {
      idMap = buildIdMap(db.rows, db.fields, idCol)
      displayMap = idMap.displayMap
    }
  }

  let rows: StandardRow[] = []
  // Per-gene presence: the distinct samples in which a uniqID has a non-null value.
  // Used by the optional low-coverage clean-up below.
  const presence = new Map<string, Set<string>>()
  const allSamples = new Set<string>()
  for (const m of merged) {
    allSamples.add(m.sample)
    // Expand ';'-concatenated IDs, then map each through the DB (unmapped kept as-is).
    const ids = m.id.includes(';')
      ? m.id
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean)
      : [m.id]
    for (const rawId of ids) {
      const uniqID = idMap ? (idMap.lookup.get(rawId) ?? rawId) : rawId
      if (m.value != null) {
        let s = presence.get(uniqID)
        if (!s) presence.set(uniqID, (s = new Set()))
        s.add(m.sample)
      }
      rows.push({
        uniqID,
        strain: m.strain,
        cmpd: m.cmpd,
        dose: m.dose,
        time: m.time,
        rep: m.rep,
        value: m.value,
        peptides: m.peptides
      })
    }
  }

  // ── clean-up: drop low-coverage genes (identified in < minSamplePct of samples) ──
  const sampleCount = allSamples.size
  const minSamplePct = Math.min(100, Math.max(0, input.minSamplePct ?? 0))
  let droppedGenes = 0
  if (minSamplePct > 0 && sampleCount > 0) {
    const dropped = new Set<string>()
    for (const [uniqID, samples] of presence) {
      if ((samples.size / sampleCount) * 100 < minSamplePct) dropped.add(uniqID)
    }
    // A uniqID with no non-null value anywhere never enters `presence`; treat it as 0%.
    for (const r of rows) if (!presence.has(r.uniqID)) dropped.add(r.uniqID)
    if (dropped.size > 0) {
      droppedGenes = dropped.size
      rows = rows.filter((r) => !dropped.has(r.uniqID))
    }
  }

  // ── which conditions are active (present with any non-empty value) ──────────
  const requested = input.activeConditions ?? VALID_CONDITIONS
  const activeConditions = requested.filter((c) => {
    if (c === 'strain' || c === 'cmpd') return rows.some((r) => (r[c] as string) !== '')
    return rows.some((r) => r[c] != null)
  })

  const compounds = [...new Set(rows.map((r) => r.cmpd).filter((c) => c !== ''))].sort()

  return {
    rows,
    displayMap,
    activeConditions,
    compounds,
    cleanup: { droppedGenes, sampleCount, minSamplePct }
  }
}
