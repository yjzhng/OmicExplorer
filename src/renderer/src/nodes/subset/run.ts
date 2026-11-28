/** Subset's run: keep the samples whose conditions take the chosen values. */
import type { LoadConfig, SubsetConfig } from '../../graph/config/load'
import { wiredKindOf, loadAbove } from '../../graph/registry'
import { rowCount } from '../../engine/columns/lazyRows'
import { engine } from '../../engine/client'
import type { StepRunContext } from '../runContext'

export async function run(ctx: StepRunContext): Promise<void> {
  const { id, node, state, get, set, setStatus, upId } = ctx
  // Off Load data, the filter is Clean data's to apply as it reads the import (loadAbove):
  // nothing to compute here, only that the import is there to filter.
  if (wiredKindOf(state, id) === 'load') {
    const cfg = loadAbove(state, id)?.load.data.config as LoadConfig | undefined
    if (!cfg?.data || !cfg.samplesheet) {
      setStatus('error', 'Configure the Load data tile first.')
      return
    }
    setStatus('done')
    get().invalidateDownstream(id)
    return
  }
  // Keep the samples whose conditions take the chosen values (Clean data or a Merge in —
  // either emits the same result kind — and Clean data out).
  const up = upId ? state.results[upId] : undefined
  if (up?.kind !== 'standardize') {
    setStatus('error', 'Connect and run a Clean data tile upstream.')
    return
  }
  const sc = node.data.config as SubsetConfig
  setStatus('running')
  // filtered in the worker
  const std = await engine.subset(up.std, sc.keep ?? {}, { reps: sc.reps, drop: sc.drop })
  if (get().nodes.find((n) => n.id === id)?.data.status !== 'running') return // cancelled
  if (rowCount(std) === 0) {
    setStatus('error', 'No samples match the chosen values.')
    return
  }
  set((s) => ({ results: { ...s.results, [id]: { kind: 'standardize', std } } }))
  setStatus('done')
  get().invalidateDownstream(id)
}
