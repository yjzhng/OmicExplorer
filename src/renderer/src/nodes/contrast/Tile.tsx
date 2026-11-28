/** Contrast's canvas tile: its contrasts and counts. */
import type { ReactNode } from 'react'

import type { TileContext } from '../tiles'
import { PILL_CAP } from '../../ui/controls/ChoiceSwitch'
import { muted, stat } from '../kit/tile'

export function tile(t: TileContext): ReactNode {
  const { result, signfCount, valueRows } = t
  const ctr = result?.kind === 'contrast' ? result.ctr : null
  return (
    <div style={muted}>
      {ctr
        ? ctr.comparisons.length > PILL_CAP
          ? `${ctr.comparisons.length} contrasts`
          : ctr.comparisons.join(', ') || 'contrast'
        : 'Connect a Compare tile, then pick two levels.'}
      {ctr && (
        <div style={stat}>
          {valueRows.toLocaleString()} rows · {signfCount} signif
        </div>
      )}
    </div>
  )
}
