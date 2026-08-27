/** Gene-bar panel body: ONE gene's standardized value across every condition, with a
 *  gene switch-tab (like TDR). Focus genes get tabs, genes pinned elsewhere are appended,
 *  and a hovered gene transiently drives the bars. */
import { useMemo } from 'react'

import { buildGeneBar, type StandardizeResult } from '../engine'
import { valueRange, type ValueRange } from '../ui/colormap'
import { GeneBarView } from '../ui/GeneBarView'
import { GeneSwitch } from './GeneSwitch'

function GeneBarBody({
  std,
  gene,
  orient,
  range
}: {
  std: StandardizeResult
  gene: string
  orient?: 'landscape' | 'portrait'
  range: ValueRange
}) {
  const bar = useMemo(
    () => buildGeneBar(std.rows, [gene], std.displayMap, range.log),
    [std, gene, range.log]
  )
  return <GeneBarView bar={bar} orient={orient} title={std.displayMap[gene] ?? gene} range={range} />
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
  // Global std value range (log-aware) shared with the Heatmap tile and Standardize table, so the
  // bars' colour AND the value axis's log/linear scaling match those surfaces.
  const range = useMemo(() => valueRange(std.rows.map((r) => r.value)), [std])
  return (
    <GeneSwitch genes={genes} present={present} displayMap={std.displayMap}>
      {(gene) => <GeneBarBody std={std} gene={gene} orient={orient} range={range} />}
    </GeneSwitch>
  )
}
