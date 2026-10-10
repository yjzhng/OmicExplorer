/**
 * Promise-based client for the engine Web Worker. React nodes call `engine.*`
 * and await results; compute runs off the UI thread.
 */
import type { ContrastInput, ContrastPairInput, ContrastResult } from './contrast'
import type { CompareTableResult, DirectInput } from './direct'
import type { TwoWayInput } from './twoWay'
import type { ScalePreview } from './ingest'
import type { EnrichData, EnrichOptions, enrichmentAll } from './plotData'
import type { EngineRequest, EngineResponse } from './worker'
import type {
  CompareInput,
  CompareResultRow,
  ConditionKey,
  StandardizeInput,
  StandardizeResult,
  VehNormInput,
  VehNormResult
} from './types'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const msg = e.data
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
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
    w.postMessage({ id: 0, op: 'putDataset', payload: { key: entry.key, rows } } as EngineRequest)
    datasets.push(entry)
    while (datasets.length > DATASETS_KEPT) {
      const old = datasets.shift()!
      w.postMessage({ id: 0, op: 'dropDataset', payload: { key: old.key } } as EngineRequest)
    }
  }
  return { ...(payload as object), rows: { $dataset: entry.key } }
}

function call<T>(op: EngineRequest['op'], payload: unknown): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    const message = withDataset(payload) // may post the table first (messages arrive in order)
    getWorker().postMessage({ id, op, payload: message } as EngineRequest)
  })
}

export const engine = {
  standardize: (input: StandardizeInput): Promise<StandardizeResult> =>
    call<StandardizeResult>('standardize', input),
  /** A data file's scale and a value sample, for Clean data's preview — no run needed. */
  previewScale: (dataText: string, dataFilename: string): Promise<ScalePreview> =>
    call<ScalePreview>('previewScale', { dataText, dataFilename }),
  vehNorm: (input: VehNormInput): Promise<VehNormResult> => call<VehNormResult>('vehNorm', input),
  direct: (input: DirectInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('direct', input),
  compare: (input: CompareInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('compare', input),
  twoWayAnova: (input: TwoWayInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('twoWayAnova', input),
  /** Dose–response curve fit (CurveCurator's recalibrated F-test). */
  curveFit: (input: CompareInput & { curveAxis: ConditionKey }): Promise<CompareTableResult> =>
    call<CompareTableResult>('curveFit', input),
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

// A second worker for BACKGROUND work (the plot-table exports to output/): it runs alongside the one
// above, so a long GSEA export never queues a run behind it, and Stop (cancel) leaves it alone.
let bgWorker: Worker | null = null
let bgSeq = 0
const bgPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
function bgCall<T>(op: EngineRequest['op'], payload: unknown): Promise<T> {
  if (!bgWorker) {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<EngineResponse>) => {
      const msg = e.data
      const p = bgPending.get(msg.id)
      if (!p) return
      bgPending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error))
    }
    w.onerror = (e) => {
      for (const [, p] of bgPending) p.reject(new Error(e.message || 'engine worker error'))
      bgPending.clear()
      bgWorker = null
    }
    bgWorker = w
  }
  const id = ++bgSeq
  return new Promise<T>((resolve, reject) => {
    bgPending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    bgWorker!.postMessage({ id, op, payload } as EngineRequest)
  })
}

export const engineBg = {
  /** One facet's enrichment as table rows (every tested term), labelled with `facet`. */
  enrichmentTable: (
    rows: CompareResultRow[],
    opts: Omit<EnrichOptions, 'topTerms'>,
    facet: string
  ): Promise<Record<string, string | number | null>[]> =>
    bgCall<Record<string, string | number | null>[]>('enrichmentTable', { rows, opts, facet })
}
