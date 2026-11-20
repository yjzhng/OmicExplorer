/** Enrichment's run: every method × term source the genes carry, per facet, every tested term
 *  (engine/enrichmentAll, in the worker). */
import type { PlotRunContext } from '../runContext'
import type { EnrichConfig, NodeResult } from '../../graph/types'
import {
  enrichSourcesPresent,
  resolveEnrichSource,
  holderWhere,
  type EnrichSource
} from '../../engine'
import { engine } from '../../engine/client'
import { holderTable } from '../../engine/lazyRows'
import { withoutColumns } from '../../engine/wire'
import { unmetRequirement, factsOf } from '../../graph/requirements'
import { NotReady } from '../../shared/diagnostics'

export async function run(ctx: PlotRunContext): Promise<NodeResult> {
  const { kind, config, upstream } = ctx
  if (upstream.kind !== 'compare') throw new NotReady('Needs a Compare upstream.')
  const cfg = config as EnrichConfig
  const ann = upstream.annotationMap ?? {}
  const cats = upstream.keggCategories ?? {}
  const sources = enrichSourcesPresent(ann, cats)
  // The tile's own fallback when its saved source isn't carried, for the requirement check.
  const source = resolveEnrichSource(cfg.source ?? 'go', sources) ?? cfg.source ?? 'go'
  const why = unmetRequirement(kind, { ...cfg, source }, factsOf(upstream))
  if (why) throw new NotReady(why)
  if (sources.length === 0) throw new NotReady('No GO / KEGG / COG … terms on these genes.')
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
