/**
 * The shared condition switcher for one analysis group: one pill per context dimension
 * (cell / dose / time / a custom axis), one level selected in each.
 *
 * It owns the selection that every plot in the group follows. That matters more than it looks:
 * `FacetedPlot` renders NO tabs of its own once a `facetSel` is handed to it, on the promise that a
 * control like this one exists — so a layout that passes a selection without showing this bar
 * leaves the conditions unchangeable. Both results layouts (the dashboard and the paged form view)
 * render it for that reason.
 *
 * Renders nothing for a non-faceted group (e.g. a Clean data tile's heatmap or cluster).
 */
import { type CSSProperties, type ReactNode } from 'react'

import type { AnalysisGroup } from '../graph/groups'
import type { NodeResult } from '../graph/types'
import { UI } from '../ui/theme'
import { ChoiceSwitch, PILL_CAP } from '../ui/ChoiceSwitch'
import {
  facetBarLabel,
  facetChoice,
  isNumericFacet,
  pickFacet,
  useFacet,
  useGroupFacets
} from './facet'

export function FacetContextBar({
  group,
  results
}: {
  group: AnalysisGroup
  results: Record<string, NodeResult>
}): ReactNode {
  const { rows, dims, bars, numeric, sel } = useGroupFacets(group, results)
  const setSel = useFacet((s) => s.setSel)
  if (!bars.length) return null
  return (
    <div style={styles.facetBar}>
      {bars.map((bar) => {
        const { dim, value, options } = bar
        return (
          <div key={dim} style={styles.facetGroup}>
            <span style={styles.facetLabel}>{facetBarLabel(bar)}</span>
            {/* Pills, or a searchable dropdown past PILL_CAP levels — categorical conditions only;
              numeric ones (dose, time, any declared numeric) stay pills (ordered levels, stepped
              through). */}
            <ChoiceSwitch
              cap={isNumericFacet(dim, numeric) ? Infinity : PILL_CAP}
              counter
              label={facetBarLabel(bar)}
              value={String(value)}
              // A one-sided contrast level (outer-join rows with nothing to pair), or one not
              // measured alongside the picks to its left: greyed, not selectable — the tooltip
              // says why.
              options={options.map((o) => facetChoice(dim, o, bars))}
              onChange={(v) =>
                rows && setSel(group.id, pickFacet(rows, dims, sel, dim, v, numeric))
              }
            />
          </div>
        )
      })}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  facetBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    flex: 1,
    minWidth: 0
  },
  facetGroup: { display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' },
  facetLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  }
}
