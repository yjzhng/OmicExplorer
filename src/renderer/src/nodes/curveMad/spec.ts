/** curveMad: its node contract (see nodes/contract.ts). */
import type { CurveMadConfig } from '../../graph/config/qc'
import { defineSpec } from '../contract'
import { CC_ONLY } from '../kit/requirements'

export const curveMadSpec = defineSpec<'curveMad'>({
  kind: 'curveMad',
  // Shown under the same name as Clean data's QC plot (qc): each tile only appears for its own
  // input, so the two never sit side by side.
  label: 'QC',
  category: 'plotting',
  // A curve fit's QC: its residuals from the fits (CurveCurator's MAD analysis), and the curves'
  // metrics against each other.
  input: { accepts: ['curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): CurveMadConfig => ({}),
  requirement: (u) => (u.detection === 'spline' || u.surface ? CC_ONLY : null),
  plot: {
    tileHint: 'Curve-fit QC: residuals and fit metrics. Select to view.',
    configurable: true,
    legend: 'groups',
    axes: true,
    guides: true
  }
})
