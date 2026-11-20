import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar, SwitchStrip } from '../../dashboard/SwitchBar'
import {
  type CompareResultRow,
  type ConditionKey,
  abundanceLabel,
  anovaSliceFor,
  condLabel,
  geneShares,
  holderWhere,
  interactionAxes,
  interactionGene,
  rankByQ,
  stdLookupOf
} from '../../engine'
import { quickOn } from '../../graph/registry'
import { type InteractionConfig, type VarianceConfig, drLook } from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { InteractionView } from './InteractionView'
import { VarianceView } from './VarianceView'

/** The variance / interaction result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function varianceView(v: ViewContext): ReactNode {
  const { rawUp, kind, cfgSource, patchConfig, genes, numeric, facetSel, repStd, abScale } = v
  if (rawUp?.kind !== 'compare')
    return <Empty text="Connect a Compare running an ANOVA, and run it." />
  const anova = rawUp.cmp.anova
  if (!anova) return <Empty text="Needs an ANOVA — re-run the Compare." />
  const dm = rawUp.displayMap
  const terms = anova.terms.map((t) => t.label)
  // The context pick (dose …) chooses the model's slice: one term's rows carry the contexts.
  const facetRows = holderWhere(
    rawUp.cmp,
    `term¦${terms[0]}`,
    (c) => !!c.term && c.comparison === terms[0]
  ).rows
  const present = new Set(anova.slices.flatMap((s) => s.genes.map((g) => g.uniqID)))
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
      if (!slice) return []
      const sel = genes.filter((id) => slice.genes.some((g) => g.uniqID === id))
      const picked = sel.length
        ? sel.map((id) => slice.genes.find((g) => g.uniqID === id)!)
        : rankByQ(slice.genes).slice(0, Math.max(1, Math.min(cfg.topGenes || 20, 60)))
      return picked.map(geneShares)
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
                          genes={[geneShares(g)]}
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
                    genes={
                      view === 'detail'
                        ? detailOf(rows)
                        : (anovaSliceFor(anova, rows[0])?.genes ?? []).map(geneShares)
                    }
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
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div style={styles.stackBody}>
          <GeneSwitch
            genes={pagerGenes(genes, present)}
            present={present}
            displayMap={dm}
            controls={
              quickOn(cfg, 'xFactor') && (
                <SwitchBar
                  inline
                  label="x axis"
                  value={anova.factors[x].condition}
                  options={anova.factors.map((f) => f.condition)}
                  optionLabel={(o) => condLabel(o as ConditionKey)}
                  onChange={(v) => patchConfig({ xFactor: v })}
                />
              )
            }
          >
            {(gene) => (
              <FacetedPlot numeric={numeric} rows={facetRows} facetSel={facetSel}>
                {(rows) => {
                  const slice = anovaSliceFor(anova, rows[0])
                  const g = slice?.genes.find((x0) => x0.uniqID === gene)
                  return slice && g ? (
                    <InteractionView
                      gene={interactionGene(
                        anova,
                        slice,
                        g,
                        { x, line },
                        abScale,
                        std && (std.get(gene) ?? [])
                      )}
                      xName={condLabel(anova.factors[x].condition)}
                      xLevels={anova.factors[x].levels}
                      lineName={line == null ? '' : condLabel(anova.factors[line].condition)}
                      lineLevels={line == null ? ['mean'] : anova.factors[line].levels}
                      yLabel={abundanceLabel(abScale)}
                      displayMap={dm}
                      look={drLook(cfg)}
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
