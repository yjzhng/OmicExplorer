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
  runFactorAnova,
  runVehNorm,
  recleanStandardized,
  standardize,
  previewScale,
  enrichmentTable,
  enrichmentAll,
  buildCluster,
  buildSampleCorrAll
} from './index'
import type { ContrastInput, ContrastPairInput } from './contrast'
import { failure } from './engineError'
import type { RecleanInput } from './ingest'
import type { DirectInput } from './direct'
import type { FactorAnovaInput } from './twoWay'
import type {
  CompareInput,
  CompareResultRow,
  ConditionKey,
  StandardizeInput,
  StandardRow,
  VehNormInput
} from './types'
import type { ClusterOptions } from './plotData'
import type { ValueScale } from './scale'
import { curveFitSteps, driveAsync } from './direct'
import { responseSurfaceSteps, runResponseSurface, type ResponseInput } from './responseSurface'
import { enrichmentAllSteps } from './plotData'
import { configurePool, pool, setUiBusy } from './pool'
import { clusterRowGroups, clusterRowTree, type ClusterOrderOptions } from './cluster'
import { progressTracker, type Progress, type ProgressTracker } from './progress'
import { decodeValue, encodeValue } from './wire'

export type EngineRequest =
  | { id: number; op: 'standardize'; payload: StandardizeInput }
  | { id: number; op: 'reclean'; payload: RecleanInput }
  | { id: number; op: 'previewScale'; payload: { dataText: string; dataFilename: string } }
  | { id: number; op: 'vehNorm'; payload: VehNormInput }
  | { id: number; op: 'direct'; payload: DirectInput }
  | { id: number; op: 'compare'; payload: CompareInput }
  | { id: number; op: 'factorAnova'; payload: FactorAnovaInput }
  | { id: number; op: 'curveFit'; payload: CompareInput & { curveAxis: ConditionKey } }
  | { id: number; op: 'responseSurface'; payload: ResponseInput }
  | { id: number; op: 'contrast'; payload: ContrastInput }
  | { id: number; op: 'contrastPair'; payload: ContrastPairInput }
  | { id: number; op: 'putDataset'; payload: { key: number; rows: unknown[] } }
  | { id: number; op: 'configurePool'; payload: { size: number } }
  | { id: number; op: 'uiBusy'; payload: { busy: boolean } }
  | { id: number; op: 'clusterRowGroups'; payload: { flat: Float64Array; m: number; k: number } }
  | {
      id: number
      op: 'clusterRowTree'
      payload: { flat: Float64Array; m: number; opts: ClusterOrderOptions }
    }
  | { id: number; op: 'dropDataset'; payload: { key: number } }
  | {
      id: number
      op: 'enrichmentTable'
      payload: {
        rows: CompareResultRow[]
        opts: Parameters<typeof enrichmentTable>[1]
        facet?: string
      }
    }
  | { id: number; op: 'buildCluster'; payload: { rows: StandardRow[]; opts: ClusterOptions } }
  | {
      id: number
      op: 'sampleCorr'
      payload: { rows: StandardRow[]; activeConditions: ConditionKey[]; scale?: ValueScale }
    }
  | {
      id: number
      op: 'enrichmentAll'
      payload: { rows: CompareResultRow[]; opts: Parameters<typeof enrichmentAll>[1] }
    }

export type EngineResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string; stack?: string; op?: string }
  /** a long run's progress so far (the request still running) */
  | { id: number; progress: Progress }

// Cast the worker global to a minimal interface to avoid pulling the conflicting
// webworker/DOM lib typings into this file.
interface WorkerCtx {
  postMessage(msg: EngineResponse, transfer?: Transferable[]): void
  addEventListener(type: 'message', cb: (e: { data: EngineRequest }) => void): void
}
const ctx = self as unknown as WorkerCtx

/** Input tables kept from earlier requests (see the client's withDataset), by key. */
const datasets = new Map<number, unknown[]>()

/** A tracker posting a request's progress back to the page (throttled — see progressTracker). */
const trackerFor = (id: number): ProgressTracker =>
  progressTracker((progress) => ctx.postMessage({ id, progress }))

/** A compute request: every op but the control messages handled before it. */
type ComputeRequest = Exclude<
  EngineRequest,
  { op: 'putDataset' | 'dropDataset' | 'configurePool' | 'uiBusy' }
>
type PayloadOf<O extends ComputeRequest['op']> = Extract<ComputeRequest, { op: O }>['payload']

/** The engine ops, by name: each takes its payload (and the request id, for its progress) and
 *  returns its result. A new op is one entry here plus its request type above. */
const OPS: { [O in ComputeRequest['op']]: (payload: PayloadOf<O>, id: number) => unknown } = {
  standardize: (p) => standardize(p),
  reclean: (p) => recleanStandardized(p),
  clusterRowGroups: ({ flat, m, k }) => {
    // rows arrive as one flat (transferred) buffer; each row a view onto it
    const rows: Float64Array[] = []
    for (let i = 0; i + m <= flat.length && m > 0; i += m) rows.push(flat.subarray(i, i + m))
    return clusterRowGroups(rows as unknown as number[][], k)
  },
  clusterRowTree: ({ flat, m, opts }) => {
    // likewise
    const rows: Float64Array[] = []
    for (let i = 0; i + m <= flat.length && m > 0; i += m) rows.push(flat.subarray(i, i + m))
    return clusterRowTree(rows as unknown as number[][], opts)
  },
  previewScale: (p) => previewScale(p.dataText, p.dataFilename),
  vehNorm: (p) => runVehNorm(p),
  direct: (p) => runDirect(p),
  compare: (p) => runCompare(p),
  factorAnova: (p) => runFactorAnova(p),
  curveFit: (p, id) => {
    // The fits shared out over the pool when there is one (same results, more cores), each
    // chunk counted as it comes back (progress).
    const pl = pool()
    const pr = trackerFor(id)
    return pl ? driveAsync(curveFitSteps(p, pr), (b) => pl.fit(b, pr.add)) : runCurveFit(p, pr)
  },
  responseSurface: (p, id) => {
    // The 4PL surface detector's fits shared out over the pool when there is one.
    const pl = pool()
    const pr = trackerFor(id)
    return pl
      ? driveAsync(responseSurfaceSteps(p, pr), (b) => pl.joint(b, pr.add))
      : runResponseSurface(p, pr)
  },
  contrast: (p) => runContrast(p),
  contrastPair: (p) => runContrastPair(p),
  enrichmentAll: (p) => {
    const pl = pool()
    return pl
      ? driveAsync(enrichmentAllSteps(p.rows, p.opts), pl.enrich)
      : enrichmentAll(p.rows, p.opts)
  },
  buildCluster: (p) => buildCluster(p.rows, p.opts),
  sampleCorr: (p) =>
    buildSampleCorrAll({ rows: p.rows, activeConditions: p.activeConditions }, { scale: p.scale }),
  enrichmentTable: (p) => enrichmentTable(p.rows, p.opts, p.facet)
}

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
    const op = OPS[msg.op as ComputeRequest['op']] as
      ((payload: unknown, id: number) => unknown) | undefined
    if (!op) throw new Error(`Unknown engine op: ${(msg as { op: string }).op}`)
    const result: unknown = await op(msg.payload, msg.id)
    // Row tables go back columnar, their buffers moved rather than copied (see wire.ts).
    const transfer: Transferable[] = []
    ctx.postMessage({ id: msg.id, ok: true, result: encodeValue(result, transfer) }, transfer)
  } catch (err) {
    ctx.postMessage({ id: msg.id, ok: false, op: msg.op, ...failure(err) })
  }
})
