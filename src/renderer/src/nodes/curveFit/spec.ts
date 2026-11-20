/** curveFit: its node contract (see nodes/contract.ts). */
import { type CurveFitConfig, CURVECURATOR_THRESHOLD } from '../../graph/types'
import { DEFAULT_THRESHOLD } from '../../engine'
import { defineSpec } from '../contract'

export const curveFitSpec = defineSpec<'curveFit'>({
  kind: 'curveFit',
  label: 'Curve fit',
  subtitle: 'dose / time curves',
  category: 'processing',
  input: { accepts: ['abundance'], max: 2 },
  output: 'curves',
  hasRun: true,
  defaultConfig: (): CurveFitConfig => ({
    analysis: 'curve_fit',
    method: 'ttest',
    curveAxis: 'dose',
    // Fresh tile: nothing declared — the user opens "Configure curve fit" to pick the
    // treatments and the control.
    num: {},
    den: {},
    match: [],
    condition: 'cmpd',
    pairNum: '',
    pairDen: '',
    condition2: 'dose',
    pair2Num: '',
    pair2Den: '',
    threshold: { ...DEFAULT_THRESHOLD, ...CURVECURATOR_THRESHOLD }
  })
})
