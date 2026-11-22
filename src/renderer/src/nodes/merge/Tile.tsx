/** Merge's canvas tile: the pooled table's size and conditions once run. */
import type { ReactNode } from 'react'

import type { TileContext } from '../tiles'
import { rowCount } from '../../engine/lazyRows'
import { condLabel } from '../../engine/types'
import { muted, stat } from '../kit/tile'

export function tile(t: TileContext): ReactNode {
  const { result } = t
  const std = result?.kind === 'standardize' ? result.std : null
  // Once pooled the inputs are indistinguishable, so report what came out — the row count and
  // the union of conditions is what tells you the merge did what you expected.
  return std ? (
    <div style={stat}>
      {rowCount(std).toLocaleString()} rows · {std.activeConditions.map(condLabel).join(', ')}
    </div>
  ) : (
    <div style={muted}>Pool two or more Clean data tiles into one dataset.</div>
  )
}
