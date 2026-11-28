import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar, SwitchBarToggle } from '../../dashboard/SwitchBar'
import {
  ENRICH_SOURCE_LABEL,
  type EnrichSource,
  enrichSourcesPresent,
  resolveEnrichSource,
  termLevelsOf,
  termModules
} from '../../engine'
import { quickOn } from '../../graph/registry'
import { factsOf, unmetRequirement } from '../../graph/run/requirements'
import type { EnrichMapConfig } from '../../graph/config/enrich'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { groupOrderOf } from '../enrich/groupOrder'
import { FDR_PRESETS } from '../enrich/termCut'
import type { MapInput } from './layout'
import { MapView } from './MapView'
import { DIRECTIONS, mapCut, mapTerms } from './terms'

const NO_CATS: Record<string, string> = {}
/** The enrichment map's result body (nodes/views.ts): the enrichment plot's switches, then a map per
 *  facet. Plain render function (no hooks): MapView holds the chart's own. */
export function enrichMapView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, patchConfig, numeric, facetSel, plotRun, categoricalOf } = v
  if (upstream?.kind !== 'compare')
    return <Empty text="Connect a Compare or Curve fit tile and run it." />
  const cfg = cfgSource as EnrichMapConfig
  const method = cfg.method ?? 'ora'
  const ann = upstream.annotationMap ?? {}
  const cats = upstream.keggCategories ?? NO_CATS
  const sources = enrichSourcesPresent(ann, cats)
  const saved = cfg.source ?? 'go'
  const source = resolveEnrichSource(saved, sources) ?? saved
  const unmet = unmetRequirement('enrichMap', { ...cfg, source }, factsOf(upstream))
  const modules = cfg.modules ?? true
  const direction = cfg.direction ?? 'both'
  // the FDR cut as a switch: none, the presets, and the map's own where it's another
  const cut = mapCut(cfg)
  const fdrOptions = [
    'none',
    ...[...new Set([...FDR_PRESETS, ...(cut.fdr != null ? [cut.fdr] : [])])]
      .sort((a, b) => a - b)
      .map(String)
  ]
  const withBar = (body: ReactNode): ReactNode => (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div className="oe-switch-row" style={{ display: 'flex', flexWrap: 'wrap' }}>
          {quickOn(cfg, 'method') && (
            <SwitchBar
              label="method"
              value={method}
              options={['ora', 'gsea']}
              onChange={(v) => patchConfig({ method: v })}
            />
          )}
          {quickOn(cfg, 'source') && sources.length > 1 && (
            <SwitchBar
              label="terms"
              value={source}
              options={sources}
              optionLabel={(o) =>
                (ENRICH_SOURCE_LABEL[o as EnrichSource] ?? o).replace(/\s*\(human\)$/, '')
              }
              onChange={(v) => patchConfig({ source: v })}
            />
          )}
          {quickOn(cfg, 'termFdr') && (
            <SwitchBar
              label="FDR <"
              value={cut.fdr != null ? String(cut.fdr) : 'none'}
              options={fdrOptions}
              // (a pick replaces an older map's "every significant term")
              onChange={(v) =>
                patchConfig({ termFdr: v === 'none' ? undefined : Number(v), terms: undefined })
              }
            />
          )}
          {quickOn(cfg, 'direction') && (
            <SwitchBar
              label="direction"
              value={direction}
              options={[...DIRECTIONS]}
              onChange={(v) => patchConfig({ direction: v as EnrichMapConfig['direction'] })}
            />
          )}
          {quickOn(cfg, 'overlap') && (
            <SwitchBar
              label="overlap"
              value={cfg.overlap ?? 'stack'}
              options={['stack', 'split']}
              onChange={(v) => patchConfig({ overlap: v as EnrichMapConfig['overlap'] })}
            />
          )}
          {quickOn(cfg, 'modules') && (
            <SwitchBarToggle
              label="modules"
              on={modules}
              onChange={(on) => patchConfig({ modules: on })}
            />
          )}
        </div>
        <div style={styles.stackBody}>{body}</div>
      </div>
    </div>
  )
  if (unmet) return withBar(<Empty text={unmet} />)
  const run = plotRun?.kind === 'enrich' ? plotRun : undefined
  return withBar(
    <FacetedPlot numeric={numeric} rows={{ of: upstream.cmp }} facetSel={facetSel}>
      {(_facetRows, facetKey) => {
        const all = run?.facets[facetKey]?.[`${method}|${source}`]
        if (!all) return <Empty text="No enrichment for these terms here — re-run the plot." />
        return (
          <Built
            name="enrichMap"
            build={(): { input: MapInput } => {
              const terms = mapTerms(all, cfg)
              const lv = termLevelsOf(source as EnrichSource, ann, cats)
              const mods = modules
                ? termModules(
                    [...all.up, ...all.down].map((t) => ({
                      term: t.term,
                      genes: t.geneIds ?? t.genes,
                      pAdjust: t.pAdjust
                    }))
                  ).of
                : undefined
              const order = groupOrderOf(source as EnrichSource, ann, cats)
              const rank = new Map(order.map((g, i) => [g, i]))
              return {
                input: {
                  terms,
                  levels: lv.levels,
                  paths: lv.paths,
                  modules: mods,
                  ancestors: source === 'go' ? run?.goAncestors : undefined,
                  topRank: (g) => rank.get(g) ?? order.length
                }
              }
            }}
            deps={[
              all,
              cfg.terms,
              cfg.termFdr,
              cfg.topTerms,
              direction,
              modules,
              source,
              ann,
              cats,
              run
            ]}
          >
            {({ input }) =>
              input.terms.length ? (
                <MapView
                  input={input}
                  groupOrder={groupOrderOf(source as EnrichSource, ann, cats)}
                  categorical={categoricalOf(cfg)}
                  moduleCategorical={categoricalOf({ categorical: cfg.moduleCategorical })}
                  displayMap={upstream.displayMap}
                  fallback={cfg.overlap ?? 'stack'}
                />
              ) : (
                <Empty
                  text={
                    cut.fdr != null
                      ? `No terms significant at FDR < ${cut.fdr}.`
                      : 'No enriched terms.'
                  }
                />
              )
            }
          </Built>
        )
      }}
    </FacetedPlot>
  )
}
