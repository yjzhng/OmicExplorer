import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  comparisonOf,
  ENRICH_SOURCE_LABEL,
  type EnrichSource,
  enrichSourcesPresent,
  fcMeasure,
  isInteractionRow,
  isSlopeRow,
  resolveEnrichSource
} from '../../engine'
import { quickOn } from '../../graph/registry'
import { factsOf, unmetRequirement } from '../../graph/requirements'
import { type EnrichConfig, normalizeCompareConfig } from '../../graph/types'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { EnrichView } from './EnrichView'
import { groupOrderOf } from './groupOrder'

export const NO_CATS: Record<string, string> = {}
/** The enrich result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function enrichView(v: ViewContext): ReactNode {
  const {
    upstream,
    cfgSource,
    patchConfig,
    numeric,
    facetSel,
    plotRun,
    upCompareCfg,
    effectsOf,
    categoricalOf
  } = v
  if (upstream?.kind !== 'compare')
    return <Empty text="Connect a Compare or Curve fit tile and run it." />
  const cfg = cfgSource as EnrichConfig
  const method = cfg.method ?? 'ora'
  // 'ridge' is GSEA-only; fall back to dot if a persisted ridge style meets ORA.
  const style = cfg.style === 'ridge' && method !== 'gsea' ? 'dot' : (cfg.style ?? 'dot')
  const styleOpts = method === 'gsea' ? ['dot', 'bar', 'ridge'] : ['dot', 'bar']
  const ann = upstream.annotationMap ?? {}
  const cats = upstream.keggCategories ?? NO_CATS
  // Only offer term sets these genes actually carry. If the saved source isn't one of them the
  // tile falls back through ENRICH_FALLBACK to one that is, rather than an error the user can't
  // act on — display only, the config keeps what it had (same as the GSEA-only ridge style
  // falling back to dot above).
  const sources = enrichSourcesPresent(ann, cats)
  const saved = cfg.source ?? 'go'
  const source = resolveEnrichSource(saved, sources) ?? saved
  const unmet = unmetRequirement('enrich', { ...cfg, source }, factsOf(upstream))
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
              // Short on the tile: the species note ("(human)") is left to the settings.
              optionLabel={(o) =>
                (ENRICH_SOURCE_LABEL[o as EnrichSource] ?? o).replace(/\s*\(human\)$/, '')
              }
              onChange={(v) => patchConfig({ source: v })}
            />
          )}
          {quickOn(cfg, 'style') && (
            <SwitchBar
              label="style"
              value={style}
              options={styleOpts}
              onChange={(v) => patchConfig({ style: v })}
            />
          )}
        </div>
        <div style={styles.stackBody}>{body}</div>
      </div>
    </div>
  )
  if (unmet) return withBar(<Empty text={unmet} />)
  return withBar(
    <FacetedPlot numeric={numeric} rows={{ of: upstream.cmp }} facetSel={facetSel}>
      {(facetRows, facetKey) => {
        // From the plot's run: this facet's terms for the method and source on show (every one
        // was computed), cut to the top N — so switching any of them only re-renders.
        const all =
          plotRun?.kind === 'enrich' ? plotRun.facets[facetKey]?.[`${method}|${source}`] : undefined
        if (!all) return <Empty text="No enrichment for these terms here — re-run the plot." />
        const top = cfg.topTerms > 0 ? cfg.topTerms : 15
        return (
          <Built
            build={() => ({ ...all, up: all.up.slice(0, top), down: all.down.slice(0, top) })}
            deps={[all, top]}
          >
            {(enrich) => (
              <EnrichView
                enrich={enrich}
                style={style}
                measure={fcMeasure(
                  upCompareCfg && normalizeCompareConfig(upCompareCfg).analysis,
                  upCompareCfg?.detection,
                  upCompareCfg?.surface,
                  facetRows.some(isInteractionRow),
                  facetRows.some(isSlopeRow)
                )}
                comparison={comparisonOf(facetRows)}
                effectColors={effectsOf(cfg, cfg.effectColors)}
                groupOrder={groupOrderOf(source as EnrichSource, ann, cats)}
                categorical={categoricalOf(cfg)}
                termOrder={cfg.termOrder}
              />
            )}
          </Built>
        )
      }}
    </FacetedPlot>
  )

  return <Empty text="No output." />
}
