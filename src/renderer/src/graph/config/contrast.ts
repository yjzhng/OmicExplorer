/** A Contrast's settings: its two sides and how they're picked. */
import type { ConditionKey, CondSelector, ContrastStat, PairFix } from '../../engine'

/** Contrast forms two sides (FC1/FC2) and scores per-gene divergence between them. */
export interface ContrastConfig {
  /** correlated (OLS prediction band around the trend) vs independent (linear cutoff per axis) */
  relationship: 'correlated' | 'independent'
  /** the statistic's cutoffs: band confidence (correlated), q + |value| floor (linear cutoff) */
  stat?: ContrastStat
  /** how the two sides (FC1/FC2) are formed:
   *   - 'select' (default): ONE upstream input, split into two EXPLICIT cond-value selections
   *     (num → FC1, den → FC2) aligned on the chosen match context — the same interactive selector
   *     window as Compare, so the two sides and their context are declared, never inferred.
   *   - 'pair': two upstream inputs (two Compares → FC-vs-FC, or two Standardizes →
   *     abundance-vs-abundance), joined by uniqID + the matched context. */
  source?: 'select' | 'pair'
  /** 'select' mode: the two sides' cond-value selections (like Compare's num/den). FC1 = rows
   *  matching `num`, FC2 = rows matching `den`. */
  num?: CondSelector
  den?: CondSelector
  /** context dims to align the two sides on (joined with uniqID); unmatched dims are averaged.
   *  Empty = join on uniqID alone (one point per gene). Used by both 'select' and 'pair'. */
  match?: ConditionKey[]
  /** 'pair' mode: which wired inputs are dataset A (y) and B (x), by node id. A tile may have
   *  more than two inputs wired; absent/stale ids fall back to the first two edges. */
  pairA?: string
  pairB?: string
  /** 'select' mode with several inputs wired: which one the two groups are selected from, by
   *  node id; absent/stale falls back to the first edge. */
  selectFrom?: string
  /** 'pair' mode: the slice each UNMATCHED condition is fixed to, per dataset — nothing is pooled
   *  across a condition (see engine PairFix). */
  pairFix?: PairFix
}

/** Effective contrast source, tolerating older saved values (the pre-rename 'split' → 'select'). */
/** The contrast's mode: with one input only intra-dataset (select two groups) is possible; with
 *  two or more the config chooses, defaulting to inter-dataset (pair two of them). */
export function resolveContrastSource(c: ContrastConfig, inputCount: number): 'select' | 'pair' {
  if (inputCount < 2) return 'select'
  return c.source === 'select' ? 'select' : 'pair'
}

/** Whether a 'select'-mode contrast has both sides pinned (so it can run). */
export function isContrastConfigured(c: ContrastConfig): boolean {
  const pinned = (s?: CondSelector): boolean =>
    !!s && Object.values(s).some((v) => v != null && v.length > 0)
  return pinned(c.num) && pinned(c.den)
}
