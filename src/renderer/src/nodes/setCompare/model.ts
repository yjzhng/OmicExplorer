/** The set comparison's sets, from its run and config: what can be picked (`choices`) and what's
 *  drawn (`sets`) — the run's sets for its upstream, picked, with the saved gene sets asked for. */
import {
  condValue,
  type ConditionKey,
  directedSets,
  enrichSourcesPresent,
  facetNames,
  holderWhere,
  type NumericConds,
  quantitySets,
  resolveEnrichSource,
  sampleConds,
  sampleGroups,
  sampleIndex,
  type SampleGroup,
  type SampleOf,
  type SetDef,
  termGroups
} from '../../engine'
import {
  type CondUnits,
  type GeneSet,
  type NodeResult,
  type SetCompareConfig,
  unitOf
} from '../../graph/types'

/** The sets drawn when none are picked: the first this many. */
export const DEFAULT_SETS = 5
/** A gene is in a sample group's set when measured in this share of its samples, unless set. */
export const DEFAULT_SHARE = 0.5
/** A term is significant below this FDR, unless set. */
export const DEFAULT_FDR = 0.05
/** An UpSet's most columns, while its cap is on (and it's on unless switched off). */
export const DEFAULT_MAX_INTERSECTIONS = 30
/** A saved gene set's key among the sets. */
export const GENE_SET = 'gs:'

export interface SetChoice {
  key: string
  label: string
}

/** Clean data's sets are drawn per level of one condition, at most this many when none are picked
 *  (every level, as a rule: a bias shows only against all of them). */
export const DEFAULT_LEVELS = 15

/** The conditions the samples take two or more levels of — what Clean data's sets can be grouped
 *  by (one level would make one set). */
export function levelConds(samples: readonly SampleOf[]): ConditionKey[] {
  return sampleConds(samples).filter((c) => {
    const seen = new Set<unknown>()
    for (const s of samples) {
      seen.add(condValue(s as never, c))
      if (seen.size > 1) return true
    }
    return false
  })
}

/** The samples' grouping: by the config's condition (while the samples take levels of it), else
 *  by the first they do; one set of every sample when there's none. ('sample' and several
 *  conditions are an older config's — still read.) */
export function groupByOf(
  cfg: SetCompareConfig,
  samples: readonly SampleOf[]
): ConditionKey[] | 'sample' {
  if (cfg.groupBy === 'sample') return 'sample'
  const conds = levelConds(samples)
  if (cfg.groupBy?.length && cfg.groupBy.every((c) => conds.includes(c))) return cfg.groupBy
  return conds.slice(0, 1)
}

/** Sample groups named by their level alone, with the condition's unit ("10 nM", "Ampicillin")
 *  where they're grouped by one condition — the plot titles them with the condition. */
function byLevel(
  groups: SampleGroup[],
  samples: readonly SampleOf[],
  by: ConditionKey[] | 'sample',
  units?: CondUnits
): SampleGroup[] {
  if (by === 'sample' || by.length !== 1) return groups
  const u = unitOf(units, by[0])
  return groups.map((g) => {
    const v = g.samples.length ? condValue(samples[g.samples[0]] as never, by[0]) : null
    return v == null || v === '' ? g : { ...g, label: u ? `${v} ${u}` : String(v) }
  })
}

/** The choices picked, in the choices' order: the config's (those still there), else the first
 *  `n` (DEFAULT_SETS). */
export function pickedOf(
  cfg: SetCompareConfig,
  choices: readonly SetChoice[],
  n = DEFAULT_SETS
): Set<string> {
  if (!cfg.sets) return new Set(choices.slice(0, n).map((c) => c.key))
  const want = new Set(cfg.sets)
  return new Set(choices.filter((c) => want.has(c.key)).map((c) => c.key))
}

/** How many sets are drawn when none are picked: every level of Clean data's condition (up to
 *  DEFAULT_LEVELS), else DEFAULT_SETS. */
export const defaultCountOf = (up: NodeResult | undefined): number =>
  up?.kind === 'standardize' ? DEFAULT_LEVELS : DEFAULT_SETS

/** The term set a terms config tests against: its own, else the one the genes carry (as the
 *  enrichment plot falls back). */
export function termSourceOf(cfg: SetCompareConfig, up: NodeResult | undefined): string {
  const saved = cfg.source ?? 'go'
  if (up?.kind !== 'compare') return saved
  const present = enrichSourcesPresent(up.annotationMap ?? {}, up.keggCategories)
  return resolveEnrichSource(saved, present) ?? saved
}

/** What the sets can be picked from, read off the upstream itself (no run needed) — the settings'
 *  list. Clean data: its sample groups; a Compare: its facets. */
export function choicesOf(
  cfg: SetCompareConfig,
  up: NodeResult | undefined,
  numeric: NumericConds,
  units?: CondUnits
): SetChoice[] {
  if (up?.kind === 'standardize') {
    const samples = up.std.samples ?? sampleIndex(up.std).reps
    const by = groupByOf(cfg, samples)
    return byLevel(sampleGroups(samples, by, numeric), samples, by, units)
  }
  if (up?.kind === 'compare')
    return facetNames(
      holderWhere(up.cmp, 'signed', (c) => !c.term),
      numeric
    )
  return []
}

/** The sets a config draws from its run, and what they were picked from. */
export function setsOf(
  cfg: SetCompareConfig,
  run: Extract<NodeResult, { kind: 'sets' }>,
  combo: string,
  geneSets: readonly GeneSet[],
  numeric: NumericConds,
  units?: CondUnits
): {
  choices: SetChoice[]
  sets: SetDef[]
  /** terms: the genes behind each set's terms (by the set's key, then the term) — what selecting
   *  a term set selects, as clicking a term in the enrichment plot does */
  termGenes?: Map<string, Map<string, readonly string[]>>
} {
  const terms = cfg.elements === 'terms' && !!run.calls
  let termGenes: Map<string, Map<string, readonly string[]>> | undefined
  let choices: SetChoice[] = []
  let sets: SetDef[] = []
  if (run.quantity) {
    const q = run.quantity
    const by = groupByOf(cfg, q.samples)
    const groups = byLevel(sampleGroups(q.samples, by, numeric), q.samples, by, units)
    choices = groups
    const picked = pickedOf(cfg, choices, DEFAULT_LEVELS)
    sets = quantitySets(
      q,
      groups.filter((g) => picked.has(g.key)),
      cfg.minShare ?? DEFAULT_SHARE
    )
  } else if (run.calls) {
    choices = run.calls
    const picked = pickedOf(cfg, choices)
    const groups = run.calls.filter((g) => picked.has(g.key))
    const base = terms
      ? termGroups(groups, run.enrich ?? {}, combo, cfg.termFdr ?? DEFAULT_FDR)
      : groups
    sets = directedSets(base, cfg.direction ?? 'any')
    if (terms) termGenes = termGenesOf(groups, run.enrich ?? {}, combo)
  }
  if (!terms && cfg.geneSets?.length) {
    const want = new Set(cfg.geneSets)
    for (const g of geneSets)
      if (want.has(g.id))
        sets.push({
          key: GENE_SET + g.id,
          group: GENE_SET + g.id,
          label: g.name,
          members: g.genes.map((x) => x.id)
        })
  }
  return { choices, sets, termGenes }
}

/** Each facet's terms' genes (the genes driving each term — its hit genes, or a GSEA term's
 *  leading edge), under every key a set of that facet can take: up, down, and either (both
 *  pooled). */
function termGenesOf(
  groups: ReadonlyArray<{ key: string }>,
  facets: Record<string, Record<string, import('../../engine').EnrichData>>,
  combo: string
): Map<string, Map<string, readonly string[]>> {
  const out = new Map<string, Map<string, readonly string[]>>()
  for (const g of groups) {
    const e = facets[g.key === 'all' ? '' : g.key]?.[combo]
    const up = new Map<string, readonly string[]>()
    const down = new Map<string, readonly string[]>()
    for (const t of e?.up ?? []) up.set(t.term, t.geneIds ?? [])
    for (const t of e?.down ?? []) down.set(t.term, t.geneIds ?? [])
    const any = new Map(up)
    for (const [t, ids] of down) any.set(t, [...new Set([...(any.get(t) ?? []), ...ids])])
    out.set(`${g.key}¦up`, up)
    out.set(`${g.key}¦down`, down)
    out.set(g.key, any)
  }
  return out
}
