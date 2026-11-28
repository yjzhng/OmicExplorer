/**
 * A Clean data step's settings, and how they read as the engine's clean-up, normalisation, batch
 * and imputation options.
 */
import {
  type CleanupMode,
  type CleanupRule,
  cleanupRuleOf,
  type ConditionKey,
  type ImputeMethod,
  type NormalizeOptions,
  type NormalizeReference,
  type RefCombine,
  type RefMissing
} from '../../engine'

export interface StandardizeConfig {
  /** null = auto-detect all present conditions */
  activeConditions: ConditionKey[] | null
  /** clean-up on/off. Absent on older configs → on iff minSamplePct > 0. */
  cleanupEnabled?: boolean
  /** clean-up: drop genes identified (non-null) in fewer than this % of samples (applied only
   *  while `cleanupEnabled`). */
  minSamplePct: number
  /** clean-up threshold as a percentage of samples (default) or a declared count of them */
  minSampleUnit?: 'pct' | 'count'
  /** the count, while `minSampleUnit` is 'count' (within each group, grouped) */
  minSampleCount?: number
  /** conditions to measure the % threshold within (e.g. ['cell'] = per cell, ['cell', 'dose'] =
   *  per cell × dose); what goes follows `cleanupMode`. Empty/absent = all samples pooled (the
   *  threshold global). */
  minSamplePctBy?: ConditionKey[]
  /** the removal mode (engine cleanup.ts CleanupMode); absent = cleanupModeOfConfig's default */
  cleanupMode?: CleanupMode
  /** The scale Clean data presents its values on (its table, its written CSV): none = as the input
   *  arrived, or log₁₀ / log₂. Analyses always work from exact linear values (see engine scale.ts).
   *  Absent = none, whatever the input scale (engine scale.ts). */
  logTransform?: 'none' | 'log2' | 'log10'
  /** with a log-transform: show the values as their logs, or plain on a log axis (engine scale.ts
   *  LogDisplay); unset = the unit's default (plain for fractions of a reference protein) */
  logDisplay?: 'log' | 'plain'
  /** median normalisation on/off (absent = off) */
  normalizeEnabled?: boolean
  /** the genes each sample's median is taken over (absent = 'shared': genes in every sample), or
   *  reference proteins ('protein': refProteinsOf) */
  normalizeReference?: NormalizeReference
  /** normalizeReference 'protein': the reference proteins' uniqIDs (one, or a set) */
  normalizeProteins?: string[]
  /** (older configs) the one reference protein — read through refProteinsOf */
  normalizeProtein?: string
  /** several reference proteins: their level per sample, the median of their logs (absent) or
   *  the mean (geometric mean) */
  normalizeCombine?: RefCombine
  /** a sample missing reference proteins: stop (absent), drop it, or use the ones it measured */
  normalizeMissing?: RefMissing
  /** also equalise each sample's spread, Perseus width adjustment (absent = off) */
  normalizeSpread?: boolean
  /** batch correction on/off (absent = off) */
  batchEnabled?: boolean
  /** the batches, as filled and edited here: each a name and its samples (by sampleLabel), and —
   *  filled — the value it was filled from. A sample in none isn't corrected. */
  batches?: Array<{ name: string; samples: string[]; value?: string }>
  /** what the batches were filled from: a condition (which then stops being one — it's the batch),
   *  or 'source' — the Merge inputs the samples came from (StandardizeResult.sources) */
  batchFrom?: ConditionKey | 'source'
  /** a sample moved between batches (or a batch added / removed) by hand since the fill: the
   *  batches are then these lists. Else they're worked out from `batchFrom` on each run, so they
   *  follow the data above (BatchSpec.live). */
  batchEdited?: boolean
  /** imputation on/off (absent = off) */
  imputeEnabled?: boolean
  /** imputation method while enabled (absent = 'perseus') */
  imputeMethod?: ImputeMethod
  /** perseus: downshift in sample SDs (absent = 1.8) */
  imputeShift?: number
  /** perseus: width as a fraction of the sample SD (absent = 0.3) */
  imputeWidth?: number
}

/** Whether a Standardize config's clean-up applies — the explicit switch, or (older configs
 *  without one) a non-zero threshold. */
export const cleanupOn = (c: StandardizeConfig): boolean =>
  c.cleanupEnabled ?? (c.minSamplePct ?? 0) > 0

/** A Clean data step's removal mode: as chosen, or (older configs) within its groups when it has
 *  any — a gene kept if it clears in at least one, as it always was — else overall. */
export const cleanupModeOfConfig = (c: StandardizeConfig): CleanupMode =>
  c.cleanupMode ?? ((c.minSamplePctBy ?? []).length ? 'anyGroup' : 'overall')
/** Its clean-up as the engine takes it (cleanup.ts CleanupRule); undefined while it's off. */
/** A Clean data step's reference proteins: its set, or (older configs) its one protein. */
export const refProteinsOf = (c: StandardizeConfig): string[] =>
  c.normalizeProteins ?? (c.normalizeProtein ? [c.normalizeProtein] : [])

/** Its normalisation as the engine takes it (normalize.ts NormalizeOptions); undefined while off. */
export function normalizeOptionsOf(c: StandardizeConfig): NormalizeOptions | undefined {
  if (!c.normalizeEnabled) return undefined
  const reference = c.normalizeReference ?? 'shared'
  return reference === 'protein'
    ? {
        reference,
        proteins: refProteinsOf(c),
        combine: c.normalizeCombine ?? 'median',
        missing: c.normalizeMissing ?? 'stop'
      }
    : { reference, spread: !!c.normalizeSpread }
}

export function cleanupRuleOfConfig(c: StandardizeConfig): CleanupRule | undefined {
  if (!cleanupOn(c)) return undefined
  return cleanupRuleOf(
    cleanupModeOfConfig(c),
    c.minSamplePctBy ?? [],
    c.minSampleUnit === 'count'
      ? { unit: 'count', value: c.minSampleCount ?? 2 }
      : { unit: 'pct', value: c.minSamplePct ?? 0 }
  )
}

/** The batches a Clean data step corrects for, as the engine takes them (batch.ts BatchSpec) — none
 *  while it's off or fewer than two batches hold samples. */
export function batchSpecOf(c: StandardizeConfig): import('../../engine').BatchSpec | undefined {
  if (!c.batchEnabled) return undefined
  const used = (c.batches ?? []).filter((b) => b.samples.length > 0)
  if (used.length < 2) return undefined
  const of: Record<string, string> = {}
  for (const b of used) for (const s of b.samples) of[s] = b.name
  // Filled and not moved by hand: worked out from the data on each run, each value keeping the
  // name given here.
  const from = c.batchEdited ? undefined : c.batchFrom
  return {
    of,
    ...(c.batchFrom && c.batchFrom !== 'source' ? { condition: c.batchFrom } : null),
    ...(from
      ? {
          live: {
            from,
            names: Object.fromEntries(
              (c.batches ?? []).flatMap((b) => (b.value ? [[b.value, b.name]] : []))
            )
          }
        }
      : null)
  }
}

/** Whether imputation applies: its own switch, AND clean-up — without a coverage threshold a gene
 *  seen once would be mostly imputed and could come out as a confident call, so imputation is
 *  gated on clean-up being on. */
export const imputeOn = (c: StandardizeConfig): boolean => !!c.imputeEnabled && cleanupOn(c)
