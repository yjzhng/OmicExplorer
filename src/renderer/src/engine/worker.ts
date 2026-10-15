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
  enrichmentAll,
  buildCluster
} from './index'
import type { ContrastInput, ContrastPairInput } from './contrast'
import type { DirectInput } from './direct'
import type { TwoWayInput } from './twoWay'
import type {
  CompareInput,
  CompareResultRow,
  ConditionKey,
  StandardizeInput,
  StandardRow,
  VehNormInput
} from './types'
import type { ClusterOptions, EnrichOptions } from './plotData'
import { curveFitSteps, driveAsync } from './direct'
import { responseSurfaceSteps, runResponseSurface, type ResponseInput } from './responseSurface'
import { enrichmentAllSteps } from './plotData'
import { configurePool, pool, setUiBusy } from './pool'
import { clusterRowGroups } from './cluster'
import { decodeValue, encodeValue } from './wire'

export type EngineRequest =
  | { id: number; op: 'standardize'; payload: StandardizeInput }
  | { id: number; op: 'previewScale'; payload: { dataText: string; dataFilename: string } }
  | { id: number; op: 'vehNorm'; payload: VehNormInput }
  | { id: number; op: 'direct'; payload: DirectInput }
  | { id: number; op: 'compare'; payload: CompareInput }
  | { id: number; op: 'twoWayAnova'; payload: TwoWayInput }
  | { id: number; op: 'curveFit'; payload: CompareInput & { curveAxis: ConditionKey } }
  | { id: number; op: 'responseSurface'; payload: ResponseInput }
  | { id: number; op: 'contrast'; payload: ContrastInput }
  | { id: number; op: 'contrastPair'; payload: ContrastPairInput }
  | { id: number; op: 'putDataset'; payload: { key: number; rows: unknown[] } }
  | { id: number; op: 'configurePool'; payload: { size: number } }
  | { id: number; op: 'uiBusy'; payload: { busy: boolean } }
  | { id: number; op: 'clusterRowGroups'; payload: { flat: Float64Array; m: number; k: number } }
  | { id: number; op: 'dropDataset'; payload: { key: number } }
  | {
      id: number
      op: 'enrichmentTable'
      payload: { rows: CompareResultRow[]; opts: Omit<EnrichOptions, 'topTerms'>; facet?: string }
    }
  | { id: number; op: 'buildCluster'; payload: { rows: StandardRow[]; opts: ClusterOptions } }
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
  postMessage(msg: EngineResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', cb: (e: { data: EngineRequest }) => void): void
}
const ctx = self as unknown as WorkerCtx

/** Input tables kept from earlier requests (see the client's withDataset), by key. */
const datasets = new Map<number, unknown[]>()

ctx.addEventListener('message', async (e) => {
  const msg = e.data
  if (msg.op === 'putDataset') {
    datasets.set(msg.payload.key, decodeValue(msg.payload.rows) as unknown[])
    return
  }
  if (msg.op === 'dropDataset') {
    datasets.delete(msg.payload.key)
    return
  }
  if (msg.op === 'configurePool') {
    configurePool(msg.payload.size)
    return
  }
  if (msg.op === 'uiBusy') {
    setUiBusy(msg.payload.busy)
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
    else if (msg.op === 'clusterRowGroups') {
      // rows arrive as one flat (transferred) buffer; each row a view onto it
      const { flat, m, k } = msg.payload
      const rows: Float64Array[] = []
      for (let i = 0; i + m <= flat.length && m > 0; i += m) rows.push(flat.subarray(i, i + m))
      result = clusterRowGroups(rows as unknown as number[][], k)
    } else if (msg.op === 'previewScale')
      result = previewScale(msg.payload.dataText, msg.payload.dataFilename)
    else if (msg.op === 'vehNorm') result = runVehNorm(msg.payload)
    else if (msg.op === 'direct') result = runDirect(msg.payload)
    else if (msg.op === 'compare') result = runCompare(msg.payload)
    else if (msg.op === 'twoWayAnova') result = runTwoWayAnova(msg.payload)
    else if (msg.op === 'curveFit') {
      // The fits shared out over the pool when there is one (same results, more cores).
      const p = pool()
      result = p ? await driveAsync(curveFitSteps(msg.payload), p.fit) : runCurveFit(msg.payload)
    } else if (msg.op === 'responseSurface') {
      // The 4PL surface detector's fits shared out over the pool when there is one.
      const p = pool()
      result = p
        ? await driveAsync(responseSurfaceSteps(msg.payload), p.joint)
        : runResponseSurface(msg.payload)
    } else if (msg.op === 'contrast') result = runContrast(msg.payload)
    else if (msg.op === 'contrastPair') result = runContrastPair(msg.payload)
    else if (msg.op === 'enrichmentAll') {
      const p = pool()
      result = p
        ? await driveAsync(enrichmentAllSteps(msg.payload.rows, msg.payload.opts), p.enrich)
        : enrichmentAll(msg.payload.rows, msg.payload.opts)
    } else if (msg.op === 'buildCluster') result = buildCluster(msg.payload.rows, msg.payload.opts)
    else if (msg.op === 'enrichmentTable')
      result = enrichmentTable(msg.payload.rows, msg.payload.opts, msg.payload.facet)
    else throw new Error(`Unknown engine op: ${(msg as { op: string }).op}`)
    // Row tables go back columnar, their buffers moved rather than copied (see wire.ts).
    const transfer: Transferable[] = []
    ctx.postMessage({ id: msg.id, ok: true, result: encodeValue(result, transfer) }, transfer)
  } catch (err) {
    ctx.postMessage({
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
})
