/** The results behind the undo/redo history. A history snapshot records, per result key, the id of
 *  the result VERSION it had; the versions live here. One that is still current costs nothing (the
 *  store holds it anyway); one that has been replaced is kept in memory only while it's among the
 *  few most recently replaced, and otherwise spilled to a session file on disk (packed, as parked
 *  workflows are) and read back if an undo/redo needs it. Versions no snapshot refers to any longer
 *  are forgotten, files and all; past the disk cap the oldest files go, and undoing to them then
 *  needs a re-run.
 *
 *  A threshold drag re-calls a Compare into a new object with the same statistics. Those are one
 *  FAMILY: a snapshot records the family, any member serves as its statistics (undo re-calls it
 *  under the restored threshold), and a family is spilled once — not once per drag. */
import type { NodeResult } from './types'

export interface HistoryIO {
  write: (key: string, pieces: string[]) => Promise<void>
  read: (key: string) => Promise<string>
  drop: (key: string) => Promise<void>
  pack: (results: Record<string, NodeResult>) => string[]
  unpack: (text: string) => Record<string, NodeResult>
}

interface Version {
  id: number
  /** in memory: a member of the family (the current one while there is one) */
  obj?: NodeResult
  /** on disk under this park key, `size` characters */
  file?: string
  size: number
  /** a write in flight */
  writing?: Promise<void>
  /** dropped past the disk cap: undo to it needs a re-run */
  evicted?: boolean
}

/** Replaced versions kept in memory, the most recently replaced first — a quick undo needs no read. */
export const HOT = 2
/** Disk use cap for spilled versions, in characters (≈ bytes: the packed text is ASCII JSON). */
export const DISK_CAP = 2e9

export class HistoryCache {
  private readonly io: HistoryIO
  private readonly session: string
  private next = 1
  private readonly ids = new WeakMap<object, number>()
  private readonly root = new WeakMap<object, object>()
  private readonly versions = new Map<number, Version>()
  /** version ids in the order they were replaced (most recent last) */
  private replaced: number[] = []
  private queue: Promise<void> = Promise.resolve()

  private readonly hot: number
  private readonly diskCap: number

  constructor(io: HistoryIO, opts: { session?: string; hot?: number; diskCap?: number } = {}) {
    this.io = io
    this.session = opts.session ?? Math.random().toString(36).slice(2, 10)
    this.hot = opts.hot ?? HOT
    this.diskCap = opts.diskCap ?? DISK_CAP
  }

  /** `next` re-calls `prev` (same statistics, another threshold): one family. */
  derive(next: NodeResult, prev: NodeResult): void {
    this.root.set(next, this.root.get(prev) ?? prev)
  }

  private familyOf(r: NodeResult): object {
    return this.root.get(r) ?? r
  }

  /** The version ids of a results map, registering any not seen yet — what a snapshot records. */
  ref(results: Record<string, NodeResult>): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [key, r] of Object.entries(results)) {
      if (!r) continue
      const fam = this.familyOf(r)
      let id = this.ids.get(fam)
      if (id == null || !this.versions.has(id)) {
        id = this.next++
        this.ids.set(fam, id)
        this.versions.set(id, { id, obj: r, size: 0 })
      } else {
        const v = this.versions.get(id)!
        // The newest member stands for the family (it's the one the store holds).
        if (!v.evicted) v.obj = r
      }
      out[key] = id
    }
    return out
  }

  /** A version held in memory, if it is. */
  peek(id: number): NodeResult | undefined {
    return this.versions.get(id)?.obj
  }

  /** Whether a version can still be restored (in memory or on disk). */
  has(id: number): boolean {
    const v = this.versions.get(id)
    return !!v && !v.evicted && (!!v.obj || !!v.file)
  }

  /** A version, read back from disk if it has to be; undefined when it's gone. */
  async load(id: number): Promise<NodeResult | undefined> {
    const v = this.versions.get(id)
    if (!v || v.evicted) return undefined
    if (v.obj) return v.obj
    await v.writing
    if (!v.file) return undefined
    try {
      const r = this.io.unpack(await this.io.read(v.file)).r
      return this.versions.has(id) && !v.evicted ? r : undefined
    } catch {
      return undefined
    }
  }

  /** Bring the cache in line with the store: forget versions no snapshot refers to, keep the current
   *  ones and the HOT most recently replaced in memory, spill the rest, and hold disk use under the
   *  cap. `live` = every version id the history's snapshots record. */
  sync(current: Record<string, NodeResult>, live: Set<number>): void {
    const currentFam = new Map<number, NodeResult>()
    for (const r of Object.values(current)) {
      if (!r) continue
      const id = this.ids.get(this.familyOf(r))
      if (id != null) currentFam.set(id, r)
    }
    for (const v of [...this.versions.values()]) {
      if (live.has(v.id) || currentFam.has(v.id)) continue
      this.versions.delete(v.id)
      if (v.file) this.enqueue(() => this.io.drop(v.file!))
    }
    // The current member stays the family's in-memory copy; any other replaced version is in line.
    for (const [id, r] of currentFam) {
      const v = this.versions.get(id)
      if (v && !v.evicted) v.obj = r
    }
    this.replaced = this.replaced.filter((id) => this.versions.has(id) && !currentFam.has(id))
    for (const v of this.versions.values())
      if (!currentFam.has(v.id) && !this.replaced.includes(v.id) && !v.evicted)
        this.replaced.push(v.id)
    const hot = new Set(this.hotIds())
    for (const id of this.replaced) {
      const v = this.versions.get(id)!
      if (hot.has(id) || !v.obj || v.writing) continue
      if (v.file) v.obj = undefined
      else this.spill(v)
    }
    this.cap()
  }

  /** The most recently replaced versions kept in memory (`slice(-0)` would be all of them). */
  private hotIds(): number[] {
    return this.hot > 0 ? this.replaced.slice(-this.hot) : []
  }

  private spill(v: Version): void {
    const obj = v.obj!
    const key = `hist-${this.session}-${v.id}`
    v.writing = new Promise<void>((resolve) => {
      this.enqueue(async () => {
        try {
          if (!this.versions.has(v.id)) return
          const pieces = this.io.pack({ r: obj })
          await this.io.write(key, pieces)
          v.file = key
          v.size = pieces.reduce((n, p) => n + p.length, 0)
          // Only now is it safe to let go — unless it became current again meanwhile.
          if (v.obj === obj && this.replaced.includes(v.id) && !this.hotIds().includes(v.id))
            v.obj = undefined
          if (!this.versions.has(v.id)) await this.io.drop(key)
          this.cap()
        } catch {
          // A failed write keeps the version in memory; nothing is lost.
        } finally {
          v.writing = undefined
          resolve()
        }
      })
    })
  }

  /** Over the disk cap: drop the oldest spilled versions that aren't in memory. */
  private cap(): void {
    let total = 0
    for (const v of this.versions.values()) if (v.file) total += v.size
    for (const v of [...this.versions.values()].sort((a, b) => a.id - b.id)) {
      if (total <= this.diskCap) break
      if (!v.file || v.obj) continue
      total -= v.size
      const file = v.file
      v.file = undefined
      v.evicted = true
      this.enqueue(() => this.io.drop(file))
    }
  }

  private enqueue(job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch(() => undefined)
  }

  /** Resolves once every queued write/drop has finished (tests; nothing in the app waits on it). */
  idle(): Promise<void> {
    return this.queue
  }

  /** Diagnostics for tests: what's held where. */
  stats(): { versions: number; inMemory: number; onDisk: number; diskSize: number } {
    let inMemory = 0
    let onDisk = 0
    let diskSize = 0
    for (const v of this.versions.values()) {
      if (v.obj) inMemory++
      if (v.file) {
        onDisk++
        diskSize += v.size
      }
    }
    return { versions: this.versions.size, inMemory, onDisk, diskSize }
  }
}
