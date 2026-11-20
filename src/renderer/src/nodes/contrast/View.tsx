import type { ReactNode } from 'react'
import { numericOfResult, plotResultKey } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { contrastTableData } from '../kit/views/tableData'
import { ContrastTable } from '../kit/views/tables'

/** The contrast result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function contrastView(v: ViewContext): ReactNode {
  const { result, node, child, units, facetSel } = v
  if (result?.kind !== 'contrast')
    return <Empty text="Connect a Compare tile, pick two levels to contrast, and run." />
  return (
    <ContrastTable
      showKey={plotResultKey(node.id, child?.id)}
      units={units}
      // the feature on the switcher (a table isn't faceted, but it shows one feature)
      data={contrastTableData(result.ctr, facetSel?.feature)}
      displayMap={result.displayMap}
      comparisons={result.ctr.comparisons}
      numeric={numericOfResult(result)}
    />
  )

  return <Empty text="No output." />
}
