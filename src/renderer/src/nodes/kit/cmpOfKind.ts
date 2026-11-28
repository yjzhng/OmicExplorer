/** A Compare's rows of one `show` kind, kept free of the views' React and store imports so a run
 *  (heatmap/run.ts) can read them too. */
import { type CompareResultRow, hasTermRows, holderWhere, showKindOf } from '../../engine'

/** A Compare's rows of one `show` kind (rowsOfKind) as a result of their own (holderWhere): the
 *  same result when it has only one kind. */
export function cmpOfKind<H extends { rows: readonly CompareResultRow[] }>(
  cmp: H,
  show?: string
): H {
  if (!hasTermRows(cmp)) return cmp
  const want = show === 'factors' ? 'factors' : 'overall'
  return holderWhere(cmp, `show¦${want}`, (c) => showKindOf(c) === want)
}
