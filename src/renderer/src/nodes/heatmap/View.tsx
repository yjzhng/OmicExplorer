import type { ReactNode } from 'react'
import { SwitchBar, SwitchBarToggle } from '../../dashboard/SwitchBar'
import { SHOW_KINDS, hasTermRows, presentStd } from '../../engine'
import { quickOn } from '../../graph/registry'
import {
  DENDRO_CLADES_DEFAULT,
  HEATMAP_COND_DISTANCES,
  type HeatmapCondDistance,
  HEATMAP_LEAF_ORDERS,
  HEATMAP_LINKAGES,
  type HeatmapConfig,
  SAMPLE_ORDERS,
  heatmapCondBar,
  primaryColorLevels,
  sampleOrderOf
} from '../../graph/types'
import { CATEGORICAL_SCHEMES, toCategoricalId } from '../../ui/palettes'
import { Empty } from '../kit/views/common'
import { type ViewContext, cmpOfKind } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { FcHeatmapTile } from './FcHeatmapTile'
import { HeatmapTile } from './HeatmapTile'
import { fcHeatmapRunKey, fcHeatmapRunOpts } from './runKey'

/** The fold-change heatmap's linkage and leaf-order choices, as switch-bar options. */
export const HEATMAP_LINKAGE_KEYS = Object.keys(HEATMAP_LINKAGES)
export const HEATMAP_LEAF_ORDER_KEYS = Object.keys(HEATMAP_LEAF_ORDERS)
/** The heatmap result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function heatmapView(v: ViewContext): ReactNode {
  const {
    cfgSource,
    upstream,
    globalCategorical,
    facetSel,
    patchConfig,
    focus,
    paletteOf,
    quantityScale,
    plainScale,
    numeric,
    plotRun
  } = v
  const cfg = cfgSource as HeatmapConfig
  // Compare upstream → log2FC heatmap (every comparison/context is a column, no faceting).
  if (upstream?.kind === 'compare') {
    const linkage = cfg.linkage ?? 'ward'
    const leafOrder = cfg.leafOrder ?? 'mean'
    const quickLinkage = quickOn(cfg, 'linkage', 'heatmap')
    const quickLeaf = quickOn(cfg, 'leafOrder', 'heatmap')
    const condDistance = cfg.condDistance ?? 'size'
    const quickCondDistance = quickOn(cfg, 'condDistance', 'heatmap')
    // Each side's clustering switches on the tile: the genes' and the conditions' modules + tree.
    const sideToggles = (
      [
        ['gene modules', 'geneModules'],
        ['gene tree', 'geneTree'],
        ['condition modules', 'condModules'],
        ['condition tree', 'condTree']
      ] as const
    ).filter(([, f]) => quickOn(cfg, f, 'heatmap'))
    const catOf = (id: unknown): readonly string[] =>
      CATEGORICAL_SCHEMES[toCategoricalId(id) ?? globalCategorical]
    // A two-way ANOVA's rows: its overall 2×2 fold changes or its factors' effect sizes — the
    // group's `show` pick (its shared bar); a tile outside a group has its own switch.
    const hasTerms = hasTermRows(upstream.cmp)
    const ownShow = hasTerms && !facetSel
    const fcRows = !hasTerms
      ? 'overall'
      : facetSel
        ? facetSel.show === 'factors'
          ? 'factors'
          : 'overall'
        : cfg.fcRows === 'factors'
          ? 'factors'
          : 'overall'
    const heatRows = cmpOfKind(upstream.cmp, fcRows).rows
    // the clustering settings, as the plot's run built its heatmap under (runKey) — drawn from
    // that run while they still match
    const runOpts = fcHeatmapRunOpts(cfg)
    const fcRun =
      plotRun?.kind === 'heatmap' && plotRun.fc?.key === fcHeatmapRunKey(cfg)
        ? plotRun.fc
        : undefined
    // the comparisons' condition tracks: on unless switched off
    const fcCondBar = cfg.condBar ?? true
    const quickCondBar = quickOn(cfg, 'condBar', 'heatmap')
    return (
      <div style={styles.chart}>
        <div style={styles.stack}>
          {(ownShow ||
            quickCondBar ||
            quickLinkage ||
            quickLeaf ||
            quickCondDistance ||
            sideToggles.length > 0) && (
            <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
              {ownShow && (
                <SwitchBar
                  label="show"
                  value={fcRows}
                  options={SHOW_KINDS}
                  onChange={(v) => patchConfig({ fcRows: v })}
                />
              )}
              {quickLinkage && (
                <SwitchBar
                  label="linkage"
                  value={linkage}
                  options={HEATMAP_LINKAGE_KEYS}
                  optionLabel={(o) => (o === 'ward' ? 'Ward' : o)}
                  onChange={(v) => patchConfig({ linkage: v })}
                />
              )}
              {quickLeaf && (
                <SwitchBar
                  label="leaf order"
                  value={leafOrder}
                  options={HEATMAP_LEAF_ORDER_KEYS}
                  onChange={(v) => patchConfig({ leafOrder: v })}
                />
              )}
              {quickCondDistance && (
                <SwitchBar
                  label="conditions by"
                  value={condDistance}
                  options={Object.keys(HEATMAP_COND_DISTANCES)}
                  optionLabel={(o) => (o === 'size' ? 'size + pattern' : 'pattern')}
                  onChange={(v) => patchConfig({ condDistance: v as HeatmapCondDistance })}
                />
              )}
              {sideToggles.map(([label, f]) => (
                <SwitchBarToggle
                  key={f}
                  label={label}
                  on={!!cfg[f]}
                  onChange={(on) => patchConfig({ [f]: on })}
                />
              ))}
              {/* a display switch, after the clustering ones */}
              {quickCondBar && (
                <SwitchBarToggle
                  label="show conditions"
                  on={fcCondBar}
                  onChange={(on) => patchConfig({ condBar: on })}
                />
              )}
            </div>
          )}
          <div style={styles.stackBody}>
            <FcHeatmapTile
              rows={heatRows}
              unsigned={fcRows === 'factors'}
              displayMap={upstream.displayMap}
              maxGenes={runOpts.maxGenes}
              topSplit={cfg.topSplit}
              topUp={cfg.topUp}
              topDown={cfg.topDown}
              focus={focus}
              // Remount on a flip: it swaps which screen axis carries which data, and Plotly's
              // key-by-key react diff can leave the previous orientation's own keys behind (a
              // colourbar's placement, an axis side). A fresh div starts clean.
              key={cfg.orient ?? 'auto'}
              orient={cfg.orient}
              palette={paletteOf(cfg, 'fc')}
              linkage={runOpts.linkage}
              leafOrder={runOpts.leafOrder}
              colPattern={runOpts.colPattern}
              prebuilt={fcRows === 'factors' ? fcRun?.factors : fcRun?.overall}
              geneMax={cfg.dendroClades ?? DENDRO_CLADES_DEFAULT}
              geneModules={!!cfg.geneModules}
              geneTree={!!cfg.geneTree}
              geneColors={catOf(cfg.geneCategorical)}
              condMax={cfg.dendroColClades ?? DENDRO_CLADES_DEFAULT}
              condModules={!!cfg.condModules}
              condTree={!!cfg.condTree}
              condColors={catOf(cfg.condCategorical)}
              condBar={fcCondBar}
              numeric={numeric}
            />
          </div>
        </div>
      </div>
    )
  }
  // Standardize upstream → intensity heatmap (genes × samples, full proteome — no gene cap).
  if (upstream?.kind !== 'standardize')
    return <Empty text="Connect a Clean data or Compare tile and run it." />
  // On the scale every abundance plot shows Clean data on (see quantityScale).
  const scale = quantityScale
  const condBar = heatmapCondBar(cfg, primaryColorLevels(upstream.std))
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {quickOn(cfg, 'condBar') && (
            <SwitchBarToggle
              label="show conditions"
              on={condBar}
              onChange={(on) => patchConfig({ condBar: on })}
            />
          )}
          {quickOn(cfg, 'sampleOrder') && (
            <SwitchBar
              label="sort"
              value={sampleOrderOf(cfg)}
              options={SAMPLE_ORDERS}
              onChange={(v) => patchConfig({ sampleOrder: v })}
            />
          )}
        </div>
        <div style={styles.stackBody}>
          <HeatmapTile
            key={cfg.orient ?? 'auto'}
            std={presentStd(upstream.std, scale)}
            scale={scale}
            focus={focus}
            orient={cfg.orient}
            condBar={condBar}
            palette={paletteOf(cfg, 'data', 'valuePalette')}
            sampleOrder={sampleOrderOf(cfg)}
            plainScale={plainScale}
            // the run's clustering, when it was on the scale shown (a log flip re-stamps the
            // scale without one)
            runGroups={
              plotRun?.kind === 'heatmap' && plotRun.std?.scale === scale ? plotRun.std : undefined
            }
          />
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
