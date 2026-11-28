import type { ReactNode } from 'react'
import { plotCached } from '../../ui/plot/plotCache'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar, SwitchStrip } from '../../dashboard/SwitchBar'
import {
  quantityLabel,
  drBase,
  drPick,
  type CompareResultRow,
  type ConditionKey,
  condLabel,
  condsIn,
  condValue,
  contextOf,
  contrastFeatureLabel,
  contrastYRangeOf,
  ctxNum,
  distinctOf,
  stdLookupOf
} from '../../engine'
import { firstRow } from '../../engine/columns/lazyRows'
import { contrastCurveSides } from '../../graph/models/contrastPair'
import { quickOn } from '../../graph/registry'
import { axisTitle } from '../../graph/config/units'
import type { ContrastConfig } from '../../graph/config/contrast'
import { DR_DETAIL_CAP, type DRConfig, drLook, drYScale } from '../../graph/config/dr'
import { geneCapOn } from '../../graph/config/genePlots'
import { modelViewOf } from '../../graph/config/compare'
import { topCountOf, topSplitOf } from '../../graph/config/plotStyle'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { axisChoices, pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { DRFocusView } from './DRFocusView'
import { DRView } from './DRView'
import { ResponseCompareView } from './ResponseCompareView'

/** A rows array as a result (one per array, so a memo keyed on it holds across renders). */
export const holders = new WeakMap<readonly object[], { rows: readonly object[] }>()
/** A facet's rows of one gene, kept by the rows (ui/plot/plotCache): the same array render to render,
 *  so a focused view isn't rebuilt and redrawn on every render (a pin anywhere). */
const geneRows = <T extends { uniqID: string }>(rows: T[], gene: string): T[] =>
  plotCached('geneRows', [rows, gene], () => rows.filter((r) => r.uniqID === gene))
export function asHolder<T extends object>(rows: readonly T[]): { rows: readonly T[] } {
  let h = holders.get(rows)
  if (!h) holders.set(rows, (h = { rows }))
  return h as { rows: readonly T[] }
}
/** The dr result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function drView(v: ViewContext): ReactNode {
  const {
    cfgSource,
    numeric,
    genes,
    patchConfig,
    facetSel,
    units,
    effectsOf,
    upstream,
    upStep,
    upCompareCfg,
    edges,
    upId,
    results,
    quantityScale,
    quantityUnit,
    plainScale,
    contrastSource,
    repStd,
    paletteOf,
    categoricalOf
  } = v
  const cfg = cfgSource as DRConfig
  // One Response plot per numeric condition: the axis is the tile's own, never switched — data
  // without it says so instead of drawing another.
  const axis = cfg.axis
  const noAxis = (rows: Parameters<typeof axisChoices>[0]): ReactNode =>
    axisChoices(rows, numeric).includes(axis) ? null : (
      <Empty
        text={`No ${condLabel(axis)} levels here — add the Response plot of a condition the data has instead.`}
      />
    )
  // A Contrast of two Curve fits (two inputs, or two selections of one): one gene at a time, each
  // side's fitted curve and its points, a colour per side (DRFocusView, as a Curve fit's focused
  // view). A condition the two sides never share a value of (compound A vs B) isn't a facet —
  // its sides are the curves.
  const contrastCurves = (
    [a, b]: [CompareResultRow[], CompareResultRow[]],
    dm: Record<string, string>
  ): ReactNode => {
    // kept by the two sides (ui/plot/plotCache, the sides are the same arrays each render): the same
    // rows and sets render to render, so the plot below isn't rebuilt and redrawn for nothing
    const { both, present, disjoint, responseFit } = plotCached('contrastBoth', [a, b], () => {
      const both = [...a, ...b]
      return {
        both,
        present: new Set(both.map((r) => r.uniqID)),
        disjoint: condsIn(both).filter((c) => {
          const va = new Set(a.map((r) => String(condValue(r, c) ?? '')))
          return !b.some((r) => va.has(String(condValue(r, c) ?? '')))
        }),
        responseFit: both.some((r) => r.rs)
      }
    })
    const model = cfg.model ?? 'curve'
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={styles.stackBody}>
            <GeneSwitch
              genes={pagerGenes(genes, present)}
              present={present}
              displayMap={dm}
              controls={
                <>
                  {responseFit && quickOn(cfg, 'model') && (
                    <SwitchBar
                      inline
                      label="model"
                      value={model}
                      options={['spline', 'curve']}
                      onChange={(v) => patchConfig({ model: v })}
                    />
                  )}
                  {quickOn(cfg, 'yScale') && (
                    <SwitchBar
                      inline
                      label="scale"
                      value={drYScale(cfg, false)}
                      options={['gene', 'global']}
                      optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                      onChange={(v) => patchConfig({ yScale: v })}
                    />
                  )}
                </>
              }
            >
              {(gene) => (
                <FacetedPlot
                  numeric={numeric}
                  rows={both}
                  exclude={[axis, ...disjoint]}
                  // the two sides are the plot's two curves (its legend), not facets
                  together
                  facetSel={facetSel}
                >
                  {(rows) => (
                    <DRFocusView
                      rows={geneRows(rows, gene)}
                      axis={axis}
                      axisLabel={axisTitle(axis, units)}
                      gene={gene}
                      look={drLook(cfg, true)}
                      effectColors={effectsOf(cfg)}
                      categorical={categoricalOf(cfg)}
                      model={model}
                      scaleOf={drYScale(cfg, false) === 'global' ? asHolder(rows) : undefined}
                    />
                  )}
                </FacetedPlot>
              )}
            </GeneSwitch>
          </div>
        </div>
      </div>
    )
  }
  // From a Contrast: the hovered/selected gene's response profile on BOTH sides (FC1 vs FC2), for
  // comparing two datasets/contrasts. From a Compare: every gene's response curve (below).
  if (upstream?.kind === 'contrast') {
    const dm = upstream.displayMap
    // Both sides Curve fits over this axis: their fitted curves, side by side in one plot.
    const sides =
      upStep?.data.kind === 'contrast'
        ? contrastCurveSides(
            upStep.data.config as ContrastConfig,
            edges.filter((e) => e.target === upId).map((e) => e.source),
            results,
            axis,
            [firstRow(upstream.ctr)?.cmp1 ?? 'A', firstRow(upstream.ctr)?.cmp2 ?? 'B']
          )
        : null
    if (sides) return contrastCurves(sides, dm)
    const missing = noAxis(contextOf(upstream.ctr).rows)
    if (missing) return missing
    const present = distinctOf(upstream.ctr, 'uniqID') as Set<string>
    // FC1/FC2 are abundance when the contrast is fed by Clean data inputs (on the plots'
    // abundance scale — see contrastRows), log2 fold-change when fed by Compare inputs.
    const yLabel =
      upstream.ctr.valueKind === 'quantity'
        ? quantityLabel(quantityScale, quantityUnit, !!plainScale)
        : 'log₂FC'
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          <div style={styles.stackBody}>
            {/* One gene at a time — the pager steps through every gene, or just the selected
                      ones while any are selected. */}
            <GeneSwitch
              genes={pagerGenes(genes, present)}
              present={present}
              displayMap={dm}
              // The axis scale on the gene switcher's own row, before the gene.
              controls={
                quickOn(cfg, 'yScale') && (
                  <SwitchBar
                    inline
                    label="scale"
                    value={drYScale(cfg, true)}
                    options={['gene', 'global']}
                    optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                    onChange={(v) => patchConfig({ yScale: v })}
                  />
                )
              }
            >
              {(gene) => (
                <FacetedPlot
                  numeric={numeric}
                  rows={contrastSource(upstream)}
                  exclude={[axis]}
                  facetSel={facetSel}
                >
                  {(rows) => (
                    <ResponseCompareView
                      rows={rows}
                      displayMap={dm}
                      axis={axis}
                      axisLabel={axisTitle(axis, units)}
                      gene={gene}
                      yLabel={contrastFeatureLabel(rows) ?? yLabel}
                      // Global (default): one y scale for the WHOLE contrast — of the feature
                      // on show — so paging genes (or switching facets) doesn't rescale and the
                      // curves stay comparable. Per gene: each gene's own range.
                      yRange={
                        drYScale(cfg, true) === 'global'
                          ? contrastYRangeOf(
                              upstream.ctr,
                              rows[0],
                              upstream.ctr.valueKind === 'quantity' ? quantityScale : undefined,
                              drLook(cfg).errors,
                              drLook(cfg).points
                            )
                          : undefined
                      }
                      look={drLook(cfg)}
                      categorical={categoricalOf(cfg)}
                      // an abundance contrast's own values (not another feature) shown plain
                      plainScale={
                        upstream.ctr.valueKind === 'quantity' && !contrastFeatureLabel(rows)
                          ? plainScale
                          : undefined
                      }
                    />
                  )}
                </FacetedPlot>
              )}
            </GeneSwitch>
          </div>
        </div>
      </div>
    )
  }
  if (upstream?.kind !== 'compare')
    return <Empty text="Connect a Compare, Curve fit or Contrast tile and run it." />
  const dm = upstream.displayMap
  const missing = noAxis(contextOf(upstream.cmp).rows)
  if (missing) return missing
  const drView = cfg.view ?? 'overview'
  // A facet with one level of the axis has no response to draw: say so (and which conditions to
  // change) rather than leave the plot empty. A curve fit's rows are whole curves — never one.
  const levelled =
    (draw: (rows: CompareResultRow[]) => ReactNode) =>
    (rows: CompareResultRow[]): ReactNode =>
      oneAxisLevel(rows, axis, axisTitle(axis, units)) ?? draw(rows)
  // Fed by a Curve fit: its look's defaults differ (no confidence band unless asked — drLook).
  const drCurveFit = upStep?.data.kind === 'curveFit'
  // A response surface method curve fit: drawn by the model its Curve fit's plots show (the shared
  // model switch, in the analysis's context bar): the description ('curve') or the detector's spline.
  const model = modelViewOf(upCompareCfg) === 'detector' ? 'spline' : 'curve'
  const present = distinctOf(upstream.cmp, 'uniqID') as Set<string>
  // The global ⇆ detailed ⇆ focused switch. (The stored value for global stays 'overview'.)
  const viewSwitch = (): ReactNode =>
    quickOn(cfg, 'view') ? (
      <SwitchBar
        inline
        label="view"
        value={drView}
        options={['overview', 'detail', 'focus']}
        optionLabel={(o) => (o === 'focus' ? 'focused' : o === 'detail' ? 'detailed' : 'global')}
        onChange={(v) => patchConfig({ view: v })}
      />
    ) : null
  // How many genes the detailed view draws: the top-N, at most DR_DETAIL_CAP.
  const detailN = Math.min(
    geneCapOn(cfg) ? topCountOf(cfg, cfg.topGenes) : DR_DETAIL_CAP,
    DR_DETAIL_CAP
  )
  // how the top-N splits between up and down, and its key for the builds' deps
  const split = topSplitOf(cfg)
  const splitKey = `${split.by}:${split.up ?? ''}:${split.down ?? ''}`
  // The axis scale of the gene-by-gene views (detailed, focused).
  const scaleSwitch = (): ReactNode =>
    quickOn(cfg, 'yScale') ? (
      <SwitchBar
        inline
        label="scale"
        value={drYScale(cfg, false)}
        options={['gene', 'global']}
        optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
        onChange={(v) => patchConfig({ yScale: v })}
      />
    ) : null
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        {/* Global / detailed: one strip for the view (/ scale) switches, one line while the tile
                  is wide enough, wrapping (not cropped) when it isn't. Focused: the pager's. */}
        {drView !== 'focus' &&
          (quickOn(cfg, 'view') || (drView === 'detail' && quickOn(cfg, 'yScale'))) && (
            <SwitchStrip>
              {viewSwitch()}
              {drView === 'detail' && scaleSwitch()}
            </SwitchStrip>
          )}
        <div style={styles.stackBody}>
          {drView === 'focus' ? (
            // One gene at a time — the pager steps through every gene, or just the selected
            // ones while any are selected (a hovered gene takes over while hovered), drawn for
            // the compound / context on show. The view / model switches sit on the pager's own
            // row, before the gene.
            <GeneSwitch
              genes={pagerGenes(genes, present)}
              present={present}
              displayMap={dm}
              // The view and axis-scale switches on the gene switcher's own row, before the gene
              // (as the bar's) — the master view first.
              controls={
                <>
                  {viewSwitch()}
                  {scaleSwitch()}
                </>
              }
            >
              {(gene) => (
                <FacetedPlot
                  numeric={numeric}
                  rows={{ of: upstream.cmp }}
                  exclude={[axis]}
                  facetSel={facetSel}
                >
                  {levelled((rows) => (
                    <DRFocusView
                      rows={geneRows(rows, gene)}
                      axis={axis}
                      axisLabel={axisTitle(axis, units)}
                      gene={gene}
                      std={repStd ? stdLookupOf(repStd) : undefined}
                      look={drLook(cfg, drCurveFit)}
                      effectColors={effectsOf(cfg)}
                      categorical={categoricalOf(cfg)}
                      model={model}
                      // Global: one y scale for the WHOLE Compare, so paging genes (or switching
                      // facets) doesn't rescale. Per gene (default): each gene's own range.
                      scaleOf={drYScale(cfg, false) === 'global' ? upstream.cmp : undefined}
                    />
                  ))}
                </FacetedPlot>
              )}
            </GeneSwitch>
          ) : drView === 'detail' ? (
            // The top-N genes by response (at most DR_DETAIL_CAP; buildDR picks them, in its colour
            // order) without the every-gene background, each drawn in full as the focused view
            // draws one. The selection narrows the pool they're picked from, not the curves.
            <FacetedPlot
              numeric={numeric}
              rows={{ of: upstream.cmp }}
              exclude={[axis]}
              facetSel={facetSel}
            >
              {levelled((rows) => (
                <Built
                  name="drBase"
                  build={() => drBase(rows, { axis, model, displayMap: dm })}
                  deps={[rows, axis, model, dm]}
                >
                  {(base) => (
                    <Built
                      name="drFocus"
                      build={() => drPick(base, { topGenes: detailN, split, within: genes })}
                      deps={[base, detailN, splitKey, genes]}
                    >
                      {(dr) => {
                        const shown = dr.series.slice(0, dr.highlight).map((sr) => sr.uniqID)
                        const on = new Set(shown)
                        return (
                          <DRFocusView
                            rows={plotCached('drShownRows', [rows, dr], () =>
                              rows.filter((r) => on.has(r.uniqID))
                            )}
                            genes={shown}
                            displayMap={dm}
                            axis={axis}
                            axisLabel={axisTitle(axis, units)}
                            std={repStd ? stdLookupOf(repStd) : undefined}
                            look={drLook(cfg, drCurveFit)}
                            effectColors={effectsOf(cfg)}
                            categorical={categoricalOf(cfg)}
                            model={model}
                            scaleOf={drYScale(cfg, false) === 'global' ? upstream.cmp : undefined}
                          />
                        )
                      }}
                    </Built>
                  )}
                </Built>
              ))}
            </FacetedPlot>
          ) : (
            // DR/TR always draws every gene as a faint background curve; the selection only
            // changes WHICH curves are coloured — the selected genes while any are selected,
            // else the top-N by response — so use the full rows (no `sub`).
            <FacetedPlot
              numeric={numeric}
              rows={{ of: upstream.cmp }}
              exclude={[axis]}
              facetSel={facetSel}
            >
              {levelled((rows) => (
                <Built
                  name="drBase"
                  build={() => drBase(rows, { axis, model, displayMap: dm })}
                  deps={[rows, axis, model, dm]}
                >
                  {(base) => (
                    <Built
                      name="dr"
                      build={() =>
                        drPick(base, {
                          topGenes: geneCapOn(cfg) ? topCountOf(cfg, cfg.topGenes) : 0,
                          split,
                          focus: genes
                        })
                      }
                      deps={[
                        base,
                        geneCapOn(cfg) ? topCountOf(cfg, cfg.topGenes) : 0,
                        splitKey,
                        genes
                      ]}
                    >
                      {(dr) => (
                        <DRView
                          dr={dr}
                          axisLabel={axisTitle(dr.axis, units)}
                          look={drLook(cfg, drCurveFit)}
                          palette={paletteOf(cfg, 'fcObject')}
                          categorical={categoricalOf(cfg)}
                        />
                      )}
                    </Built>
                  )}
                </Built>
              ))}
            </FacetedPlot>
          )}
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
/** A Response plot's facet with fewer than two levels of its axis (`axis`, titled `title`): a note
 *  saying so — a response needs two — else null. A curve fit's rows (whole curves) always draw. */
export function oneAxisLevel(
  rows: readonly CompareResultRow[],
  axis: ConditionKey,
  title: string
): ReactNode | null {
  const levels = new Set<number>()
  for (const r of rows) {
    if (r.curve || r.rs) return null
    const v = ctxNum(r, axis)
    if (v != null) levels.add(v)
    if (levels.size > 1) return null
  }
  if (!rows.length) return null
  const [only] = levels
  return (
    <Empty
      text={
        only == null
          ? `No ${title} levels at the conditions on show — pick others above.`
          : `Only one ${title} level (${only}) at the conditions on show — a response needs two or more. Pick other conditions above.`
      }
    />
  )
}
