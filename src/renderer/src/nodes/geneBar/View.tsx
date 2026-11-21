import type { ReactNode } from 'react'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { presentStd } from '../../engine'
import { quickOn } from '../../graph/registry'
import { type BarConfig, SAMPLE_ORDERS, sampleOrderOf } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { GeneBarTile } from './GeneBarTile'

/** The geneBar result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function geneBarView(v: ViewContext): ReactNode {
  const { upstream, quantityScale, cfgSource, condTitle, genes, patchConfig } = v
  if (upstream?.kind !== 'standardize')
    return <Empty text="Connect a Clean data tile and run it." />
  // On the scale every abundance plot shows Clean data on (see quantityScale).
  const scale = quantityScale
  const barCfg = cfgSource as BarConfig
  return (
    <div style={styles.chart}>
      <GeneBarTile
        condTitle={condTitle}
        key={barCfg.orient ?? 'auto'}
        std={presentStd(upstream.std, scale)}
        scale={scale}
        genes={genes}
        config={barCfg}
        // The quick switches on the gene switcher's row, before the gene.
        controls={
          <>
            {quickOn(barCfg, 'yScale') && (
              <SwitchBar
                inline
                label="scale"
                value={barCfg.yScale ?? 'gene'}
                options={['gene', 'global']}
                optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                onChange={(v) => patchConfig({ yScale: v })}
              />
            )}
            {quickOn(barCfg, 'sampleOrder') && (
              <SwitchBar
                inline
                label="sort"
                value={sampleOrderOf(barCfg)}
                options={SAMPLE_ORDERS}
                onChange={(v) => patchConfig({ sampleOrder: v })}
              />
            )}
          </>
        }
      />
    </div>
  )

  return <Empty text="No output." />
}
