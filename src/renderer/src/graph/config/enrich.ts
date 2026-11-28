/**
 * The enrichment plots' settings: Enrichment, Enrichment map, Set comparison and the STRING
 * network.
 */
import type { EnrichSource } from '../../engine'
import type { FcPaletteConfig, PlotAxes, PlotEffectColors, QuickAccess } from './plotStyle'

/** Enrichment (compare): over-representation of GO / KEGG / COG / MSigDB / Reactome terms in the
 *  significant gene set, drawn as a dot or bar plot. Reads the annotations fetched in the
 *  interactive import. */
export interface EnrichConfig extends FcPaletteConfig {
  /** the up / down / none colours, this plot's own; unset (or 'auto') = from its FC palette */
  effectColors?: PlotEffectColors
  /** 'ora' = over-representation (hypergeometric); 'gsea' reserved (ranked, not yet computed). */
  method: 'ora' | 'gsea'
  /** which annotation term set to test */
  source: EnrichSource
  /** plot style ('ridge' is GSEA-only: per-set log₂FC density ridges) */
  style: 'dot' | 'bar' | 'ridge'
  /** how many top terms to show */
  topTerms: number
  /** only terms with an FDR (BH-adjusted p) below this are drawn, still at most `topTerms` each
   *  way; unset = no cut (the top terms whatever their FDR) */
  termFdr?: number
  /** how terms are stacked: by significance alone (unset), or by category first — the
   *  categories in their fixed order (the legend's), each's terms by significance (within a module,
   *  with modules on) */
  termOrder?: 'significance' | 'category'
  /** gene modules: terms carried by largely the same genes (engine/enrich/enrichModules) stacked together,
   *  module by module, a bar beside each — as the fold-change heatmap's gene modules */
  modules?: boolean
  /** with modules on: every top term (unset), or only each module's most significant */
  show?: 'all' | 'one'
  /** the term groups' (categories') palette, this plot's own; unset = the global one */
  categorical?: import('../../ui/color/palettes').CategoricalId
  /** the gene modules' palette, this plot's own; unset = the global one — and while it's the
   *  categories' palette too, the modules take its colours after theirs, so none repeats */
  moduleCategorical?: import('../../ui/color/palettes').CategoricalId
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
  /** x / y axis overrides (title, fonts, range, ticks, grid, line); unset = the view's layout */
  axes?: PlotAxes
}

/** Enrichment map (compare): the enriched terms as a flow — the source's levels (KEGG category ›
 *  group, GO aspect, …), then the terms, GO terms nested inside their enriched ancestors, then the
 *  gene modules gathering them — each node as tall as its hit genes, a ribbon carrying the genes a term shares with
 *  each group it sits in; ribbons into one node overlap on its genes, so overlap shows as depth.
 *  The same run as the enrichment plot's. */
export interface EnrichMapConfig {
  method: 'ora' | 'gsea'
  source: EnrichSource
  /** an older map's choice of terms: 'significant' = every one below FDR 0.05 (up to 200 each
   *  way). Read while `termFdr` is unset; the FDR switch replaces it. */
  terms?: 'top' | 'significant'
  /** only terms with an FDR (BH-adjusted p) below this are drawn, at most `topTerms` each way;
   *  unset = no cut (the top terms whatever their FDR) */
  termFdr?: number
  topTerms: number
  /** which direction's terms: both (unset; a term found both ways is one node, its genes pooled),
   *  up or down */
  direction?: 'both' | 'up' | 'down'
  /** a gene-modules column on the right, the terms flowing into it (on unless switched off) */
  modules?: boolean
  /** where overlapping terms leave a ribbon's genes apart on a node's edge: strands off each run
   *  merging soon after ('split'), or that edge's ribbons stacked, thinned to fill the bar
   *  ('stack', unset) */
  overlap?: 'split' | 'stack'
  /** the categories' palette, this plot's own; unset = the global one */
  categorical?: import('../../ui/color/palettes').CategoricalId
  /** the modules' palette; unset = the global one (past the categories' colours, as the
   *  enrichment plot's) */
  moduleCategorical?: import('../../ui/color/palettes').CategoricalId
  quick?: QuickAccess
}

/** Set comparison: sets of genes — measured per sample or condition group (Clean data), or
 *  significant per facet (a Compare / Curve fit) — or of a Compare's enriched terms, with any saved
 *  gene sets, drawn as an UpSet or an area-proportional Venn (two or three sets). */
export interface SetCompareConfig {
  /** what the sets hold: genes (unset), or a Compare's enriched terms */
  elements?: 'genes' | 'terms'
  /** Clean data: a set per sample ('sample'), or per group of samples sharing these conditions
   *  (unset = every condition the samples carry) */
  groupBy?: 'sample' | import('../../engine').ConditionKey[]
  /** Clean data: a gene is in a group's set when measured in at least this share of its samples
   *  (0 = any one; unset = 0.5) */
  minShare?: number
  /** a Compare: which of a facet's genes / terms — up, down, either (unset), or up and down as two
   *  sets */
  direction?: import('../../engine').SetDirection
  /** the sets drawn, by their group (a sample group, a facet); unset = the first ones (up to
   *  DEFAULT_SETS) */
  sets?: string[]
  /** saved gene sets drawn as sets too, by id (genes only) */
  geneSets?: string[]
  /** terms: the enrichment's method and term set, and the FDR a term is significant below */
  method?: 'ora' | 'gsea'
  source?: EnrichSource
  termFdr?: number
  /** an UpSet (unset), or a Venn of two or three sets */
  view?: 'upset' | 'venn'
  /** UpSet: its columns largest first (unset), or by how many sets */
  order?: import('../../engine').IntersectionOrder
  /** UpSet: the most columns drawn (with `capEnabled`) */
  maxIntersections?: number
  capEnabled?: boolean
  /** the sets' palette, this plot's own; unset = the global one */
  categorical?: import('../../ui/color/palettes').CategoricalId
  quick?: QuickAccess
}

/** STRING network (compare): PPI network among the top differential genes, fetched from STRING-DB.
 *  Species comes from the interactive-import annotation fetch (NCBI taxon); a non-zero `species`
 *  here overrides it. Nodes = genes coloured by log₂FC, sized by degree; edges = STRING confidence. */
export interface StringConfig extends FcPaletteConfig {
  /** the up / down / none colours, this plot's own; unset (or 'auto') = from its FC palette */
  effectColors?: PlotEffectColors
  /** STRING confidence cutoff bucket (maps to required_score 150/400/700/900); unset = auto, the
   *  highest level at which the query genes still have a network (medium with interactors on) */
  confidence?: 'low' | 'medium' | 'high' | 'highest'
  /** cap on the number of genes (strongest |log₂FC|) sent to STRING */
  maxGenes: number
  /** also include first-shell interactors of the query set (proteins that directly connect to a
   *  differential gene above the confidence threshold). They count toward `maxGenes` like any
   *  other node. */
  addInteractors?: boolean
  /** manual NCBI taxon override; 0/undefined = use the species from the annotation fetch */
  species?: number
  /** the query genes' node outline width, px (unset = STRING_OUTLINE) */
  queryOutline?: number
  /** the query genes' node outline colour (unset or AUTO = black) */
  queryOutlineColor?: string
  /** the first-shell interactors' node outline width, px (unset = STRING_OUTLINE) */
  interactorOutline?: number
  /** the interactors' node outline colour (unset or AUTO = the plot background) */
  interactorOutlineColor?: string
  /** which of this plot's settings the tile surfaces as quick-access switch bars (unset = all;
   *  the gear always carries every setting). Keyed by config field. */
  quick?: QuickAccess
}

/** A STRING node's default outline width, px — query genes and interactors alike. */
export const STRING_OUTLINE = 0.5
