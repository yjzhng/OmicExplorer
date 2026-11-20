import {
  ALL_OPS,
  canConnect,
  categoryOf,
  outputKindOf,
  type PlotMenuEntry,
  plotEntriesFor,
  PLOT_SECTIONS
} from '../graph/registry'
import { type NodeKind } from '../graph/types'

/** The process steps a plot can be added after, in the editor's order — the Plot defaults page's
 *  first pick. */
// A Merge or a Subset hands on Clean data (outputKindOf), so it shares Clean data's defaults.
export const DEFAULT_STEPS = ALL_OPS.filter(
  (k) => categoryOf(k) !== 'plotting' && outputKindOf(k) === k && plotEntriesAfter(k).length > 0
)
/** The plot menu's entries for a step, in its section order (PLOT_SECTIONS). */
export function plotEntriesAfter(step: NodeKind): PlotMenuEntry[] {
  return PLOT_SECTIONS.flatMap((sec) => sec.kinds)
    .filter((k) => canConnect(step, k))
    .flatMap((k) => plotEntriesFor(k))
}
