/** Session scratch space for workflows' results that aren't on screen: the renderer parks an
 *  inactive workflow's (packed) results here instead of keeping them in memory, and reads them
 *  back when that workflow is opened again. One folder per app run, removed on quit. */
import { rmSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { app, ipcMain } from 'electron'

const dir = join(tmpdir(), `omicexplorer-park-${process.pid}`)
/** A parked key's file. Keys come from the renderer; only plain names are allowed, so a key can't
 *  reach outside. (Also how a save copies parked results into the project file.) */
export const parkFileOf = (key: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`Bad park key: ${key}`)
  return join(dir, `${key}.json`)
}

export function registerPark(): void {
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
