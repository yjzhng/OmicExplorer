/**
 * The gene selector's menu: every gene, grouped three ways — Function (GO by default, or COG /
 * MSigDB), Pathway (KEGG by default, or Reactome) and Essentiality (CEG/NEG before DEG), each by ONE
 * set the results carry, with a dropdown in the tab to pick another. Only each tab's chosen set is
 * grouped: GO alone can run to thousands of terms, so building every set up front would pay for
 * groupings nobody opened. Shared by the dashboard and the form layout (the main nav's selector).
 */
import { useMemo, useState } from 'react'

import {
  cogAreasOf,
  ENRICH_GROUPS,
  enrichSourcesPresent,
  enrichTermsOf,
  ENRICH_SOURCE_LABEL,
  resolveEnrichSource,
  type EnrichSource
} from '../engine'
import type { NodeResult } from '../graph/types'
import type { GeneCategory, GeneGroupTab } from '../ui/GeneSelectMenu'

/** Essentiality classes, in menu order. */
const ESS_CLASSES = ['Essential', 'Non-essential', 'NA'] as const
type EssClass = (typeof ESS_CLASSES)[number]
/** Essentiality columns the annotation fetch writes, preferred first. CEG/NEG outranks DEG: it's a
 *  curated human gold standard that reports non-essential too, where DEG — a union of screens over
 *  many organisms — can only say "essential in at least one of them". */
const ESSENTIALITY_COLS = ['essentialityCEG', 'essentiality']
/** What each known essentiality column is, for the tab's dropdown; any other column shows by name. */
const ESSENTIALITY_LABEL: Record<string, string> = {
  essentialityCEG: 'CEG / NEG (human)',
  essentiality: 'DEG'
}

/** Pick a gene's protein description from its annotation record: the UniProt `proteinName` column
 *  first, else a data column whose name reads like a protein name / description / product. */
function pickDesc(rec: Record<string, string> | undefined): string | undefined {
  if (!rec) return undefined
  if (rec.proteinName) return rec.proteinName
  const key = Object.keys(rec).find((c) => /protein[_. ]?name|description|product/i.test(c))
  return key ? rec[key] : undefined
}

/** Which term sets each tab offers, its default first: the engine's Function / Pathway groups,
 *  shared with the enrichment terms dropdown. */
const tabSources = (label: 'Function' | 'Pathway'): EnrichSource[] =>
  ENRICH_GROUPS.find((g) => g.label === label)?.sources ?? []
const TAB_SOURCES = { function: tabSources('Function'), pathway: tabSources('Pathway') }

/** The selector's tabs (Pathway, Essentiality) for these results. */
export function useGeneMenuTabs(results: Record<string, NodeResult>): GeneGroupTab[] {
  // uniqID → display name, merged across every result's displayMap, so the selected-genes chips
  // can show gene names for the pinned selection (which carries only ids).
  const geneLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of Object.values(results)) {
      const dm = r.kind === 'standardize' ? r.std.displayMap : r.displayMap
      if (dm) for (const k in dm) if (!(k in m)) m[k] = dm[k]
    }
    return m
  }, [results])
  // Merged per-gene annotations across EVERY result that carries them — Standardize (std) as well as
  // Compare — so the description (proteinName) and pathway tags show even in a Standardize-only flow
  // (previously only Compare results were read, so a Standardize-driven menu had no proteinName).
  const annById = useMemo(() => {
    const m: Record<string, Record<string, string>> = {}
    for (const r of Object.values(results)) {
      const am =
        r.kind === 'standardize'
          ? r.std.annotationMap
          : r.kind === 'compare'
            ? r.annotationMap
            : undefined
      if (!am) continue
      for (const id in am) {
        const rec = m[id] ?? (m[id] = {})
        for (const c in am[id]) if (rec[c] == null) rec[c] = am[id][c]
      }
    }
    return m
  }, [results])
  // Pathway → BRITE category, merged the same way (Standardize + Compare).
  const kcatAll = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of Object.values(results)) {
      const kc =
        r.kind === 'standardize'
          ? r.std.keggCategories
          : r.kind === 'compare'
            ? r.keggCategories
            : undefined
      if (kc) for (const k in kc) if (!(k in m)) m[k] = kc[k]
    }
    return m
  }, [results])
  // Genes grouped pathway-CATEGORY → PATHWAY → gene for the multi-select menu. Pathways come from the
  // merged per-gene annotationMap (keggPathway; ';'/'|'-separated); each pathway's category from the
  // merged keggCategories map (BRITE top level). A gene appears under every pathway it's annotated
  // with. Genes with no pathway → "No pathway"; pathways with no known category → "Other".
  // Two-level grouping, parent → term → genes: KEGG's BRITE category → pathway, COG's area →
  // functional category. A gene appears under every term it carries; genes with none → `none`;
  // terms with no known parent → "Other". Both sink to the bottom.
  const nestedCategories = (
    termsOf: (id: string) => string[],
    parentOf: (term: string) => string | undefined,
    none: string
  ): GeneCategory[] => {
    const OTHER = 'Other'
    type Gene = { id: string; label: string; desc?: string }
    const cats = new Map<string, Map<string, Gene[]>>()
    const put = (cat: string, term: string, gene: Gene): void => {
      let byTerm = cats.get(cat)
      if (!byTerm) cats.set(cat, (byTerm = new Map()))
      const arr = byTerm.get(term)
      if (arr) arr.push(gene)
      else byTerm.set(term, [gene])
    }
    for (const id in geneLabels) {
      const gene = { id, label: geneLabels[id], desc: pickDesc(annById[id]) }
      const terms = [...new Set(termsOf(id))]
      if (terms.length === 0) put(none, none, gene)
      else for (const t of terms) put(parentOf(t) ?? OTHER, t, gene)
    }
    const byName = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { numeric: true })
    const rank = (name: string): number => (name === none ? 2 : name === OTHER ? 1 : 0)
    return [...cats.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || byName(a[0], b[0]))
      .map(([name, byTerm]) => ({
        name,
        pathways: [...byTerm.entries()]
          .sort((a, b) => byName(a[0], b[0]))
          .map(([term, genes]) => ({
            name: term,
            genes: genes.sort((x, y) => byName(x.label, y.label))
          }))
      }))
  }
  const keggCategories = (): GeneCategory[] =>
    nestedCategories(
      (id) =>
        (annById[id]?.keggPathway ?? '')
          .split(/[;|]/)
          .map((s) => s.trim())
          .filter(Boolean),
      (pw) => kcatAll[pw],
      'No pathway'
    )
  // COG categories under the functional area NCBI puts each in — read from the data: the fetch
  // writes a `cogArea` column aligned with `cogCategory` (one area per category, same order).
  // Data fetched before that column existed has no areas, and its categories land under "Other"
  // until COG is fetched again.
  const cogCategories = (): GeneCategory[] => {
    const areaOf = cogAreasOf(annById)
    return nestedCategories(
      (id) => enrichTermsOf(annById, 'cog', id),
      (c) => areaOf[c],
      'No COG category'
    )
  }

  // Genes grouped by essentiality — a flat tree for the menu's second tab. NA means "this source
  // doesn't say", which is not the same as non-essential: DEG is essential-only, so under it every
  // unlisted gene is NA, while CEG/NEG can positively call a gene non-essential. Empty classes are
  // dropped so a DEG-only dataset doesn't show a Non-essential bucket it can never fill.
  // Every essentiality column the genes carry: the known ones first (CEG/NEG before DEG — see
  // ESSENTIALITY_COLS), then any other /essential/i column, so a hand-supplied DB column (say
  // `is_essential`) works too. The tab's dropdown picks between them; they're kept apart rather
  // than merged because they answer different questions.
  const essCols = useMemo(() => {
    const present = new Set(Object.values(annById).flatMap((rec) => Object.keys(rec)))
    const known = ESSENTIALITY_COLS.filter((c) => present.has(c))
    const other = [...present].filter((c) => /essential/i.test(c) && !known.includes(c)).sort()
    return [...known, ...other]
  }, [annById])
  const [pickedEss, setPickedEss] = useState<string | null>(null)
  const essCol = pickedEss && essCols.includes(pickedEss) ? pickedEss : essCols[0]
  const geneEssentiality = useMemo(() => {
    const ann = annById
    const classOf = (v: string | undefined): EssClass => {
      const s = (v ?? '').trim().toLowerCase()
      if (s === '') return 'NA'
      if (s.startsWith('non') || s === 'no' || s === 'false' || s === '0') return 'Non-essential'
      const yes = s.includes('essential') || s === 'e' || s === 'yes' || s === 'true' || s === '1'
      return yes ? 'Essential' : 'NA'
    }
    const byName = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { numeric: true })
    const buckets: Record<EssClass, { id: string; label: string; desc?: string }[]> = {
      Essential: [],
      'Non-essential': [],
      NA: []
    }
    // No essentiality column at all: no tab — a lone "NA" bucket would say nothing.
    if (!essCol) return null
    for (const id in geneLabels)
      buckets[classOf(ann[id]?.[essCol])].push({
        id,
        label: geneLabels[id],
        desc: pickDesc(ann[id])
      })
    return ESS_CLASSES.filter((name) => buckets[name].length > 0).map((name) => ({
      name,
      genes: buckets[name].sort((x, y) => byName(x.label, y.label))
    }))
  }, [annById, geneLabels, essCol])
  // The term sets present, split between the Function and Pathway tabs (TAB_SOURCES — the same
  // split as the import's annotation groups).
  const present = useMemo(() => enrichSourcesPresent(annById, kcatAll), [annById, kcatAll])
  const fnPresent = present.filter((s) => TAB_SOURCES.function.includes(s))
  const pwPresent = present.filter((s) => TAB_SOURCES.pathway.includes(s))
  const [pickedFn, setPickedFn] = useState<EnrichSource | null>(null)
  const [pickedPw, setPickedPw] = useState<EnrichSource | null>(null)
  // Each tab's first set unless another was picked (GO, KEGG); the enrichment fallback order when
  // that isn't in the data.
  const fnSource = resolveEnrichSource(pickedFn ?? TAB_SOURCES.function[0], fnPresent)
  const pwSource = resolveEnrichSource(pickedPw ?? TAB_SOURCES.pathway[0], pwPresent)

  // One set's grouping: KEGG and COG nested (see keggCategories / cogCategories), any other flat —
  // term → genes, with the genes carrying none at the bottom.
  const groupBy = (source: EnrichSource): GeneCategory[] => {
    if (source === 'kegg') return keggCategories()
    if (source === 'cog') return cogCategories()
    const byName = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { numeric: true })
    const none = `No ${ENRICH_SOURCE_LABEL[source]} term`
    const byTerm = new Map<string, { id: string; label: string; desc?: string }[]>()
    for (const id in geneLabels) {
      const gene = { id, label: geneLabels[id], desc: pickDesc(annById[id]) }
      const terms = enrichTermsOf(annById, source, id, kcatAll)
      for (const t of terms.length ? terms : [none]) {
        const arr = byTerm.get(t)
        if (arr) arr.push(gene)
        else byTerm.set(t, [gene])
      }
    }
    return [...byTerm.entries()]
      .sort((a, b) => Number(a[0] === none) - Number(b[0] === none) || byName(a[0], b[0]))
      .map(([name, genes]) => ({ name, genes: genes.sort((x, y) => byName(x.label, y.label)) }))
  }
  // Only each tab's chosen set is grouped, rebuilt when the choice changes. groupBy reads only
  // annById / kcatAll / geneLabels, all listed.
  /* eslint-disable react-hooks/exhaustive-deps */
  const fnCategories = useMemo(
    () => (fnSource ? groupBy(fnSource) : null),
    [fnSource, annById, kcatAll, geneLabels]
  )
  const pwCategories = useMemo(
    () => (pwSource ? groupBy(pwSource) : null),
    [pwSource, annById, kcatAll, geneLabels]
  )
  /* eslint-enable react-hooks/exhaustive-deps */

  return useMemo(() => {
    const tabs: GeneGroupTab[] = []
    const termTab = (
      key: string,
      label: string,
      source: EnrichSource | null,
      categories: GeneCategory[] | null,
      sources: EnrichSource[],
      pick: (s: EnrichSource) => void
    ): void => {
      if (!source || !categories) return
      tabs.push({
        key,
        label,
        categories,
        variant: {
          value: source,
          options: sources.map((s) => ({
            value: s,
            label: ENRICH_SOURCE_LABEL[s]
          })),
          onChange: (v) => pick(v as EnrichSource)
        }
      })
    }
    termTab('function', 'Function', fnSource, fnCategories, fnPresent, setPickedFn)
    termTab('pathway', 'Pathway', pwSource, pwCategories, pwPresent, setPickedPw)
    if (geneEssentiality && essCol)
      tabs.push({
        key: 'essentiality',
        label: 'Essentiality',
        categories: geneEssentiality,
        variant: {
          value: essCol,
          options: essCols.map((c) => ({ value: c, label: ESSENTIALITY_LABEL[c] ?? c })),
          onChange: setPickedEss
        }
      })
    // No annotations of any kind: still list every gene, so the selector works on bare data.
    if (tabs.length === 0) {
      const byName = (a: string, b: string): number =>
        a.localeCompare(b, undefined, { numeric: true })
      const genes = Object.keys(geneLabels)
        .map((id) => ({ id, label: geneLabels[id] }))
        .sort((x, y) => byName(x.label, y.label))
      tabs.push({ key: 'genes', label: 'Genes', categories: [{ name: 'All genes', genes }] })
    }
    return tabs
    // fnPresent / pwPresent are re-derived each render; `present` is the stable source of both.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    fnSource,
    pwSource,
    present,
    fnCategories,
    pwCategories,
    geneEssentiality,
    essCol,
    essCols,
    geneLabels
  ])
}
