import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar, SwitchStrip } from '../../dashboard/SwitchBar'
import { condLabel, contextOf, type ConditionKey } from '../../engine'
import { quickOn, seriesAxes } from '../../graph/registry'
import {
  axisTitle,
  geneCapOn,
  topCountOf,
  type BubbleConfig,
  type CompareConfig
} from '../../graph/types'
import { BUBBLE_SIG_PALETTE, toPaletteRef } from '../../ui/palettes'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { axisChoices } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { BubbleView } from './BubbleView'

/** The bubble result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function bubbleView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    numeric,
    rawUp,
    upStep,
    patchConfig,
    facetSel,
    units,
    focus,
    paletteOf
  } = v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
  const cfg = cfgSource as BubbleConfig
  const dm = upstream.displayMap
  // Over the numeric conditions with a series: the switch only when there are several, and the
  // saved axis only when it's one of them (seriesAxes).
  const { axes, axis: seriesAxis } = seriesAxes(
    cfg.axis,
    axisChoices(contextOf(upstream.cmp).rows, numeric),
    rawUp
  )
  const axis = seriesAxis ?? cfg.axis
  // Rank by log₂FC, or by the significance column the Compare calls by (its P or Q value).
  const statType =
    (upstream.cmp.threshold ?? (upStep?.data.config as CompareConfig | undefined)?.threshold)
      ?.statType ?? 'pQ'
  const statName = statType === 'pP' ? 'P-value' : 'Q-value'
  const rank = cfg.rank ?? 'fc'
  const over = cfg.over ?? 'peak'
  const showAxis = axes.length > 1 && quickOn(cfg, 'axis')
  const showRank = quickOn(cfg, 'rank')
  const showOver = quickOn(cfg, 'over')
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        {(showAxis || showRank || showOver) && (
          <SwitchStrip>
            {showAxis && (
              <SwitchBar
                inline
                label="axis"
                value={axis}
                options={axes}
                optionLabel={(o) => condLabel(o as ConditionKey)}
                onChange={(v) => patchConfig({ axis: v })}
              />
            )}
            {showRank && (
              <SwitchBar
                inline
                label="rank"
                value={rank}
                options={['fc', 'sig']}
                optionLabel={(o) => (o === 'fc' ? 'log₂FC' : statName)}
                onChange={(v) => patchConfig({ rank: v })}
              />
            )}
            {showOver && (
              <SwitchBar
                inline
                label="over levels"
                value={over}
                options={['peak', 'total']}
                onChange={(v) => patchConfig({ over: v })}
              />
            )}
          </SwitchStrip>
        )}
        <div style={styles.stackBody}>
          {/* Full rows (no `sub`): base follows the All/Selected toggle via `focus`, and
                  BubbleView appends any hovered/pinned gene to the gene axis. */}
          <FacetedPlot
            numeric={numeric}
            rows={{ of: upstream.cmp }}
            exclude={[axis]}
            facetSel={facetSel}
          >
            {(rows) => (
              <BubbleView
                rows={rows}
                axis={axis}
                axisLabel={axisTitle(axis, units)}
                topGenes={geneCapOn(cfg) ? topCountOf(cfg, cfg.topGenes) : 0}
                topSplit={cfg.topSplit}
                topUp={cfg.topUp}
                topDown={cfg.topDown}
                rank={rank === 'sig' ? statType : 'fc'}
                over={over}
                stat={statType}
                sizeBy={cfg.sizeBy}
                colorBy={cfg.colorBy}
                outlineBy={cfg.outlineBy}
                outlineColor={cfg.outlineColor}
                asterisk={cfg.asterisk}
                sigPalette={toPaletteRef(cfg.sigPalette) ?? BUBBLE_SIG_PALETTE}
                displayMap={dm}
                focus={focus}
                key={cfg.orient ?? 'auto'}
                orient={cfg.orient}
                palette={paletteOf(cfg, 'fcObject')}
              />
            )}
          </FacetedPlot>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
