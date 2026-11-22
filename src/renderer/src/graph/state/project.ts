import { reportError } from '../../shared/diagnostics'
import { useAppView } from '../../ui/useAppView'
import { dataFolderName, dataRootOf, outDirName, pathSeg, planRenames } from '../diskNames'
import { exclusiveDisk } from '../diskWrites'
import { loadLastView } from '../lastView'
import {
  deserializeProject,
  isNewerVersion,
  newProjectFile,
  ParkedRef,
  PROJECT_VERSION,
  type ProjectFile,
  type ProjectFolder,
  type ProjectHeader,
  projectHeader,
  type ProjectWorkflow,
  relocateFolders,
  savedByVersion,
  serializeProjectChunks,
  storedResultsChunks,
  unpackResults,
  upgradesDue,
  withRelPaths
} from '../project'
import { loadRecents, pushRecent, removeRecent, saveRecents } from '../recents'
import { categoryOf, stepTitle } from '../registry'
import { type Getter, type GraphState, type Setter, type StoreSet } from '../store'
import {
  buildTemplate,
  isTemplateText,
  projectFromTemplate,
  serializeTemplate,
  TEMPLATE_EXT
} from '../template'
import type { LoadConfig, NodeResult } from '../types'
import {
  type CleanupPlan,
  graphOf,
  parkQueue,
  loadSlot,
  locationOf,
  syncActiveSlot,
  PARK_SESSION,
  nextParkSeq
} from './shared'

/** Whether each of these recent files saved before the last upgrade is changed by it — read in
 *  full, off the UI thread (upgradeCheck.worker), one at a time, into recentUpgrades. The answer is
 *  kept per file and the release that saved it (localStorage), so a file is read once. */
export const UPGRADE_CHECK_KEY = 'omicexplorer-upgrade-check'
export let upgradeWorker: Worker | null = null
export let upgradeSeq = 0
export async function checkUpgrades(
  get: Getter,
  set: Setter,
  headers: Record<string, ProjectHeader>
): Promise<void> {
  let cache: Record<string, { sig: string; changes: boolean }> = {}
  try {
    cache = JSON.parse(localStorage.getItem(UPGRADE_CHECK_KEY) ?? '{}')
  } catch {
    // unreadable: checked afresh
  }
  const put = (path: string, changes: boolean): void =>
    set({ recentUpgrades: { ...get().recentUpgrades, [path]: changes } })
  for (const [path, h] of Object.entries(headers)) {
    if (!upgradesDue(h)) continue
    const sig = `${h.format ?? ''}|${h.savedBy ?? ''}|${h.createdWith ?? ''}`
    if (cache[path]?.sig === sig) {
      put(path, cache[path].changes)
      continue
    }
    try {
      const text = await window.api.readProject(path)
      upgradeWorker ??= new Worker(new URL('../upgradeCheck.worker.ts', import.meta.url), {
        type: 'module'
      })
      const w = upgradeWorker
      const id = ++upgradeSeq
      const changes = await new Promise<boolean | null>((resolve) => {
        const on = (e: MessageEvent<{ id: number; changes: boolean | null }>): void => {
          if (e.data.id !== id) return
          w.removeEventListener('message', on)
          resolve(e.data.changes)
        }
        w.addEventListener('message', on)
        w.postMessage({ id, text })
      })
      if (changes == null) continue
      put(path, changes)
      cache[path] = { sig, changes }
      try {
        localStorage.setItem(UPGRADE_CHECK_KEY, JSON.stringify(cache))
      } catch {
        // best-effort, like recents
      }
    } catch {
      // unreadable now: no answer, so no amber tag
    }
  }
}
/** Pin output/ folder names for these processing steps of a workflow (the active one by default;
 *  first use takes the step's current name); returns each one's name. Not undoable and doesn't
 *  dirty the project — a name not yet saved is simply re-derived from the step's name next time. */
export function pinOutDirs(
  get: Getter,
  set: Setter,
  stepIds: string[],
  folderId: string | null = get().activeFolderId,
  workflowId: string | null = get().activeWorkflowId
): Record<string, string> {
  const s = get()
  const folder = s.folders.find((f) => f.id === folderId)
  const wf = folder?.workflows.find((w) => w.id === workflowId)
  if (!folder || !wf) return {}
  const titles = stepTitlesOf(s, folder.id, wf)
  const outDirs = { ...(wf.outDirs ?? {}) }
  const names: Record<string, string> = {}
  let changed = false
  for (const id of stepIds) {
    const title = titles.get(id)
    if (title == null) continue
    if (!outDirs[id]) {
      outDirs[id] = outDirName(outDirs, id, title)
      changed = true
    }
    names[id] = outDirs[id]
  }
  if (changed)
    set({
      folders: s.folders.map((f) =>
        f.id !== folder.id
          ? f
          : { ...f, workflows: f.workflows.map((w) => (w.id === wf.id ? { ...w, outDirs } : w)) }
      )
    })
  return names
}
/** A folder's entries, or none when it can't be read (missing). */
export async function entriesOf(
  dir: string
): Promise<Array<{ name: string; path: string; dir: boolean }>> {
  try {
    return await window.api.listDir(dir)
  } catch {
    return []
  }
}
/**
 * Everything under a data folder's project data folder that the project no longer uses: folders of
 * workflows it no longer has; in each workflow's folder, anything besides input/ and output/; input
 * files no Load tile of that workflow reads; output folders of steps it no longer has. A live
 * step's output folder is kept whole (its run tables and your downloads). Names are compared
 * ignoring case, as a Mac disk does.
 */
export async function planCleanupOf(s: GraphState, folderId: string): Promise<CleanupPlan | null> {
  const f = s.folders.find((x) => x.id === folderId)
  if (!f) return null
  const root = dataRootOf(f, {
    saved: !!s.projectPath,
    projectName: s.projectName,
    scratch: s.scratchRoot
  })
  if (!root) return null
  const lc = (n: string): string => n.toLowerCase()
  const remove: string[] = []
  const wfByDir = new Map(f.workflows.map((w) => [lc(w.dir ?? pathSeg(w.name, 'Workflow')), w]))
  for (const e of await entriesOf(root)) {
    const w = e.dir ? wfByDir.get(lc(e.name)) : undefined
    if (!w) {
      remove.push(e.path)
      continue
    }
    const nodes = graphOf(s, f.id, w).nodes
    for (const sub of await entriesOf(e.path)) {
      if (sub.dir && lc(sub.name) === 'input') {
        const refs = new Set<string>()
        for (const n of nodes)
          if (n.data.kind === 'load') {
            const c = n.data.config as LoadConfig
            for (const name of [c.matrix, c.data, c.samplesheet, c.db]) if (name) refs.add(lc(name))
          }
        for (const file of await entriesOf(sub.path))
          if (!refs.has(lc(file.name))) remove.push(file.path)
      } else if (sub.dir && lc(sub.name) === 'output') {
        // The live steps' folders: their pinned names, else (not written to yet) their names now.
        const live = new Set(nodes.map((n) => n.id))
        const keep = new Set<string>()
        for (const [id, d] of Object.entries(w.outDirs ?? {})) if (live.has(id)) keep.add(lc(d))
        for (const n of nodes)
          if (!w.outDirs?.[n.id] && categoryOf(n.data.kind) === 'processing')
            keep.add(lc(pathSeg(stepTitle(n), 'Step')))
        // Kept too: a flat batch export's files of a live step (`<step>__<file>`) and its
        // `selected/` folder, written straight into output/.
        const used = (out: { name: string; dir: boolean }): boolean =>
          out.dir
            ? keep.has(lc(out.name)) || lc(out.name) === 'selected'
            : [...keep].some((k) => lc(out.name).startsWith(`${k}__`))
        for (const out of await entriesOf(sub.path)) if (!used(out)) remove.push(out.path)
      } else remove.push(sub.path)
    }
  }
  return { folderId, root, remove }
}
/** A workflow's step names, by id. */
export function stepTitlesOf(
  s: GraphState,
  folderId: string,
  wf: ProjectWorkflow
): Map<string, string> {
  return new Map(graphOf(s, folderId, wf).nodes.map((n) => [n.id, stepTitle(n)]))
}
/**
 * Bring the disk in line with the project as it's being saved (see graph/diskNames.ts), per data
 * folder: first the project data folder itself — moved out of scratch on the first save, copied to
 * the new name on Save as (the original project keeps its own), else renamed after the project —
 * then each renamed workflow's folder, then each renamed step's output/ folder. Runs with file
 * writes held back (graph/diskWrites.ts). Records the names that resulted (a failed move keeps the
 * old one) and returns what couldn't be done, for the save to report.
 */
export async function applyDiskLayout(
  get: Getter,
  set: Setter,
  mode: 'first' | 'copy' | 'rename'
): Promise<string[]> {
  return exclusiveDisk(async () => {
    const warnings: string[] = []
    const fail = (what: string, err?: string): void => {
      warnings.push(err ? `${what}: ${err}` : what)
    }
    const nameOf = (p: string): string => p.split(/[/\\]/).pop() ?? p
    const want = dataFolderName(get().projectName)
    const scratch = get().scratchRoot
    const folders: ProjectFolder[] = []
    for (const f of get().folders) {
      if (!f.path) {
        folders.push(f)
        continue
      }
      // 1 · the project data folder
      let dataName = f.dataName ?? want
      if (mode === 'first') {
        if (scratch) {
          const [r] = await window.api.applyDirOps([
            { from: `${scratch}/${f.id}`, to: `${f.path}/${want}`, mode: 'move', unique: true }
          ])
          dataName = r.ok && !r.skipped ? nameOf(r.to) : want
          if (!r.ok) fail(`Couldn't move this session's files into ${f.path}`, r.error)
        } else dataName = want
      } else if (mode === 'copy' && f.dataName) {
        const [r] = await window.api.applyDirOps([
          { from: `${f.path}/${f.dataName}`, to: `${f.path}/${want}`, mode: 'copy', unique: true }
        ])
        if (r.ok) dataName = r.skipped ? want : nameOf(r.to)
        else
          fail(`Couldn't copy ${f.dataName} to ${want} (still shared with the original)`, r.error)
      } else if (f.dataName && f.dataName !== want) {
        const [r] = await window.api.applyDirOps([
          { from: `${f.path}/${f.dataName}`, to: `${f.path}/${want}`, mode: 'rename' }
        ])
        if (r.ok) dataName = want
        else fail(`Couldn't rename ${f.dataName} to ${want}`, r.error)
      }
      const root = `${f.path}/${dataName}`

      // 2 · workflow folders
      const wfPlan = planRenames(
        f.workflows.map((w) => ({
          key: w.id,
          dir: w.dir ?? pathSeg(w.name, 'Workflow'),
          want: pathSeg(w.name, 'Workflow')
        }))
      )
      const wfMoves = wfPlan.filter((p) => p.to !== p.dir)
      const wfRes = await window.api.applyDirOps(
        wfMoves.map((p) => ({ from: `${root}/${p.dir}`, to: `${root}/${p.to}`, mode: 'rename' }))
      )
      const dirOf = new Map(wfPlan.map((p) => [p.key, p.to]))
      wfMoves.forEach((p, i) => {
        if (wfRes[i].ok) return
        dirOf.set(p.key, p.dir)
        fail(`Couldn't rename workflow folder ${p.dir} to ${p.to}`, wfRes[i].error)
      })

      // 3 · each workflow's step output folders
      const workflows: ProjectWorkflow[] = []
      for (const w of f.workflows) {
        const dir = dirOf.get(w.id) ?? w.dir
        const titles = stepTitlesOf(get(), f.id, w)
        // A deleted step's folder stays on disk; it just stops being tracked.
        const tracked = Object.entries(w.outDirs ?? {}).filter(([id]) => titles.has(id))
        const outPlan = planRenames(
          tracked.map(([id, d]) => ({ key: id, dir: d, want: pathSeg(titles.get(id)!, 'Step') }))
        )
        const outMoves = outPlan.filter((p) => p.to !== p.dir)
        const out = `${root}/${dir}/output`
        const outRes = await window.api.applyDirOps(
          outMoves.map((p) => ({ from: `${out}/${p.dir}`, to: `${out}/${p.to}`, mode: 'rename' }))
        )
        const outDirs = Object.fromEntries(outPlan.map((p) => [p.key, p.to]))
        outMoves.forEach((p, i) => {
          if (outRes[i].ok) return
          outDirs[p.key] = p.dir
          fail(`Couldn't rename output folder ${p.dir} to ${p.to}`, outRes[i].error)
        })

        workflows.push({ ...w, dir, outDirs })
      }
      folders.push({ ...f, dataName, workflows })
    }
    set({ folders })
    return warnings
  })
}
/** A failed save's reason, for the message by the Save button. */
export function saveErrorText(err: unknown): string {
  const msg = reportError(err, { where: 'save-project' })
  return `Couldn't save the project: ${msg.replace(/^Error invoking remote method '[^']+': /, '')}`
}
/** The project file with every parked workflow's results as a reference to its park file
 *  (ParkedRef): the main process copies the file's packed text into the save itself, so it's never
 *  read into the renderer and sent back. */
export async function withParkedResults(p: ProjectFile): Promise<ProjectFile> {
  await parkQueue // let any parking in flight settle first
  const folders = p.folders.map((f) => ({
    ...f,
    workflows: f.workflows.map((w) =>
      w.parked
        ? { ...w, results: new ParkedRef(w.parked) as unknown as Record<string, NodeResult> }
        : w
    )
  }))
  return { ...p, folders }
}
/** A save's folder problems as one message (null when there were none). */
/** Resolves once the browser has painted a frame — so a notice just set shows before work that
 *  holds the thread. At once where there's no frame to wait for (tests). */
const paintFrame = (): Promise<void> =>
  typeof requestAnimationFrame === 'function'
    ? new Promise((done) => requestAnimationFrame(() => setTimeout(done, 0)))
    : Promise.resolve()

export const layoutWarning = (warnings: string[]): string | null =>
  warnings.length ? `Saved, but some folders weren't updated — ${warnings.join('; ')}` : null
/** Replace the session with a new, unsaved project made from a template's text. Its folders have
 *  no data folder yet — each is picked from the folder selector, as for a new project. */
export function startFromTemplate(get: Getter, set: Setter, text: string): void {
  const proj = projectFromTemplate(text)
  set({
    projectPath: null,
    projectName: 'Untitled project',
    projectCreatedWith: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
    projectOpen: true,
    folders: proj.folders,
    activeFolderId: proj.activeFolderId,
    geneSets: proj.geneSets ?? [],
    dirty: false,
    inputFiles: [],
    inputFileFolders: {},
    openError: null
  })
  loadSlot(get, set, proj.activeFolderId)
  useAppView.getState().setView('canvas')
}
/** The header a file just saved from this session carries (for the home page's version tag). */
export function savedHeader(get: Getter): ProjectHeader {
  return {
    format: PROJECT_VERSION,
    savedBy: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
    createdWith: get().projectCreatedWith
  }
}
export function buildProjectFile(get: Getter): ProjectFile {
  const s = get()
  const av = useAppView.getState()
  return {
    format: 'omicexplorer-project',
    version: PROJECT_VERSION,
    // Named when an older app version is asked to open this file (see deserializeProject).
    ...(typeof __APP_VERSION__ === 'string' ? { appVersion: __APP_VERSION__ } : null),
    ...(s.projectCreatedWith ? { createdWith: s.projectCreatedWith } : null),
    name: s.projectName,
    folders: s.projectPath ? withRelPaths(s.folders, s.projectPath) : s.folders,
    activeFolderId: s.activeFolderId ?? s.folders[0]?.id ?? '',
    // Persist which page the user was on so opening the project resumes it (see openProject).
    view: av.view,
    resultsTab: av.resultsTab,
    geneSets: s.geneSets
  }
}
/** The project file: new / open / save / save as / templates, its output folders, the recent projects. */
export function projectSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'outputDirFor'
  | 'planCleanup'
  | 'applyCleanup'
  | 'outputLayoutFor'
  | 'outputSubdirFor'
  | 'clearSaveError'
  | 'initProject'
  | 'goHome'
  | 'resumeProject'
  | 'confirmDiscard'
  | 'newProject'
  | 'openProject'
  | 'saveProject'
  | 'saveProjectAs'
  | 'saveTemplate'
  | 'newFromTemplate'
  | 'refreshDataFiles'
  | 'forgetRecent'
  | 'pruneMissingRecents'
  | 'loadRecentHeaders'
  | 'upgradeProject'
> {
  return {
    outputDirFor: (stepId) => {
      const loc = locationOf(get())
      if (!loc) return null
      const name = pinOutDirs(get, set, [stepId])[stepId]
      return name ? `${loc.scope.base}/output/${name}` : null
    },
    planCleanup: (folderId) => planCleanupOf(get(), folderId),
    applyCleanup: async (plan) => {
      const errors = await exclusiveDisk(() => window.api.removeInside(plan.root, plan.remove))
      // Deleted steps' output folder names are gone from disk: stop tracking them.
      set((s) => ({
        folders: s.folders.map((f) =>
          f.id !== plan.folderId
            ? f
            : {
                ...f,
                workflows: f.workflows.map((w) => {
                  const live = new Set(graphOf(s, f.id, w).nodes.map((n) => n.id))
                  const outDirs = Object.fromEntries(
                    Object.entries(w.outDirs ?? {}).filter(([id]) => live.has(id))
                  )
                  return { ...w, outDirs }
                })
              }
        )
      }))
      void get().refreshDataFiles()
      return errors
    },
    outputLayoutFor: (stepIds) => {
      const loc = locationOf(get())
      if (!loc) return null
      return { root: `${loc.scope.base}/output`, names: pinOutDirs(get, set, stepIds) }
    },
    outputSubdirFor: (stepId, folderId, workflowId) =>
      pinOutDirs(get, set, [stepId], folderId, workflowId)[stepId] ?? null,
    clearSaveError: () => set({ saveError: null, saveWarning: null }),

    // ── project (.omicexplorer) → folders → workflows ────────────────────────
    initProject: () => {
      // Show the home page on launch; a project is created/opened from there.
      set({ recentProjects: loadRecents(), projectOpen: false })
      return window.api
        .scratchDir()
        .then((scratchRoot) => set({ scratchRoot }))
        .catch(() => undefined)
    },
    goHome: () => {
      // Flush live edits back into the project so switching away loses nothing.
      if (get().projectOpen) syncActiveSlot(get, set)
      set({ projectOpen: false })
    },
    resumeProject: () => {
      // The project's live state (nodes/edges/folders/dirty) is kept in memory by goHome, so
      // re-entering it simply re-shows the workspace — unsaved changes are still there. Guarded so it
      // is a no-op on a fresh launch with no in-memory project.
      if (get().folders.length > 0) set({ projectOpen: true })
    },
    confirmDiscard: async (action) => {
      // goHome keeps the project in memory, so "dirty" applies even from the Home screen.
      if (!get().dirty || get().folders.length === 0) return true
      const choice = await window.api.askSaveChanges(action)
      if (choice === 'cancel') return false
      if (choice === 'save') return get().saveProject()
      return true
    },
    newProject: async () => {
      if (!(await get().confirmDiscard('starting a new project'))) return
      const proj = newProjectFile()
      set({
        projectPath: null,
        projectName: proj.name,
        projectCreatedWith: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null,
        projectOpen: true,
        folders: proj.folders,
        activeFolderId: proj.activeFolderId,
        geneSets: [],
        dirty: false,
        inputFiles: [],
        inputFileFolders: {}
      })
      loadSlot(get, set, proj.activeFolderId)
      // A fresh project always starts on the Workflow canvas.
      useAppView.getState().setView('canvas')
    },
    openProject: async (path) => {
      // One at a time: a click while a project is still loading (a big one takes seconds) is
      // ignored rather than starting it again.
      if (get().opening) return
      if (!(await get().confirmDiscard('opening another project'))) return
      set({ openError: null })
      let p = path ?? null
      // Shows the "Opening…" notice (App), and lets it paint before the reading and unpacking
      // below hold the thread.
      const loading = async (file: string): Promise<void> => {
        set({ opening: file })
        await paintFrame()
      }
      try {
        let text: string
        if (p) {
          await loading(p)
          text = await window.api.readProject(p)
        } else {
          const picked = await window.api.openProject()
          if (!picked) return
          p = picked.path
          await loading(p)
          text = picked.content
        }
        // Saved by a newer app: it may still open, so warn and carry on rather than refuse.
        const savedBy = savedByVersion(text)
        const current = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : null
        if (savedBy && current && isNewerVersion(savedBy, current)) {
          const file = p ? (p.split(/[/\\]/).pop() ?? p) : 'This project'
          await window.api.warnNewerProject(file, savedBy, current)
        }
        // A template opened as a project starts a new one from it — opening it in place would make
        // Save write a project over the template.
        if (isTemplateText(text)) {
          startFromTemplate(get, set, text)
          return
        }
        // Results stay packed for now: only the workflow opened is unpacked (below).
        const proj = deserializeProject(text, { packed: true })
        // Folders found next to the project by their saved relative paths (a project copied to
        // another machine with its folders) are used there — not an edit, so not dirty: the next
        // save writes their new full paths.
        if (p && typeof window.api.pathExists === 'function') {
          const isDir = (q: string): Promise<boolean> => window.api.pathExists(q).then((e) => e.dir)
          proj.folders = (await relocateFolders(proj.folders, p, isDir)).folders
        }
        // The project's display name follows its filename (like Save As), so renaming the
        // `.omicexplorer` file renames the project; fall back to the embedded name if the
        // path is somehow missing.
        const nameFromPath = p ? (p.split(/[/\\]/).pop() ?? '').replace(/\.omicexplorer$/i, '') : ''
        const projectName = nameFromPath || proj.name
        // Drop dangling path-less placeholder folders once at least one real (path-having) folder
        // exists — these are leftovers from a project's initial empty folder and only clutter the
        // selector as "(no path) —" rows. Always keep at least one folder.
        const hasReal = proj.folders.some((f) => f.path)
        const folders = hasReal ? proj.folders.filter((f) => f.path) : proj.folders
        // Resume where the user left off: the position remembered locally as they navigated (which
        // needs no save) wins over the one written into the file at its last save. Read it before
        // any set() below, since the position tracker starts overwriting it as state changes.
        const last = p ? loadLastView(p) : null
        const wantFolder = last?.folderId ?? proj.activeFolderId
        const activeFolderId = folders.some((f) => f.id === wantFolder) ? wantFolder : folders[0].id
        const folder = folders.find((f) => f.id === activeFolderId)
        const workflowId =
          last?.folderId === activeFolderId &&
          folder?.workflows.some((w) => w.id === last.workflowId)
            ? (last.workflowId ?? undefined)
            : undefined
        // Only the workflow opened is unpacked into memory; every other one is parked straight from
        // the file's packed text, and comes back when it's opened (as a workflow left is parked). A
        // project of several large workflows held all at once would run the renderer out of memory.
        const openId = workflowId ?? folder?.activeWorkflowId
        for (const f of folders)
          for (const w of f.workflows) {
            const stored = w.stored
            if (stored === undefined) continue
            delete w.stored
            if (!(f.id === activeFolderId && w.id === openId)) {
              const key = `wf-${PARK_SESSION}-${nextParkSeq()}`
              try {
                await window.api.parkWrite(key, storedResultsChunks(stored))
                w.parked = key
                continue
              } catch {
                // no park store (e.g. the screenshot harness): kept in memory, as before
              }
            }
            w.results = unpackResults(stored)
          }
        set({
          projectPath: p,
          projectName,
          projectCreatedWith: proj.createdWith ?? null,
          recentHeaders: p
            ? { ...get().recentHeaders, [p]: projectHeader(text) }
            : get().recentHeaders,
          projectOpen: true,
          folders,
          activeFolderId,
          geneSets: proj.geneSets ?? [],
          dirty: false,
          recentProjects: pushRecent(get().recentProjects, { path: p as string, name: projectName })
        })
        loadSlot(get, set, activeFolderId, workflowId)
        // …and the page (Workflow canvas vs Results dashboard) and its tab, instead of always
        // dropping onto the canvas.
        const av = useAppView.getState()
        av.setView(last?.view ?? proj.view ?? 'canvas')
        const tab = last ? last.resultsTab : proj.resultsTab
        if (tab) av.setResultsTab(tab)
        await get().refreshDataFiles()
      } catch (e) {
        // Surface the failure instead of a silent no-op (missing file, bad JSON, etc.).
        const msg = reportError(e, { where: 'open-project', detail: path })
        const missing = /ENOENT|no such file/i.test(msg)
        set({
          openError: p
            ? `Couldn't open ${p.split(/[/\\]/).pop() ?? p}: ${missing ? 'file not found' : msg}`
            : `Couldn't open project: ${msg}`
        })
      } finally {
        if (get().opening) set({ opening: null })
      }
    },
    saveProject: async () => {
      syncActiveSlot(get, set)
      if (!get().projectPath) return get().saveProjectAs()
      const path = get().projectPath as string
      set({ saving: true })
      let warnings: string[]
      try {
        warnings = await applyDiskLayout(get, set, 'rename')
        syncActiveSlot(get, set) // edits made while folders moved
        const file = await withParkedResults(buildProjectFile(get))
        await window.api.saveProject(path, serializeProjectChunks(file))
      } catch (err) {
        set({ saveError: saveErrorText(err) })
        return false
      } finally {
        set({ saving: false })
      }
      set({
        dirty: false,
        saveError: null,
        saveWarning: layoutWarning(warnings),
        recentProjects: pushRecent(get().recentProjects, { path, name: get().projectName }),
        recentHeaders: { ...get().recentHeaders, [path]: savedHeader(get) }
      })
      return true
    },
    saveProjectAs: async () => {
      const path = await window.api.pickProjectSavePath(get().projectName)
      if (!path) return false
      const name = (path.split(/[/\\]/).pop() ?? 'project').replace(/\.omicexplorer$/i, '')
      syncActiveSlot(get, set)
      const prevPath = get().projectPath
      set({ projectPath: path, projectName: name })
      set({ saving: true })
      let warnings: string[]
      try {
        // First save: out of scratch. A new file: copy the data (the original keeps its own).
        warnings = await applyDiskLayout(
          get,
          set,
          !prevPath ? 'first' : prevPath !== path ? 'copy' : 'rename'
        )
        syncActiveSlot(get, set)
        const file = await withParkedResults(buildProjectFile(get))
        await window.api.saveProject(path, serializeProjectChunks(file))
      } catch (err) {
        set({ saveError: saveErrorText(err) })
        return false
      } finally {
        set({ saving: false })
      }
      set({
        dirty: false,
        saveError: null,
        saveWarning: layoutWarning(warnings),
        recentProjects: pushRecent(get().recentProjects, { path, name }),
        recentHeaders: { ...get().recentHeaders, [path]: savedHeader(get) }
      })
      return true
    },
    saveTemplate: async (sections) => {
      const path = await window.api.pickSavePath({
        defaultPath: `${get().projectName}.${TEMPLATE_EXT}`,
        ext: TEMPLATE_EXT,
        typeName: 'OmicExplorer template'
      })
      if (!path) return false
      syncActiveSlot(get, set)
      const name = (path.split(/[/\\]/).pop() ?? 'template').slice(0, -(TEMPLATE_EXT.length + 1))
      try {
        const tpl = buildTemplate(buildProjectFile(get), sections, name)
        await window.api.saveProject(path, serializeTemplate(tpl))
      } catch (err) {
        set({ saveError: saveErrorText(err) })
        return false
      }
      return true
    },
    newFromTemplate: async () => {
      if (!(await get().confirmDiscard('starting a new project'))) return
      set({ openError: null })
      try {
        const picked = await window.api.openTemplate()
        if (picked) startFromTemplate(get, set, picked.content)
      } catch (e) {
        set({ openError: `Couldn't open template: ${reportError(e, { where: 'open-template' })}` })
      }
    },
    refreshDataFiles: async () => {
      const dir = get().dataDir
      if (!dir) {
        set({ inputFiles: [], dataDirMissing: false })
        return
      }
      // Existence check is best-effort: an older preload build (before a full restart)
      // may not expose pathExists yet, and a probe failure must never wipe the file
      // list — otherwise the Load dropdowns go empty even though the files are readable.
      let missing = false
      try {
        if (typeof window.api.pathExists === 'function') {
          missing = !(await window.api.pathExists(dir)).dir
        }
      } catch {
        missing = false
      }
      if (get().dataDir !== dir) return // switched folders while awaiting
      if (missing) {
        set({ inputFiles: [], dataDirMissing: true })
        // the Load tiles' files went with it: their status says so
        void get().checkLoads()
        return
      }
      const scope = locationOf(get())?.scope
      // Folders are best-effort: a main process from before a restart has no listWhere.
      const folders = await window.api.listDataFileFolders?.(dir, scope).catch(() => ({}))
      set({
        inputFiles: await window.api.listDataFiles(dir, scope),
        inputFileFolders: folders ?? {},
        dataDirMissing: false
      })
      void get().checkLoads()
    },

    // ── recent projects ──────────────────────────────────────────────────────
    forgetRecent: (path) => {
      set({ recentProjects: removeRecent(get().recentProjects, path) })
    },
    pruneMissingRecents: async () => {
      const list = get().recentProjects
      if (list.length === 0 || typeof window.api.pathExists !== 'function') return
      try {
        const checks = await Promise.all(
          list.map((r) => window.api.pathExists(r.path).then((e) => e.exists))
        )
        const kept = list.filter((_, i) => checks[i])
        if (kept.length !== list.length) set({ recentProjects: saveRecents(kept) })
      } catch {
        // best-effort — leave recents untouched on any probe failure
      }
    },
    loadRecentHeaders: async () => {
      const paths = get().recentProjects.map((r) => r.path)
      if (paths.length === 0 || typeof window.api.readProjectHeads !== 'function') return
      try {
        const heads = await window.api.readProjectHeads(paths)
        const next: Record<string, ProjectHeader> = {}
        for (const [path, text] of Object.entries(heads)) if (text) next[path] = projectHeader(text)
        set({ recentHeaders: { ...get().recentHeaders, ...next } })
        void checkUpgrades(get, set, next)
      } catch {
        // best-effort — rows just go without a version tag
      }
    },
    upgradeProject: async (path) => {
      const s0 = get()
      const isOpen = s0.projectOpen && s0.projectPath === path
      try {
        const text = await window.api.readProject(path)
        const before = projectHeader(text)
        // The old file, untouched, beside the project — the way back if the rewrite misreads it.
        const backup = await window.api.backupProject(path, before.savedBy ?? 'unknown')
        if (isOpen) {
          // The open project was migrated when it was opened: saving it writes the current form.
          if (!(await get().saveProject())) return { error: get().saveError ?? 'save failed' }
          return { backup }
        }
        // Not open: read it as opening would (every migration applied), write it straight back.
        const proj = deserializeProject(text)
        // Header first, in the order the home page reads it back (projectHeader).
        const { format, version, createdWith, ...body } = proj
        const file: ProjectFile = {
          format,
          version,
          ...(typeof __APP_VERSION__ === 'string' ? { appVersion: __APP_VERSION__ } : null),
          ...(createdWith ? { createdWith } : null),
          ...body
        }
        await window.api.saveProject(path, serializeProjectChunks(file))
        set({
          recentHeaders: {
            ...get().recentHeaders,
            [path]: {
              format: PROJECT_VERSION,
              savedBy: file.appVersion ?? null,
              createdWith: createdWith ?? null
            }
          }
        })
        return { backup }
      } catch (e) {
        return { error: reportError(e, { where: 'upgrade-project', detail: path }) }
      }
    }
  }
}
