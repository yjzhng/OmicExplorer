/** A project (`.omicexplorer`) — the whole saved session. Structure:
 *
 *    Project  →  Folders  →  Workflows
 *
 *  A folder is a filesystem directory (holding input/output/data) scanned for
 *  inputs; each folder owns its own workflows. Opening a project restores the
 *  session exactly (embedded results and all). */
import type { NodeResult } from './types'
import { emptyWorkflowDoc, type WorkflowDoc } from './workflowDoc'

export interface ProjectWorkflow {
  id: string
  name: string
  doc: WorkflowDoc
  /** embedded computed results (keyed by node id) so the session resumes exactly */
  results: Record<string, NodeResult>
}

export interface ProjectFolder {
  id: string
  name: string
  /** filesystem folder scanned for inputs; '' until the user picks one */
  path: string
  workflows: ProjectWorkflow[]
  activeWorkflowId: string
}

export interface ProjectFile {
  format: 'omicexplorer-project'
  /** 1 = flat {dataDir, workflows}; 2 = {folders[]} */
  version: 2
  name: string
  folders: ProjectFolder[]
  activeFolderId: string
  /** UI page to restore on open — the Workflow canvas or the Results dashboard. Optional (older
   *  files default to the canvas). */
  view?: 'canvas' | 'results'
  /** the Results tab (analysis-group id) that was active, restored alongside `view`. */
  resultsTab?: string | null
  /** where a per-tile download was last saved in this project; the next save-as opens there
   *  instead of the data folder's `output/`. */
  saveDir?: string | null
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

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2)
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
          results: w.results ?? {}
        }))
      : [emptyWorkflow()]
  const active = activeId && workflows.some((w) => w.id === activeId) ? activeId : workflows[0].id
  return { workflows, activeWorkflowId: active }
}

/** Object keys renamed by the strain → cell condition rename (v0.4). */
const RENAMED_KEYS: Record<string, string> = { strain: 'cell' }
/** The boolean "per strain/cell" clean-up flag became a list of grouping conditions (v0.4):
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

/** The `strain` condition was renamed `cell` (v0.4). Rewrite every place a saved project names
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
        activeWorkflowId
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
    version: 2,
    name: raw.name ?? 'Untitled project',
    folders,
    activeFolderId,
    view: raw.view === 'results' ? 'results' : 'canvas',
    resultsTab: typeof raw.resultsTab === 'string' ? raw.resultsTab : null,
    saveDir: typeof raw.saveDir === 'string' && raw.saveDir ? raw.saveDir : null
  }
}

/** A fresh single-folder, single-workflow project (unsaved, no data folder yet). */
export function newProjectFile(name = 'Untitled project'): ProjectFile {
  const folder = newFolder('', 'Folder 1')
  return {
    format: 'omicexplorer-project',
    version: 2,
    name,
    folders: [folder],
    activeFolderId: folder.id
  }
}
