/** Content fingerprints for the background temp export (tempResults.ts) — kept apart from it so it
 *  carries no app state and can be tested on its own. */
import type { NodeResult } from '../graph/types'

type CompareResult = Extract<NodeResult, { kind: 'compare' }>

/** A content fingerprint of a Compare result: everything the exports read from it — each row's
 *  identity, context, log₂FC and significance call, plus the annotations, labels and KEGG
 *  categories. Content, not object identity, so it's the same after the project is reopened (its
 *  results rebuilt as new objects) and changes whenever the numbers do, re-run or not (a dragged
 *  threshold re-classifies genes in place). Two 32-bit FNV-1a passes with different seeds, hex.
 *  Cached per result object: computed once, then free. */
const fingerprints = new WeakMap<object, string>()
export function fingerprintOf(r: CompareResult): string {
  const hit = fingerprints.get(r)
  if (hit) return hit
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ 0x5bd1e995
  const feed = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      h1 = Math.imul(h1 ^ c, 0x01000193)
      h2 = Math.imul(h2 ^ c, 0x01000193) ^ (h2 >>> 13)
    }
    // a separator, so "ab"+"c" and "a"+"bc" differ
    h1 = Math.imul(h1 ^ 0x1f, 0x01000193)
    h2 = Math.imul(h2 ^ 0x1f, 0x01000193)
  }
  for (const row of r.cmp.rows)
    feed(
      `${row.uniqID}|${row.comparison}|${row.cmpd}|${row.cell ?? ''}|${row.dose ?? ''}|${row.time ?? ''}|${
        row.extra ? JSON.stringify(row.extra) : ''
      }|${row.log2FC ?? ''}|${row.pP ?? ''}|${row.pQ ?? ''}|${row.signf ? 1 : 0}|${row.effect}`
    )
  feed(JSON.stringify(r.annotationMap ?? {}))
  feed(JSON.stringify(r.displayMap ?? {}))
  feed(JSON.stringify(r.keggCategories ?? {}))
  const fp = `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
  fingerprints.set(r, fp)
  return fp
}
