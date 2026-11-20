/** tdr: its node contract (see nodes/contract.ts). */
import { type TdrConfig, tdrPair } from '../../graph/types'
import { condLabel } from '../../engine'
import { defineSpec } from '../contract'
import { tdrVariants } from '../kit/variants'
import { needSeries } from '../kit/requirements'

export const tdrSpec = defineSpec<'tdr'>({
  kind: 'tdr',
  // The same name as the Curve fit's (response) — see there.
  label: 'Dose & Time response',
  category: 'plotting',
  input: { accepts: ['comparison'] },
  output: null,
  hasRun: true,
  defaultConfig: (): TdrConfig => ({}),
  requirement: (u, cfg) => {
    const [a, b] = tdrPair(cfg as TdrConfig | undefined)
    if (!u.axes.includes(a) || !u.axes.includes(b))
      return `Needs both ${condLabel(a)} and ${condLabel(b)} as numeric conditions in the data`
    return needSeries(u, a) ?? needSeries(u, b)
  },
  plot: {
    tileHint: (config) => {
      const [a, b] = tdrPair(config as TdrConfig)
      return `${condLabel(a)} × ${condLabel(b)} response per gene. Select to view.`
    },
    configurable: true,
    legend: true,
    // the 3-D projection is set once, in the settings window
    quick: { projection: false },
    variants: tdrVariants
  }
})
