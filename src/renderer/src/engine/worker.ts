/**
 * Web Worker entry — runs the (pure) engine off the UI thread. Kept minimal: it
 * dispatches typed requests to the engine and posts back the result. Constructed
 * by client.ts via `new Worker(new URL('./worker.ts', import.meta.url))`.
 */
import {
  runCompare,
  runContrast,
  runContrastPair,
  runDirect,
  runTwoWayAnova,
  runVehNorm,
  standardize
} from './index'
import type { ContrastInput, ContrastPairInput } from './contrast'
import type { DirectInput } from './direct'
import type { TwoWayInput } from './twoWay'
import type { CompareInput, StandardizeInput, VehNormInput } from './types'

export type EngineRequest =
  | { id: number; op: 'standardize'; payload: StandardizeInput }
  | { id: number; op: 'vehNorm'; payload: VehNormInput }
  | { id: number; op: 'direct'; payload: DirectInput }
  | { id: number; op: 'compare'; payload: CompareInput }
  | { id: number; op: 'twoWayAnova'; payload: TwoWayInput }
  | { id: number; op: 'contrast'; payload: ContrastInput }
  | { id: number; op: 'contrastPair'; payload: ContrastPairInput }

export type EngineResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }

// Cast the worker global to a minimal interface to avoid pulling the conflicting
// webworker/DOM lib typings into this file.
interface WorkerCtx {
  postMessage(msg: EngineResponse): void
  addEventListener(type: 'message', cb: (e: { data: EngineRequest }) => void): void
}
const ctx = self as unknown as WorkerCtx

ctx.addEventListener('message', (e) => {
  const msg = e.data
  try {
    let result: unknown
    if (msg.op === 'standardize') result = standardize(msg.payload)
    else if (msg.op === 'vehNorm') result = runVehNorm(msg.payload)
    else if (msg.op === 'direct') result = runDirect(msg.payload)
    else if (msg.op === 'compare') result = runCompare(msg.payload)
    else if (msg.op === 'twoWayAnova') result = runTwoWayAnova(msg.payload)
    else if (msg.op === 'contrast') result = runContrast(msg.payload)
    else if (msg.op === 'contrastPair') result = runContrastPair(msg.payload)
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
