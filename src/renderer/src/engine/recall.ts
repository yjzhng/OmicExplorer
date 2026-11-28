/** A Compare result's calls under a new threshold (or gene mask), straight off its columns: only
 *  thrsh / signf / effect depend on the threshold, so on a columnar result (lazyRows.ts) those three
 *  columns are re-encoded and the rest of the table is kept as it is — no row built. The answer is
 *  the one re-calling each row gives (graph/state/shared.ts reclassify). */
import { classifyCompareRow } from './curveFit'
import { holderTable } from './lazyRows'
import { thresholdLabel, type ThresholdConfig } from './stats'
import { encodeColumn, tableColumn, type Pool, type Table } from './wire'

const CALL_KEYS = ['thrsh', 'signf', 'effect'] as const

/** `holder`'s table with its calls redone under `t` (`hidden` genes uncalled) — null when it isn't
 *  columnar, or its calls need more than the row's own fold change and p-values (a curve fit's
 *  CurveCurator test, its target–decoy FDR, its model), or a row lacks a call field: re-call its
 *  rows then. */
export function recallTable(
  holder: { rows: readonly object[] },
  t: ThresholdConfig,
  hidden: ReadonlySet<string>
): Table | null {
  const tab = holderTable(holder)
  if (!tab || t.type === 'curvecurator' || tab.cols.curve || tab.cols.rs) return null
  if (!tab.shapes.every((keys) => CALL_KEYS.every((k) => keys.includes(k)))) return null
  const read = (k: string): ((i: number) => unknown) => tableColumn(tab, k) ?? (() => undefined)
  const fc = read('log2FC')
  const pP = read('pP')
  const pQ = read('pQ')
  const id = read('uniqID')
  const n = tab.n
  const signf: boolean[] = new Array(n)
  const effect: string[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const cls = classifyCompareRow(
      {
        log2FC: fc(i) as number | null,
        pP: pP(i) as number | null,
        pQ: pQ(i) as number | null
      },
      t
    )
    const s = cls.signf && !hidden.has(id(i) as string)
    signf[i] = s
    effect[i] = s ? cls.effect : 'none'
  }
  const pool: Pool = { list: [], at: new Map() }
  const cols = {
    ...tab.cols,
    thrsh: encodeColumn(new Array<string>(n).fill(thresholdLabel(t)), [], pool),
    signf: encodeColumn(signf, [], pool),
    effect: encodeColumn(effect, [], pool)
  }
  // (plain strings and booleans: nothing nested to pool)
  if (pool.list.length) return null
  return { ...tab, cols }
}
