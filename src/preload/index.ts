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
/** Where a workflow's generated files live: its folder (`base`, absolute), plus the workflow name
 *  whose older `<data folder>/<name>` subfolder is still read from. A bare string is the older
 *  form (a workflow name nested under the data folder). */
export type WorkflowScope = string | { base: string; legacy?: string }

/** One folder move a project save applies (see main/data-layout.ts). */
export interface DirOp {
  from: string
  to: string
  mode: 'rename' | 'move' | 'copy'
  unique?: boolean
}
export interface DirOpResult {
  from: string
  to: string
  ok: boolean
  skipped?: boolean
  error?: string
}

/** One entry of a folder listing (see fs:listDir). */
export interface DirEntry {
  name: string
  path: string
  dir: boolean
  size: number
  /** last-modified time, epoch ms */
  mtime: number
}

export interface WorkflowEntry {
  name: string
  path: string
}

/** One rendered plot handed to the main process to write (see plots:export). `base64` holds
 *  the PNG bytes, or for `svg` the markup. */
export interface ExportItem {
  relPath: string
  format: 'png' | 'pdf' | 'svg'
  base64: string
  widthIn: number
  heightIn: number
}

/** One plot to put on the OS clipboard (see plots:copy). */
export type CopyPayload = { format: 'png'; base64: string } | { format: 'svg'; svg: string }
export interface ExportResult {
  dir: string
  written: number
  errors: string[]
}

/** What the app-wide reference cache holds (Settings › Database; main/ref-cache.ts). */
export interface RefCacheSummary {
  root: string
  uniprot: {
    bytes: number
    updated: number
    accessions: number
    releases: { release: string; count: number }[]
    sources: { label: string; field: string; count: number; outdated: number }[]
    species: {
      taxon: number
      count: number
      releases: string[]
      sources: { label: string; field: string; count: number; outdated: number }[]
      bytes: number
    }[]
  } | null
  string: {
    taxon: number
    version: string
    bytes: number
    oldBytes: number
    names: boolean
    updated: number
  }[]
}
/** One page of Settings' cache browser: one species, one source (main/ref-cache.ts). */
export interface RefCacheBrowseQuery {
  taxon: number
  field: string
  query: string
  emptyOnly?: boolean
  offset: number
  limit: number
}
export interface RefCacheBrowseResult {
  cols: string[]
  total: number
  rows: { acc: string; gene: string; values: string[] }[]
}
export type RefCacheTarget =
  | { kind: 'uniprot' }
  | { kind: 'uniprot-taxon'; taxon: number }
  | { kind: 'string'; taxon: number }
  | { kind: 'string-old' }

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
  /** Write a file under the workflow folder's input/ (`scope`), else <dir>/input. */
  writeInputFile: (
    dir: string,
    name: string,
    content: string,
    scope?: WorkflowScope
  ): Promise<void> => ipcRenderer.invoke('wf:writeInput', dir, name, content, scope),

  // ── projects (.omicexplorer) ─────────────────────────────────────────────────
  /** Open a project via native picker; returns its path + JSON text (null if cancelled). */
  openProject: (): Promise<{ path: string; content: string } | null> =>
    ipcRenderer.invoke('proj:open'),
  /** Open a template (.omicexplorer-template) via native picker; its path + text (null if
   *  cancelled). */
  openTemplate: (): Promise<{ path: string; content: string } | null> =>
    ipcRenderer.invoke('tpl:open'),
  /** Read a project file's text by path. */
  readProject: (path: string): Promise<string> => ipcRenderer.invoke('proj:read', path),
  /** The project this window was opened for (from Finder / the command line), once; else null. */
  takeLaunchProject: (): Promise<string | null> => ipcRenderer.invoke('proj:takeLaunch'),
  /** Park an inactive workflow's packed results on disk (its JSON text, in pieces). */
  parkWrite: (key: string, pieces: string[]): Promise<void> =>
    ipcRenderer.invoke('park:write', key, pieces),
  /** Read parked results back (their JSON text). */
  parkRead: (key: string): Promise<string> => ipcRenderer.invoke('park:read', key),
  /** Forget parked results. */
  parkDrop: (key: string): Promise<void> => ipcRenderer.invoke('park:drop', key),
  /** The first characters of each project file (its header) — null where unreadable. */
  readProjectHeads: (paths: string[]): Promise<Record<string, string | null>> =>
    ipcRenderer.invoke('proj:heads', paths),
  /** Copy a project file beside itself before it's rewritten; resolves to the copy's path. */
  backupProject: (path: string, version: string): Promise<string> =>
    ipcRenderer.invoke('proj:backup', path, version),
  /** Write a project file — its text whole, or in pieces written one after another; a
   *  `{ park }` piece is that parked workflow's results, copied in from its park file. */
  saveProject: (path: string, content: string | Array<string | { park: string }>): Promise<void> =>
    ipcRenderer.invoke('proj:save', path, content),
  /** Native save-as dialog; returns the chosen .omicexplorer path (null if cancelled). */
  pickProjectSavePath: (suggestedName?: string): Promise<string | null> =>
    ipcRenderer.invoke('proj:pickSavePath', suggestedName),
  /** Pick a data folder (null if cancelled). */
  pickDataDir: (): Promise<string | null> => ipcRenderer.invoke('proj:pickDataDir'),
  /** Native save-as for one file: returns the chosen absolute path with `ext` enforced, or null. */
  pickSavePath: (opts: {
    defaultPath: string
    ext: string
    typeName: string
  }): Promise<string | null> => ipcRenderer.invoke('file:pickSave', opts),
  /** Tell main whether the in-memory project has unsaved changes (drives the close prompt). */
  setProjectDirty: (dirty: boolean, name: string): void =>
    ipcRenderer.send('proj:dirty', dirty, name),
  /** Native Save / Don't Save / Cancel prompt; `action` completes "before …?" (e.g. "closing"). */
  askSaveChanges: (action: string): Promise<'save' | 'discard' | 'cancel'> =>
    ipcRenderer.invoke('proj:askSave', action),
  /** Native warning that the project was saved by a newer app version (`savedBy`) and may not
   *  work right in this one (`current`); resolves once dismissed. */
  warnNewerProject: (name: string, savedBy: string, current: string): Promise<void> =>
    ipcRenderer.invoke('proj:warnNewer', name, savedBy, current),
  /** Main asks the renderer to save (on close → Save). The handler resolves true once written,
   *  false if it couldn't (save-as cancelled). Returns an unsubscribe. */
  onSaveRequest: (handler: () => Promise<boolean>): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, token: number): void => {
      handler().then(
        (ok) => ipcRenderer.send('proj:saveResult', token, ok),
        () => ipcRenderer.send('proj:saveResult', token, false)
      )
    }
    ipcRenderer.on('proj:saveRequest', listener)
    return () => ipcRenderer.removeListener('proj:saveRequest', listener)
  },
  /** Whether a path exists on disk (`dir` = exists and is a directory). */
  pathExists: (p: string): Promise<{ exists: boolean; dir: boolean }> =>
    ipcRenderer.invoke('fs:exists', p),
  /** This app run's scratch folder, where an unsaved project's files go until its first save. */
  scratchDir: (): Promise<string> => ipcRenderer.invoke('layout:scratchDir'),
  /** Apply a save's folder moves in order (renames, scratch → data folder, Save-as copies). */
  applyDirOps: (ops: DirOp[]): Promise<DirOpResult[]> =>
    ipcRenderer.invoke('layout:applyDirOps', ops),
  /** One level of a folder for the project-folder viewer: folders first, dotfiles hidden. */
  listDir: (dir: string): Promise<DirEntry[]> => ipcRenderer.invoke('fs:listDir', dir),
  /** Delete these files / folders (recursively), each only if inside `root` (a project folder
   *  clean-up); returns what couldn't be removed. */
  removeInside: (root: string, paths: string[]): Promise<string[]> =>
    ipcRenderer.invoke('layout:removeInside', root, paths),
  /** Select a file or folder in the OS file manager. */
  revealPath: (p: string): Promise<void> => ipcRenderer.invoke('fs:reveal', p),
  /** Open a file in its default app; resolves to an error message, or '' on success. */
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('fs:open', p),
  /** List input files (csv/tsv/txt) in a data folder — and, with `scope`, the workflow's folder. */
  listDataFiles: (dir: string, scope?: WorkflowScope): Promise<string[]> =>
    ipcRenderer.invoke('data:list', dir, scope),
  /** Each input file's folder, relative to the data folder ('' = the folder itself) — where it's
   *  read from. */
  listDataFileFolders: (dir: string, scope?: WorkflowScope): Promise<Record<string, string>> =>
    ipcRenderer.invoke('data:listWhere', dir, scope),
  /** Read a file from the data folder — or, when `name` is an absolute path, that file directly
   *  (null if missing). With `scope`, the workflow's folder is tried first, then the older
   *  per-workflow subfolder and the shared data-folder root. */
  /** Copy the named input files from data folder `from` to the same places under `to` (a data
   *  folder changing location); never overwrites. */
  copyInputFiles: (
    from: string,
    to: string,
    files: Array<{ name: string; legacy?: string }>
  ): Promise<{ copied: string[]; errors: string[] }> =>
    ipcRenderer.invoke('data:copyInputs', from, to, files),
  readDataFile: (dir: string, name: string, scope?: WorkflowScope): Promise<string | null> =>
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
  /** Put plain text on the clipboard. */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clip:text', text),
  /** Put one rendered plot on the clipboard: PNG as an image; SVG as a vector picture (macOS) or markup text. */
  copyPlot: (payload: CopyPayload): Promise<void> => ipcRenderer.invoke('plots:copy', payload),
  /** Reveal a folder in the OS file manager. */
  revealFolder: (dir: string): Promise<void> => ipcRenderer.invoke('plots:reveal', dir),

  // ── external annotation ────────────────────────────────────────────────────────
  /** Fetch UniProt annotations for a list of accessions; returns {byId, fields, found, taxon, error?}.
   *  `refresh` bypasses the app-wide accession cache and re-queries every source. */
  fetchUniprot: (
    accessions: string[],
    fields: string[],
    opts?: { refresh?: boolean }
  ): Promise<{
    byId: Record<string, Record<string, string>>
    fields: string[]
    found: number
    taxon?: number
    keggOrg?: string
    keggCategories?: Record<string, string>
    error?: string
  }> => ipcRenderer.invoke('annot:uniprot', accessions, fields, opts),

  /** Subscribe to annotation fetch progress: accessions done / total during the UniProt pass, and
   *  a `stage` message while a downstream source (KEGG, COG, MSigDB, Reactome) resolves. Returns an
   *  unsubscribe fn. */
  onAnnotProgress: (
    cb: (p: { done: number; total: number; stage?: string }) => void
  ): (() => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; stage?: string }): void =>
      cb(p)
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
    /** best query–query / query–any link score (0–1000) at any confidence; −1 = none */
    maxQueryScore?: number
    maxLinkScore?: number
    error?: string
  }> => ipcRenderer.invoke('string:network', identifiers, species, requiredScore, maxInteractors),

  /** Every setting's STRING network for one query at once, from two local scans (see the main
   *  process's StringAllResult): `genes` is the widest query, strongest first, each gene's STRING
   *  ids; `caps` the gene caps offered (`genes` sent, `k` interactors). */
  fetchStringNetworkAll: (
    genes: string[][],
    species: number,
    caps: { genes: number; k: number }[]
  ): Promise<{
    nodes: { id: string; name: string }[]
    edges: { aId: string; bId: string; score: number }[]
    interactors: string[][][]
    maxLinkScore: number[]
    error?: string
  }> => ipcRenderer.invoke('string:networkAll', genes, species, caps),

  /** Download an organism's STRING interactome + canonical gene-name map into the app cache
   *  (idempotent). */
  ensureStringOrg: (taxon: number): Promise<{ cached: boolean; version: string; error?: string }> =>
    ipcRenderer.invoke('string:ensureOrg', taxon),

  /** What the UniProt / STRING reference cache holds, with versions and sizes. */
  refCacheSummary: (): Promise<RefCacheSummary> => ipcRenderer.invoke('refcache:summary'),
  /** Search one species' cached proteins for one source, a page at a time — local, no network. */
  browseRefCache: (q: RefCacheBrowseQuery): Promise<RefCacheBrowseResult> =>
    ipcRenderer.invoke('refcache:browse', q),
  /** The live UniProt release and STRING version ('' where unreachable) — goes to the network. */
  refCacheLatest: (): Promise<{ uniprot: string; string: string }> =>
    ipcRenderer.invoke('refcache:latest'),
  /** Re-fetch one annotation source (an import field id, e.g. 'kegg') for every cached protein
   *  that has it — goes to the network. */
  updateRefCacheSource: (field: string): Promise<{ proteins: number; error?: string }> =>
    ipcRenderer.invoke('refcache:updateSource', field),
  /** Subscribe to updateRefCacheSource's progress; returns an unsubscribe fn. */
  onRefCacheProgress: (
    cb: (p: { done: number; total: number; stage?: string }) => void
  ): (() => void) => {
    const listener = (_e: unknown, p: { done: number; total: number; stage?: string }): void =>
      cb(p)
    ipcRenderer.on('refcache:progress', listener)
    return () => ipcRenderer.removeListener('refcache:progress', listener)
  },
  /** Delete part of the reference cache (the caller confirms first); true when deleted. */
  clearRefCache: (target: RefCacheTarget): Promise<boolean> =>
    ipcRenderer.invoke('refcache:clear', target),

  /** Subscribe to STRING download progress events; returns an unsubscribe fn. */
  onStringProgress: (
    cb: (p: { taxon: number; stage: string; loaded: number; total: number }) => void
  ): (() => void) => {
    const listener = (
      _e: unknown,
      p: { taxon: number; stage: string; loaded: number; total: number }
    ): void => cb(p)
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
