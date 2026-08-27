/**
 * Promise-based client for the engine Web Worker. React nodes call `engine.*`
 * and await results; compute runs off the UI thread.
 */
import type { ContrastInput, ContrastResult } from './contrast'
import type { CompareTableResult, DirectInput } from './direct'
import type { TwoWayInput } from './twoWay'
import type { EngineRequest, EngineResponse } from './worker'
import type {
  CompareInput,
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

function call<T>(op: EngineRequest['op'], payload: unknown): Promise<T> {
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ id, op, payload } as EngineRequest)
  })
}

export const engine = {
  standardize: (input: StandardizeInput): Promise<StandardizeResult> =>
    call<StandardizeResult>('standardize', input),
  vehNorm: (input: VehNormInput): Promise<VehNormResult> => call<VehNormResult>('vehNorm', input),
  direct: (input: DirectInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('direct', input),
  compare: (input: CompareInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('compare', input),
  twoWayAnova: (input: TwoWayInput): Promise<CompareTableResult> =>
    call<CompareTableResult>('twoWayAnova', input),
  contrast: (input: ContrastInput): Promise<ContrastResult> => call<ContrastResult>('contrast', input),
  /** Terminate the worker and reject any in-flight calls (backs the Stop button). */
  cancel: (): void => {
    if (worker) {
      worker.terminate()
      worker = null
    }
    for (const [, p] of pending) p.reject(new Error('cancelled'))
    pending.clear()
  }
}
