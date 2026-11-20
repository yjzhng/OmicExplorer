import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar } from '../../dashboard/SwitchBar'
import { condLabel, ctxNum, idsWhere, stdLookupOf } from '../../engine'
import { quickOn } from '../../graph/registry'
import {
  CURVE_OF_SLICE,
  SLICE_OF_CURVE,
  type TdrConfig,
  axisTitle,
  responseDim,
  responseLook,
  responseShow,
  responseShowWhy,
  tdrPair
} from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { TdrBody } from './TdrTile'

/** The tdr result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function tdrView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    genes,
    patchConfig,
    numeric,
    facetSel,
    repStd,
    responseRoles,
    units
  } = v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Compare tile and run it." />
  // A Compare's measured log₂FC over two numeric conditions (the tile's pair: the first along x, a
  // line per level of the second), drawn as the Response plot draws a surface.
  const cfg = cfgSource as TdrConfig
  const pair = tdrPair(cfg)
  const [ax, ay] = pair
  const dim = responseDim(cfg)
  const show = responseShow(cfg)
  const look = responseLook(cfg)
  const present = idsWhere(upstream.cmp, (c) => ctxNum(c, ax) != null && ctxNum(c, ay) != null)
  if (!present.size)
    return (
      <Empty text={`Needs ${condLabel(ax)} and ${condLabel(ay)} both active in the Compare.`} />
    )
  // Lines (2-D or 3-D) can run along the first (one per level of the second) or along the second.
  const sliceable = show === 'line'
  const slice = cfg.slice ?? 'time'
  const projection = cfg.projection ?? 'orthographic'
  const yScale = cfg.yScale ?? 'gene'
  // A global scale spans the genes on show: the selected ones while any are selected, else all.
  const scaleGenes = genes.some((id) => present.has(id)) ? genes : undefined
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div style={styles.stackBody}>
          {/* One gene at a time — every gene, or the selected ones while any are selected. */}
          <GeneSwitch
            genes={pagerGenes(genes, present)}
            present={present}
            displayMap={upstream.displayMap}
            // The view / show / lines / scale switches on the gene switcher's row, before the
            // gene — one strip, wrapping only as the tile's width needs.
            controls={
              <>
                {quickOn(cfg, 'dim') && (
                  <SwitchBar
                    inline
                    label="view"
                    value={dim}
                    options={['2d', '3d']}
                    optionLabel={(o) => o.toUpperCase()}
                    onChange={(v) => patchConfig({ dim: v })}
                  />
                )}
                {quickOn(cfg, 'show') && (
                  <SwitchBar
                    inline
                    label="show"
                    value={show}
                    options={['line', 'surface', 'heatmap']}
                    optionDisabled={(o) => responseShowWhy(dim, o)}
                    onChange={(v) => patchConfig({ show: v })}
                  />
                )}
                {sliceable && quickOn(cfg, 'slice') && (
                  <SwitchBar
                    inline
                    label="curve"
                    value={CURVE_OF_SLICE[slice]}
                    options={['dose', 'time']}
                    optionLabel={(o) => condLabel(o === 'dose' ? ax : ay)}
                    onChange={(v) => patchConfig({ slice: SLICE_OF_CURVE[v as 'dose' | 'time'] })}
                  />
                )}
                {dim === '3d' && quickOn(cfg, 'projection', 'tdr') && (
                  <SwitchBar
                    inline
                    label="projection"
                    value={projection}
                    options={['orthographic', 'perspective']}
                    onChange={(v) => patchConfig({ projection: v })}
                  />
                )}
                {quickOn(cfg, 'yScale') && (
                  <SwitchBar
                    inline
                    label="scale"
                    value={yScale}
                    options={['gene', 'global']}
                    optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                    onChange={(v) => patchConfig({ yScale: v })}
                  />
                )}
              </>
            }
          >
            {(gene) => (
              // Over its two conditions, so facet by the OTHER context dims (e.g. cell, or a third
              // numeric condition); without this a gene's levels would mix them.
              <FacetedPlot
                numeric={numeric}
                rows={{ of: upstream.cmp }}
                exclude={pair}
                facetSel={facetSel}
              >
                {(rows) => (
                  <TdrBody
                    rows={rows}
                    pair={pair}
                    gene={gene}
                    std={repStd ? stdLookupOf(repStd) : undefined}
                    global={yScale === 'global'}
                    scaleGenes={scaleGenes}
                    dim={dim}
                    show={show}
                    look={look}
                    slice={slice}
                    projection={projection}
                    rolePalettes={responseRoles}
                    doseLabel={axisTitle(ax, units)}
                    timeLabel={axisTitle(ay, units)}
                  />
                )}
              </FacetedPlot>
            )}
          </GeneSwitch>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
