import type { ReactNode } from 'react'
import type { LoadConfig } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'

/** The load result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function loadView(v: ViewContext): ReactNode {
  const { node } = v
  const cfg = node.data.config as LoadConfig
  if (!cfg.data) return <Empty text="No input selected — choose files in the tile inspector." />
  return (
    <div style={styles.loadInfo}>
      <div>
        <span style={styles.loadLabel}>data</span>
        {cfg.data}
      </div>
      <div>
        <span style={styles.loadLabel}>samplesheet</span>
        {cfg.samplesheet ?? '—'}
      </div>
      <div>
        <span style={styles.loadLabel}>ID map</span>
        {cfg.db ?? '—'}
      </div>
    </div>
  )

  return <Empty text="No output." />
}
