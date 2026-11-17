/**
 * Pool several standardized datasets into one, so a Compare tile fed by two Standardize inputs can
 * compare conditions drawn from either dataset. Genes are matched across datasets by their shared
 * `uniqID` (see [[omicviz-conceptual-reuse]]): rows are concatenated, so samples that share a
 * condition across datasets pool as replicates, and the id→label / annotation / KEGG maps are
 * merged (later inputs win on a clash). Active conditions and compounds are unioned.
 *
 * A sample is its conditions and replicate (rows carry no sample name — see sampleIndex.ts), so a
 * later input's replicates of a condition an earlier one has are renumbered past them (r1–r3 and
 * r1–r3 → r1–r6) — kept as they were, the two datasets' r1s were one sample to every plot that
 * pivots by sample (heatmap, QC, correlation).
 *
 * A single input passes straight through (same reference), so the common one-dataset Compare is
 * unchanged.
 */
import { sampleIndex } from './sampleIndex'
import { sampleLabel } from './sampleLabel'
import type { ConditionKey, SampleConds, StandardizeResult, StandardRow } from './types'
import { orderConds } from './types'

/** A sample's conditions, all but its replicate — what its replicates are numbered within. */
const condKey = (r: Pick<StandardRow, 'cell' | 'cmpd' | 'dose' | 'time' | 'extra'>): string =>
  JSON.stringify([
    r.cell,
    r.cmpd,
    r.dose,
    r.time,
    Object.keys(r.extra ?? {})
      .sort()
      .map((k) => [k, r.extra![k]])
  ])

/** Each input's replicates renumbered so no two inputs share a sample: per condition, an input
 *  whose replicates clash with an earlier input's has all of them moved past the highest taken
 *  (a missing replicate counting as 1), keeping their order. Inputs (and conditions) with no clash
 *  come back as they were, rows untouched. */
function distinctReps(
  stds: StandardizeResult[]
): Array<Pick<StandardizeResult, 'rows' | 'samples'>> {
  const taken = new Map<string, Set<number | null>>()
  return stds.map((s) => {
    const ix = sampleIndex(s)
    // this input's replicates per condition
    const mine = new Map<string, Set<number | null>>()
    for (const r of ix.reps) {
      const k = condKey(r)
      let set = mine.get(k)
      if (!set) mine.set(k, (set = new Set()))
      set.add(r.rep)
    }
    // per condition that clashes, the offset its replicates move by
    const offset = new Map<string, number>()
    for (const [k, reps] of mine) {
      let had = taken.get(k)
      if (!had) taken.set(k, (had = new Set()))
      const by = [...reps].some((r) => had.has(r)) ? Math.max(0, ...[...had].map((r) => r ?? 1)) : 0
      if (by) offset.set(k, by)
      for (const r of reps) had.add(by ? by + (r ?? 1) : r)
    }
    if (offset.size === 0) return s
    const moved = (r: Pick<StandardRow, 'rep'>, k: string): number | null => {
      const by = offset.get(k)
      return by ? by + (r.rep ?? 1) : r.rep
    }
    const newRep = ix.reps.map((r) => moved(r, condKey(r)))
    const rows = s.rows.map((r, i) => {
      const rep = newRep[ix.sample[i]]
      return rep === r.rep ? r : { ...r, rep }
    })
    const samples = s.samples?.map((x): SampleConds => {
      const rep = moved(x, condKey(x))
      return rep === x.rep ? x : { ...x, rep }
    })
    return { rows, ...(samples ? { samples } : {}) }
  })
}

/** `names`: each input's name (its tile), recorded per sample as the merged result's `sources`. A
 *  batch map isn't carried: the datasets pooled are batches of their own now, for a Clean data below
 *  to define (from `sources`, say). */
export function combineStandardize(stds: StandardizeResult[], names?: string[]): StandardizeResult {
  if (stds.length === 1) return stds[0]

  const pooled = distinctReps(stds)
  const rows = pooled.flatMap((s) => s.rows)
  // which input each (renumbered) sample came from
  const sources: Record<string, string> = {}
  if (names)
    pooled.forEach((p, i) => {
      for (const s of p.samples ?? sampleIndex(p).reps) sources[sampleLabel(s)] = names[i]
    })
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
  // orderConds, not a VALID_CONDITIONS filter: that only lists the four presets, so filtering
  // through it silently dropped every custom (`@slug`) condition from the union — and since
  // runCompare derives its context dims from activeConditions, the custom axis then vanished from
  // the merged dataset's plots and result switchers entirely.
  const activeConditions = orderConds([...activeSet])
  // Numeric where any input declared it (a custom condition is one schema across the merge).
  const numericConditions = [...new Set(stds.flatMap((s) => s.numericConditions ?? []))].filter(
    (c) => activeSet.has(c)
  )
  const compounds = [...new Set(stds.flatMap((s) => s.compounds))]

  const cleanup = {
    droppedGenes: stds.reduce((a, s) => a + (s.cleanup?.droppedGenes ?? 0), 0),
    sampleCount: stds.reduce((a, s) => a + (s.cleanup?.sampleCount ?? 0), 0),
    minSamplePct: stds[0]?.cleanup?.minSamplePct ?? 0,
    by: stds[0]?.cleanup?.by
  }

  // Rows are linear in every input (see scale.ts), so they pool as-is; the merged dataset is
  // presented on the first input's scale (and carries its input scale, for a Clean data below).
  return {
    rows,
    // Pooled like the rows; only when every input kept its samples (else the shape reads rows).
    ...(pooled.every((s) => s.samples) ? { samples: pooled.flatMap((s) => s.samples!) } : {}),
    displayMap,
    annotationMap,
    keggCategories,
    activeConditions,
    ...(numericConditions.length ? { numericConditions } : {}),
    compounds,
    cleanup,
    ...(stds[0]?.scale ? { scale: stds[0].scale } : {}),
    ...(stds[0]?.inputScale ? { inputScale: stds[0].inputScale } : {}),
    ...(names ? { sources } : {})
  }
}
