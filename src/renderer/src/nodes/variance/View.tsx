import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar, SwitchStrip } from '../../dashboard/SwitchBar'
import {
  type CompareResultRow,
  type ConditionKey,
  quantityLabel,
  anovaSliceFor,
  condLabel,
  geneShares,
  holderWhere,
  interactionAxes,
  interactionGene,
  rankByQ,
  stdLookupOf,
  isNumericCond,
  type AnovaFactor,
  type GeneShares
} from '../../engine'
import { quickOn } from '../../graph/registry'
import {
  type InteractionConfig,
  interactionDim,
  interactionDimWhy,
  type InteractionShape,
  interactionShow,
  interactionShowWhy,
  type VarianceConfig
} from '../../graph/config/anovaPlots'
import { responseLook, type TdrConfig } from '../../graph/config/response'
import { drLook } from '../../graph/config/dr'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { InteractionHeatmap } from './InteractionHeatmap'
import { InteractionSurface } from './InteractionSurface'
import { InteractionView } from './InteractionView'
import { VarianceView } from './VarianceView'
import { plotCached } from '../../ui/plot/plotCache'

const NO_SHARES: GeneShares[] = []
/** factor 2's one level with no factor 2 (the rest averaged) */
const MEAN_ONLY = ['mean']

/** The variance / interaction result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function varianceView(v: ViewContext): ReactNode {
  const {
    rawUp,
    kind,
    cfgSource,
    patchConfig,
    genes,
    numeric,
    facetSel,
    repStd,
    quantityScale,
    quantityUnit,
    plainScale,
    responseRoles
  } = v
  if (rawUp?.kind !== 'compare')
    return <Empty text="Connect a Compare running an ANOVA, and run it." />
  const anova = rawUp.cmp.anova
  if (!anova) return <Empty text="Needs an ANOVA — re-run the Compare." />
  const dm = rawUp.displayMap
  // kept by the ANOVA (ui/plot/plotCache), so the plots below get the same arrays render to render —
  // a fresh one is a rebuild and a redraw, on every pin
  const terms = plotCached('anovaTerms', [anova], () => anova.terms.map((t) => t.label))
  // The context pick (dose …) chooses the model's slice: one term's rows carry the contexts.
  const facetRows = holderWhere(
    rawUp.cmp,
    `term¦${terms[0]}`,
    (c) => !!c.term && c.comparison === terms[0]
  ).rows
  const present = plotCached(
    'anovaPresent',
    [anova],
    () => new Set(anova.slices.flatMap((s) => s.genes.map((g) => g.uniqID)))
  )
  const geneIn = (rows: CompareResultRow[], id: string) =>
    anovaSliceFor(anova, rows[0])?.genes.find((g) => g.uniqID === id)
  if (kind === 'variance') {
    const cfg = cfgSource as VarianceConfig
    const view = cfg.view ?? 'overview'
    const viewSwitch = quickOn(cfg, 'view') ? (
      <SwitchBar
        inline
        label="view"
        value={view}
        options={['overview', 'detail', 'focus']}
        optionLabel={(o) => (o === 'focus' ? 'focused' : o === 'detail' ? 'detailed' : 'global')}
        onChange={(v) => patchConfig({ view: v })}
      />
    ) : null
    // detailed: the selected genes, else the most significant (smallest q of any factor)
    const detailOf = (rows: CompareResultRow[]) => {
      const slice = anovaSliceFor(anova, rows[0])
      if (!slice) return NO_SHARES
      const top = Math.max(1, Math.min(cfg.topGenes || 20, 60))
      return plotCached('varianceDetail', [slice, genes, top], () => {
        const sel = genes.filter((id) => slice.genes.some((g) => g.uniqID === id))
        const picked = sel.length
          ? sel.map((id) => slice.genes.find((g) => g.uniqID === id)!)
          : rankByQ(slice.genes).slice(0, top)
        return picked.map(geneShares)
      })
    }
    // every gene of the slice on show, as shares (the global view)
    const allOf = (rows: CompareResultRow[]) => {
      const slice = anovaSliceFor(anova, rows[0])
      return slice
        ? plotCached('varianceAll', [slice], () => slice.genes.map(geneShares))
        : NO_SHARES
    }
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {view !== 'focus' && viewSwitch && <SwitchStrip>{viewSwitch}</SwitchStrip>}
          <div style={styles.stackBody}>
            {view === 'focus' ? (
              <GeneSwitch
                genes={pagerGenes(genes, present)}
                present={present}
                displayMap={dm}
                controls={viewSwitch}
              >
                {(gene) => (
                  <FacetedPlot numeric={numeric} rows={facetRows} facetSel={facetSel}>
                    {(rows) => {
                      const g = geneIn(rows, gene)
                      return g ? (
                        <VarianceView
                          view="focus"
                          terms={terms}
                          genes={plotCached('varianceGene', [g], () => [geneShares(g)])}
                          displayMap={dm}
                        />
                      ) : (
                        <Empty text="This gene has no fit in this context." />
                      )
                    }}
                  </FacetedPlot>
                )}
              </GeneSwitch>
            ) : (
              <FacetedPlot numeric={numeric} rows={facetRows} facetSel={facetSel}>
                {(rows) => (
                  <VarianceView
                    view={view}
                    terms={terms}
                    genes={view === 'detail' ? detailOf(rows) : allOf(rows)}
                    displayMap={dm}
                  />
                )}
              </FacetedPlot>
            )}
          </div>
        </div>
      </div>
    )
  }
  // interaction: one gene at a time, as the dose-response plot's focused view
  const cfg = cfgSource as InteractionConfig
  // x and the lines as picked (the model's first two by default); further factors averaged
  const { x, line } = interactionAxes(anova, cfg.xFactor, cfg.lineFactor)
  const std = repStd ? stdLookupOf(repStd) : undefined
  // what the view can draw: 3D needs factor 2, a surface both factors numeric
  const isNum = (f: AnovaFactor): boolean => !!f.x || isNumericCond(f.condition, numeric)
  const shape: InteractionShape = {
    two: line != null,
    numeric: line != null && isNum(anova.factors[x]) && isNum(anova.factors[line])
  }
  const dim = interactionDim(cfg, shape)
  const show = interactionShow(cfg, shape)
  const asGrid = show === 'heatmap'
  const as3d = dim === '3d' && line != null
  // factor 2's options: the factors, or none (factor 1 alone, the rest averaged; 2D only)
  const f2Options = [...anova.factors.map((f) => f.condition as string), 'none']
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div style={styles.stackBody}>
          <GeneSwitch
            genes={pagerGenes(genes, present)}
            present={present}
            displayMap={dm}
            controls={
              // none on quick access: no controls (an empty fragment would draw an empty bar)
              (quickOn(cfg, 'dim') ||
                quickOn(cfg, 'show') ||
                quickOn(cfg, 'xFactor') ||
                quickOn(cfg, 'lineFactor')) && (
                <>
                  {quickOn(cfg, 'dim') && (
                    <SwitchBar
                      inline
                      label="view"
                      value={dim}
                      options={['2d', '3d']}
                      optionLabel={(o) => o.toUpperCase()}
                      optionDisabled={(o) => interactionDimWhy(o, shape)}
                      onChange={(v) => patchConfig({ dim: v })}
                    />
                  )}
                  {quickOn(cfg, 'show') && (
                    <SwitchBar
                      inline
                      label="show"
                      value={show}
                      options={['line', 'surface', 'heatmap']}
                      optionDisabled={(o) => interactionShowWhy(dim, o, shape)}
                      onChange={(v) => patchConfig({ show: v })}
                    />
                  )}
                  {quickOn(cfg, 'xFactor') && (
                    <SwitchBar
                      inline
                      label="factor 1"
                      value={anova.factors[x].condition}
                      options={anova.factors.map((f) => f.condition)}
                      optionLabel={(o) => condLabel(o as ConditionKey)}
                      // factor 2's for factor 1 swaps the two
                      onChange={(v) =>
                        patchConfig({
                          xFactor: v,
                          ...(line != null && v === anova.factors[line].condition
                            ? { lineFactor: anova.factors[x].condition }
                            : null)
                        })
                      }
                    />
                  )}
                  {quickOn(cfg, 'lineFactor') && (
                    <SwitchBar
                      inline
                      label="factor 2"
                      value={line != null ? anova.factors[line].condition : 'none'}
                      options={f2Options}
                      optionLabel={(o) => (o === 'none' ? 'none' : condLabel(o as ConditionKey))}
                      optionDisabled={(o) =>
                        o === 'none' && dim === '3d' ? '3D needs a factor 2' : undefined
                      }
                      onChange={(v) =>
                        patchConfig({
                          lineFactor: v,
                          ...(line != null && v === anova.factors[x].condition
                            ? { xFactor: anova.factors[line].condition }
                            : null)
                        })
                      }
                    />
                  )}
                </>
              )
            }
          >
            {(gene) => (
              <FacetedPlot numeric={numeric} rows={facetRows} facetSel={facetSel}>
                {(rows) => {
                  const slice = anovaSliceFor(anova, rows[0])
                  const g = slice?.genes.find((x0) => x0.uniqID === gene)
                  // the same cell means either way: as lines, or as a grid of tiles
                  // 3-D: log₂ against the control cell, whatever the abundance scale
                  const scale = as3d ? 'log2' : quantityScale
                  // kept by the gene's fit (ui/plot/plotCache): the same object render to render, so a
                  // pin elsewhere doesn't redraw it
                  const ig =
                    slice && g
                      ? plotCached('interactionGene', [g, slice, anova, x, line, scale, std], () =>
                          interactionGene(
                            anova,
                            slice,
                            g,
                            { x, line },
                            scale,
                            std && (std.get(gene) ?? [])
                          )
                        )
                      : undefined
                  return ig && as3d ? (
                    <InteractionSurface
                      gene={ig}
                      xFactor={anova.factors[x]}
                      lineFactor={anova.factors[line!]}
                      numeric={numeric}
                      show={show === 'surface' ? 'surface' : 'line'}
                      look={responseLook(cfg as Partial<TdrConfig>)}
                      rolePalettes={responseRoles}
                    />
                  ) : ig && asGrid ? (
                    <InteractionHeatmap
                      gene={ig}
                      xName={condLabel(anova.factors[x].condition)}
                      xLevels={anova.factors[x].levels}
                      lineName={line == null ? '' : condLabel(anova.factors[line].condition)}
                      lineLevels={line == null ? MEAN_ONLY : anova.factors[line].levels}
                      valueLabel={quantityLabel(quantityScale, quantityUnit, !!plainScale)}
                      displayMap={dm}
                      plainScale={plainScale}
                    />
                  ) : ig ? (
                    <InteractionView
                      gene={ig}
                      xName={condLabel(anova.factors[x].condition)}
                      xLevels={anova.factors[x].levels}
                      lineName={line == null ? '' : condLabel(anova.factors[line].condition)}
                      lineLevels={line == null ? MEAN_ONLY : anova.factors[line].levels}
                      yLabel={quantityLabel(quantityScale, quantityUnit, !!plainScale)}
                      displayMap={dm}
                      look={drLook(cfg)}
                      plainScale={plainScale}
                    />
                  ) : (
                    <Empty text="This gene has no fit in this context." />
                  )
                }}
              </FacetedPlot>
            )}
          </GeneSwitch>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
