/** TDR panel body: a dose×time figure for one gene, shown via the shared gene switch-tab
 *  (selected genes as tabs, hover drives the figure). */
import { useMemo, type CSSProperties } from 'react'

import { buildTdr, type CompareResultRow } from '../engine'
import type { CondUnits } from '../graph/types'
import { TdrView } from '../ui/TdrView'
import { UI } from '../ui/theme'
import { GeneSwitch } from './GeneSwitch'

function TdrBody({
  rows,
  gene,
  displayMap,
  units
}: {
  rows: CompareResultRow[]
  gene: string
  displayMap: Record<string, string>
  units?: CondUnits
}) {
  const tdr = useMemo(() => buildTdr(rows, gene, displayMap), [rows, gene, displayMap])
  return tdr.series.length === 0 ? (
    <div style={styles.note}>{tdr.gene}: TDR needs both dose and time active.</div>
  ) : (
    <TdrView tdr={tdr} title={tdr.gene} units={units} />
  )
}

export function TdrTile({
  rows,
  genes,
  displayMap,
  units
}: {
  rows: CompareResultRow[]
  genes: string[]
  displayMap: Record<string, string>
  /** the dose / time units the data was imported with */
  units?: CondUnits
}) {
  const present = useMemo(() => new Set(rows.map((r) => r.uniqID)), [rows])
  return (
    <GeneSwitch genes={genes} present={present} displayMap={displayMap}>
      {(gene) => <TdrBody rows={rows} gene={gene} displayMap={displayMap} units={units} />}
    </GeneSwitch>
  )
}

const styles: Record<string, CSSProperties> = {
  note: {
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    color: UI.textMuted,
    fontSize: 12,
    padding: 12,
    textAlign: 'center'
  }
}
