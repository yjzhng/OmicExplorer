/** The import wizard's stages, in order, and stepping between them. */

/** Wizard stages: Columns · Filtering · Conditions · Metadata. Numbered 1, 2, 3, 5: stage 4 (a
 *  separate Samplesheet step) merged into Conditions, and the numbers are what a project saves
 *  (`interactive.step`) — so an old 4 still means "the conditions" and 5 still "metadata". */
export type Stage = 1 | 2 | 3 | 5
export const STAGES: Array<{ stage: Stage; name: string }> = [
  { stage: 1, name: 'Columns' },
  { stage: 2, name: 'Filtering' },
  { stage: 3, name: 'Conditions' },
  { stage: 5, name: 'Metadata' }
]

/** Next/previous stage, skipping Filtering (stage 2) when no column is a filter. */
export function nextStage(s: Stage, hasFilters: boolean): Stage {
  if (s === 1) return hasFilters ? 2 : 3
  if (s === 2) return 3
  return 5
}
export function prevStage(s: Stage, hasFilters: boolean): Stage {
  if (s === 5) return 3
  if (s === 3) return hasFilters ? 2 : 1
  return 1
}
