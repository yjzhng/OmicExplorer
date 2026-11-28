/** Subset's canvas tile: what it keeps, and the table's size once run. */
import type { ReactNode } from 'react'

import type { TileContext } from '../tiles'
import { condLabel, type ConditionKey } from '../../engine'
import { rowCount } from '../../engine/columns/lazyRows'
import type { SubsetConfig } from '../../graph/config/load'
import { PILL_CAP } from '../../ui/controls/ChoiceSwitch'
import { muted, stat } from '../kit/tile'

export function tile(t: TileContext): ReactNode {
  const { result, config } = t
  const std = result?.kind === 'standardize' ? result.std : null
  // What is kept, per filtered condition — past PILL_CAP values just their count ("12 cmpd").
  const kept = Object.entries((config as SubsetConfig).keep ?? {})
    .filter(([, vs]) => (vs?.length ?? 0) > 0)
    .map(([c, vs]) => {
      const label = condLabel(c as ConditionKey)
      return vs!.length > PILL_CAP
        ? `${vs!.length} ${label}`
        : `${label}: ${vs!.map((v) => v || '—').join(', ')}`
    })
  // …the replicates kept, and the samples left out by name
  const sc = config as SubsetConfig
  if (sc.reps?.length) kept.push(`rep: ${sc.reps.join(', ')}`)
  if (sc.drop?.length)
    kept.push(`${sc.drop.length} sample${sc.drop.length === 1 ? '' : 's'} left out`)
  return (
    <>
      <div style={kept.length ? stat : muted}>
        {kept.length ? kept.join(' · ') : 'Keeps every sample — pick values to subset.'}
      </div>
      {std && (
        <div style={muted}>
          {rowCount(std).toLocaleString()} rows
          {std.samples ? ` · ${std.samples.length} samples` : ''}
        </div>
      )}
    </>
  )
}
