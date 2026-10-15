/**
 * A pool sub-worker (see pool.ts): fits batches of curves and runs single enrichment jobs for the
 * engine worker, which shares its independent pieces out over several of these. Inputs used by
 * many jobs (a facet's rows, a source's annotation columns) arrive once as `put` and are referred
 * to by key.
 */
import { fitBatch, type FitBatch } from './direct'
import { enrichJob, type EnrichJob } from './plotData'
import { fitJointBatch, type JointBatch } from './surfaceJoint'

export type PoolRequest =
  | { op: 'put'; key: string; value: unknown }
  | { op: 'drop'; keys: string[] }
  | { op: 'fit'; id: number; batch: FitBatch }
  | { op: 'joint'; id: number; batch: JointBatch }
  | { op: 'enrich'; id: number; job: EnrichJob; rowsKey: string; annKey: string }
export type PoolResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

interface Ctx {
  postMessage(msg: PoolResponse): void
  addEventListener(type: 'message', cb: (e: { data: PoolRequest }) => void): void
}
const ctx = self as unknown as Ctx
const shared = new Map<string, unknown>()

ctx.addEventListener('message', (e) => {
  const m = e.data
  if (m.op === 'put') return void shared.set(m.key, m.value)
  if (m.op === 'drop') return void m.keys.forEach((k) => shared.delete(k))
  try {
    let result: unknown
    if (m.op === 'fit') result = fitBatch(m.batch)
    else if (m.op === 'joint') result = fitJointBatch(m.batch)
    else {
      const job: EnrichJob = {
        rows: shared.get(m.rowsKey) as EnrichJob['rows'],
        opts: {
          ...m.job.opts,
          annotationMap: shared.get(m.annKey) as EnrichJob['opts']['annotationMap']
        }
      }
      result = enrichJob(job)
    }
    ctx.postMessage({ id: m.id, ok: true, result })
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
})
