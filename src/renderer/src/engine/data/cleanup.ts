/**
 * Clean-up: removing what's identified too patchily to trust. The decision is made of independent
 * parts (CleanupRule):
 *
 * - **check** — where coverage is measured: across every sample, or within each group;
 * - **by** — the conditions whose combinations are the groups (cell, cell × dose, …);
 * - **threshold** — the bar: a percentage of the samples measured, or a number of them;
 * - **remove** — what falling short removes: the whole gene, or its values in the groups short of
 *   it (left missing — imputation, if on, fills them: a group all measured or all imputed);
 * - **required** — checked within groups, removed whole: how many groups a gene must clear to stay.
 *
 * The Clean data panel offers four presets of it (CleanupMode, cleanupRuleOf). A gene counts as
 * identified in a sample when it has a value there (a 0 was read as missing on import).
 */
import type { ConditionKey, StandardRow } from '../types'

export interface CleanupThreshold {
  unit: 'pct' | 'count'
  /** a percentage (0–100) of the samples measured, or a number of them */
  value: number
}
export interface CleanupRule {
  check: 'global' | 'group'
  /** check 'group': the conditions whose combinations are the groups (none: one group, all) */
  by: ConditionKey[]
  threshold: CleanupThreshold
  /** check 'group': the whole gene, or its values in each group it falls short in. A global
   *  check has one verdict per gene, so it removes the gene. */
  remove: 'gene' | 'group'
  /** check 'group', remove 'gene': how many groups a gene must clear to stay — a number (at most
   *  the groups there are), or all */
  required: number | 'all'
}

/** The panel's four removal modes, as presets of the rule:
 *  - `overall`: genes below the threshold across all samples;
 *  - `withinGroup`: a gene's values in each group where it's below (a gene below in every group
 *    goes whole);
 *  - `anyGroup`: genes, unless above the threshold in at least one group;
 *  - `everyGroup`: genes, unless above it in every group. */
export type CleanupMode = 'overall' | 'withinGroup' | 'anyGroup' | 'everyGroup'
export const CLEANUP_MODES: readonly CleanupMode[] = [
  'overall',
  'withinGroup',
  'anyGroup',
  'everyGroup'
]
export function cleanupRuleOf(
  mode: CleanupMode,
  by: ConditionKey[],
  threshold: CleanupThreshold
): CleanupRule {
  if (mode === 'overall') return { check: 'global', by: [], threshold, remove: 'gene', required: 1 }
  if (mode === 'withinGroup') return { check: 'group', by, threshold, remove: 'group', required: 1 }
  return {
    check: 'group',
    by,
    threshold,
    remove: 'gene',
    required: mode === 'anyGroup' ? 1 : 'all'
  }
}
/** The mode a rule is, when it's one of the presets (else undefined). */
export function cleanupModeOf(rule: CleanupRule): CleanupMode | undefined {
  if (rule.check === 'global') return 'overall'
  if (rule.remove === 'group') return 'withinGroup'
  if (rule.required === 1) return 'anyGroup'
  if (rule.required === 'all') return 'everyGroup'
  return undefined
}
/** Whether the rule removes anything at all (a threshold of 0 keeps everything). */
export const cleanupActive = (rule: CleanupRule | undefined): rule is CleanupRule =>
  !!rule && rule.threshold.value > 0

/** Enough identified samples, of `total`, to clear the threshold. */
export function clears(threshold: CleanupThreshold, hits: number, total: number): boolean {
  if (total <= 0) return false
  return threshold.unit === 'count'
    ? hits >= threshold.value
    : (hits / total) * 100 >= threshold.value
}

/**
 * Apply a rule. `presence`: gene → the samples it has a value in; `sampleGroup`: every sample →
 * its group (its `by` values joined; '' for one group of all); `rowGroup`: a row's group, the same
 * way. Returns the rows kept (a removed group's values set missing), the genes removed whole and
 * the values removed from groups.
 */
export function applyCleanup(
  rows: StandardRow[],
  presence: Map<string, Set<string>>,
  sampleGroup: Map<string, string>,
  rowGroup: (r: StandardRow) => string,
  rule: CleanupRule | undefined
): { rows: StandardRow[]; droppedGenes: number; removedValues: number } {
  const none = { rows, droppedGenes: 0, removedValues: 0 }
  const sampleCount = sampleGroup.size
  if (!cleanupActive(rule) || sampleCount === 0) return none
  const geneIds = new Set(rows.map((r) => r.uniqID))
  const dropped = new Set<string>()
  // remove 'group': gene → the groups whose values go
  const short = new Map<string, Set<string>>()

  if (rule.check === 'global') {
    // one verdict per gene, over every sample (a gene with no value anywhere has none)
    for (const g of geneIds)
      if (!clears(rule.threshold, presence.get(g)?.size ?? 0, sampleCount)) dropped.add(g)
  } else {
    // the samples per group (the denominators), and each gene's identified samples per group
    const groupTotal = new Map<string, number>()
    for (const grp of sampleGroup.values()) groupTotal.set(grp, (groupTotal.get(grp) ?? 0) + 1)
    const groups = [...groupTotal.keys()]
    const need =
      rule.required === 'all' ? groups.length : Math.min(Math.max(1, rule.required), groups.length)
    for (const g of geneIds) {
      const hits = new Map<string, number>()
      for (const s of presence.get(g) ?? []) {
        const grp = sampleGroup.get(s) ?? ''
        hits.set(grp, (hits.get(grp) ?? 0) + 1)
      }
      const failed = groups.filter(
        (grp) => !clears(rule.threshold, hits.get(grp) ?? 0, groupTotal.get(grp)!)
      )
      const passed = groups.length - failed.length
      if (rule.remove === 'group') {
        // short everywhere: nothing left, so the gene goes
        if (passed === 0) dropped.add(g)
        else if (failed.length) short.set(g, new Set(failed))
      } else if (passed < need) dropped.add(g)
    }
  }

  if (dropped.size === 0 && short.size === 0) return none
  let removedValues = 0
  const out: StandardRow[] = []
  for (const r of rows) {
    if (dropped.has(r.uniqID)) continue
    if (short.get(r.uniqID)?.has(rowGroup(r))) {
      if (r.value != null) removedValues++
      out.push({ ...r, value: null, imputed: undefined })
    } else out.push(r)
  }
  return { rows: out, droppedGenes: dropped.size, removedValues }
}

/** An input's rule: its own, or — older callers — `minSamplePct` (with `minSamplePctBy`: within
 *  those groups, a gene kept when it clears in at least one). Undefined = no clean-up. */
export function cleanupRuleFromInput(input: {
  cleanupRule?: CleanupRule
  minSamplePct?: number
  minSamplePctBy?: ConditionKey[]
}): CleanupRule | undefined {
  if (input.cleanupRule) return input.cleanupRule
  const pct = Math.min(100, Math.max(0, input.minSamplePct ?? 0))
  if (!(pct > 0)) return undefined
  const by = input.minSamplePctBy ?? []
  return cleanupRuleOf(by.length ? 'anyGroup' : 'overall', by, { unit: 'pct', value: pct })
}
