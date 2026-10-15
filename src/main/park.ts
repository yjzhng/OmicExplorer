/** Session scratch space for results that aren't on screen: the renderer parks an inactive
 *  workflow's (packed) results here instead of keeping them in memory, and reads them back when that
 *  workflow is opened again; the undo history spills replaced results here too (historyCache.ts).
 *  One folder per app run, removed on quit — and a crashed run's folder on the next start. */
import { rmSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app, ipcMain } from 'electron'

const PREFIX = 'omicexplorer-park-'
const dir = join(tmpdir(), `${PREFIX}${process.pid}`)

/** Whether a process is still running (EPERM: it is, just not ours to signal). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Remove the park folders of app runs that ended without quitting (a crash, a forced kill). */
async function sweepStale(): Promise<void> {
  const names = await readdir(tmpdir()).catch(() => [] as string[])
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue
    const pid = Number(name.slice(PREFIX.length))
    if (!Number.isInteger(pid) || pid === process.pid || alive(pid)) continue
    await rm(join(tmpdir(), name), { recursive: true, force: true }).catch(() => undefined)
  }
}
/** A parked key's file. Keys come from the renderer; only plain names are allowed, so a key can't
 *  reach outside. (Also how a save copies parked results into the project file.) */
export const parkFileOf = (key: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`Bad park key: ${key}`)
  return join(dir, `${key}.json`)
}

export function registerPark(): void {
  void sweepStale()
  ipcMain.handle('park:write', async (_evt, key: string, pieces: string[]): Promise<void> => {
    await mkdir(dir, { recursive: true })
    const path = parkFileOf(key)
    await writeFile(path, '', 'utf8')
    for (const piece of pieces) await appendFile(path, piece, 'utf8')
  })
  ipcMain.handle('park:read', async (_evt, key: string): Promise<string> =>
    readFile(parkFileOf(key), 'utf8')
  )
  ipcMain.handle('park:drop', async (_evt, key: string): Promise<void> => {
    await rm(parkFileOf(key), { force: true })
  })
  app.on('will-quit', () => rmSync(dir, { recursive: true, force: true }))
}
