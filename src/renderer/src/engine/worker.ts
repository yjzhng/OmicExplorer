/**
 * Web Worker entry — runs the (pure) engine off the UI thread. Kept minimal: it
 * dispatches typed requests to the engine and posts back the result. Constructed
 * by client.ts via `new Worker(new URL('./worker.ts', import.meta.url))`.
 */
import {
  runCompare,
  runCurveFit,
  runContrast,
  runContrastPair,
  runDirect,
  runTwoWayAnova,
  runVehNorm,
  standardize,
  previewScale,
  enrichmentTable,
  enrichmentAll
} from './index'
import type { ContrastInput, ContrastPairInput } from './contrast'
import type { DirectInput } from './direct'
import type { TwoWayInput } from './twoWay'
import type {
  CompareInput,
  CompareResultRow,
  ConditionKey,
  StandardizeInput,
  VehNormInput
} from './types'
import type { EnrichOptions } from './plotData'

export type EngineRequest =
  | { id: number; op: 'standardize'; payload: StandardizeInput }
  | { id: number; op: 'previewScale'; payload: { dataText: string; dataFilename: string } }
  | { id: number; op: 'vehNorm'; payload: VehNormInput }
  | { id: number; op: 'direct'; payload: DirectInput }
  | { id: number; op: 'compare'; payload: CompareInput }
  | { id: number; op: 'twoWayAnova'; payload: TwoWayInput }
  | { id: number; op: 'curveFit'; payload: CompareInput & { curveAxis: ConditionKey } }
  | { id: number; op: 'contrast'; payload: ContrastInput }
  | { id: number; op: 'contrastPair'; payload: ContrastPairInput }
  | { id: number; op: 'putDataset'; payload: { key: number; rows: unknown[] } }
  | { id: number; op: 'dropDataset'; payload: { key: number } }
  | {
      id: number
      op: 'enrichmentTable'
      payload: { rows: CompareResultRow[]; opts: Omit<EnrichOptions, 'topTerms'>; facet?: string }
    }
  | {
      id: number
      op: 'enrichmentAll'
      payload: { rows: CompareResultRow[]; opts: Parameters<typeof enrichmentAll>[1] }
    }

export type EngineResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

// Cast the worker global to a minimal interface to avoid pulling the conflicting
// webworker/DOM lib typings into this file.
interface WorkerCtx {
  postMessage(msg: EngineResponse): void
  addEventListener(type: 'message', cb: (e: { data: EngineRequest }) => void): void
}
const ctx = self as unknown as WorkerCtx

/** Input tables kept from earlier requests (see the client's withDataset), by key. */
const datasets = new Map<number, unknown[]>()

ctx.addEventListener('message', (e) => {
  const msg = e.data
  if (msg.op === 'putDataset') {
    datasets.set(msg.payload.key, msg.payload.rows)
    return
  }
  if (msg.op === 'dropDataset') {
    datasets.delete(msg.payload.key)
    return
  }
  // A request naming a kept table gets it back in place of the key.
  const ref = (msg.payload as { rows?: { $dataset?: number } } | null)?.rows?.$dataset
  if (ref !== undefined) {
    const rows = datasets.get(ref)
    if (!rows) {
      ctx.postMessage({ id: msg.id, ok: false, error: 'engine lost its input table — run again' })
      return
    }
    ;(msg as { payload: unknown }).payload = { ...(msg.payload as object), rows }
  }
  try {
    let result: unknown
    if (msg.op === 'standardize') result = standardize(msg.payload)
    else if (msg.op === 'previewScale')
      result = previewScale(msg.payload.dataText, msg.payload.dataFilename)
    else if (msg.op === 'vehNorm') result = runVehNorm(msg.payload)
    else if (msg.op === 'direct') result = runDirect(msg.payload)
    else if (msg.op === 'compare') result = runCompare(msg.payload)
    else if (msg.op === 'twoWayAnova') result = runTwoWayAnova(msg.payload)
    else if (msg.op === 'curveFit') result = runCurveFit(msg.payload)
    else if (msg.op === 'contrast') result = runContrast(msg.payload)
    else if (msg.op === 'contrastPair') result = runContrastPair(msg.payload)
    else if (msg.op === 'enrichmentAll') result = enrichmentAll(msg.payload.rows, msg.payload.opts)
    else if (msg.op === 'enrichmentTable')
      result = enrichmentTable(msg.payload.rows, msg.payload.opts, msg.payload.facet)
    else throw new Error(`Unknown engine op: ${(msg as { op: string }).op}`)
    ctx.postMessage({ id: msg.id, ok: true, result })
  } catch (err) {
    ctx.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
})
