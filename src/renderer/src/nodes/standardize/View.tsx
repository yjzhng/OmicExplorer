import type { ReactNode } from 'react'
import { presentStd, tableScaleOf } from '../../engine'
import { plotResultKey } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { StdTable } from '../kit/views/tables'

/** The standardize result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function standardizeView(v: ViewContext): ReactNode {
  const { result, units, node, child } = v
  if (result?.kind !== 'standardize')
    return <Empty text="Run this tile to produce the clean data table." />
  // Shown on Clean data's chosen scale (its log-transform) — or as plain values when it shows its
  // logged values so (tableScaleOf); analyses read the linear rows.
  return (
    <StdTable
      std={presentStd(result.std, tableScaleOf(result.std))}
      units={units}
      showKey={plotResultKey(node.id, child?.id)}
    />
  )

  return <Empty text="No output." />
}
