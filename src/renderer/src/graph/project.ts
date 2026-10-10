/** A project (`.omicexplorer`) — the whole saved session. Structure:
 *
 *    Project  →  Folders  →  Workflows
 *
 *  A folder is a filesystem directory (holding input/output/data) scanned for
 *  inputs; each folder owns its own workflows. Opening a project restores the
 *  session exactly (embedded results and all). */
import type { NodeResult } from './types'
import { packResults, unpackResults } from './resultPack'
import { emptyWorkflowDoc, type WorkflowDoc } from './workflowDoc'

export interface ProjectWorkflow {
  id: string
  name: string
  doc: WorkflowDoc
  /** embedded computed results (keyed by node id) so the session resumes exactly */
  results: Record<string, NodeResult>
  /** in a session only (never saved): the results are parked on disk under this key while the
   *  workflow isn't the open one, and `results` is empty (see the store's parking) */
  parked?: string
  /** this workflow's folder name on disk (under the project data folder) — follows `name` at the
   *  next save after a rename (see graph/diskNames.ts) */
  dir?: string
  /** processing step id → its output/ subfolder name on disk; set at the step's first download,
   *  follows the step's name at the next save after a rename */
  outDirs?: Record<string, string>
}

/** JSON text placed into a serialized project as is — a parked workflow's results, already
 *  packed, go into the file without being parsed back into memory. */
export class RawJson {
  constructor(readonly text: string) {}
}

/** A parked workflow's results, named by their park key in place of their text: the save reads
 *  the park file straight into the project file in the main process, so the (often tens of MB of)
 *  text never travels to the renderer and back. */
export class ParkedRef {
  constructor(readonly key: string) {}
}

/** One piece of a project file being saved: text, or a parked workflow's results to copy in. */
export type SavePiece = string | { park: string }

export interface ProjectFolder {
  id: string
  name: string
  /** filesystem folder scanned for inputs; '' until the user picks one */
  path: string
  workflows: ProjectWorkflow[]
  activeWorkflowId: string
  /** the project data folder's name on disk, inside `path` (`<project>_data`); unset until the
   *  project has a file — follows the project's name at the next save (see graph/diskNames.ts) */
  dataName?: string
}

export interface ProjectFile {
  format: 'omicexplorer-project'
  /** 1 = flat {dataDir, workflows}; 2 = {folders[]}; 3 = packed results, gzipped (0.3.5).
   *  Bump it when older app versions can't read what's saved. */
  version: number
  /** the app version that saved the file, so an older app can warn it may not read it right
   *  (see savedByVersion). Optional (files before 0.3.5 don't carry it). */
  appVersion?: string
  name: string
  folders: ProjectFolder[]
  activeFolderId: string
  /** UI page to restore on open — the Workflow canvas or the Results dashboard. Optional (older
   *  files default to the canvas). */
  view?: 'canvas' | 'results'
  /** the Results tab (analysis-group id) that was active, restored alongside `view`. */
  resultsTab?: string | null
}

/** The newest project format this build reads and writes. */
export const PROJECT_VERSION = 3

/** The app version a project file says saved it, read from the file's start (it's written right
 *  after `version`) without parsing the whole file; null when it names none (before 0.3.5). */
export function savedByVersion(text: string): string | null {
  return /"appVersion"\s*:\s*"([^"]+)"/.exec(text.slice(0, 1000))?.[1] ?? null
}

/** Whether dotted version `a` is newer than `b` ("0.4.0" > "0.3.10"). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}

/** Counter-based ids (no Math.random — deterministic and test-stable). The counter is shared
 *  across folder and workflow ids, so it stays globally unique within a session. */
let seq = 0
const uid = (p: string): string => {
  seq += 1
  return `${p}-${seq}`
}
export const nextWorkflowId = (): string => uid('wf')
export const nextFolderId = (): string => uid('fd')

/** Advance the id counter past every `…-N` id already present in a loaded project, so ids minted
 *  afterwards (e.g. a new workflow) never collide with saved ones. Without this the counter resets
 *  to 0 each launch and `addWorkflow` re-mints `wf-1`, which then resolves to the *existing* wf-1 —
 *  the new workflow appears in the list but switching to it lands on the old one. */
function reserveIds(raw: Partial<ProjectFile> & ProjectFileV1): void {
  let max = seq
  const scan = (id: unknown): void => {
    if (typeof id !== 'string') return
    const m = /-(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  const folders = Array.isArray(raw.folders) ? raw.folders : []
  for (const f of folders) {
    scan(f?.id)
    for (const w of Array.isArray(f?.workflows) ? f.workflows : []) scan(w?.id)
  }
  for (const w of Array.isArray(raw.workflows) ? raw.workflows : []) scan(w?.id) // v1
  seq = max
}

export function emptyWorkflow(name = 'Workflow 1'): ProjectWorkflow {
  return { id: nextWorkflowId(), name, doc: emptyWorkflowDoc(), results: {} }
}

export function newFolder(path = '', name?: string): ProjectFolder {
  const wf = emptyWorkflow()
  return {
    id: nextFolderId(),
    name: name ?? (path ? (path.split(/[/\\]/).pop() ?? path) : 'Folder 1'),
    path,
    workflows: [wf],
    activeWorkflowId: wf.id
  }
}

/** Levels serialized piece by piece (root → folders → folder → workflows → workflow → packed
 *  results → results → result); below that, each value (a workflow's doc, one result's table, an
 *  annotation table) is a single JSON.stringify. */
const CHUNK_DEPTH = 8
/** Pieces are merged up to about this many characters, to keep the count small. */
const CHUNK_CHARS = 32_000_000

/** JSON for `value`, appended to `out` in pieces down to `depth` levels — exactly what
 *  JSON.stringify gives (compact), just never as one string. */
function stringifyInto(value: unknown, depth: number, out: SavePiece[]): void {
  if (value instanceof RawJson) {
    out.push(value.text)
    return
  }
  if (value instanceof ParkedRef) {
    out.push({ park: value.key })
    return
  }
  if (depth === 0 || value === null || typeof value !== 'object') {
    out.push(JSON.stringify(value) ?? 'null')
    return
  }
  if (Array.isArray(value)) {
    out.push('[')
    value.forEach((v, i) => {
      if (i) out.push(',')
      stringifyInto(v === undefined || typeof v === 'function' ? null : v, depth - 1, out)
    })
    out.push(']')
    return
  }
  out.push('{')
  let first = true
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || typeof v === 'function') continue
    out.push(`${first ? '' : ','}${JSON.stringify(k)}:`)
    first = false
    stringifyInto(v, depth - 1, out)
  }
  out.push('}')
}

/**
 * The project file's text in pieces — concatenated, they're the file. A project holding large
 * results runs to hundreds of MB, past the longest string JavaScript can build, so it's never one
 * JSON.stringify: each workflow's document and each result is its own piece. Compact (no
 * indentation), which also keeps the file a good deal smaller. A parked workflow's results stay a
 * `{ park }` piece (see ParkedRef) for the main process to fill in.
 */
export function serializeProjectChunks(p: ProjectFile): SavePiece[] {
  // Results go in packed (columnar tables, pooled annotations — see resultPack).
  const packed = {
    ...p,
    folders: p.folders.map((f) => ({
      ...f,
      // `parked` is session state, not the file's; a parked workflow's results arrive as a
      // ParkedRef (or RawJson text).
      workflows: f.workflows.map((w) => {
        const out: Omit<Partial<ProjectWorkflow>, 'results'> & { results: unknown } = {
          ...w,
          results:
            (w.results as unknown) instanceof RawJson || (w.results as unknown) instanceof ParkedRef
              ? w.results
              : packResults(w.results)
        }
        delete out.parked
        return out
      })
    }))
  }
  const parts: SavePiece[] = []
  stringifyInto(packed, CHUNK_DEPTH, parts)
  const out: SavePiece[] = []
  let buf: string[] = []
  let size = 0
  for (const part of parts) {
    // A parked reference stays its own piece, between the text around it.
    if (typeof part !== 'string') {
      if (buf.length) out.push(buf.join(''))
      buf = []
      size = 0
      out.push(part)
      continue
    }
    if (size + part.length > CHUNK_CHARS && buf.length) {
      out.push(buf.join(''))
      buf = []
      size = 0
    }
    buf.push(part)
    size += part.length
  }
  if (buf.length) out.push(buf.join(''))
  return out
}

/** A workflow's results packed (see resultPack) as JSON text in pieces — how they're parked on
 *  disk, and exactly what the project file holds for them. */
export function packedResultsChunks(results: Record<string, NodeResult>): string[] {
  const parts: string[] = []
  stringifyInto(packResults(results), 3, parts)
  return parts
}

/** A workflow's results from parked text (packedResultsChunks, joined). */
export function unpackParked(text: string): Record<string, NodeResult> {
  return unpackResults(JSON.parse(text))
}

/** The project file's text as one string (for small projects and tests; saving uses the chunks). */
export function serializeProject(p: ProjectFile): string {
  return serializeProjectChunks(p).join('')
}

/** v1 (flat dataDir + workflows) shape, for migration. */
interface ProjectFileV1 {
  dataDir?: string | null
  workflows?: ProjectWorkflow[]
  activeWorkflowId?: string
}

function coerceWorkflows(
  ws: ProjectWorkflow[] | undefined,
  activeId?: string
): { workflows: ProjectWorkflow[]; activeWorkflowId: string } {
  const workflows =
    Array.isArray(ws) && ws.length
      ? ws.map((w, i) => ({
          id: w.id ?? nextWorkflowId(),
          name: w.name ?? `Workflow ${i + 1}`,
          doc: w.doc ?? emptyWorkflowDoc(),
          results: unpackResults(w.results),
          ...(typeof w.dir === 'string' && w.dir ? { dir: w.dir } : null),
          ...(w.outDirs && typeof w.outDirs === 'object' ? { outDirs: { ...w.outDirs } } : null)
        }))
      : [emptyWorkflow()]
  const active = activeId && workflows.some((w) => w.id === activeId) ? activeId : workflows[0].id
  return { workflows, activeWorkflowId: active }
}

/** Object keys renamed by the strain → cell condition rename (v0.3.3). */
const RENAMED_KEYS: Record<string, string> = { strain: 'cell' }
/** The boolean "per strain/cell" clean-up flag became a list of grouping conditions (v0.3.3):
 *  true → ['cell'], false → pooled (key dropped). Config key → new key, result key → new key. */
const PER_CELL_FLAGS: Record<string, string> = {
  minSamplePctPerStrain: 'minSamplePctBy',
  minSamplePctPerCell: 'minSamplePctBy',
  perStrain: 'by',
  perCell: 'by'
}
/** Keys whose string value names one condition. */
const COND_VALUE_KEYS = new Set(['condition', 'condition2', 'colorBy'])
/** Keys whose array value lists conditions. */
const COND_LIST_KEYS = new Set(['match', 'activeConditions'])

/** The `strain` condition was renamed `cell` (v0.3.3). Rewrite every place a saved project names
 *  it — row/selector/config keys, condition-valued fields, condition lists and `cmp_cond` labels
 *  (`cmpd:strain`) — in place, so projects saved before the rename open unchanged. Walks node
 *  configs and embedded results alike; a key already present under its new name wins. */
export function migrateStrainToCell(v: unknown): void {
  if (Array.isArray(v)) {
    for (const x of v) migrateStrainToCell(x)
    return
  }
  if (v === null || typeof v !== 'object') return
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) {
    const val = o[k]
    if (typeof val === 'string') {
      if (COND_VALUE_KEYS.has(k) && val === 'strain') o[k] = 'cell'
      else if (k === 'cmp_cond' && val.includes('strain'))
        o[k] = val
          .split(':')
          .map((c) => (c === 'strain' ? 'cell' : c))
          .join(':')
    } else if (Array.isArray(val) && COND_LIST_KEYS.has(k)) {
      o[k] = val.map((c) => (c === 'strain' ? 'cell' : c))
    } else migrateStrainToCell(val)
    const to = RENAMED_KEYS[k]
    if (to !== undefined) {
      if (!(to in o)) o[to] = o[k]
      delete o[k]
    }
    const flagTo = PER_CELL_FLAGS[k]
    if (flagTo !== undefined) {
      if (o[k] === true && !(flagTo in o)) o[flagTo] = ['cell']
      delete o[k]
    }
  }
}

/** Parse + validate a project file, migrating the v1 (flat) shape into a folder and any
 *  pre-rename `strain` condition into `cell`. */
export function deserializeProject(text: string): ProjectFile {
  const raw = JSON.parse(text) as Partial<ProjectFile> & ProjectFileV1
  migrateStrainToCell(raw)
  // Reserve every existing id so parse-time and later-minted ids can't collide with saved ones.
  reserveIds(raw)
  let folders: ProjectFolder[]
  if (Array.isArray(raw.folders) && raw.folders.length) {
    folders = raw.folders.map((f, i) => {
      const { workflows, activeWorkflowId } = coerceWorkflows(f.workflows, f.activeWorkflowId)
      return {
        id: f.id ?? nextFolderId(),
        name: f.name ?? (f.path ? (f.path.split(/[/\\]/).pop() ?? f.path) : `Folder ${i + 1}`),
        path: f.path ?? '',
        workflows,
        activeWorkflowId,
        ...(typeof f.dataName === 'string' && f.dataName ? { dataName: f.dataName } : null)
      }
    })
  } else {
    // v1 → one folder holding the flat workflow list at the old dataDir
    const { workflows, activeWorkflowId } = coerceWorkflows(raw.workflows, raw.activeWorkflowId)
    const path = raw.dataDir ?? ''
    folders = [
      {
        id: nextFolderId(),
        name: path ? (path.split(/[/\\]/).pop() ?? path) : 'Folder 1',
        path,
        workflows,
        activeWorkflowId
      }
    ]
  }
  const activeFolderId =
    raw.activeFolderId && folders.some((f) => f.id === raw.activeFolderId)
      ? raw.activeFolderId
      : folders[0].id
  return {
    format: 'omicexplorer-project',
    version: PROJECT_VERSION,
    name: raw.name ?? 'Untitled project',
    folders,
    activeFolderId,
    view: raw.view === 'results' ? 'results' : 'canvas',
    resultsTab: typeof raw.resultsTab === 'string' ? raw.resultsTab : null
  }
}

/** A fresh single-folder, single-workflow project (unsaved, no data folder yet). */
export function newProjectFile(name = 'Untitled project'): ProjectFile {
  const folder = newFolder('', 'Folder 1')
  return {
    format: 'omicexplorer-project',
    version: PROJECT_VERSION,
    name,
    folders: [folder],
    activeFolderId: folder.id
  }
}
