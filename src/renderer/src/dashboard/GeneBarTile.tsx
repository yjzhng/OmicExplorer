/** Gene-bar panel body: ONE gene's standardized value across every condition, with a
 *  gene switch-tab (like TDR). Focus genes get tabs, genes pinned elsewhere are appended,
 *  and a hovered gene transiently drives the bars. */
import { useMemo } from 'react'

import { buildGeneBar, type StandardizeResult } from '../engine'
import { GeneBarView } from '../ui/GeneBarView'
import { GeneSwitch } from './GeneSwitch'

function GeneBarBody({
  std,
  gene,
  orient
}: {
  std: StandardizeResult
  gene: string
  orient?: 'landscape' | 'portrait'
}) {
  const bar = useMemo(() => buildGeneBar(std.rows, [gene], std.displayMap), [std, gene])
  return <GeneBarView bar={bar} orient={orient} title={std.displayMap[gene] ?? gene} />
}

export function GeneBarTile({
  std,
  genes,
  orient
}: {
  std: StandardizeResult
  genes: string[]
  orient?: 'landscape' | 'portrait'
}) {
  const present = useMemo(() => new Set(std.rows.map((r) => r.uniqID)), [std])
  return (
    <GeneSwitch genes={genes} present={present} displayMap={std.displayMap}>
      {(gene) => <GeneBarBody std={std} gene={gene} orient={orient} />}
    </GeneSwitch>
  )
}
