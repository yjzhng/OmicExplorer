/** The project data layout's disk side: a session scratch folder for an unsaved project's files,
 *  and the batch folder moves a project save applies (renames, the first save's move out of
 *  scratch, Save-as copies). The renderer decides what goes where; this only touches the disk.
 *
 *    <data folder>/<project>_data/<workflow>/{input,output/<step>}
 */
import { rmSync } from 'node:fs'
import { cp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, isAbsolute, resolve } from 'node:path'

import { app, ipcMain } from 'electron'

/** One app run's scratch root; an unsaved project writes under `<scratch>/<folder id>/…`. Removed
 *  on quit (an unsaved project's files go with it, like its unsaved edits). */
const scratch = join(tmpdir(), `omicexplorer-scratch-${process.pid}`)

export interface DirOp {
  from: string
  to: string
  /** rename/move: the folder leaves `from`; copy: `from` stays as it was */
  mode: 'rename' | 'move' | 'copy'
  /** when `to` is taken: pick `to (2)`, `to (3)`, … instead of failing */
  unique?: boolean
}

export interface DirOpResult {
  from: string
  /** where the folder is now (`to`, or its unique variant); `from` when the op failed */
  to: string
  ok: boolean
  /** `from` didn't exist — nothing to move, `to` is free to use */
  skipped?: boolean
  error?: string
}

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false
  )

/** Same path, differing only in letter case — the same folder on a case-insensitive disk. */
const sameIgnoringCase = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

async function freeTarget(to: string, unique: boolean): Promise<string | null> {
  if (!(await exists(to))) return to
  if (!unique) return null
  for (let n = 2; n < 1000; n++) {
    const alt = join(dirname(to), `${basename(to)} (${n})`)
    if (!(await exists(alt))) return alt
  }
  return null
}

/** rename, falling back to copy + delete across disks (scratch lives on the system disk). */
async function moveDir(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await rm(from, { recursive: true, force: true })
  }
}

/**
 * Apply ops in order. Renames go through a temporary name first, so a batch can swap two folders'
 * names (A→B, B→A) or change only a name's case. A failed op leaves its folder where it was and
 * the rest still run; nothing is ever deleted or merged.
 */
async function applyDirOps(ops: DirOp[]): Promise<DirOpResult[]> {
  const out: DirOpResult[] = ops.map((op) => ({ from: op.from, to: op.from, ok: false }))
  // Phase 1: step every rename source aside, so targets freed by this batch read as free.
  const parked = new Map<number, string>()
  for (const [i, op] of ops.entries()) {
    if (op.mode !== 'rename' || op.from === op.to) continue
    if (!(await exists(op.from))) continue
    const tmp = `${op.from}.oe-renaming-${process.pid}-${i}`
    try {
      await rename(op.from, tmp)
      parked.set(i, tmp)
    } catch (e) {
      out[i].error = e instanceof Error ? e.message : String(e)
    }
  }
  // Phase 2: each op to its target.
  for (const [i, op] of ops.entries()) {
    if (out[i].error) continue
    if (op.from === op.to) {
      out[i] = { from: op.from, to: op.to, ok: true, skipped: !(await exists(op.from)) }
      continue
    }
    const src = parked.get(i) ?? op.from
    if (!parked.has(i) && !(await exists(src))) {
      out[i] = { from: op.from, to: op.to, ok: true, skipped: true }
      continue
    }
    try {
      const target =
        op.mode === 'rename' && sameIgnoringCase(op.from, op.to)
          ? op.to
          : await freeTarget(op.to, !!op.unique)
      if (!target) throw new Error(`"${basename(op.to)}" already exists`)
      if (op.mode === 'copy') await cp(src, target, { recursive: true, errorOnExist: true })
      else await moveDir(src, target)
      out[i] = { from: op.from, to: target, ok: true }
    } catch (e) {
      out[i].error = e instanceof Error ? e.message : String(e)
      // Put a stepped-aside folder back under its own name.
      if (parked.has(i)) await rename(src, op.from).catch(() => undefined)
    }
  }
  return out
}

/**
 * Delete files and folders (recursively) for a project folder clean-up — each only if it lies
 * strictly inside `root` (the project's data folder), so a bad plan can never reach outside it.
 * One failing path doesn't stop the rest; returns what couldn't be removed.
 */
async function removeInside(root: string, paths: string[]): Promise<string[]> {
  const base = resolve(root)
  const errors: string[] = []
  for (const p of paths) {
    const full = resolve(p)
    const rel = relative(base, full)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      errors.push(`${p}: outside the project data folder — not removed`)
      continue
    }
    try {
      await rm(full, { recursive: true, force: true })
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return errors
}

export function registerDataLayout(): void {
  ipcMain.handle('layout:removeInside', (_evt, root: string, paths: string[]): Promise<string[]> =>
    removeInside(root, paths)
  )
  ipcMain.handle('layout:scratchDir', (): string => scratch)
  ipcMain.handle('layout:applyDirOps', (_evt, ops: DirOp[]): Promise<DirOpResult[]> =>
    applyDirOps(ops)
  )
  app.on('will-quit', () => rmSync(scratch, { recursive: true, force: true }))
}
