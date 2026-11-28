/**
 * A Load tile's and a Subset's settings: the input files, the import mode, the interactive
 * import's classification and conditions, and the annotations fetched for the features.
 */
import type {
  CondSelector,
  FilterSpec,
  InteractiveRole,
  InteractiveSampleCond,
  MatrixPreset
} from '../../engine'
import type { CondUnits } from './units'

/** Subset keeps the samples whose conditions take the chosen values: condition → kept values. A
 *  condition absent or empty is unfiltered, so the default passes the dataset through. */
export interface SubsetConfig {
  keep: CondSelector
  /** the replicates kept ("1", "2", …), across every condition; unset or empty = all */
  reps?: string[]
  /** samples left out by name (a bad replicate of one condition) */
  drop?: string[]
}

export interface FileEntry {
  name: string
  content: string
}

// ── per-kind configuration ──────────────────────────────────────────────────────

/** A Load tile references input files by name under the workflow's `input/` folder. */
/** How the Load tile sources its data:
 *  - `manual`: user picks the three standard files (data + samplesheet + ID map).
 *  - `interactive`: user picks one raw data matrix (e.g. a DIA-NN protein-group table);
 *    an adapter derives the three standard inputs from it (see engine/data/interactive.ts). New
 *    load nodes default to `interactive`; a legacy project with no `mode` field falls back
 *    to `manual`. */
export type LoadMode = 'manual' | 'interactive'

export interface LoadConfig {
  mode?: LoadMode
  data: string | null
  samplesheet: string | null
  db: string | null
  /** interactive mode: the single raw data matrix file (in the project data folder). */
  matrix?: string | null
  /** the units the numeric conditions' values are in (set where the conditions are mapped).
   *  Display-only — axis titles, EC50 and a dose curve's molar pEC50; never stales a result (see
   *  setLoadUnits). */
  units?: CondUnits
  /** the custom conditions declared numeric (their cat/num chip) — one declaration for both modes,
   *  as `units` is: set in the interactive import's Conditions step or the manual panel's
   *  Conditions, and kept when the tile switches mode. Read it through declaredNumeric (a project
   *  from before kept the import's in InteractiveImport.numericConditions). */
  numericConditions?: string[]
  /** interactive mode: the import spec built across the 4-step wizard. */
  interactive?: InteractiveImport
  /** interactive mode: the raw data file as it was when last converted — a change to it (another
   *  file picked, or this one rewritten) re-converts (see the store's checkLoad) */
  convertedFrom?: FileStamp
  /** the standard files as Clean data last read them (manual mode: your own files) — a change
   *  since puts Clean data and below out of date */
  readStamps?: Partial<Record<'data' | 'samplesheet' | 'db', FileStamp>>
}

/** A file as it was when read: its name as the Load tile names it, its size and modified time,
 *  and a SHA-1 of its bytes (compared when the time moved but the size didn't). */
export interface FileStamp {
  name: string
  size: number
  mtime: number
  hash?: string
}

/** Whether a Load tile's inputs are as they were read — live (never saved), from the store's
 *  checkLoad. Absent = not checked yet (or nothing to check: an unconfigured tile). */
export type LoadCheck =
  | { state: 'ok' }
  /** re-converting a changed raw file with the saved import settings */
  | { state: 'converting' }
  /** interactive: the raw file is gone, but its converted copy still reads */
  | { state: 'sourceMissing'; name: string }
  /** a file Clean data read has changed since (what's below is out of date until it runs) */
  | { state: 'filesChanged'; names: string[] }
  /** files the run needs aren't there */
  | { state: 'filesMissing'; names: string[] }
  /** interactive: the raw file lacks columns the import settings use */
  | { state: 'columns'; missing: string[] }
  /** a re-conversion that failed */
  | { state: 'error'; message: string }

/** A Load tile's custom conditions declared numeric — whichever mode it is in (one declaration, as
 *  its units), falling back to where an import saved before kept them. */
export const declaredNumeric = (c: LoadConfig | undefined): string[] =>
  c?.numericConditions ?? c?.interactive?.numericConditions ?? []

/** Resolve a Load tile's effective mode, tolerating older saved values:
 *  - `manual` / `interactive` → themselves
 *  - any other stored value (e.g. the pre-rename `diann`) → `interactive`
 *  - no `mode` field → `manual` if it already references the standard files, else `interactive`
 *    (so a fresh tile defaults to interactive but a legacy manual project still reads as manual). */
export function resolveLoadMode(c: LoadConfig): LoadMode {
  const m = c.mode as string | undefined
  if (m === 'manual') return 'manual'
  if (m != null) return 'interactive'
  return c.data || c.samplesheet || c.db ? 'manual' : 'interactive'
}

/** The samplesheet columns Clean data reads as custom conditions off this Load tile: the ones the
 *  interactive import defined, less those switched off; undefined for a hand-written samplesheet
 *  (manual mode), whose customs ingest auto-detects. */
export const loadCustomConditions = (c: LoadConfig): string[] | undefined =>
  c.interactive?.customConditions?.filter((n) => !c.interactive?.hiddenConditions?.includes(n))

/** …and of those, the ones declared numeric (the import's cat/num chip; a manual tile's on its
 *  panel). */
export const loadNumericConditions = (c: LoadConfig): string[] =>
  resolveLoadMode(c) === 'manual'
    ? declaredNumeric(c)
    : declaredNumeric(c).filter(
        (n) =>
          c.interactive?.customConditions?.includes(n) &&
          !c.interactive?.hiddenConditions?.includes(n)
      )

/** Why a Load tile isn't ready to feed a Clean data step — null when it is. Both standard files
 *  must be set: Clean data reads them in either mode (interactive materialises them on convert),
 *  so this mirrors the run's own check rather than merely "some file is named". */
export function unconfiguredLoad(c: LoadConfig): string | null {
  const interactive = resolveLoadMode(c) === 'interactive'
  if (!c.data)
    return interactive
      ? 'Not configured — click “Configure samples…” and convert'
      : 'No data file selected'
  if (!c.samplesheet) return interactive ? 'Not converted yet' : 'No samplesheet selected'
  return null
}

/** Interactive import: the user's column classification + per-sample conditions, from which the
 *  three standard files are generated (see engine buildStandardInputs). */
export interface InteractiveImport {
  /** all matrix column headers */
  columns: string[]
  /** header → role (id / sample / label / meta / filter / ignore) */
  roles: Record<string, InteractiveRole>
  /** sample header → assigned conditions */
  conditions: Record<string, InteractiveSampleCond>
  /** custom condition axes the user added beyond the five presets, in display order. Each becomes
   *  a samplesheet column of the same name, and a `@name` condition key downstream. Categorical
   *  unless listed in `numericConditions`. */
  customConditions?: string[]
  /** Legacy: where the import first kept its declared numeric conditions — now on the Load tile
   *  (LoadConfig.numericConditions, shared by both modes). Only read, by declaredNumeric, for a
   *  project saved before. */
  numericConditions?: string[]
  /** conditions switched off that still carry values: kept (switching one back on restores them),
   *  but left out of the samplesheet and the checks while off */
  hiddenConditions?: string[]
  /** filter-column header → row-filter spec (Filtering step); absent = no row filtering */
  filters?: Record<string, FilterSpec>
  /** sample header → condition field → the token-index range [start, end) that field occupies in
   *  the sample name (Conditions step). The single source of truth for the step: the extracted
   *  value, the highlight and the samplesheet "original" all derive from it. Stored per row (not one
   *  global rule) so a paint on one group of rows can't disturb another, and unaffected by a value
   *  rename. Persisted so reopening restores the highlights, mirroring how column roles are kept. */
  spans?: Record<string, Partial<Record<string, [number, number]>>>
  /** token separator the Conditions step splits sample names on (default '_'); spans are token
   *  indexes under it, so changing it clears them */
  separator?: string
  /** where the Conditions step takes the conditions from: painted off the sample names (absent =
   *  'names'), or mapped from a samplesheet's columns (`sheet`) */
  condSource?: 'names' | 'sheet'
  /** the samplesheet loaded in the Conditions step's samplesheet mode, and how it's mapped */
  sheet?: LoadedSheet
  /** last wizard stage the user was on (1–5) — reopens the wizard where they left off */
  step?: number
  /** last column-classification preset (Columns step) */
  preset?: MatrixPreset | 'custom'
  /** fetched external annotations (UniProt) merged into the DB, keyed by the feature's ID value
   *  (uniqID/accession). Persisted so a reopened wizard keeps them and they're written on convert. */
  annotations?: AnnotationSet
}

/** A samplesheet as the interactive import holds it: the file's table as written (any headers), the
 *  column naming each row's sample, and the conditions mapped onto its columns (see sheetMap). */
export interface LoadedSheet {
  /** the file's name, to show */
  file: string
  columns: string[]
  /** each row's cells, in `columns` order */
  rows: string[][]
  /** the column holding each row's sample name (null: none picked) */
  nameCol: string | null
  /** condition → the column holding it */
  map: Record<string, string>
  /** sample column → sheet row, matched by hand (a row dragged onto it); ahead of the automatic
   *  match */
  pinned: Record<string, number>
}

/** External-annotation columns fetched for the feature IDs (e.g. from UniProt). */
export interface AnnotationSet {
  /** provider tag (currently 'uniprot') */
  source: string
  /** output column names, in order (e.g. ['proteinName', 'geneNames']) */
  fields: string[]
  /** feature ID (accession) → { field → value } */
  byId: Record<string, Record<string, string>>
  /** dominant NCBI taxon id learned from the fetch — the species for the STRING network */
  taxon?: number
  /** dominant KEGG organism code (e.g. 'hsa') learned from the fetch — for STRING pathway mode */
  keggOrg?: string
  /** pathway name → top-level KEGG category (BRITE), for grouping/colouring enrichment terms */
  keggCategories?: Record<string, string>
}
