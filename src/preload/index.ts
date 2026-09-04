import { contextBridge, ipcRenderer } from 'electron'

export interface OpenFileResult {
  path: string
  name: string
  content: string
}

export interface OpenFileOptions {
  filters?: { name: string; extensions: string[] }[]
  title?: string
}

/**
 * Secure bridge to the renderer. Add your app's IPC methods here — typically thin
 * `ipcRenderer.invoke(...)` wrappers around handlers in the main process.
 *
 * Window / aspect-ratio switching is intentionally NOT here: it's a dev tool in the
 * main-process menu (see src/main/dev-menu.ts), so it stays out of your app UI.
 */
export interface WorkflowEntry {
  name: string
  path: string
}

/** One rendered plot handed to the main process to write (see plots:export). */
export interface ExportItem {
  relPath: string
  format: 'png' | 'pdf'
  base64: string
  widthIn: number
  heightIn: number
}
export interface ExportResult {
  dir: string
  written: number
  errors: string[]
}

/** One table handed to the main process to write as CSV/XLSX (see tables:export). */
export interface TableItem {
  relPath: string
  sheetName: string
  columns: string[]
  rows: Array<Array<string | number | null>>
}

const api = {
  platform: process.platform,
  /** Open a native file picker and read the chosen file's text (null if cancelled). */
  openFile: (opts?: OpenFileOptions): Promise<OpenFileResult | null> =>
    ipcRenderer.invoke('file:open', opts),
  /** Default workflow directory (created if missing). */
  workflowDefaultDir: (): Promise<string> => ipcRenderer.invoke('wf:defaultDir'),
  /** Pick a workflow directory (null if cancelled). */
  pickWorkflowDir: (): Promise<string | null> => ipcRenderer.invoke('wf:pickDir'),
  /** List *.json workflow files in a directory. */
  listWorkflows: (dir: string): Promise<WorkflowEntry[]> => ipcRenderer.invoke('wf:list', dir),
  /** Read a workflow file's text. */
  readWorkflow: (path: string): Promise<string> => ipcRenderer.invoke('wf:read', path),
  /** Write a workflow file. */
  writeWorkflow: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('wf:write', path, content),
  /** List files under <dir>/input. */
  listInputFiles: (dir: string): Promise<string[]> => ipcRenderer.invoke('wf:listInput', dir),
  /** Read a file under <dir>/input (null if missing). */
  readInputFile: (dir: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('wf:readInput', dir, name),
  /** Write a file under <dir>/[scope/]input (scope = the per-workflow subfolder, when nesting). */
  writeInputFile: (dir: string, name: string, content: string, scope?: string): Promise<void> =>
    ipcRenderer.invoke('wf:writeInput', dir, name, content, scope),
  /** Write processed data under <dir>/[scope/]temp. */
  writeTempFile: (dir: string, name: string, content: string, scope?: string): Promise<void> =>
    ipcRenderer.invoke('wf:writeTemp', dir, name, content, scope),

  // ── projects (.omicexplorer) ─────────────────────────────────────────────────
  /** Open a project via native picker; returns its path + JSON text (null if cancelled). */
  openProject: (): Promise<{ path: string; content: string } | null> =>
    ipcRenderer.invoke('proj:open'),
  /** Read a project file's text by path. */
  readProject: (path: string): Promise<string> => ipcRenderer.invoke('proj:read', path),
  /** Write a project file. */
  saveProject: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('proj:save', path, content),
  /** Native save-as dialog; returns the chosen .omicexplorer path (null if cancelled). */
  pickProjectSavePath: (suggestedName?: string): Promise<string | null> =>
    ipcRenderer.invoke('proj:pickSavePath', suggestedName),
  /** Pick a data folder (null if cancelled). */
  pickDataDir: (): Promise<string | null> => ipcRenderer.invoke('proj:pickDataDir'),
  /** Whether a path exists on disk (`dir` = exists and is a directory). */
  pathExists: (p: string): Promise<{ exists: boolean; dir: boolean }> =>
    ipcRenderer.invoke('fs:exists', p),
  /** List input files (csv/tsv/txt) directly under a data folder. */
  listDataFiles: (dir: string): Promise<string[]> => ipcRenderer.invoke('data:list', dir),
  /** Read a file from the data folder — or, when `name` is an absolute path, that file directly
   *  (null if missing). When `scope` (a per-workflow subfolder) is given, the workflow subfolder is
   *  tried first, then the shared data-folder root. */
  readDataFile: (dir: string, name: string, scope?: string): Promise<string | null> =>
    ipcRenderer.invoke('data:read', dir, name, scope),
  /** Pick a data matrix from anywhere on disk via the native picker; returns its absolute path
   *  (readable via readDataFile), or null if cancelled. */
  pickDataFile: (): Promise<string | null> => ipcRenderer.invoke('data:pickFile'),

  // ── plot export ──────────────────────────────────────────────────────────────
  /** Write rendered plots (PNG/PDF) under baseDir; returns count + any per-file errors. */
  exportPlots: (payload: { baseDir: string; items: ExportItem[] }): Promise<ExportResult> =>
    ipcRenderer.invoke('plots:export', payload),
  /** Write result tables (CSV/XLSX) under baseDir. */
  exportTables: (payload: {
    baseDir: string
    format: 'csv' | 'xlsx'
    items: TableItem[]
  }): Promise<ExportResult> => ipcRenderer.invoke('tables:export', payload),
  /** Reveal a folder in the OS file manager. */
  revealFolder: (dir: string): Promise<void> => ipcRenderer.invoke('plots:reveal', dir),

  // ── external annotation ────────────────────────────────────────────────────────
  /** Fetch UniProt annotations for a list of accessions; returns {byId, fields, found, taxon, error?}. */
  fetchUniprot: (
    accessions: string[],
    fields: string[]
  ): Promise<{
    byId: Record<string, Record<string, string>>
    fields: string[]
    found: number
    taxon?: number
    keggOrg?: string
    keggCategories?: Record<string, string>
    error?: string
  }> => ipcRenderer.invoke('annot:uniprot', accessions, fields),

  /** Subscribe to UniProt fetch progress (accessions done / total); returns an unsubscribe fn. */
  onAnnotProgress: (cb: (p: { done: number; total: number }) => void): (() => void) => {
    const listener = (_e: unknown, p: { done: number; total: number }): void => cb(p)
    ipcRenderer.on('annot:progress', listener)
    return () => ipcRenderer.removeListener('annot:progress', listener)
  },

  /** Fetch the STRING interaction network among `identifiers` for a species (NCBI taxon).
   *  `requiredScore` is 0–1000 (STRING confidence). When `maxInteractors > 0`, also includes up to
   *  that many first-shell interactors (top proteins connecting to the query set) ON TOP of the query.
   *  Returns nodes (`isQuery` flagged) + confidence-scored edges. */
  fetchStringNetwork: (
    identifiers: string[],
    species: number,
    requiredScore: number,
    maxInteractors = 0
  ): Promise<{
    nodes: { id: string; name: string; isQuery: boolean }[]
    edges: { aId: string; bId: string; score: number }[]
    error?: string
  }> => ipcRenderer.invoke('string:network', identifiers, species, requiredScore, maxInteractors),

  /** Download an organism's STRING interactome + canonical gene-name map into the app cache
   *  (idempotent). */
  ensureStringOrg: (
    taxon: number
  ): Promise<{ cached: boolean; version: string; error?: string }> =>
    ipcRenderer.invoke('string:ensureOrg', taxon),

  /** Subscribe to STRING download progress events; returns an unsubscribe fn. */
  onStringProgress: (
    cb: (p: { taxon: number; stage: string; loaded: number; total: number }) => void
  ): (() => void) => {
    const listener = (_e: unknown, p: { taxon: number; stage: string; loaded: number; total: number }): void =>
      cb(p)
    ipcRenderer.on('string:progress', listener)
    return () => ipcRenderer.removeListener('string:progress', listener)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Fallback when contextIsolation is disabled.
  ;(window as unknown as { api: Api }).api = api
}

export type Api = typeof api
