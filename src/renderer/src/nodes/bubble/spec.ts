/** bubble: its node contract (see nodes/contract.ts). */
import type { BubbleConfig } from '../../graph/types'
import { defineSpec } from '../contract'
import { seriesIn } from '../kit/requirements'

export const bubbleSpec = defineSpec<'bubble'>({
  kind: 'bubble',
  label: 'Bubble',
  category: 'plotting',
  input: { accepts: ['comparison'] },
  output: null,
  hasRun: true,
  defaultConfig: (): BubbleConfig => ({ axis: 'dose', capEnabled: true, topGenes: 20 }),
  // The plot draws over any condition with a series, its saved axis only when that's one of them
  // (seriesAxes): so any such condition will do, whichever axis it was saved with.
  requirement: (u) => {
    if (!u.axes.length) return 'Needs a numeric condition in the data'
    return seriesIn(u).some((c) => u.axes.includes(c))
      ? null
      : 'Only one level of each condition here — needs at least two to show a response'
  },
  plot: {
    tileHint: 'Gene × dose bubble grid. Select to view.',
    configurable: true,
    legend: true,
    axes: true
  }
})
