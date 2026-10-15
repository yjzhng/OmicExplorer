/** A plot group's name as its results tab shows it (see tabTitles): its own, else the step it reads
 *  from, `_1`, `_2` … where several would match. Undefined for anything that isn't a plot group
 *  (or not yet wired to a step). The canvas tile and the paged view's card use it, so the tile and
 *  its tab always read the same. */
import { deriveTabs, tabTitles } from './groups'
import { useGraph } from './store'

export function usePlotGroupTitle(id: string, isGroup: boolean): string | undefined {
  return useGraph((s) =>
    isGroup ? tabTitles(deriveTabs(s.nodes, s.edges), s.nodes).get(id) : undefined
  )
}
