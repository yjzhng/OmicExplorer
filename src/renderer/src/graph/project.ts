/** A project (`.omicexplorer`) — the whole saved session. Structure:
 *
 *    Project  →  Folders  →  Workflows
 *
 *  A folder is a filesystem directory (holding input/output/data) scanned for
 *  inputs; each folder owns its own workflows. Opening a project restores the
 *  session exactly (embedded results and all). */
import type { GeneSet, NodeResult } from './types'
import { dirOf, relativeTo, resolveFrom } from './relPath'
import { compactResults } from './compactResults'
import { packResults, unpackResults as unpackStored } from './resultPack'
import { MIGRATED_THROUGH, upgradeProjectFile, type RawProject } from './upgrades'
import { emptyWorkflowDoc, type WorkflowDoc } from './workflowDoc'

/** Re-exported from where they live now, for existing callers. */
export { geneMaskKey } from './geneMask'
export { migrateStrainToCell } from './upgrades'

export interface ProjectWorkflow {
  id: string
  name: string
  doc: WorkflowDoc
  /** embedded computed results (keyed by node id) so the session resumes exactly */
  results: Record<string, NodeResult>
  /** in a session only (never saved): the results are parked on disk under this key while the
   *  workflow isn't the open one, and `results` is empty (see the store's parking) */
  parked?: string
  /** while a project opens only (never saved): its results as the file stores them, packed and
   *  not yet unpacked (deserializeProject's `packed`) — the open one is unpacked, the rest parked
   *  from this, so a large project never holds every workflow's results in memory at once */
  stored?: unknown
  /** this workflow's folder name on disk (under the project data folder) — follows `name` at the
   *  next save after a rename (see graph/diskNames.ts) */
  dir?: string
  /** processing step id → its output/ subfolder name on disk; set at the step's first download,
   *  follows the step's name at the next save after a rename */
  outDirs?: Record<string, string>
  /** the gene mask (see geneMaskKey) its results were last classified under; when the project's
   *  differs on opening the workflow, the mask is re-applied to them. Unset = not known. */
  mask?: string
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
  /** `path` relative to the project file's folder, written at each save (see relPath.ts): a
   *  project copied to another machine along with its folders finds them there (openProject).
   *  Unset when there's no relative path (another drive) or the project has no file yet. */
  rel?: string
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
  /** the app version the project was first created with — kept unchanged by every later save.
   *  Optional (files before 0.3.7 don't carry it, and it's never guessed for them). */
  createdWith?: string
  name: string
  folders: ProjectFolder[]
  activeFolderId: string
  /** UI page to restore on open — the Workflow canvas or the Results dashboard. Optional (older
   *  files default to the canvas). */
  view?: 'canvas' | 'results'
  /** the Results tab (analysis-group id) that was active, restored alongside `view`. */
  resultsTab?: string | null
  /** named genesets, shared by every workflow in the project (before 0.3.6 each workflow kept
   *  its own — gathered here on open, see deserializeProject) */
  geneSets?: GeneSet[]
}

/** The newest project format this build reads and writes. */
export const PROJECT_VERSION = 3

/** The release of the last upgrade (upgrades.ts): a file saved before it is written in an older
 *  form — it opens fine, being upgraded as it's read, and Fix writes it back in the current one. */
export { MIGRATED_THROUGH }
/** A workflow's results from their stored (packed) form, their large row tables kept columnar
 *  (compactResults) — a file's, a parked workflow's and the undo history's alike. */
export function unpackResults(stored: unknown): Record<string, NodeResult> {
  return compactResults(unpackStored(stored))
}

/** What a project file says about itself, from its first bytes (format, appVersion and
 *  createdWith are written first) — no full parse, so it's cheap for a list of files. */
export interface ProjectHeader {
  /** the file format (`version`); null when unreadable */
  format: number | null
  /** the app version that last saved it; null before 0.3.5 */
  savedBy: string | null
  /** the app version it was created with; null before 0.3.7 */
  createdWith: string | null
}

export function projectHeader(text: string): ProjectHeader {
  const head = text.slice(0, 1000)
  const str = (k: string): string | null =>
    new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`).exec(head)?.[1] ?? null
  const format = /"version"\s*:\s*(\d+)/.exec(head)?.[1]
  return {
    format: format ? Number(format) : null,
    savedBy: str('appVersion'),
    createdWith: str('createdWith')
  }
}

/** The app version a project file says saved it; null when it names none (before 0.3.5). */
export function savedByVersion(text: string): string | null {
  return projectHeader(text).savedBy
}

/** How a project file stands against this app: `current`; `older` — in an older file format, or
 *  saved before a migration this app applies on open (MIGRATED_THROUGH) AND that migration changes
 *  it (`upgrades`, from upgradeChanges — a file the upgrades leave as it was is current, whichever
 *  release saved it), so Fix rewrites it; or `newer` — saved by a newer app, which this one may not
 *  read right. `upgrades` unknown (not checked yet) counts as no change. */
export function projectStanding(
  h: ProjectHeader,
  appVersion: string | null,
  upgrades?: boolean
): 'current' | 'older' | 'newer' {
  if ((h.format ?? 0) > PROJECT_VERSION) return 'newer'
  if (h.savedBy && appVersion && isNewerVersion(h.savedBy, appVersion)) return 'newer'
  if ((h.format ?? 0) < PROJECT_VERSION) return 'older'
  if (upgradesDue(h) && upgrades) return 'older'
  return 'current'
}

/** Whether a file was saved before the last upgrade, so it may need one (upgradeChanges says). */
export function upgradesDue(h: ProjectHeader): boolean {
  return !h.savedBy || isNewerVersion(MIGRATED_THROUGH, h.savedBy)
}

/** The file's version stamps (its header): they change with every save, so they aren't a change of
 *  the project. A workflow doc's own `version` likewise. */
const STAMPS = new Set(['appVersion', 'createdWith', 'format', 'version'])

/** Whether reading a project file through the upgrades changes anything in it besides its version
 *  stamps — i.e. whether Fix would rewrite what it says, not just which release wrote it. The
 *  results aren't compared (not settings, and by far the largest part): an upgrade that moves them
 *  moves the steps they belong to too. */
export function upgradeChanges(text: string): boolean {
  const after = JSON.parse(text) as RawProject
  for (const w of [
    ...(after.workflows ?? []),
    ...(after.folders ?? []).flatMap((f) => f.workflows ?? [])
  ])
    delete w.results
  const before = structuredClone(after)
  let n = 0
  upgradeProjectFile(after, { nextFolderId: () => `fd-check-${++n}` })
  return !sameContent(before, after)
}

/** Deep equality of parsed JSON, version stamps aside (the header's; a workflow doc's `version`);
 *  a key set to undefined, '' or an empty list or object counts as absent (an upgrade writing
 *  `geneSets: []` or `mask: ''` where the file had none changes nothing). */
function sameContent(a: unknown, b: unknown, top = true): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a))
    return (
      a.length === (b as unknown[]).length &&
      a.every((x, i) => sameContent(x, (b as unknown[])[i], false))
    )
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const stamp = (r: Record<string, unknown>, k: string): boolean =>
    top ? STAMPS.has(k) : k === 'version' && Array.isArray(r.nodes)
  const empty = (v: unknown): boolean =>
    v === undefined ||
    v === '' ||
    (Array.isArray(v) ? v.length === 0 : !!v && typeof v === 'object' && !Object.keys(v).length)
  const keys = (r: Record<string, unknown>): string[] =>
    Object.keys(r).filter((k) => !empty(r[k]) && !stamp(r, k))
  const ka = keys(ra)
  const kb = keys(rb)
  return ka.length === kb.length && ka.every((k) => k in rb && sameContent(ra[k], rb[k], false))
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
            w.stored !== undefined
              ? w.stored
              : (w.results as unknown) instanceof RawJson ||
                  (w.results as unknown) instanceof ParkedRef
                ? w.results
                : packResults(w.results)
        }
        delete out.parked
        delete out.stored
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

/** Results as a project file stores them (already packed) as park text in pieces — parking a
 *  workflow straight from the file, without unpacking it first. */
export function storedResultsChunks(stored: unknown): string[] {
  const parts: string[] = []
  stringifyInto(stored ?? {}, 3, parts)
  return parts as string[]
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
  activeId?: string,
  packed = false
): { workflows: ProjectWorkflow[]; activeWorkflowId: string } {
  const workflows =
    Array.isArray(ws) && ws.length
      ? ws.map((w, i) => ({
          id: w.id ?? nextWorkflowId(),
          name: w.name ?? `Workflow ${i + 1}`,
          doc: w.doc ?? emptyWorkflowDoc(),
          ...(packed ? { results: {}, stored: w.results } : { results: unpackResults(w.results) }),
          ...(typeof w.dir === 'string' && w.dir ? { dir: w.dir } : null),
          ...(w.outDirs && typeof w.outDirs === 'object' ? { outDirs: { ...w.outDirs } } : null),
          ...(typeof w.mask === 'string' ? { mask: w.mask } : null)
        }))
      : [emptyWorkflow()]
  const active = activeId && workflows.some((w) => w.id === activeId) ? activeId : workflows[0].id
  return { workflows, activeWorkflowId: active }
}

/** Parse + validate a project file of any release: brought to the current form first
 *  (upgrades.ts — every upgrade the file format has had, in one place), then read. */
export function deserializeProject(
  text: string,
  /** leave each workflow's results packed, in `stored`, for the caller to unpack or park */
  opts: { packed?: boolean } = {}
): ProjectFile {
  const raw = JSON.parse(text) as Partial<ProjectFile> & ProjectFileV1
  // Reserve every existing id so parse-time and later-minted ids can't collide with saved ones.
  reserveIds(raw)
  upgradeProjectFile(raw as RawProject, { nextFolderId })
  const folders: ProjectFolder[] = (raw.folders ?? []).map((f, i) => {
    const { workflows, activeWorkflowId } = coerceWorkflows(
      f.workflows,
      f.activeWorkflowId,
      opts.packed
    )
    return {
      id: f.id ?? nextFolderId(),
      name: f.name ?? (f.path ? (f.path.split(/[/\\]/).pop() ?? f.path) : `Folder ${i + 1}`),
      path: f.path ?? '',
      workflows,
      activeWorkflowId,
      ...(typeof f.dataName === 'string' && f.dataName ? { dataName: f.dataName } : null),
      ...(typeof f.rel === 'string' && f.rel ? { rel: f.rel } : null)
    }
  })
  const geneSets = raw.geneSets ?? []
  const activeFolderId =
    raw.activeFolderId && folders.some((f) => f.id === raw.activeFolderId)
      ? raw.activeFolderId
      : folders[0].id
  return {
    format: 'omicexplorer-project',
    version: PROJECT_VERSION,
    ...(typeof raw.createdWith === 'string' && raw.createdWith
      ? { createdWith: raw.createdWith }
      : null),
    name: raw.name ?? 'Untitled project',
    folders,
    activeFolderId,
    view: raw.view === 'results' ? 'results' : 'canvas',
    resultsTab: typeof raw.resultsTab === 'string' ? raw.resultsTab : null,
    geneSets
  }
}

/** The folders with each one's path relative to the project file at `projectPath` (see
 *  ProjectFolder.rel), for saving there. */
export function withRelPaths(folders: ProjectFolder[], projectPath: string): ProjectFolder[] {
  const dir = dirOf(projectPath)
  return folders.map((f) => {
    const rel = f.path && dir ? relativeTo(dir, f.path) : null
    if (rel) return { ...f, rel }
    if (!f.rel) return f
    const out = { ...f }
    delete out.rel
    return out
  })
}

/** On opening the project at `projectPath`: each folder's saved relative path, when it leads to a
 *  folder that exists, is where the folder is — it wins over the saved full path, so a copy of a
 *  project and its folders reads its own data, never the original's. Otherwise the full path is
 *  kept (it's flagged as missing later if that doesn't exist either). Returns the folders and
 *  whether any moved. */
export async function relocateFolders(
  folders: ProjectFolder[],
  projectPath: string,
  isDir: (path: string) => Promise<boolean>
): Promise<{ folders: ProjectFolder[]; moved: number }> {
  const dir = dirOf(projectPath)
  let moved = 0
  const out = await Promise.all(
    folders.map(async (f) => {
      if (!f.rel || !dir) return f
      const there = resolveFrom(dir, f.rel)
      if (there === f.path || !(await isDir(there).catch(() => false))) return f
      moved += 1
      return { ...f, path: there }
    })
  )
  return { folders: out, moved }
}

/** A fresh single-folder, single-workflow project (unsaved, no data folder yet). */
export function newProjectFile(name = 'Untitled project'): ProjectFile {
  const folder = newFolder('', 'Folder 1')
  return {
    format: 'omicexplorer-project',
    version: PROJECT_VERSION,
    name,
    folders: [folder],
    activeFolderId: folder.id,
    geneSets: []
  }
}
