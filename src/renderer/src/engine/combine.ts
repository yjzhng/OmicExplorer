/**
 * Pool several standardized datasets into one, so a Compare tile fed by two Standardize inputs can
 * compare conditions drawn from either dataset. Genes are matched across datasets by their shared
 * `uniqID` (see [[omicviz-conceptual-reuse]]): rows are concatenated, so samples that share a
 * condition across datasets pool as replicates, and the id→label / annotation / KEGG maps are
 * merged (later inputs win on a clash). Active conditions and compounds are unioned.
 *
 * A single input passes straight through (same reference), so the common one-dataset Compare is
 * unchanged.
 */
import type { ConditionKey, StandardizeResult } from './types'
import { VALID_CONDITIONS } from './types'

export function combineStandardize(stds: StandardizeResult[]): StandardizeResult {
  if (stds.length === 1) return stds[0]

  const rows = stds.flatMap((s) => s.rows)
  const displayMap: Record<string, string> = {}
  const annotationMap: Record<string, Record<string, string>> = {}
  const keggCategories: Record<string, string> = {}
  for (const s of stds) {
    Object.assign(displayMap, s.displayMap)
    for (const [uid, ann] of Object.entries(s.annotationMap ?? {}))
      annotationMap[uid] = { ...annotationMap[uid], ...ann }
    Object.assign(keggCategories, s.keggCategories ?? {})
  }

  const activeSet = new Set<ConditionKey>()
  for (const s of stds) for (const c of s.activeConditions) activeSet.add(c)
  const activeConditions = VALID_CONDITIONS.filter((c) => activeSet.has(c))
  const compounds = [...new Set(stds.flatMap((s) => s.compounds))]

  const cleanup = {
    droppedGenes: stds.reduce((a, s) => a + (s.cleanup?.droppedGenes ?? 0), 0),
    sampleCount: stds.reduce((a, s) => a + (s.cleanup?.sampleCount ?? 0), 0),
    minSamplePct: stds[0]?.cleanup?.minSamplePct ?? 0,
    perStrain: stds[0]?.cleanup?.perStrain
  }

  return { rows, displayMap, annotationMap, keggCategories, activeConditions, compounds, cleanup }
}
