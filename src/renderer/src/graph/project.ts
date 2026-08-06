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
}

/** Counter-based ids (no Math.random — deterministic and test-stable). */
let seq = 0
const uid = (p: string): string => {
  seq += 1
  return `${p}-${seq}`
}
export const nextWorkflowId = (): string => uid('wf')
export const nextFolderId = (): string => uid('fd')

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

/** Parse + validate a project file, migrating the v1 (flat) shape into a folder. */
export function deserializeProject(text: string): ProjectFile {
  const raw = JSON.parse(text) as Partial<ProjectFile> & ProjectFileV1
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
    activeFolderId
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
