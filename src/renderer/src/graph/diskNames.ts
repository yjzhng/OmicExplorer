/** The project's data layout on disk, and the folder names that mirror the names you give things:
 *
 *    <data folder>/<project>_data/<workflow>/input          files made by the interactive import
 *                                           /output/<step>  per processing step: the tables its run
 *                                                           writes, plus your downloads
 *
 *  Each folder's name on disk is stored beside the name shown in the app (`dataName` on a folder,
 *  `dir` on a workflow, `outDirs` per processing step). Renaming something in the app changes only
 *  its shown name; files keep going to the stored folder until the next project save renames the
 *  folder to match (see the store's applyDiskLayout). So disk and project file stay in step, and a
 *  rename you don't save moves nothing. An unsaved project writes under the session scratch folder
 *  (`<scratch>/<folder id>/…`) and moves into the data folder on its first save.
 *
 *  Pure — no store or window access — so it's testable on its own. */
import type { ProjectFolder, ProjectWorkflow } from './project'

/** A name as ONE safe folder name: filesystem-illegal characters (the Windows set) become `_`, a
 *  leading dot and trailing dots/spaces go, and `..` is never produced. Mirrors main's safeSeg
 *  (file-io.ts), which resolves the older layout's workflow subfolders — keep the two in step. */
export function pathSeg(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned && cleaned !== '..' ? cleaned : fallback
}

/** `seg`, or `seg (2)`, `seg (3)`, … — the first not in `taken` (compared ignoring case, since a
 *  Mac disk treats `Compare` and `compare` as one folder). */
export function uniqueSeg(seg: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()))
  if (!used.has(seg.toLowerCase())) return seg
  for (let n = 2; ; n++) {
    const alt = `${seg} (${n})`
    if (!used.has(alt.toLowerCase())) return alt
  }
}

/** The project's data folder name: `<project file name>_data`. */
export const dataFolderName = (projectName: string): string =>
  `${pathSeg(projectName, 'project')}_data`

/**
 * Fill in any missing stored folder names from the current shown names: a workflow's `dir`
 * (unique among its folder's), and — once the project has a file — a folder's `dataName`. Run when
 * a workflow is checked out, so names are pinned before anything is written. Returns `folders`
 * itself when nothing was missing.
 */
export function withDiskNames(
  folders: ProjectFolder[],
  saved: boolean,
  projectName: string
): ProjectFolder[] {
  let changed = false
  const next = folders.map((f) => {
    let wfChanged = false
    const taken: string[] = f.workflows.flatMap((w) => (w.dir ? [w.dir] : []))
    const workflows = f.workflows.map((w): ProjectWorkflow => {
      if (w.dir) return w
      const dir = uniqueSeg(pathSeg(w.name, 'Workflow'), taken)
      taken.push(dir)
      wfChanged = true
      return { ...w, dir }
    })
    const dataName = f.dataName ?? (saved ? dataFolderName(projectName) : undefined)
    if (!wfChanged && dataName === f.dataName) return f
    changed = true
    return { ...f, workflows, dataName }
  })
  return changed ? next : folders
}

/** Join path parts with `/` (accepted on every platform Electron runs on). */
const join = (...parts: string[]): string => parts.join('/')

/** Where a folder's project data lives: `<data folder>/<dataName>` once the project has a file,
 *  else the session scratch. null when neither is available yet. */
export function dataRootOf(
  folder: ProjectFolder,
  opts: { saved: boolean; projectName: string; scratch: string | null }
): string | null {
  if (opts.saved) {
    if (!folder.path) return null
    return join(folder.path, folder.dataName ?? dataFolderName(opts.projectName))
  }
  return opts.scratch ? join(opts.scratch, folder.id) : null
}

/** A workflow's folder under its data root. */
export const workflowDirOf = (root: string, wf: ProjectWorkflow): string =>
  join(root, wf.dir ?? pathSeg(wf.name, 'Workflow'))

/** One processing step's output folder name: the stored one, else a fresh one from its current
 *  name, unique among the workflow's other steps' folders. */
export function outDirName(
  outDirs: Record<string, string> | undefined,
  stepId: string,
  title: string
): string {
  const have = outDirs?.[stepId]
  if (have) return have
  const taken = Object.entries(outDirs ?? {})
    .filter(([id]) => id !== stepId)
    .map(([, d]) => d)
  return uniqueSeg(pathSeg(title, 'Step'), taken)
}

/**
 * Plan the renames that bring stored names in line with shown names, for one list of siblings:
 * each item whose shown name differs from its folder gets a new, unique (among the siblings'
 * resulting names) folder name. Items already matching keep theirs and are planned first, so a
 * rename never takes a name an untouched sibling holds.
 */
export function planRenames<T extends { key: string; dir: string; want: string }>(
  items: T[]
): Array<T & { to: string }> {
  const keep = items.filter((i) => i.dir === i.want)
  const taken = keep.map((i) => i.dir)
  const out: Array<T & { to: string }> = keep.map((i) => ({ ...i, to: i.dir }))
  for (const i of items) {
    if (keep.includes(i)) continue
    // Its own current name isn't in `taken`, so a case-only change (`compare` → `Compare`) keeps it.
    const to = uniqueSeg(i.want, taken)
    taken.push(to)
    out.push({ ...i, to })
  }
  return out
}
