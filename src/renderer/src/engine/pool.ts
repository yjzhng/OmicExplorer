/**
 * A small pool of sub-workers the engine worker shares independent work out over: the curve fits
 * of a dose–response comparison (every curve's fit is its own), the 4PL surface fits of a dose ×
 * time one, and the facet × method × source jobs of an enrichment run. Each piece is pure, so the results are the same as computing them one
 * after another in the engine worker — only spread over the machine's cores.
 *
 * Created on first use, kept for the session; terminating the engine worker (Stop) takes its
 * sub-workers with it. Where workers can't be created here, `pool()` is null and the callers
 * compute in place.
 */
import type { CurveFit } from './curveFit'
import { fitBatch, type FitBatch } from './direct'
import type { EnrichData, EnrichJob } from './plotData'
import type { PoolRequest, PoolResponse } from './poolWorker'
import { fitJointBatch, type JointBatch, type JointFit } from './surfaceJoint'
import { POOL_MAX, poolSizeFor } from './poolSize'

interface Slot {
  w: Worker
  has: Set<string>
  busy: boolean
}
interface Task {
  /** keys this task's worker must hold first, with their values */
  needs: Array<[string, unknown]>
  msg: (id: number) => PoolRequest
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

/** Sub-workers, from the logical core count (poolSize.ts). 0 = no pool (compute in place). */
let SIZE = poolSizeFor(
  (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ??
    0
)
/** While the UI thread is stalling (setUiBusy), one worker fewer is kept busy, so the pool doesn't
 *  compete with it for the cores it needs to catch up. */
let uiBusy = false

/** The UI thread has been stalling (true) / has been free a while (false). */
export function setUiBusy(busy: boolean): void {
  uiBusy = busy
  if (!busy) pump()
}

/** Set the pool's size — the diagnostics override (the next use builds it at that size). */
export function configurePool(size: number): void {
  size = Math.max(0, Math.min(POOL_MAX, Math.floor(size)))
  if (size === SIZE) return
  SIZE = size
  if (slots && queue.length === 0 && running.size === 0) {
    for (const s of slots) s.w.terminate()
    slots = undefined
  }
}

let slots: Slot[] | null | undefined
let seq = 0
const queue: Task[] = []
const running = new Map<number, { slot: Slot; task: Task }>()

function create(): Slot[] | null {
  try {
    if (typeof Worker === 'undefined' || SIZE < 2) return null
    return Array.from({ length: SIZE }, () => {
      const w = new Worker(new URL('./poolWorker.ts', import.meta.url), { type: 'module' })
      const slot: Slot = { w, has: new Set(), busy: false }
      w.onmessage = (e: MessageEvent<PoolResponse>) => {
        const r = running.get(e.data.id)
        if (!r) return
        running.delete(e.data.id)
        r.slot.busy = false
        if (e.data.ok) r.task.resolve(e.data.result)
        else r.task.reject(new Error(e.data.error))
        pump()
      }
      w.onerror = (e) => {
        for (const [id, r] of running)
          if (r.slot === slot) {
            running.delete(id)
            r.task.reject(new Error(e.message || 'engine pool worker error'))
          }
        slot.busy = false
        pump()
      }
      return slot
    })
  } catch {
    return null
  }
}

/** Idle sub-workers are let go after this long: their heaps (a run's inputs and garbage) are
 *  freed at once instead of whenever they'd next collect. The next use starts fresh ones. */
const IDLE_MS = 4000
let idleTimer: ReturnType<typeof setTimeout> | undefined

function pump(): void {
  clearTimeout(idleTimer)
  if (slots && queue.length === 0 && running.size === 0)
    idleTimer = setTimeout(() => {
      if (!slots || queue.length || running.size) return
      for (const s of slots) s.w.terminate()
      slots = undefined
    }, IDLE_MS)
  if (!slots) return
  const limit = uiBusy ? Math.max(1, slots.length - 1) : slots.length
  for (const slot of slots) {
    if (running.size >= limit) return
    if (slot.busy) continue
    // Prefer a task whose shared inputs this worker already holds (no re-send), else the next.
    let i = queue.findIndex((t) => t.needs.every(([k]) => slot.has.has(k)))
    if (i < 0) i = 0
    const task = queue.splice(i, 1)[0]
    if (!task) return
    for (const [k, v] of task.needs)
      if (!slot.has.has(k)) {
        slot.w.postMessage({ op: 'put', key: k, value: v } satisfies PoolRequest)
        slot.has.add(k)
      }
    const id = ++seq
    slot.busy = true
    running.set(id, { slot, task })
    slot.w.postMessage(task.msg(id))
  }
}

function submit<T>(needs: Task['needs'], msg: Task['msg']): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ needs, msg, resolve: resolve as (v: unknown) => void, reject })
    pump()
  })
}

function drop(keys: string[]): void {
  for (const s of slots ?? []) {
    const held = keys.filter((k) => s.has.has(k))
    if (!held.length) continue
    held.forEach((k) => s.has.delete(k))
    s.w.postMessage({ op: 'drop', keys: held } satisfies PoolRequest)
  }
}

/** The pool, or null where sub-workers aren't available (then compute in place). */
export function pool(): {
  fit: (batch: FitBatch) => Promise<Array<CurveFit | null>>
  joint: (batch: JointBatch) => Promise<JointFit[]>
  enrich: (jobs: EnrichJob[]) => Promise<EnrichData[]>
} | null {
  if (slots === undefined || (slots === null && SIZE >= 2)) slots = create()
  if (!slots) return null
  return {
    /** Fit a batch across the pool: split into a few chunks per worker, answered in order. */
    fit: async (batch) => {
      if (batch.length < 64) return fitBatch(batch)
      const n = Math.min(batch.length, SIZE * 4)
      const size = Math.ceil(batch.length / n)
      const parts: Array<Promise<Array<CurveFit | null>>> = []
      for (let i = 0; i < batch.length; i += size) {
        const chunk = batch.slice(i, i + size)
        parts.push(submit([], (id) => ({ op: 'fit', id, batch: chunk })))
      }
      return (await Promise.all(parts)).flat()
    },
    /** Fit a batch of 4PL surfaces across the pool, as `fit` (each surface's fit is its own). */
    joint: async (batch) => {
      if (batch.length < 16) return fitJointBatch(batch)
      const n = Math.min(batch.length, SIZE * 4)
      const size = Math.ceil(batch.length / n)
      const parts: Array<Promise<JointFit[]>> = []
      for (let i = 0; i < batch.length; i += size) {
        const chunk = batch.slice(i, i + size)
        parts.push(submit([], (id) => ({ op: 'joint', id, batch: chunk })))
      }
      return (await Promise.all(parts)).flat()
    },
    /** Run enrichment jobs across the pool (GSEA's, the slow ones, first), answered in order. Each
     *  distinct rows table / annotation map goes to a worker once, by key. */
    enrich: async (jobs) => {
      const call = ++seq
      const keyOf = new Map<object, string>()
      const key = (o: object, tag: string): string => {
        let k = keyOf.get(o)
        if (!k) keyOf.set(o, (k = `${call}:${tag}${keyOf.size}`))
        return k
      }
      const order = jobs.map((_, i) => i).sort((a, b) => {
        const g = (i: number): number => (jobs[i].opts.method === 'gsea' ? 0 : 1)
        return g(a) - g(b) || a - b
      })
      const out: EnrichData[] = new Array(jobs.length)
      try {
        await Promise.all(
          order.map(async (i) => {
            const j = jobs[i]
            const rowsKey = key(j.rows, 'r')
            const annKey = key(j.opts.annotationMap, 'a')
            const job: EnrichJob = { rows: [], opts: { ...j.opts, annotationMap: {} } }
            out[i] = await submit<EnrichData>(
              [
                [rowsKey, j.rows],
                [annKey, j.opts.annotationMap]
              ],
              (id) => ({ op: 'enrich', id, job, rowsKey, annKey })
            )
          })
        )
      } finally {
        drop([...keyOf.values()])
      }
      return out
    }
  }
}
