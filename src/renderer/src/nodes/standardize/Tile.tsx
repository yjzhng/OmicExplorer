/** Clean data's canvas tile: its table's size and conditions once run. */
import type { ReactNode } from 'react'

import type { TileContext } from '../tiles'
import { rowCount } from '../../engine/lazyRows'
import { muted, stat } from '../kit/tile'

export function tile(t: TileContext): ReactNode {
  const { result } = t
  const std = result?.kind === 'standardize' ? result.std : null
  return std ? (
    <div style={stat}>
      {rowCount(std).toLocaleString()} rows · {std.activeConditions.join(', ')}
    </div>
  ) : (
    <div style={muted}>Tidy uniqID × sample table.</div>
  )
}
