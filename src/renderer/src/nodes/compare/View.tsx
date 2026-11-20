import type { ReactNode } from 'react'
import {
  type CompareConfig,
  curveDoseUnit,
  effectLabelsOf,
  numericOfResult,
  plotResultKey
} from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { CompareTable } from '../kit/views/tables'

/** The compare / curveFit result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function compareView(v: ViewContext): ReactNode {
  const { result, kind, node, child, units } = v
  if (result?.kind !== 'compare')
    return (
      <Empty
        text={`Run this tile to produce the ${kind === 'curveFit' ? 'curve fit' : 'comparison'} table.`}
      />
    )
  const cmpCfg = node.data.config as CompareConfig
  return (
    <CompareTable
      showKey={plotResultKey(node.id, child?.id)}
      units={units}
      cmp={result.cmp}
      analysis={cmpCfg.analysis}
      effectLabels={effectLabelsOf(cmpCfg)}
      displayMap={result.displayMap}
      comparisons={result.cmp.comparisons}
      statType={(result.cmp.threshold ?? cmpCfg.threshold)?.statType ?? 'pQ'}
      threshold={result.cmp.threshold ?? cmpCfg.threshold}
      dose={curveDoseUnit(cmpCfg, units)}
      numeric={numericOfResult(result)}
    />
  )

  return <Empty text="No output." />
}
