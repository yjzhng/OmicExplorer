/** response: its node contract (see nodes/contract.ts). */
import type { ResponseConfig } from '../../graph/config/response'
import { condLabel, type ConditionKey } from '../../engine'
import { defineSpec } from '../contract'
import { responsePairVariants } from '../kit/variants'

export const responseSpec = defineSpec<'response'>({
  kind: 'response',
  // Shown under the same name as the Compare's dose × time plot (tdr): each tile only appears
  // for its own input, so the two never sit side by side.
  label: 'Dose & Time response',
  category: 'plotting',
  // A Curve fit's dose × time surfaces (the response surface method), one gene at a time.
  input: { accepts: ['curves'] },
  output: null,
  hasRun: true,
  defaultConfig: (): ResponseConfig => ({ show: 'line' }),
  requirement: (u, cfg) => {
    const want = (cfg as { pair?: [ConditionKey, ConditionKey] })?.pair ?? ['dose', 'time']
    const name = `${condLabel(want[0])} × ${condLabel(want[1])}`
    if (!u.surface) return `Needs ${name} surfaces — a Curve fit over ${name}`
    const has = u.surfacePair ?? ['dose', 'time']
    return has[0] === want[0] && has[1] === want[1]
      ? null
      : `The Curve fit runs over ${condLabel(has[0])} × ${condLabel(has[1])}, not ${name}`
  },
  plot: {
    tileHint: (config) => {
      const [a, b] = (config as ResponseConfig | undefined)?.pair ?? ['dose', 'time']
      return `${condLabel(a)} × ${condLabel(b)} response surface per gene. Select to view.`
    },
    configurable: true,
    legend: true,
    // the 3-D projection is set once, in the settings window
    quick: { projection: false },
    variants: responsePairVariants
  }
})
