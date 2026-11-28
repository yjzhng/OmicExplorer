import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { SwitchBar, SwitchBarToggle } from '../../dashboard/SwitchBar'
import {
  comparisonOf,
  type EnrichData,
  ENRICH_SOURCE_LABEL,
  type EnrichSource,
  fcMeasure,
  isInteractionRow,
  isSlopeRow,
  resolveEnrichSource,
  termModules
} from '../../engine'
import { quickOn } from '../../graph/registry'
import { factsOf, unmetRequirement } from '../../graph/run/requirements'
import type { EnrichConfig } from '../../graph/config/enrich'
import { normalizeCompareConfig } from '../../graph/config/compare'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { styles } from '../kit/views/styles'
import { resultEnrichSources } from './spec'
import { EnrichView } from './EnrichView'
import { FDR_PRESETS } from './termCut'
import { groupOrderOf } from './groupOrder'

export const NO_CATS: Record<string, string> = {}

/** The terms significant at `fdr` (BH-adjusted p below it), each direction's order kept. Cached
 *  per run result and cut, so the plot's memos hold across renders. */
const sigCache = new WeakMap<EnrichData, Map<number, EnrichData>>()
function significantOf(e: EnrichData, fdr: number): EnrichData {
  let m = sigCache.get(e)
  if (!m) sigCache.set(e, (m = new Map()))
  let out = m.get(fdr)
  if (!out) {
    out = {
      ...e,
      up: e.up.filter((t) => t.pAdjust < fdr),
      down: e.down.filter((t) => t.pAdjust < fdr)
    }
    m.set(fdr, out)
  }
  return out
}

/** With modules on, each term's gene module (engine/enrich/enrichModules), over every term computed — so
 *  a module is the same whatever the plot draws of it. */
function moduleView(all: EnrichData, modules: boolean): ReadonlyMap<string, string> | undefined {
  if (!modules) return undefined
  return termModules(
    [...all.up, ...all.down].map((t) => ({
      term: t.term,
      genes: t.geneIds ?? t.genes,
      pAdjust: t.pAdjust
    }))
  ).of
}

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
  // kept by the annotations (resultEnrichSources): not a walk of every gene's on each render
  const sources = resultEnrichSources(upstream.annotationMap, upstream.keggCategories)
  const saved = cfg.source ?? 'go'
  const source = resolveEnrichSource(saved, sources) ?? saved
  const unmet = unmetRequirement('enrich', { ...cfg, source }, factsOf(upstream))
  const modules = !!cfg.modules
  const show = cfg.show ?? 'all'
  // the FDR cut as a switch: none, the presets, and the config's own where it's another
  const fdrOptions = [
    'none',
    ...[...new Set([...FDR_PRESETS, ...(cfg.termFdr != null ? [cfg.termFdr] : [])])]
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
              // Short on the tile: the species note ("(human)") is left to the settings.
              optionLabel={(o) =>
                (ENRICH_SOURCE_LABEL[o as EnrichSource] ?? o).replace(/\s*\(human\)$/, '')
              }
              onChange={(v) => patchConfig({ source: v })}
            />
          )}
          {quickOn(cfg, 'termFdr') && (
            <SwitchBar
              label="FDR <"
              value={cfg.termFdr != null ? String(cfg.termFdr) : 'none'}
              options={fdrOptions}
              onChange={(v) => patchConfig({ termFdr: v === 'none' ? undefined : Number(v) })}
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
  return withBar(
    <FacetedPlot numeric={numeric} rows={{ of: upstream.cmp }} facetSel={facetSel}>
      {(facetRows, facetKey) => {
        // From the plot's run: this facet's terms for the method and source on show (every one
        // was computed), cut to the top N — so switching any of them only re-renders.
        const computed =
          plotRun?.kind === 'enrich' ? plotRun.facets[facetKey]?.[`${method}|${source}`] : undefined
        if (!computed) return <Empty text="No enrichment for these terms here — re-run the plot." />
        // with an FDR cut: the terms below it, of which the top N are drawn (the modules still
        // over every term computed, so a module is the same either way)
        const fdr = cfg.termFdr
        const all = fdr != null ? significantOf(computed, fdr) : computed
        if (fdr != null && !all.up.length && !all.down.length)
          return <Empty text={`No terms significant at FDR < ${fdr}.`} />
        const top = cfg.topTerms > 0 ? cfg.topTerms : 15
        return (
          <Built
            name="enrichModules"
            build={() => ({ moduleOf: moduleView(computed, modules) })}
            deps={[computed, modules]}
          >
            {({ moduleOf }) => (
              <EnrichView
                // every term computed: the plot draws the top ones — or, with categories or modules
                // chosen in its legend, theirs
                enrich={all}
                top={top}
                onePerModule={modules && show === 'one'}
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
                modules={moduleOf}
                categorical={categoricalOf(cfg)}
                moduleCategorical={categoricalOf({ categorical: cfg.moduleCategorical })}
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
