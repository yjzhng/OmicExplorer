/**
 * A plot's Run: computes what the plot needs to be VIEWED, so a green plot on the canvas is one the
 * results can show at once. It covers every setting the tile offers, so changing one on the tile
 * only re-renders (see each spec's `staleOn` for the few that need another run):
 *
 *  - Enrichment: every method × term source the genes carry, per facet, every tested term
 *    (engine/enrichmentAll, in the worker).
 *  - STRING: every confidence level × gene cap × interactor mode, per facet (two scans of the
 *    organism's links file per facet — see readStringAll).
 *  - Cluster: the sample embedding under its computation settings (engine/buildCluster, in the
 *    worker) — a large dataset's PCA / UMAP / t-SNE would otherwise freeze the UI as it draws.
 *    Colour by condition, plot, territory and look draw from it; the rest need a run (staleOn).
 *  - Every other plot draws straight from its upstream's result: its run checks it can (the
 *    upstream has run and meets the plot's requirement) and stores a marker.
 */
import {
  enrichSourcesPresent,
  facetGroupsOf,
  holderWhere,
  plotScaleOf,
  resolveEnrichSource,
  type ConditionKey,
  type EnrichSource,
  type LogTransform
} from '../engine'
import { engine } from '../engine/client'
import { holderTable } from '../engine/lazyRows'
import { withoutColumns } from '../engine/wire'
import {
  readStringAll,
  stringCapOptions,
  stringQueryGenesAt,
  stringSendLimit
} from '../ui/stringModel'
import { dominantTaxon, factsOf, unmetRequirement } from './requirements'
import {
  clusterRunOf,
  isDataResult,
  numericOfResult,
  type ClusterConfig,
  type EnrichConfig,
  type NodeConfig,
  type NodeKind,
  type NodeResult,
  type StringAll,
  type StringConfig
} from './types'

/** The most loadings the cluster's loadings plot draws (its setting's maximum). */
export const CLUSTER_LOADINGS_MAX = 40

/** What the STRING read reports when the organism's interactome isn't in the local cache. */
const NO_LOCAL_DATA = 'NO_LOCAL_DATA'

/** Run one plot (`kind` + `config`) on its upstream's result. Throws with the reason it can't be
 *  viewed (the upstream hasn't run, a requirement isn't met, no species …) — that becomes the
 *  plot's error. `cancelled` is polled between the long steps. */
export async function runPlot(
  kind: NodeKind,
  config: NodeConfig,
  upstream: NodeResult | undefined,
  cancelled: () => boolean,
  /** the Clean data step's log transform — what the scale plots show its data on follows it */
  cleanTransform?: LogTransform,
  /** the numeric conditions the upstream carries as the graph sees them (axisAvailFor) — a
   *  Contrast of Curve fits has its inputs' curve axes, which its own rows don't show */
  axes?: ConditionKey[]
): Promise<NodeResult> {
  const facts = (): ReturnType<typeof factsOf> => ({
    ...factsOf(upstream),
    ...(axes ? { axes } : null)
  })
  if (!isDataResult(upstream)) throw new Error('Run the step this plot reads from first.')
  if (kind === 'pca') {
    if (upstream.kind !== 'standardize') throw new Error('Needs a Clean data upstream.')
    const cfg = config as ClusterConfig
    const ran = clusterRunOf(cfg)
    // a columnar table goes as its columns (none of its rows built here)
    const cluster = await engine.buildCluster(holderTable(upstream.std) ?? upstream.std.rows, {
      method: cfg.method,
      colorBy: cfg.colorBy,
      clusterOn: cfg.clusterOn,
      clusterCount: cfg.clusterCount,
      clusterK: cfg.clusterK,
      // PCA: the loadings plot's most it can show, so its count only redraws
      loadings: cfg.method === 'pca' ? CLUSTER_LOADINGS_MAX : 0,
      // the vectors labelled with the gene/protein NAME rather than the raw uniqID
      displayMap: upstream.std.displayMap,
      scale: cfg.scale,
      missing: cfg.missing,
      center: cfg.center,
      topVar: cfg.topVar,
      transform: cfg.transform,
      autoScale: plotScaleOf(upstream.std, cleanTransform),
      replicates: cfg.replicates
    })
    return { kind: 'cluster', cluster, ran }
  }
  if (kind === 'enrich') {
    if (upstream.kind !== 'compare') throw new Error('Needs a Compare upstream.')
    const cfg = config as EnrichConfig
    const ann = upstream.annotationMap ?? {}
    const cats = upstream.keggCategories ?? {}
    const sources = enrichSourcesPresent(ann, cats)
    // The tile's own fallback when its saved source isn't carried, for the requirement check.
    const source = resolveEnrichSource(cfg.source ?? 'go', sources) ?? cfg.source ?? 'go'
    const why = unmetRequirement(kind, { ...cfg, source }, factsOf(upstream))
    if (why) throw new Error(why)
    if (sources.length === 0) throw new Error('No GO / KEGG / COG … terms on these genes.')
    // (a two-way ANOVA's term rows have no up / down — kept out, as from every directional reader)
    // Sent without a curve fit's curves (`curve`, `rs`), which enrichment never reads: they are
    // most of a row (10k curve-fit rows ≈ 70 MB), and copying them to the worker blocked the UI
    // for seconds on every threshold change. A columnar result goes as its signed rows' columns
    // less those two (withoutColumns) — no row built here.
    const signed = holderWhere(upstream.cmp, 'signed', (c) => !c.term)
    const table = holderTable(signed)
    const rows = table
      ? withoutColumns(table, ['curve', 'rs'])
      : signed.rows.map((r) => (r.curve || r.rs ? { ...r, curve: undefined, rs: undefined } : r))
    const facets = await engine.enrichmentAll(rows, {
      numericConditions: upstream.numericConditions ?? [],
      annotationMap: ann,
      displayMap: upstream.displayMap,
      keggCategories: cats,
      sources: sources as EnrichSource[],
      methods: ['ora', 'gsea']
    })
    return { kind: 'enrich', facets }
  }
  const why = unmetRequirement(kind, config, facts())
  if (why) throw new Error(why)
  if (kind === 'string') {
    if (upstream.kind !== 'compare') throw new Error('Needs a Compare upstream.')
    const cfg = config as StringConfig
    const ann = upstream.annotationMap ?? {}
    const species = cfg.species && cfg.species > 0 ? cfg.species : dominantTaxon(ann)
    if (!species) throw new Error('No species detected — set one in the settings.')
    const caps = stringCapOptions(cfg.maxGenes > 0 ? cfg.maxGenes : 40)
    const facets: Record<string, StringAll> = {}
    // (a two-way ANOVA's term rows kept out) — the facets resolved over the context tuples, each
    // facet's genes read off its rows' columns (no row built)
    for (const g of facetGroupsOf(upstream.cmp, numericOfResult(upstream), (c) => !c.term)) {
      if (cancelled()) throw new Error('cancelled')
      // The widest query; a facet without 2 significant genes has no network to read.
      const widest = stringQueryGenesAt(
        upstream.cmp,
        g.idx,
        upstream.displayMap,
        ann,
        stringSendLimit(caps[caps.length - 1])
      )
      if (widest.length < 2) continue
      const all = await readStringAll(widest, species, caps)
      if (all.error === NO_LOCAL_DATA)
        throw new Error(
          'No local STRING data for this organism — tick STRING in the import’s Metadata fetch, ' +
            'then re-run Clean data and Compare.'
        )
      if (all.error) throw new Error(all.error)
      facets[g.key] = all
    }
    return { kind: 'string', species, caps, facets }
  }
  // Nothing of its own to compute: it draws live from the upstream. (Keep registry.plotComputes —
  // which decides where a Re-run is offered — to the kinds handled above.)
  return { kind: 'plot' }
}
