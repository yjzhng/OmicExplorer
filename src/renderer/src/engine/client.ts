/**
 * Promise-based client for the engine Web Worker. React nodes call `engine.*`
 * and await results; compute runs off the UI thread.
 */
import type { ContrastInput, ContrastPairInput, ContrastResult } from './contrast'
import type { CompareTableResult, DirectInput } from './direct'
import type { FactorAnovaInput } from './twoWay'
import type { RecleanInput, ScalePreview } from './ingest'
import type {
  ClusterData,
  ClusterOptions,
  EnrichData,
  enrichmentAll,
  enrichmentTable
} from './plotData'
import type { EngineRequest, EngineResponse } from './worker'
import type { Progress } from './progress'
import type { ResponseInput } from './responseSurface'
import type {
  CompareInput,
  CompareResultRow,
  ConditionKey,
  StandardizeInput,
  StandardizeResult,
  StandardRow,
  VehNormInput,
  VehNormResult
} from './types'
import { decodeValue, encodeValue } from './wire'

let worker: Worker | null = null
let seq = 0
const pending = new Map<
  number,
  {
    resolve: (v: unknown) => void
    reject: (e: Error) => void
    /** told a long run's progress as the worker reports it */
    onProgress?: (p: Progress) => void
  }
>()

/** `localStorage['oe.enginePool']` overrides the engine pool's size (a number; 0 = no pool) — for
 *  diagnosing a machine. Unset, the worker sizes it from the core count (poolSize.ts). */
function poolOverride(): number | null {
  try {
    const o = localStorage.getItem('oe.enginePool')
    return o != null && o.trim() !== '' && Number.isFinite(Number(o)) ? Number(o) : null
  } catch {
    return null
  }
}

// UI back-off: while the UI thread is stalling (a tile rebuild, a big result arriving), the
// engine's pool keeps one worker fewer busy so it doesn't compete for the cores the UI needs to
// catch up. A stalled thread can't report itself, so a stall is seen as the gap after it; heavy UI
// work comes as a string of stalls, so the pool stays held back until the thread has been free
// for UI_CALM_MS.
const UI_STALL_MS = 250
const UI_CALM_MS = 1500
let uiBusy = false
let uiWatch: number | undefined
function watchUi(): void {
  if (uiWatch !== undefined || typeof window === 'undefined') return
  let last = performance.now()
  let calmSince = last
  const tell = (busy: boolean): void => {
    uiBusy = busy
    worker?.postMessage({ id: 0, op: 'uiBusy', payload: { busy } } as EngineRequest)
  }
  uiWatch = window.setInterval(() => {
    const now = performance.now()
    const gap = now - last
    last = now
    if (document.hidden) return // a hidden window's timers are throttled — not a stall
    if (gap > UI_STALL_MS) {
      calmSince = now
      if (!uiBusy) tell(true)
    } else if (uiBusy && now - calmSince > UI_CALM_MS) tell(false)
  }, 100)
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const size = poolOverride()
    if (size != null)
      worker.postMessage({ id: 0, op: 'configurePool', payload: { size } } as EngineRequest)
    if (uiBusy)
      worker.postMessage({ id: 0, op: 'uiBusy', payload: { busy: true } } as EngineRequest)
    watchUi()
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const msg = e.data
      const p = pending.get(msg.id)
      if (!p) return
      if ('progress' in msg) {
        p.onProgress?.(msg.progress)
        return
      }
      pending.delete(msg.id)
      // Results stay columnar where large: their rows are built when read (lazyRows.ts).
      if (msg.ok) p.resolve(decodeValue(msg.result, true))
      else p.reject(new Error(msg.error))
    }
    worker.onerror = (e) => {
      for (const [, p] of pending) p.reject(new Error(e.message || 'engine worker error'))
      pending.clear()
    }
  }
  return worker
}

// A request's input table (`rows`, e.g. a Clean data result's hundreds of thousands of rows) is
// copied to the worker ONCE and kept there: later requests over the same table send only its key.
// Copying it anew for every run cost a stall and a second copy in memory each time. The worker
// keeps the last two; the client mirrors which (weakly, so a table the app has dropped can go).
const DATASETS_KEPT = 2
const MIN_DATASET_ROWS = 5000
let datasets: Array<{ ref: WeakRef<object>; key: number }> = []
let datasetSeq = 0

/** The payload with a large `rows` table swapped for its key on the worker (sent there first if it
 *  isn't yet). */
function withDataset(payload: unknown): unknown {
  const rows = (payload as { rows?: unknown } | null)?.rows
  if (!Array.isArray(rows) || rows.length < MIN_DATASET_ROWS) return payload
  let entry = datasets.find((d) => d.ref.deref() === rows)
  if (entry) {
    datasets = [...datasets.filter((d) => d !== entry), entry] // most recent last
  } else {
    entry = { ref: new WeakRef(rows), key: ++datasetSeq }
    const w = getWorker()
    // Sent columnar (see wire.ts): the worker gets the same rows, the UI thread skips cloning them.
    const transfer: Transferable[] = []
    const packed = encodeValue(rows, transfer)
    w.postMessage(
      { id: 0, op: 'putDataset', payload: { key: entry.key, rows: packed } } as EngineRequest,
      transfer
    )
    datasets.push(entry)
    while (datasets.length > DATASETS_KEPT) {
      const old = datasets.shift()!
      w.postMessage({ id: 0, op: 'dropDataset', payload: { key: old.key } } as EngineRequest)
    }
  }
  return { ...(payload as object), rows: { $dataset: entry.key } }
}

function call<T>(
  op: EngineRequest['op'],
  payload: unknown,
  onProgress?: (p: Progress) => void
): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress })
    const message = withDataset(payload) // may post the table first (messages arrive in order)
    getWorker().postMessage({ id, op, payload: message } as EngineRequest)
  })
}

export const engine = {
  standardize: (input: StandardizeInput): Promise<StandardizeResult> =>
    call<StandardizeResult>('standardize', input),
  /** Clean data on another Clean data's table: its clean-up, normalisation and imputation only. */
  reclean: (input: RecleanInput): Promise<StandardizeResult> =>
    call<StandardizeResult>('reclean', input),
  /** A data file's scale and a value sample, for Clean data's preview — no run needed. */
  previewScale: (dataText: string, dataFilename: string): Promise<ScalePreview> =>
    call<ScalePreview>('previewScale', { dataText, dataFilename }),
  vehNorm: (input: VehNormInput): Promise<VehNormResult> => call<VehNormResult>('vehNorm', input),
  direct: (input: DirectInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('direct', input),
  compare: (input: CompareInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('compare', input),
  factorAnova: (input: FactorAnovaInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('factorAnova', input),
  /** Dose–response curve fit (CurveCurator's recalibrated F-test). */
  curveFit: (
    input: CompareInput & { curveAxis: ConditionKey },
    onProgress?: (p: Progress) => void
  ): Promise<CompareTableResult> => call<CompareTableResult>('curveFit', input, onProgress),
  /** Curve fit by the response surface method (spline detection; see responseSurface.ts). */
  responseSurface: (
    input: ResponseInput,
    onProgress?: (p: Progress) => void
  ): Promise<CompareTableResult> => call<CompareTableResult>('responseSurface', input, onProgress),
  contrast: (input: ContrastInput): Promise<ContrastResult> =>
    call<ContrastResult>('contrast', input),
  contrastPair: (input: ContrastPairInput): Promise<ContrastResult> =>
    call<ContrastResult>('contrastPair', input),
  /** An enrichment plot's run: every method × term source × facet (see enrichmentAll). */
  enrichmentAll: (
    rows: CompareResultRow[],
    opts: Parameters<typeof enrichmentAll>[1]
  ): Promise<Record<string, Record<string, EnrichData>>> =>
    call<Record<string, Record<string, EnrichData>>>('enrichmentAll', { rows, opts }),
  /** A cluster plot's run: the sample embedding (PCA / UMAP / t-SNE) of a Clean data table. */
  buildCluster: (rows: StandardRow[], opts: ClusterOptions): Promise<ClusterData> =>
    call<ClusterData>('buildCluster', { rows, opts }),
  /** Terminate the worker and reject any in-flight calls (backs the Stop button). */
  cancel: (): void => {
    if (worker) {
      worker.terminate()
      worker = null
    }
    datasets = [] // a new worker starts with none
    for (const [, p] of pending) p.reject(new Error('cancelled'))
    pending.clear()
  }
}

// Further workers, each its own lane: BACKGROUND work (the plot-table exports to output/) runs
// alongside the one above, so a long GSEA export never queues a run behind it, and Stop (cancel)
// leaves it alone; the UI lane builds dashboard pieces too heavy for the UI thread (a full
// proteome's heatmap clustering), so a tile never waits behind an export either.
function lane(
  idleMs?: number
): <T>(op: EngineRequest['op'], payload: unknown, transfer?: Transferable[]) => Promise<T> {
  let w: Worker | null = null
  let n = 0
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  // With `idleMs`, the worker is let go once idle that long (its heap freed at once); the next
  // call starts a fresh one.
  let idle: ReturnType<typeof setTimeout> | undefined
  const settle = (): void => {
    clearTimeout(idle)
    if (idleMs != null && waiting.size === 0)
      idle = setTimeout(() => {
        if (waiting.size === 0 && w) {
          w.terminate()
          w = null
        }
      }, idleMs)
  }
  return <T>(op: EngineRequest['op'], payload: unknown, transfer: Transferable[] = []) => {
    clearTimeout(idle)
    if (!w) {
      const nw = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      nw.onmessage = (e: MessageEvent<EngineResponse>) => {
        const msg = e.data
        const p = waiting.get(msg.id)
        if (!p || 'progress' in msg) return // (this side worker's ops report no progress)
        waiting.delete(msg.id)
        if (msg.ok) p.resolve(decodeValue(msg.result))
        else p.reject(new Error(msg.error))
        settle()
      }
      nw.onerror = (e) => {
        for (const [, p] of waiting) p.reject(new Error(e.message || 'engine worker error'))
        waiting.clear()
        w = null
      }
      w = nw
    }
    const id = ++n
    return new Promise<T>((resolve, reject) => {
      waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
      w!.postMessage({ id, op, payload } as EngineRequest, transfer)
    })
  }
}
const bgCall = lane()
// the clustering's distance matrix is a few hundred MB for a full proteome — freed with the worker
const uiCall = lane(5000)

export const engineBg = {
  /** One facet's enrichment as table rows (every tested term), labelled with `facet`. */
  enrichmentTable: (
    rows: CompareResultRow[],
    opts: Parameters<typeof enrichmentTable>[1],
    facet: string
  ): Promise<Record<string, string | number | null>[]> =>
    bgCall<Record<string, string | number | null>[]>('enrichmentTable', { rows, opts, facet })
}

export const engineUi = {
  /** clusterRowGroups off the UI thread: the rows go over as one flat transferred buffer. */
  clusterRowGroups: (matrix: number[][], k: number): Promise<number[][]> => {
    const m = matrix[0]?.length ?? 0
    const flat = new Float64Array(matrix.length * m)
    for (let i = 0; i < matrix.length; i++) flat.set(matrix[i], i * m)
    return uiCall<number[][]>('clusterRowGroups', { flat, m, k }, [flat.buffer])
  }
}
