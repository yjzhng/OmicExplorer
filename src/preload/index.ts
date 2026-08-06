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
  /** Write a file under <dir>/input. */
  writeInputFile: (dir: string, name: string, content: string): Promise<void> =>
    ipcRenderer.invoke('wf:writeInput', dir, name, content),
  /** Write processed data under <dir>/temp. */
  writeTempFile: (dir: string, name: string, content: string): Promise<void> =>
    ipcRenderer.invoke('wf:writeTemp', dir, name, content),

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
  /** Read a file from the data folder (null if missing). */
  readDataFile: (dir: string, name: string): Promise<string | null> =>
    ipcRenderer.invoke('data:read', dir, name),

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
  revealFolder: (dir: string): Promise<void> => ipcRenderer.invoke('plots:reveal', dir)
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // Fallback when contextIsolation is disabled.
  ;(window as unknown as { api: Api }).api = api
}

export type Api = typeof api
