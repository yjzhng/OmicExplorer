import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

import { dialog, ipcMain } from 'electron'

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

/**
 * Register the local-file IPC seam. The renderer is context-isolated and cannot
 * touch the filesystem, so file picking/reading/writing lives here in the main
 * process and is exposed to the renderer as `window.api.*`.
 */
export function registerFileIo(): void {
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

  // ── input/ (raw data) + temp/ (processed data) under the workflow dir ────────
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
    async (_evt, dir: string, name: string, content: string): Promise<void> => {
      const inputDir = join(dir, 'input')
      await mkdir(inputDir, { recursive: true })
      await writeFile(join(inputDir, name), content, 'utf8')
    }
  )

  ipcMain.handle(
    'wf:writeTemp',
    async (_evt, dir: string, name: string, content: string): Promise<void> => {
      const tempDir = join(dir, 'temp')
      await mkdir(tempDir, { recursive: true })
      await writeFile(join(tempDir, name), content, 'utf8')
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
    return { path, content: await readFile(path, 'utf8') }
  })

  ipcMain.handle('proj:read', async (_evt, path: string): Promise<string> => {
    return readFile(path, 'utf8')
  })

  ipcMain.handle('proj:save', async (_evt, path: string, content: string): Promise<void> => {
    await writeFile(path, content, 'utf8')
  })

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

  // ── data folder (scanned for input files) ────────────────────────────────────
  // A project folder "contains input/output/data" — so scan the folder itself and
  // its common data subdirs, and resolve reads across the same locations.
  const DATA_SUBDIRS = ['', 'input', 'data']

  ipcMain.handle('data:list', async (_evt, dir: string): Promise<string[]> => {
    const names = new Set<string>()
    for (const sub of DATA_SUBDIRS) {
      try {
        for (const n of await readdir(join(dir, sub))) {
          if (!n.startsWith('.') && /\.(csv|tsv|txt)$/i.test(n)) names.add(n)
        }
      } catch {
        // subdir absent — skip
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  })

  ipcMain.handle('data:read', async (_evt, dir: string, name: string): Promise<string | null> => {
    for (const sub of DATA_SUBDIRS) {
      try {
        return await readFile(join(dir, sub, name), 'utf8')
      } catch {
        // not in this location — try the next
      }
    }
    return null
  })
}
