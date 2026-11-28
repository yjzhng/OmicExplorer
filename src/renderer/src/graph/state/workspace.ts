import { useAppView } from '../../ui/app/useAppView'
import { dataRootOf } from '../project/diskNames'
import { exclusiveDisk } from '../project/diskWrites'
import { newFolder, emptyWorkflow, type ProjectFolder } from '../project/project'
import { type Getter, type GraphState, type StoreSet } from '../store'
import type { LoadConfig } from '../config/load'
import { graphOf, syncActiveSlot, loadSlot } from './shared'

export const activeFolder = (s: GraphState): ProjectFolder | undefined =>
  s.folders.find((f) => f.id === s.activeFolderId)
/** The input files a folder's workflows read by name (their Load tiles' files), each with its
 *  workflow's name (the legacy per-workflow location data:read also looks in). */
export function inputRefsOf(
  s: GraphState,
  f: ProjectFolder
): Array<{ name: string; legacy: string }> {
  const out: Array<{ name: string; legacy: string }> = []
  for (const w of f.workflows)
    for (const n of graphOf(s, f.id, w).nodes) {
      if (n.data.kind !== 'load') continue
      const c = n.data.config as LoadConfig
      for (const name of [c.matrix, c.data, c.samplesheet, c.db])
        if (name) out.push({ name, legacy: w.name })
    }
  return out
}
/** The project's data folders and workflows. */
export function workspaceSlice(
  set: StoreSet,
  get: Getter
): Pick<
  GraphState,
  | 'addFolder'
  | 'switchFolder'
  | 'deleteFolder'
  | 'renameFolder'
  | 'moveFolder'
  | 'repathFolder'
  | 'addWorkflow'
  | 'switchWorkflow'
  | 'renameWorkflow'
  | 'deleteWorkflow'
> {
  return {
    // ── folders ─────────────────────────────────────────────────────────────
    addFolder: async () => {
      const path = await window.api.pickDataDir()
      if (!path) return
      const name = path.split(/[/\\]/).pop() ?? path
      // If the active folder is a pristine, path-less placeholder (e.g. a brand-new project's
      // initial "Folder 1"), set ITS path in place instead of appending — otherwise the empty
      // folder lingers in the selector as a "(no path) —" row.
      const active = activeFolder(get())
      if (active && !active.path) {
        set({
          folders: get().folders.map((f) => (f.id === active.id ? { ...f, path, name } : f)),
          dataDir: path,
          dirty: true
        })
        await get().refreshDataFiles()
        return
      }
      syncActiveSlot(get, set)
      const folder = newFolder(path)
      set({ folders: [...get().folders, folder], dirty: true })
      loadSlot(get, set, folder.id)
      useAppView.getState().setView('canvas') // fresh folder → empty workflow, built on the canvas
      await get().refreshDataFiles()
    },
    switchFolder: (id) => {
      if (id === get().activeFolderId) return
      syncActiveSlot(get, set)
      loadSlot(get, set, id)
      void get().refreshDataFiles()
    },
    deleteFolder: (id) => {
      const list = get().folders
      const wasActive = get().activeFolderId === id
      // A project always keeps at least one folder: deleting the only one resets it to a fresh,
      // empty folder (no path) rather than leaving none — so the "select a data folder" guide shows.
      if (list.length <= 1) {
        if (!list.some((f) => f.id === id)) return
        const fresh = newFolder('', 'Folder 1')
        set({ folders: [fresh], dirty: true })
        loadSlot(get, set, fresh.id)
        void get().refreshDataFiles()
        return
      }
      const remaining = list.filter((f) => f.id !== id)
      set({ folders: remaining, dirty: true })
      if (wasActive) {
        loadSlot(get, set, remaining[0].id)
        void get().refreshDataFiles()
      }
    },
    renameFolder: (id, name) => {
      const clean = name.trim() || 'Folder'
      set({
        folders: get().folders.map((f) => (f.id === id ? { ...f, name: clean } : f)),
        dirty: true
      })
    },
    moveFolder: async (id) => {
      syncActiveSlot(get, set)
      const s0 = get()
      const f = s0.folders.find((x) => x.id === id)
      if (!f?.path) return
      const from = f.path
      const to = await window.api.pickDataDir()
      if (!to || to === from) return
      const nameOf = (p: string): string => p.split(/[/\\]/).pop() ?? p
      if (s0.folders.some((x) => x.id !== id && x.path === to)) {
        set({ saveError: `${to} is already a folder of this project` })
        return
      }
      // A saved project's data folder is under the folder; an unsaved one's is in the session
      // scratch (keyed by the folder), so only the path changes.
      const root = s0.projectPath
        ? dataRootOf(f, { saved: true, projectName: s0.projectName, scratch: s0.scratchRoot })
        : null
      if (root && (to === root || to.startsWith(`${root}/`) || to.startsWith(`${root}\\`))) {
        set({ saveError: `Can't move ${f.name} into its own project data folder` })
        return
      }
      set({ saving: true })
      const res = await exclusiveDisk(async () => {
        let dataName = f.dataName
        if (root) {
          const [r] = await window.api.applyDirOps([
            { from: root, to: `${to}/${nameOf(root)}`, mode: 'move', unique: true }
          ])
          if (!r.ok) return { error: `Couldn't move ${nameOf(root)} to ${to}: ${r.error ?? ''}` }
          if (!r.skipped) dataName = nameOf(r.to)
        }
        const copy = await window.api.copyInputFiles(from, to, inputRefsOf(get(), f))
        return { dataName, errors: copy.errors }
      }).finally(() => set({ saving: false }))
      if ('error' in res) {
        set({ saveError: res.error })
        return
      }
      // A folder still named after its old location takes the new one's name.
      const name = f.name === nameOf(from) ? nameOf(to) : f.name
      set({
        folders: get().folders.map((x) =>
          x.id === id
            ? { ...x, path: to, name, ...(res.dataName ? { dataName: res.dataName } : null) }
            : x
        ),
        dirty: true,
        saveWarning: res.errors.length
          ? `Moved, but some input files couldn't be copied: ${res.errors.join('; ')}`
          : null
      })
      if (get().activeFolderId === id) {
        set({ dataDir: to })
        await get().refreshDataFiles()
      }
    },
    repathFolder: async (id) => {
      const path = await window.api.pickDataDir()
      if (!path) return
      const name = path.split(/[/\\]/).pop() ?? path
      set({
        folders: get().folders.map((f) => (f.id === id ? { ...f, path, name } : f)),
        dirty: true
      })
      if (get().activeFolderId === id) {
        set({ dataDir: path })
        await get().refreshDataFiles()
      }
    },

    // ── workflows (within the active folder) ─────────────────────────────────
    addWorkflow: (name) => {
      syncActiveSlot(get, set)
      const folder = activeFolder(get())
      if (!folder) return
      const wf = emptyWorkflow(name?.trim() || `Workflow ${folder.workflows.length + 1}`)
      set({
        folders: get().folders.map((f) =>
          f.id === folder.id
            ? { ...f, workflows: [...f.workflows, wf], activeWorkflowId: wf.id }
            : f
        ),
        dirty: true
      })
      loadSlot(get, set, folder.id, wf.id)
      void get().refreshDataFiles()
      // A new workflow is empty and built on the canvas — land there rather than leaving the user
      // on a now-blank Results dashboard (which reads as "stuck").
      useAppView.getState().setView('canvas')
    },
    switchWorkflow: (id) => {
      if (id === get().activeWorkflowId) return
      syncActiveSlot(get, set)
      const fid = get().activeFolderId
      if (fid) loadSlot(get, set, fid, id)
      void get().refreshDataFiles()
    },
    renameWorkflow: (id, name) => {
      const clean = name.trim() || 'Workflow'
      set({
        folders: get().folders.map((f) => ({
          ...f,
          workflows: f.workflows.map((w) => (w.id === id ? { ...w, name: clean } : w))
        })),
        dirty: true
      })
      if (id === get().activeWorkflowId) void get().refreshDataFiles()
    },
    deleteWorkflow: (id) => {
      const folder = activeFolder(get())
      if (!folder || folder.workflows.length <= 1) return // keep at least one workflow
      const remaining = folder.workflows.filter((w) => w.id !== id)
      const wasActive = get().activeWorkflowId === id
      set({
        folders: get().folders.map((f) =>
          f.id === folder.id ? { ...f, workflows: remaining } : f
        ),
        dirty: true
      })
      if (wasActive) {
        loadSlot(get, set, folder.id, remaining[0].id)
        void get().refreshDataFiles()
      }
    }
  }
}
