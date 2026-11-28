/**
 * Enrichment term sources (GO, KEGG, Reactome, COG …): which annotation columns hold terms, the
 * term tables, and the enrichment jobs a run is split into.
 */
import { pairsOf } from '../data/accession'
import {
  type CompareResultRow,
  type ConditionKey,
  ctxLabel,
  type CustomConditionKey,
  numericConds
} from '../types'
import {
  buildEnrichment,
  type EnrichData,
  type EnrichOptions,
  type EnrichTerm,
  splitTerms
} from './ora'
import { facetCompareRows, facetDims } from '../plot/facet'

// ── enrichment (over-representation analysis) ────────────────────────────────────

/** Which annotation term set to test. KEGG and COG each offer two levels — the specific one
 *  (pathway / orthologous group) and the broad one it rolls up into (pathway category / functional
 *  category). Specific sets resolve finer biology but are small, so they need a deeper dataset to
 *  clear an FDR cut; broad sets almost always have the counts but say less. The plain `kegg` and
 *  `cog` ids keep their original meaning so saved projects still open. KOG is COG's eukaryotic half
 *  — the same functional categories, its own groups — tested as its own set. */
export type EnrichSource =
  'go' | 'kegg' | 'kegg_category' | 'cog' | 'cog_group' | 'kog' | 'msigdb' | 'reactome'
/** Display name per source, for axis titles, selectors and unmet-requirement messages. */
export const ENRICH_SOURCE_LABEL: Record<EnrichSource, string> = {
  // Named for the source alone: a source's levels are its grouping (KEGG pathway category › group
  // → pathway, COG/KOG area → category), not separate choices.
  go: 'GO',
  kegg: 'KEGG',
  kegg_category: 'KEGG pathway category',
  cog: 'COG',
  cog_group: 'COG group',
  kog: 'KOG (human)',
  msigdb: 'MSigDB',
  reactome: 'Reactome (human)'
}
/** Enrichment method. `ora` is over-representation (hypergeometric on the significant set);
 *  `gsea` is ranked gene-set enrichment (weighted running-sum over the log2FC-ranked list with
 *  gene-label permutation). */
export type EnrichMethod = 'ora' | 'gsea'

/** DB annotation columns each source reads (see engine/data/ingest annotationMap). GO is fetched per
 *  aspect (BP / MF / CC) and pooled here; the plain `GO` column is the pre-split name, kept so
 *  older projects still enrich. */
export const ENRICH_COLS: Record<EnrichSource, string[]> = {
  go: ['GO_BP', 'GO_MF', 'GO_CC', 'GO'],
  kegg: ['KEGG'],
  // Same column as `kegg`: enrichTermsOf maps each pathway up to its category (see `categories`).
  kegg_category: ['KEGG'],
  cog: ['COG_cat'],
  cog_group: ['COG'],
  kog: ['KOG_cat'],
  msigdb: ['MSigDB'],
  reactome: ['Reactome']
}
/** A gene's distinct terms for a source, pooled over that source's columns. `categories` is the
 *  pathway → BRITE top-level map, needed only by `kegg_category`; without it that source has no
 *  terms at all. */
export function enrichTermsOf(
  ann: Record<string, Record<string, string>>,
  source: EnrichSource,
  uid: string,
  categories?: Record<string, string>
): string[] {
  const rec = ann[uid]
  if (!rec) return []
  const out = new Set<string>()
  for (const col of ENRICH_COLS[source]) for (const t of splitTerms(rec[col])) out.add(t)
  if (source !== 'kegg_category') return [...out]
  const cats = new Set<string>()
  for (const t of out) {
    const c = categories?.[t]
    if (c) cats.add(c)
  }
  return [...cats]
}

/** The order sources are fallen back through when a tile's chosen one isn't in the data, and the
 *  order selectors list them in — also the sources OFFERED: one not listed is never picked or shown.
 *  GO first: UniProt carries it for any organism, so it is the most likely to be there. Then the
 *  pathway sets by reach — KEGG covers prokaryotes too, Reactome is mostly model eukaryotes,
 *  MSigDB's hallmarks are human / mouse only. Then COG's functional categories, which nearly always
 *  clear an FDR cut but say least.
 *
 *  Left out, though the engine still reads them: COG group (one set per orthologous group — too
 *  fine to test or browse by) and KEGG category. A KEGG category, like a COG area, is a GROUPING of
 *  terms, not a term set: it colours and groups KEGG pathways / COG categories (see termGroups). */
export const ENRICH_FALLBACK: EnrichSource[] = ['go', 'kegg', 'reactome', 'msigdb', 'cog', 'kog']

/** How the offered sources are presented, as the import groups the annotations: what a gene DOES
 *  (Function) and what it takes part in (Pathway). The enrichment terms dropdown lists them under
 *  these headings; the gene selector makes them its Function and Pathway tabs. */
export const ENRICH_GROUPS: { label: 'Function' | 'Pathway'; sources: EnrichSource[] }[] = [
  { label: 'Function', sources: ['go', 'cog', 'kog', 'msigdb'] },
  { label: 'Pathway', sources: ['kegg', 'reactome'] }
]

/** The source a tile actually tests: its saved choice when the genes carry it, else the first of
 *  ENRICH_FALLBACK they do; null when they carry none. `present` is enrichSourcesPresent's list. */
export function resolveEnrichSource(
  saved: EnrichSource | undefined,
  present: EnrichSource[]
): EnrichSource | null {
  if (saved && present.includes(saved)) return saved
  return ENRICH_FALLBACK.find((s) => present.includes(s)) ?? null
}

/** Functional category → the area NCBI files it under, from the data: the annotation fetch writes
 *  `COG_area` aligned with `COG_cat` and `KOG_area` with `KOG_cat` (one area per category, same
 *  order). Empty for data fetched before areas existed. */
export function cogAreasOf(
  ann: Record<string, Record<string, string>>,
  kind: 'COG' | 'KOG' = 'COG'
): Record<string, string> {
  return pairsOf(ann, `${kind}_cat`, `${kind}_area`)
}

/** GO's three aspects, by the column each is fetched into. */
export const GO_ASPECTS: [col: string, name: string][] = [
  ['GO_BP', 'Biological process'],
  ['GO_MF', 'Molecular function'],
  ['GO_CC', 'Cellular component']
]
/** GO term → its aspect ("Biological process" / "Molecular function" / "Cellular component"), from
 *  the column the data carries it in — the grouping GO terms are shown under. Terms from the older
 *  single `GO` column have no aspect and stay ungrouped. */
export function goAspectsOf(ann: Record<string, Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const uid in ann)
    for (const [col, name] of GO_ASPECTS)
      for (const t of splitTerms(ann[uid][col])) if (!(t in out)) out[t] = name
  return out
}

/** A facet's label for a table, worded as the matrix column headers: "E28 | DMSO · dose 10" — the
 *  comparison bare, a condition as ctxLabel, any other dimension by its name ("show factors"). */
export const facetLabel = (values: { dim: string; value: string | number }[]): string =>
  values
    .map(({ dim, value }) =>
      dim === 'comparison'
        ? String(value)
        : dim === 'feature' || dim === 'show'
          ? `${dim} ${value}`
          : ctxLabel(dim as ConditionKey, value)
    )
    .join(' · ')

/** How a source's terms are grouped and coloured: KEGG pathways by pathway category (`categories`,
 *  over the data's KEGG_cat), Reactome terms by top-level pathway, COG / KOG categories by area,
 *  GO terms by aspect; none for the rest. Shared by the enrichment tile and its background export. */
export function enrichTermGroups(
  source: EnrichSource,
  ann: Record<string, Record<string, string>>,
  categories?: Record<string, string>
): Record<string, string> | undefined {
  switch (source) {
    case 'kegg':
      return categories
    case 'reactome':
      return reactomeCategoriesOf(ann)
    case 'go':
      return goAspectsOf(ann)
    case 'cog':
      return cogAreasOf(ann, 'COG')
    case 'kog':
      return cogAreasOf(ann, 'KOG')
    default:
      return undefined
  }
}

/** Enrichment as a table — what the enrichment tile's background export writes to the project's
 *  temp folder. Facets are the tile's own (facetDims / facetCompareRows over the Compare rows), or,
 *  with `facet`, `rows` are already one facet so labelled. Every tested term is kept, not just the
 *  top few the plot shows. */
export function enrichmentTable(
  rows: CompareResultRow[],
  /** with the dataset's declared numeric conditions, for the facets' order */
  opts: Omit<EnrichOptions, 'topTerms'> & { numericConditions: readonly CustomConditionKey[] },
  facet?: string
): Record<string, string | number | null>[] {
  const out: Record<string, string | number | null>[] = []
  const groups =
    facet != null
      ? [{ label: facet, rows }]
      : facetCompareRows(rows, facetDims(rows), numericConds(opts.numericConditions)).map((g) => ({
          label: facetLabel(g.values),
          rows: g.rows
        }))
  for (const g of groups)
    out.push(
      ...enrichTermRows(
        buildEnrichment(g.rows, { ...opts, topTerms: Number.MAX_SAFE_INTEGER }),
        g.label
      )
    )
  return out
}

/** One facet's enrichment (every tested term) as table rows — what the export writes. */
export function enrichTermRows(
  e: EnrichData,
  facet: string
): Record<string, string | number | null>[] {
  const gsea = e.method === 'gsea'
  const out: Record<string, string | number | null>[] = []
  for (const [direction, terms] of [
    ['up', e.up],
    ['down', e.down]
  ] as const)
    for (const t of terms)
      out.push({
        facet,
        method: gsea ? 'GSEA' : 'ORA',
        source: ENRICH_SOURCE_LABEL[e.source],
        direction,
        term: t.term,
        group: t.category ?? null,
        setSize: t.setSize,
        count: t.count,
        geneRatio: t.geneRatio,
        ...(gsea ? { NES: t.nes ?? null } : { bgRatio: t.bgRatio, fold: t.fold }),
        pValue: t.pValue,
        pAdjust: t.pAdjust,
        genes: t.genes.join(';')
      })
  return out
}

/** GSEA keeps each tested set's member log₂FC distribution (for the ridge plot); only this many
 *  top terms per direction keep theirs in a stored run — the ridge never shows more, and every
 *  set's would make a saved project heavy. */
export const ENRICH_DIST_KEPT = 100

/** An enrichment plot's run: every method × term source, per facet (keyed by the facet's
 *  FacetGroup key — '' when there are no facets), each with EVERY tested term (the tile shows its
 *  top N, the export writes them all). `combo` keys are `${method}|${source}`. */
export function enrichmentAll(
  rows: CompareResultRow[],
  opts: EnrichAllOptions
): Record<string, Record<string, EnrichData>> {
  const gen = enrichmentAllSteps(rows, opts)
  let r = gen.next()
  while (!r.done) r = gen.next(r.value.map((j) => enrichJob(j)))
  return r.value
}

export type EnrichAllOptions = {
  /** the dataset's declared numeric conditions (numericConds), for the facets' order */
  numericConditions: readonly CustomConditionKey[]
  annotationMap: Record<string, Record<string, string>>
  displayMap?: Record<string, string>
  keggCategories?: Record<string, string>
  sources: EnrichSource[]
  methods: EnrichMethod[]
}

/** One facet × method × source of an enrichment run — independent of the others, so they can be
 *  shared out over the worker pool. `annotationMap` carries only the source's own columns
 *  (ENRICH_COLS), all the term lookup reads, so each job is small to send. */
export interface EnrichJob {
  rows: CompareResultRow[]
  opts: EnrichOptions
}
/** Run one job: the enrichment, its terms past ENRICH_DIST_KEPT stripped of their distributions. */
export function enrichJob(j: EnrichJob): EnrichData {
  const e = buildEnrichment(j.rows, j.opts)
  const trim = (terms: EnrichTerm[]): EnrichTerm[] =>
    terms.map((t, i) =>
      i < ENRICH_DIST_KEPT ? t : { ...t, dist: undefined, leadingDist: undefined }
    )
  return { ...e, up: trim(e.up), down: trim(e.down) }
}

/** The annotation map cut down to `source`'s columns — every gene the term lookup could read. */
function annotationFor(
  ann: Record<string, Record<string, string>>,
  source: EnrichSource
): Record<string, Record<string, string>> {
  const cols = ENRICH_COLS[source]
  const out: Record<string, Record<string, string>> = {}
  for (const uid in ann) {
    const rec = ann[uid]
    let slim: Record<string, string> | undefined
    for (const c of cols)
      if (rec[c] !== undefined) {
        slim ??= {}
        slim[c] = rec[c]
      }
    if (slim) out[uid] = slim
  }
  return out
}

/** enrichmentAll as steps: one batch of every facet × method × source job (EnrichJob), answered in
 *  the same order, then assembled. */
export function* enrichmentAllSteps(
  rows: CompareResultRow[],
  opts: EnrichAllOptions
): Generator<EnrichJob[], Record<string, Record<string, EnrichData>>, EnrichData[]> {
  const groups = facetCompareRows(rows, facetDims(rows), numericConds(opts.numericConditions))
  // Per source, the term grouping and the annotation columns — the same for every facet and method.
  const perSource = new Map(
    opts.sources.map((src) => [
      src,
      {
        termGroups: enrichTermGroups(src, opts.annotationMap, opts.keggCategories ?? {}),
        ann: annotationFor(opts.annotationMap, src)
      }
    ])
  )
  const jobs: EnrichJob[] = []
  const keys: Array<[string, string]> = []
  for (const g of groups) {
    // Only the fields ORA (uniqID, signf, effect) and GSEA (uniqID, log2FC) read — one slim copy
    // per facet, shared by its jobs, so each is small to send.
    const slim = g.rows.map(
      (r) =>
        ({
          uniqID: r.uniqID,
          log2FC: r.log2FC,
          signf: r.signf,
          effect: r.effect
        }) as CompareResultRow
    )
    for (const method of opts.methods)
      for (const source of opts.sources) {
        const ps = perSource.get(source)!
        jobs.push({
          rows: slim,
          opts: {
            method,
            source,
            topTerms: Number.MAX_SAFE_INTEGER,
            annotationMap: ps.ann,
            displayMap: opts.displayMap,
            keggCategories: source.startsWith('kegg') ? opts.keggCategories : undefined,
            termGroups: ps.termGroups
          }
        })
        keys.push([g.key, `${method}|${source}`])
      }
  }
  const done: EnrichData[] = yield jobs
  const out: Record<string, Record<string, EnrichData>> = {}
  for (const g of groups) out[g.key] = {}
  keys.forEach(([fk, combo], i) => (out[fk][combo] = done[i]))
  return out
}

/** Reactome term → its top-level pathway alone — what enrichment colours Reactome terms by. */
export function reactomeCategoriesOf(
  ann: Record<string, Record<string, string>>
): Record<string, string> {
  return pairsOf(ann, 'Reactome', 'Reactome_cat')
}

/** The sources these genes actually carry terms for, in ENRICH_FALLBACK order — so a selector can
 *  offer only what the data can be tested against instead of every source that exists. Checks cells
 *  directly rather than going through enrichTermsOf, since an ABSENT source costs a full scan. */
export function enrichSourcesPresent(
  ann: Record<string, Record<string, string>>,
  categories?: Record<string, string>
): EnrichSource[] {
  const all = Object.keys(ENRICH_COLS) as EnrichSource[]
  const found = new Set<EnrichSource>()
  for (const uid in ann) {
    const rec = ann[uid]
    for (const s of all) {
      if (found.has(s)) continue
      for (const col of ENRICH_COLS[s]) {
        const raw = rec[col]
        if (!raw) continue
        // A pathway only counts for the category level if it maps up to one.
        const hit =
          s === 'kegg_category' ? splitTerms(raw).some((t) => categories?.[t]) : !!raw.trim()
        if (hit) {
          found.add(s)
          break
        }
      }
    }
    if (found.size === all.length) break
  }
  return ENRICH_FALLBACK.filter((s) => found.has(s))
}
