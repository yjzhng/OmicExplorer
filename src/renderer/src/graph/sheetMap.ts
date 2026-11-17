/** The interactive import's samplesheet mode (Conditions step): a samplesheet in any layout, its
 *  rows matched to the sample columns by name, its columns mapped to conditions — and the
 *  conditions that writes onto the samples. Pure functions over the import's state. */
import Papa from 'papaparse'

import { matchSheetRows, type InteractiveSampleCond } from '../engine'
import type { LoadedSheet } from './types'

type Spans = Record<string, Partial<Record<string, [number, number]>>>

const PRESETS = new Set(['cell', 'cmpd', 'dose', 'time', 'rep'])
/** Headers a preset condition is mapped from on its own, as a samplesheet tends to name them. */
const ALIASES: Record<string, string[]> = {
  cell: ['cell', 'strain', 'cell line', 'cell_line', 'cellline'],
  cmpd: ['cmpd', 'compound', 'drug', 'treatment'],
  dose: ['dose', 'conc', 'concentration'],
  time: ['time', 'timepoint', 'time point'],
  rep: ['rep', 'replicate']
}

/** Read a samplesheet file as written: its header row and cells (trimmed, rows padded to the
 *  header). Its sample-name column is the one whose names match the most sample columns (else one
 *  called `sample`, else the first), and a column named as a condition (ALIASES, or a custom
 *  condition's own name) is mapped to it. */
export function readSheet(
  file: string,
  text: string,
  sampleCols: string[],
  fields: string[]
): LoadedSheet {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' })
  const [head = [], ...body] = res.data
  const columns = head.map((h) => h.trim())
  const rows = body.map((r) => columns.map((_, i) => (r[i] ?? '').trim()))
  const hits = columns.map(
    (_, c) =>
      matchSheetRows(
        rows.map((r) => r[c]),
        sampleCols
      ).size
  )
  const best = hits.reduce((b, n, c) => (n > hits[b] ? c : b), 0)
  const named = columns.findIndex((h) => h.toLowerCase() === 'sample')
  const nameCol = columns.length ? columns[hits[best] > 0 ? best : named >= 0 ? named : 0] : null
  const map: Record<string, string> = {}
  for (const f of fields) {
    const names = ALIASES[f] ?? [f]
    const col = columns.find(
      (h) => h !== nameCol && names.includes(h.toLowerCase()) && !Object.values(map).includes(h)
    )
    if (col) map[f] = col
  }
  return { file, columns, rows, nameCol, map, pinned: {} }
}

/** Each sample column's sheet row (sample column → row index), by name or matched by hand. */
export function sheetMatches(sheet: LoadedSheet, sampleCols: string[]): Map<string, number> {
  const c = sheet.nameCol == null ? -1 : sheet.columns.indexOf(sheet.nameCol)
  if (c < 0) return new Map()
  return matchSheetRows(
    sheet.rows.map((r) => r[c]),
    sampleCols,
    sheet.pinned
  )
}

/** `sheet` with row `row` matched by hand to sample column `sample` (null: that sample's hand
 *  match undone) — a row is matched to one sample, a sample to one row. */
export function pinRow(sheet: LoadedSheet, sample: string, row: number | null): LoadedSheet {
  const pinned = Object.fromEntries(
    Object.entries(sheet.pinned).filter(([s, r]) => s !== sample && r !== row)
  )
  if (row != null) pinned[sample] = row
  return { ...sheet, pinned }
}

/** `sheet` with column `col` mapped to condition `field` — or unmapped, when it already was. A
 *  column holds one condition; the sample-name column holds none. */
export function mapColumn(sheet: LoadedSheet, field: string, col: string): LoadedSheet {
  if (col === sheet.nameCol) return sheet
  const map = Object.fromEntries(Object.entries(sheet.map).filter(([, c]) => c !== col))
  if (sheet.map[field] !== col) map[field] = col
  return { ...sheet, map }
}

/** `sheet` with `col` as the column naming each row's sample (no longer mapped to a condition). */
export function setNameColumn(sheet: LoadedSheet, col: string): LoadedSheet {
  const map = Object.fromEntries(Object.entries(sheet.map).filter(([, c]) => c !== col))
  return { ...sheet, nameCol: col, map }
}

const setField = (c: InteractiveSampleCond, f: string, v: string): InteractiveSampleCond => {
  const next = PRESETS.has(f) ? { ...c, [f]: v } : { ...c, extra: { ...(c.extra ?? {}), [f]: v } }
  const edited = (c.edited ?? []).filter((e) => e !== f)
  return { ...next, edited: edited.length ? edited : undefined }
}

/** The samples' conditions as `next` sets them (`prev`: the sheet before this change, if any).
 *  Each condition mapped to a column takes the value in its sample's row — none for a sample with
 *  no row — with its painted region dropped; one no longer mapped is cleared. A sample that gains
 *  or loses its row (every sample, on a first sheet) is ticked in or left out to match, as a
 *  samplesheet keeps only the samples it lists — so a sample ticked by hand stays as it is while
 *  its row does. */
export function applySheet(
  conditions: Record<string, InteractiveSampleCond>,
  spans: Spans,
  sampleCols: string[],
  prev: LoadedSheet | undefined,
  next: LoadedSheet,
  blank: (sample: string) => InteractiveSampleCond
): { conditions: Record<string, InteractiveSampleCond>; spans: Spans } {
  const rowOf = sheetMatches(next, sampleCols)
  const before = prev ? sheetMatches(prev, sampleCols) : null
  const mapped = Object.entries(next.map).map(([f, col]) => [f, next.columns.indexOf(col)] as const)
  const dropped = Object.keys(prev?.map ?? {}).filter((f) => !(f in next.map))
  const outConds = { ...conditions }
  const outSpans = { ...spans }
  for (const h of sampleCols) {
    const row = rowOf.get(h)
    let c = conditions[h] ?? blank(h)
    for (const [f, i] of mapped) c = setField(c, f, row == null ? '' : (next.rows[row][i] ?? ''))
    for (const f of dropped) c = setField(c, f, '')
    if (!before || before.has(h) !== (row != null)) c = { ...c, include: row != null }
    outConds[h] = c
    const rs = { ...(spans[h] ?? {}) }
    for (const f of [...Object.keys(next.map), ...dropped]) delete rs[f]
    outSpans[h] = rs
  }
  return { conditions: outConds, spans: outSpans }
}
