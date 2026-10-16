import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  constants,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile
} from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createGunzip, createGzip, gunzip } from 'node:zlib'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

import { dialog, ipcMain, shell } from 'electron'

import { registerDataLayout } from './data-layout'
import { parkFileOf } from './park'

const gunzipAsync = promisify(gunzip)

/** A project file's text: gzipped (as saved now) or plain JSON (older files). */
async function readProjectText(path: string): Promise<string> {
  const buf = await readFile(path)
  const gz = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
  return (gz ? await gunzipAsync(buf) : buf).toString('utf8')
}

/** The first ~`chars` characters of a project file's text, decompressing only as far as that —
 *  enough for its header (format, appVersion, createdWith come first) without reading a large
 *  project whole. */
export async function readProjectHead(path: string, chars = 1500): Promise<string> {
  const gz = await new Promise<boolean>((resolve, reject) => {
    const st = createReadStream(path, { start: 0, end: 1 })
    const got: Buffer[] = []
    st.on('data', (b) => got.push(b as Buffer))
    st.on('error', reject)
    st.on('end', () => {
      const b = Buffer.concat(got)
      resolve(b.length > 1 && b[0] === 0x1f && b[1] === 0x8b)
    })
  })
  const src = createReadStream(path)
  const stream = gz ? src.pipe(createGunzip()) : src
  let text = ''
  try {
    for await (const chunk of stream) {
      text += (chunk as Buffer).toString('utf8')
      if (text.length >= chars) break
    }
  } finally {
    src.destroy()
    if (stream !== src) stream.destroy()
  }
  return text.slice(0, chars)
}

/** A free name beside `path` for a copy of the file as saved by app `version`:
 *  `<name>.omicexplorer` → `<name>.v0.3.4.omicexplorer.bak` (then `… (2).bak`, …). */
async function backupPathFor(path: string, version: string): Promise<string> {
  const safe = version.replace(/[^0-9A-Za-z._-]+/g, '') || 'unknown'
  const base = `${path.replace(/\.omicexplorer$/i, '')}.v${safe}.omicexplorer`
  for (let i = 1; ; i++) {
    const p = i === 1 ? `${base}.bak` : `${base} (${i}).bak`
    try {
      await stat(p)
    } catch {
      return p
    }
  }
}

export interface OpenFileResult {
  path: string
  name: string
  content: string
}

export interface OpenFileOptions {
  filters?: Electron.FileFilter[]
  title?: string
}

export interface WorkflowEntry {
  name: string
  path: string
}

/** Default workflow directory: <cwd>/workflow (created if missing). */
function defaultWorkflowDir(): string {
  return join(process.cwd(), 'workflow')
}

/** Sanitize a workflow name into ONE safe path segment for the per-workflow data subfolder:
 *  replace the filesystem-illegal chars (Windows set) with `_`, strip a leading dot / trailing
 *  dot or space, and never allow a `..` traversal. Readable chars (spaces, hyphens) are kept.
 *  Empty ⇒ null (write flat, no subfolder). */
function safeSeg(scope?: string): string | null {
  if (!scope) return null
  const cleaned = scope
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')
    .trim()
  return cleaned && cleaned !== '..' ? cleaned : null
}

/** Where a workflow's generated files live. A string is the older form: a workflow name, nested
 *  under the data folder. An object names the workflow's folder outright (`base`, absolute — see
 *  the renderer's graph/diskNames.ts), with `legacy` the workflow name whose old
 *  `<data folder>/<name>` subfolder is still read from. */
type Scope = string | { base: string; legacy?: string } | undefined

/** Where to read a workflow's file from, in order: its own folder, then (legacy) the old
 *  per-workflow subfolder and the shared data-folder root — so files from older projects still
 *  resolve. */
function readRoots(dir: string, scope: Scope): string[] {
  if (scope && typeof scope === 'object') {
    const seg = safeSeg(scope.legacy)
    return [scope.base, ...(seg ? [join(dir, seg)] : []), dir]
  }
  const seg = safeSeg(scope)
  return seg ? [join(dir, seg), dir] : [dir]
}

/** A write's data folder must still be there: creating the workflow's folders under a data
 *  folder deleted mid-session would silently bring it back holding only the app's files. The
 *  renderer catches this and flags the folder missing. */
async function requireDataDir(dir: string): Promise<void> {
  const ok = await stat(dir).then(
    (s) => s.isDirectory(),
    () => false
  )
  if (!ok) throw new Error(`Data folder not found: ${dir}`)
}

/** Where to write a workflow's file: its own folder. */
function writeRoot(dir: string, scope: Scope): string {
  if (scope && typeof scope === 'object') return scope.base
  const seg = safeSeg(scope)
  return seg ? join(dir, seg) : dir
}

/**
 * Register the local-file IPC seam. The renderer is context-isolated and cannot
 * touch the filesystem, so file picking/reading/writing lives here in the main
 * process and is exposed to the renderer as `window.api.*`.
 */
/** One entry of a folder listing (the project-folder viewer). */
export interface DirEntry {
  name: string
  path: string
  dir: boolean
  size: number
  mtime: number
}

export function registerFileIo(): void {
  registerDataLayout()
  ipcMain.handle(
    'file:open',
    async (_evt, opts?: OpenFileOptions): Promise<OpenFileResult | null> => {
      const res = await dialog.showOpenDialog({
        title: opts?.title,
        properties: ['openFile'],
        filters: opts?.filters ?? [
          { name: 'Data', extensions: ['csv', 'tsv', 'txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (res.canceled || res.filePaths.length === 0) return null
      const path = res.filePaths[0]
      const content = await readFile(path, 'utf8')
      return { path, name: basename(path), content }
    }
  )

  // ── workflow files ─────────────────────────────────────────────────────────
  ipcMain.handle('wf:defaultDir', async (): Promise<string> => {
    const dir = defaultWorkflowDir()
    await mkdir(dir, { recursive: true })
    return dir
  })

  ipcMain.handle('wf:pickDir', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Select workflow folder',
      properties: ['openDirectory', 'createDirectory']
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle('wf:list', async (_evt, dir: string): Promise<WorkflowEntry[]> => {
    try {
      const names = await readdir(dir)
      return names
        .filter((n) => n.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({ name: n.replace(/\.json$/i, ''), path: join(dir, n) }))
    } catch {
      return []
    }
  })

  ipcMain.handle('wf:read', async (_evt, path: string): Promise<string> => {
    return readFile(path, 'utf8')
  })

  ipcMain.handle('wf:write', async (_evt, path: string, content: string): Promise<void> => {
    await writeFile(path, content, 'utf8')
  })

  // ── input/ (raw data) under the workflow dir ─────────────────────────────────
  ipcMain.handle('wf:listInput', async (_evt, dir: string): Promise<string[]> => {
    const inputDir = join(dir, 'input')
    await mkdir(inputDir, { recursive: true })
    try {
      const names = await readdir(inputDir)
      return names.filter((n) => !n.startsWith('.')).sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  })

  ipcMain.handle(
    'wf:readInput',
    async (_evt, dir: string, name: string): Promise<string | null> => {
      try {
        return await readFile(join(dir, 'input', name), 'utf8')
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(
    'wf:writeInput',
    async (_evt, dir: string, name: string, content: string, scope?: Scope): Promise<void> => {
      await requireDataDir(dir)
      const inputDir = join(writeRoot(dir, scope), 'input')
      await mkdir(inputDir, { recursive: true })
      await writeFile(join(inputDir, name), content, 'utf8')
    }
  )

  // ── projects (.omicexplorer) ─────────────────────────────────────────────────
  // A project bundles the whole session (workflows + configs + layouts + results)
  // and points at a data folder scanned for input files.
  ipcMain.handle('proj:open', async (): Promise<{ path: string; content: string } | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Open project',
      properties: ['openFile'],
      filters: [
        { name: 'OmicExplorer project', extensions: ['omicexplorer'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    return { path, content: await readProjectText(path) }
  })

  // A template is a project file without its data (renderer graph/template.ts), read the same way.
  ipcMain.handle('tpl:open', async (): Promise<{ path: string; content: string } | null> => {
    const res = await dialog.showOpenDialog({
      title: 'New project from template',
      properties: ['openFile'],
      filters: [
        { name: 'OmicExplorer template', extensions: ['omicexplorer-template'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const path = res.filePaths[0]
    return { path, content: await readProjectText(path) }
  })

  ipcMain.handle('proj:read', async (_evt, path: string): Promise<string> => {
    return readProjectText(path)
  })

  // Each file's first characters (its header), for the home page's version tags; null where a
  // file can't be read.
  ipcMain.handle(
    'proj:heads',
    async (_evt, paths: string[]): Promise<Record<string, string | null>> => {
      const out: Record<string, string | null> = {}
      await Promise.all(
        (paths ?? []).map(async (p) => {
          out[p] = await readProjectHead(p).catch(() => null)
        })
      )
      return out
    }
  )

  // A copy of the project file as it is, beside it, before Fix rewrites it; returns its path.
  ipcMain.handle('proj:backup', async (_evt, path: string, version: string): Promise<string> => {
    const to = await backupPathFor(path, version)
    await copyFile(path, to, constants.COPYFILE_EXCL)
    return to
  })

  // Written to a temporary file first and moved over the project only once complete, so a save
  // that fails part-way never leaves a truncated project behind. The text may come in pieces (a
  // large project can't be one string); a `{ park }` piece is a parked workflow's results, streamed
  // straight from its park file rather than sent over from the renderer.
  ipcMain.handle(
    'proj:save',
    async (
      _evt,
      path: string,
      content: string | Array<string | { park: string }>
    ): Promise<void> => {
      const pieces = Array.isArray(content) ? content : [content]
      async function* text(): AsyncGenerator<string | Buffer> {
        for (const p of pieces)
          if (typeof p === 'string') yield p
          else yield* createReadStream(parkFileOf(p.park))
      }
      // Gzipped as it's written; opening reads either form. Level 1: about 4× faster than the
      // default 6 on a large project (0.7 s vs 3.4 s for 118 MB of JSON) for a ~14% larger file.
      const tmp = `${path}.saving`
      await pipeline(Readable.from(text()), createGzip({ level: 1 }), createWriteStream(tmp))
      await rename(tmp, path)
    }
  )

  /** Native "save as" dialog; returns the chosen path (with .omicexplorer) or null. */
  ipcMain.handle(
    'proj:pickSavePath',
    async (_evt, suggestedName?: string): Promise<string | null> => {
      const res = await dialog.showSaveDialog({
        title: 'Save project as',
        defaultPath: `${(suggestedName ?? 'untitled').replace(/\.omicexplorer$/i, '')}.omicexplorer`,
        filters: [{ name: 'OmicExplorer project', extensions: ['omicexplorer'] }]
      })
      if (res.canceled || !res.filePath) return null
      return res.filePath.endsWith('.omicexplorer') ? res.filePath : `${res.filePath}.omicexplorer`
    }
  )

  /** Native "save as" for one file of a known type (a tile's plot/table download): the OS window
   *  names the file and picks the folder in one go. Returns the absolute path, with the extension
   *  enforced, or null if cancelled. */
  ipcMain.handle(
    'file:pickSave',
    async (
      _evt,
      opts: { defaultPath: string; ext: string; typeName: string }
    ): Promise<string | null> => {
      // The suggested folder (a step's output/ subfolder) may not exist yet; the window only
      // opens in a folder that does.
      if (isAbsolute(opts.defaultPath))
        await mkdir(dirname(opts.defaultPath), { recursive: true }).catch(() => undefined)
      const res = await dialog.showSaveDialog({
        title: 'Save as',
        defaultPath: opts.defaultPath,
        filters: [{ name: opts.typeName, extensions: [opts.ext] }]
      })
      if (res.canceled || !res.filePath) return null
      const want = `.${opts.ext}`
      return res.filePath.toLowerCase().endsWith(want) ? res.filePath : `${res.filePath}${want}`
    }
  )

  ipcMain.handle('proj:pickDataDir', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Select data folder',
      properties: ['openDirectory']
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  // Does a path exist on disk? Used to flag a project's data folder as missing
  // (e.g. after the folder was renamed/moved) or a recent-project file as stale.
  // `dir` = true only when the path exists AND is a directory.
  ipcMain.handle(
    'fs:exists',
    async (_evt, p: string): Promise<{ exists: boolean; dir: boolean }> => {
      try {
        const s = await stat(p)
        return { exists: true, dir: s.isDirectory() }
      } catch {
        return { exists: false, dir: false }
      }
    }
  )

  // ── project-folder viewer: list one level, reveal / open an entry ────────────
  // Folders first, then files, each by name; dotfiles hidden. One level per call — the viewer
  // expands lazily, so a deep or large folder never gets walked in full.
  ipcMain.handle('fs:listDir', async (_evt, dir: string): Promise<DirEntry[]> => {
    const ents = await readdir(dir, { withFileTypes: true })
    const out = await Promise.all(
      ents
        .filter((e) => !e.name.startsWith('.'))
        .map(async (e): Promise<DirEntry | null> => {
          const path = join(dir, e.name)
          try {
            const s = await stat(path)
            return { name: e.name, path, dir: s.isDirectory(), size: s.size, mtime: s.mtimeMs }
          } catch {
            return null // vanished mid-listing, or a dangling link
          }
        })
    )
    return out
      .filter((e): e is DirEntry => e !== null)
      .sort((a, b) =>
        a.dir !== b.dir
          ? a.dir
            ? -1
            : 1
          : a.name.localeCompare(b.name, undefined, { numeric: true })
      )
  })
  ipcMain.handle('fs:reveal', (_evt, p: string): void => shell.showItemInFolder(p))
  /** Open in the default app; resolves to an error message, or '' on success. */
  ipcMain.handle('fs:open', (_evt, p: string): Promise<string> => shell.openPath(p))

  // ── data folder (scanned for input files) ────────────────────────────────────
  // A project folder "contains input/output/data" — so scan the folder itself and
  // its common data subdirs, and resolve reads across the same locations.
  const DATA_SUBDIRS = ['', 'input', 'data']

  // With a `scope`, the workflow's own subfolder is scanned too — the same places data:read looks.
  ipcMain.handle('data:list', async (_evt, dir: string, scope?: Scope): Promise<string[]> => {
    const names = new Set<string>()
    for (const root of readRoots(dir, scope)) {
      for (const sub of DATA_SUBDIRS) {
        try {
          for (const n of await readdir(join(root, sub))) {
            if (!n.startsWith('.') && /\.(csv|tsv|txt)$/i.test(n)) names.add(n)
          }
        } catch {
          // subdir absent — skip
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  })

  // The same files, each with the folder it's read from (relative to the data folder; '' = the folder
  // itself) — the first location data:read would find it in, so the folder shown is the one used.
  ipcMain.handle(
    'data:listWhere',
    async (_evt, dir: string, scope?: Scope): Promise<Record<string, string>> => {
      const where: Record<string, string> = {}
      for (const root of readRoots(dir, scope)) {
        for (const sub of DATA_SUBDIRS) {
          const folder = join(root, sub)
          try {
            for (const n of await readdir(folder)) {
              if (n.startsWith('.') || !/\.(csv|tsv|txt)$/i.test(n) || n in where) continue
              where[n] = relative(dir, folder).split(sep).join('/')
            }
          } catch {
            // subdir absent — skip
          }
        }
      }
      return where
    }
  )

  ipcMain.handle(
    'data:read',
    async (_evt, dir: string, name: string, scope?: Scope): Promise<string | null> => {
      // An absolute `name` is a matrix picked from outside the data folder (see data:pickFile) —
      // read it directly and ignore `dir`. Bare names resolve within the data folder's subdirs.
      if (name && isAbsolute(name)) {
        try {
          return await readFile(name, 'utf8')
        } catch {
          return null
        }
      }
      // The workflow's own folder first, then the shared data-folder root (your own input files,
      // and older projects' flat ones).
      for (const root of readRoots(dir, scope)) {
        for (const sub of DATA_SUBDIRS) {
          try {
            return await readFile(join(root, sub, name), 'utf8')
          } catch {
            // not in this location — try the next
          }
        }
      }
      return null
    }
  )

  // A data folder changing location (the store's moveFolder): copy the input files its workflows
  // read by name from the old folder's own locations — the same places data:read looks outside
  // the project data folder, which moves on its own — to the same place under the new folder, so
  // they're found there just the same. The originals stay; a file the new folder already has at
  // that place is left as it is. Names not found there (in a workflow's own folder, or gone) are
  // skipped.
  ipcMain.handle(
    'data:copyInputs',
    async (
      _evt,
      from: string,
      to: string,
      files: Array<{ name: string; legacy?: string }>
    ): Promise<{ copied: string[]; errors: string[] }> => {
      const copied: string[] = []
      const errors: string[] = []
      for (const { name, legacy } of files) {
        if (!name || isAbsolute(name) || name !== basename(name)) continue
        const seg = safeSeg(legacy)
        let found: string | null = null
        for (const root of seg ? [join(from, seg), from] : [from]) {
          for (const sub of DATA_SUBDIRS) {
            const p = join(root, sub, name)
            if (
              await stat(p).then(
                (st) => st.isFile(),
                () => false
              )
            ) {
              found = p
              break
            }
          }
          if (found) break
        }
        if (!found) continue
        const target = join(to, relative(from, found))
        try {
          await mkdir(dirname(target), { recursive: true })
          await copyFile(found, target, constants.COPYFILE_EXCL)
          copied.push(name)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'EEXIST') continue
          errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      return { copied, errors }
    }
  )

  // Pick a data matrix from anywhere on disk (not restricted to the data folder). Returns the
  // absolute path (which data:read then reads directly), or null if cancelled.
  ipcMain.handle('data:pickFile', async (): Promise<string | null> => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a data matrix file',
      properties: ['openFile'],
      filters: [
        { name: 'Data', extensions: ['csv', 'tsv', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}
