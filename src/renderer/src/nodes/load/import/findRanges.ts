/** Where a find string matches in a text, as ranges to highlight. */

export type MarkRange = [number, number]

/** Every occurrence of `find` in `text`, as [start, end) ranges. */
export function findRanges(text: string, find: string): MarkRange[] {
  const out: MarkRange[] = []
  for (let i = text.indexOf(find); i !== -1 && find; i = text.indexOf(find, i + find.length))
    out.push([i, i + find.length])
  return out
}
