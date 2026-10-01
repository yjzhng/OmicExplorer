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
  pairsOf,
  goAspectsOf,
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
/** The essentiality columns — exactly these two, preferred first. CEG_NEG outranks DEG: it's a
 *  curated human gold standard that reports non-essential too, where DEG — a union of screens over
 *  many organisms — can only say "essential in at least one of them". (A DB's older names for them
 *  arrive renamed — COLUMN_ALIASES.) */
const ESSENTIALITY_COLS = ['CEG_NEG', 'DEG']
/** A term set's name without its species note ("(human)") — the selector names sets short. */
const shortLabel = (s: EnrichSource): string => ENRICH_SOURCE_LABEL[s].replace(/\s*\(human\)$/, '')
/** What each essentiality column is, for the tab's dropdown. */
const ESSENTIALITY_LABEL: Record<string, string> = {
  CEG_NEG: 'CEG-NEG',
  DEG: 'DEG'
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
  // Genes grouped PARENT → TERM → gene for the multi-select menu (KEGG: pathway category › group →
  // pathway; Reactome: top level › level 2 → level-3 pathway; GO: aspect → term; COG/KOG: area →
  // category). A gene appears under every term it's annotated with.
  // Two-level grouping, parent → term → genes: KEGG's BRITE category → pathway, COG's area →
  // functional category. A gene appears under every term it carries; genes with none → `none`;
  // terms with no known parent → "Other". Both sink to the bottom.
  const nestedCategories = (
    termsOf: (id: string) => string[],
    parentOf: (term: string) => string | undefined,
    none: string,
    /** a term's middle level within its parent (KEGG pathway group, Reactome level 2), if any */
    groupOf?: (term: string) => string | undefined
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
    // A term that IS its group (a Reactome level-2 pathway with no level 3) sits directly in the
    // category rather than under a header of its own name.
    const grp = (term: string): string | undefined => {
      const g = groupOf?.(term)
      return g && g !== term ? g : undefined
    }
    return [...cats.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || byName(a[0], b[0]))
      .map(([name, byTerm]) => ({
        name,
        // Grouped terms together (by group, then name); ungrouped ones after them.
        pathways: [...byTerm.entries()]
          .map(([term, genes]) => ({ term, group: grp(term), genes }))
          .sort(
            (a, b) =>
              Number(!a.group) - Number(!b.group) ||
              byName(a.group ?? '', b.group ?? '') ||
              byName(a.term, b.term)
          )
          .map(({ term, group, genes }) => ({
            name: term,
            ...(group ? { group } : {}),
            genes: genes.sort((x, y) => byName(x.label, y.label))
          }))
      }))
  }
  // KEGG: pathway category → pathway group → pathway — from the data's aligned KEGG / KEGG_cat /
  // KEGG_grp columns, the category over an older import's map.
  const keggCategories = (): GeneCategory[] => {
    const catOf = { ...kcatAll, ...pairsOf(annById, 'KEGG', 'KEGG_cat') }
    const grpOf = pairsOf(annById, 'KEGG', 'KEGG_grp')
    return nestedCategories(
      (id) => enrichTermsOf(annById, 'kegg', id),
      (pw) => catOf[pw],
      'No pathway',
      (pw) => grpOf[pw]
    )
  }
  // Reactome: top-level pathway → level-2 group → level-3 term — the aligned Reactome /
  // Reactome_cat / Reactome_grp columns.
  const reactomeCategories = (): GeneCategory[] => {
    const catOf = pairsOf(annById, 'Reactome', 'Reactome_cat')
    const grpOf = pairsOf(annById, 'Reactome', 'Reactome_grp')
    return nestedCategories(
      (id) => enrichTermsOf(annById, 'reactome', id),
      (t) => catOf[t],
      'No pathway',
      (t) => grpOf[t]
    )
  }
  // GO terms under their aspect (biological process / molecular function / cellular component).
  const goCategories = (): GeneCategory[] => {
    const aspectOf = goAspectsOf(annById)
    return nestedCategories(
      (id) => enrichTermsOf(annById, 'go', id),
      (t) => aspectOf[t],
      'No GO term'
    )
  }
  // COG / KOG categories under the functional area NCBI puts each in — read from the data: the
  // fetch writes an area column aligned with the category one (COG_area with COG_cat, KOG_area
  // with KOG_cat; one area per category, same order). Data without areas lands under "Other".
  const ogCategories = (kind: 'COG' | 'KOG'): GeneCategory[] => {
    const areaOf = cogAreasOf(annById, kind)
    return nestedCategories(
      (id) => enrichTermsOf(annById, kind === 'COG' ? 'cog' : 'kog', id),
      (c) => areaOf[c],
      `No ${kind} category`
    )
  }

  // Genes grouped by essentiality — a flat tree for the menu's second tab. NA means "this source
  // doesn't say", which is not the same as non-essential: DEG is essential-only, so under it every
  // unlisted gene is NA, while CEG/NEG can positively call a gene non-essential. Empty classes are
  // dropped so a DEG-only dataset doesn't show a Non-essential bucket it can never fill.
  // The essentiality columns the genes carry (CEG_NEG before DEG — see ESSENTIALITY_COLS). The tab's
  // dropdown picks between them; they're kept apart rather than merged because they answer
  // different questions.
  const essCols = useMemo(() => {
    const present = new Set(Object.values(annById).flatMap((rec) => Object.keys(rec)))
    return ESSENTIALITY_COLS.filter((c) => present.has(c))
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
    // A protein group carries its members' values `;`-joined; members that disagree put it in
    // each class they name, as a group sits under every pathway any member is in.
    for (const id in geneLabels) {
      const gene = { id, label: geneLabels[id], desc: pickDesc(ann[id]) }
      const classes = new Set((ann[id]?.[essCol] ?? '').split(';').map(classOf))
      for (const c of classes) buckets[c].push(gene)
    }
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

  // One set's grouping: KEGG, Reactome, COG and KOG nested (keggCategories, reactomeCategories,
  // ogCategories), any other flat — term → genes, with the genes carrying none at the bottom.
  const groupBy = (source: EnrichSource): GeneCategory[] => {
    if (source === 'kegg') return keggCategories()
    if (source === 'reactome') return reactomeCategories()
    if (source === 'go') return goCategories()
    if (source === 'cog') return ogCategories('COG')
    if (source === 'kog') return ogCategories('KOG')
    const byName = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { numeric: true })
    const none = `No ${shortLabel(source)} term`
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
            label: shortLabel(s)
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
