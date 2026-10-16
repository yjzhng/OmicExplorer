/** Reading a project file's header without reading the file whole, gzipped or plain, and Fix's
 *  backup copy beside it. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (evt: unknown, ...args: unknown[]) => Promise<unknown>
const handlers: Record<string, Handler> = {}
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), on: () => {}, whenReady: () => Promise.resolve() },
  dialog: {},
  shell: {},
  ipcMain: { handle: (ch: string, fn: Handler) => void (handlers[ch] = fn) }
}))
const { readProjectHead, registerFileIo } = await import('./file-io')
registerFileIo()

const HEAD = '{"format":"omicexplorer-project","version":3,"appVersion":"0.3.6","name":"P"'
const big = (): string => `${HEAD},"pad":"${'x'.repeat(2_000_000)}"}`

let dir = ''
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'oe-head-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('project file head', () => {
  it('reads the start of a gzipped project, and of a plain one', async () => {
    writeFileSync(join(dir, 'a.omicexplorer'), gzipSync(big()))
    writeFileSync(join(dir, 'b.omicexplorer'), big())
    for (const f of ['a', 'b']) {
      const head = await readProjectHead(join(dir, `${f}.omicexplorer`))
      expect(head.startsWith(HEAD)).toBe(true)
      expect(head.length).toBe(1500)
    }
  })

  it('gives null for a file that is missing, not failing the rest', async () => {
    writeFileSync(join(dir, 'a.omicexplorer'), HEAD)
    const heads = (await handlers['proj:heads']({}, [
      join(dir, 'a.omicexplorer'),
      join(dir, 'gone.omicexplorer')
    ])) as Record<string, string | null>
    expect(heads[join(dir, 'a.omicexplorer')]).toBe(HEAD)
    expect(heads[join(dir, 'gone.omicexplorer')]).toBeNull()
  })

  it('backs a project up beside itself, never over an earlier backup', async () => {
    const p = join(dir, 'P.omicexplorer')
    writeFileSync(p, 'old')
    const first = (await handlers['proj:backup']({}, p, '0.3.4')) as string
    const second = (await handlers['proj:backup']({}, p, '0.3.4')) as string
    expect(first).toBe(join(dir, 'P.v0.3.4.omicexplorer.bak'))
    expect(second).toBe(join(dir, 'P.v0.3.4.omicexplorer (2).bak'))
    expect(readFileSync(first, 'utf8')).toBe('old')
    expect(existsSync(p)).toBe(true)
  })
})
