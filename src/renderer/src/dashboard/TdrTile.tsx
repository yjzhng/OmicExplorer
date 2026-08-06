/** TDR panel body: a dose×time figure for one gene, shown via the shared gene switch-tab
 *  (focus genes as tabs, pinned genes appended, hover drives the figure). */
import { useMemo, type CSSProperties } from 'react'

import { buildTdr, type CompareResultRow } from '../engine'
import { TdrView } from '../ui/TdrView'
import { UI } from '../ui/theme'
import { GeneSwitch } from './GeneSwitch'

function TdrBody({
  rows,
  gene,
  displayMap
}: {
  rows: CompareResultRow[]
  gene: string
  displayMap: Record<string, string>
}) {
  const tdr = useMemo(() => buildTdr(rows, gene, displayMap), [rows, gene, displayMap])
  return tdr.series.length === 0 ? (
    <div style={styles.note}>{tdr.gene}: TDR needs both dose and time active.</div>
  ) : (
    <TdrView tdr={tdr} title={tdr.gene} />
  )
}

export function TdrTile({
  rows,
  genes,
  displayMap
}: {
  rows: CompareResultRow[]
  genes: string[]
  displayMap: Record<string, string>
}) {
  const present = useMemo(() => new Set(rows.map((r) => r.uniqID)), [rows])
  return (
    <GeneSwitch genes={genes} present={present} displayMap={displayMap}>
      {(gene) => <TdrBody rows={rows} gene={gene} displayMap={displayMap} />}
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
