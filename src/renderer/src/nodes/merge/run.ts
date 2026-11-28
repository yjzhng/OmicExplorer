/** Merge's run: pool every upstream Clean data into one dataset. */
import { isStep } from '../../graph/types'
import { stepTitle } from '../../graph/registry'
import { engine } from '../../engine/client'
import type { StepRunContext } from '../runContext'

export async function run(ctx: StepRunContext): Promise<void> {
  const { id, state, get, set, setStatus } = ctx
  // Pool every upstream Clean data (or Merge — it emits the same result kind) into one
  // dataset, so downstream tiles see the datasets as a single experiment. Genes are matched
  // across inputs by uniqID; samples sharing a condition pool as replicates.
  const ins = state.upstreamIds(id).flatMap((u) => {
    const r = state.results[u]
    return r?.kind === 'standardize' ? [{ id: u, std: r.std }] : []
  })
  if (ins.length === 0) {
    setStatus('error', 'Connect and run two or more Clean data tiles upstream.')
    return
  }
  // Each sample's source, by its input's name (two alike told apart by their step ids) — what
  // a Clean data below can fill its batches from.
  const titles = ins.map((x) => {
    const n = state.nodes.find((m) => m.id === x.id)
    return n && isStep(n) ? stepTitle(n) : x.id
  })
  const names = titles.map((t, i) =>
    titles.indexOf(t) !== titles.lastIndexOf(t) ? `${t} · ${ins[i].id}` : t
  )
  setStatus('running')
  // pooled in the worker (a single input passes straight through)
  const std =
    ins.length === 1
      ? ins[0].std
      : await engine.combine(
          ins.map((x) => x.std),
          names
        )
  if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
  set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
  setStatus('done')
  get().invalidateDownstream(id)
}
