/** Compare's (and Curve fit's) canvas tile: its comparisons before a run, the counts after. */
import type { ReactNode } from 'react'

import type { TileContext } from '../tiles'
import { VALID_CONDITIONS, condLabel } from '../../engine'
import { rowCount } from '../../engine/lazyRows'
import { normalizeCompareConfig, type CompareConfig } from '../../graph/types'
import { PILL_CAP } from '../../ui/ChoiceSwitch'
import { muted, stat } from '../kit/tile'

export function tile(t: TileContext): ReactNode {
  const { kind, result, config, signfCount } = t
  const cfg = normalizeCompareConfig(config as CompareConfig)
  const cmp = result?.kind === 'compare' ? result.cmp : null
  // A side's values per condition — past PILL_CAP of them, just their count ("24 cmpd").
  const sideShort = (sel: CompareConfig['num']): string =>
    VALID_CONDITIONS.filter((k) => (sel[k]?.length ?? 0) > 0)
      .map((k) => {
        const vs = sel[k] as string[]
        return vs.length > PILL_CAP ? `${vs.length} ${condLabel(k)}` : vs.join('/')
      })
      .join(',') || '—'
  // Once run, show just the comparison COUNT (the detailed strings can be long when a
  // comparison spans many values); before running, a concise config preview.
  const n = cmp?.comparisons.length ?? 0
  const curve = kind === 'curveFit'
  const label = cmp
    ? `${n} ${curve ? 'curve set' : 'comparison'}${n === 1 ? '' : 's'}`
    : cfg.analysis === 'anova'
      ? `ANOVA · ${(cfg.compared ?? []).map((c) => condLabel(c)).join(' × ')}`
      : curve
        ? `${sideShort(cfg.num)} · control ${sideShort(cfg.den)}`
        : `${sideShort(cfg.num)} vs ${sideShort(cfg.den)}`
  return (
    <div style={muted}>
      {label}
      {cmp && (
        <div style={stat}>
          {rowCount(cmp).toLocaleString()} rows · {signfCount} signif
        </div>
      )}
    </div>
  )
}
