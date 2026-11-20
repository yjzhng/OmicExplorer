/** dr: its node contract (see nodes/contract.ts). */
import type { DRConfig } from '../../graph/types'
import { type ConditionKey, condLabel, contextOf } from '../../engine'
import { defineSpec } from '../contract'
import { responseAxisVariants } from '../kit/variants'
import { SURFACES, needSeries } from '../kit/requirements'

export const drSpec = defineSpec<'dr'>({
  kind: 'dr',
  label: 'Dose/time-response',
  category: 'plotting',
  // From a Compare: every gene's response over the levels; from a Curve fit: its fitted curves.
  // From a Contrast: the hovered gene's response on
  // BOTH contrasted sides (FC1 vs FC2), for comparing profiles between two datasets/contrasts.
  input: { accepts: ['comparison', 'curves', 'contrast'] },
  output: null,
  hasRun: true,
  defaultConfig: (): DRConfig => ({ axis: 'dose', capEnabled: true, topGenes: 10 }),
  requirement: (u, cfg) => {
    if (u.surface) return SURFACES
    const axis = (cfg as { axis?: ConditionKey })?.axis ?? 'dose'
    // a Curve fit draws its own curves: over its axis only
    if (u.curve && u.curveAxis)
      return u.curveAxis === axis
        ? null
        : `The Curve fit runs over ${condLabel(u.curveAxis)} — add its ${condLabel(u.curveAxis)} response instead`
    // A curve fit's rows are whole curves over the axis (no per-level rows), each naming it.
    if (u.result?.kind === 'compare' && contextOf(u.result.cmp).rows.some((c) => c.along === axis))
      return null
    return needSeries(u, axis)
  },
  plot: {
    tileHint: 'Response curves. Select to view.',
    configurable: true,
    legend: true,
    axes: true,
    variants: responseAxisVariants
  }
})
