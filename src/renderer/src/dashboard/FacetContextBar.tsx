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
import { useMemo, type CSSProperties, type ReactNode } from 'react'

import { facetDims, type ContextRow } from '../engine'
import type { AnalysisGroup } from '../graph/groups'
import { numericOfResult, type NodeResult } from '../graph/types'
import { UI } from '../ui/theme'
import { ChoiceSwitch, PILL_CAP } from '../ui/ChoiceSwitch'
import {
  EMPTY_SEL,
  facetBarLabel,
  facetChoice,
  isNumericFacet,
  pickFacet,
  resolveFacets,
  useFacet
} from './facet'

export function FacetContextBar({
  group,
  results
}: {
  group: AnalysisGroup
  results: Record<string, NodeResult>
}): ReactNode {
  const r = results[group.rootId]
  const rows: ContextRow[] | null =
    r?.kind === 'compare' ? r.cmp.rows : r?.kind === 'contrast' ? r.ctr.rows : null
  const numeric = useMemo(() => numericOfResult(r), [r])
  const sel = useFacet((s) => s.sel[group.id]) ?? EMPTY_SEL
  const setSel = useFacet((s) => s.setSel)
  const dims = useMemo(() => (rows ? facetDims(rows) : []), [rows])
  const bars = useMemo(
    () => (rows && dims.length ? resolveFacets(rows, dims, sel, numeric).bars : []),
    [rows, dims, sel, numeric]
  )
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
              // One-sided contrast level (outer-join rows with nothing to pair): greyed, not
              // selectable — the tooltip says which side has the data.
              options={options.map((o) => facetChoice(dim, o, bars))}
              // A level not alongside the picks to its left moves those (pickFacet): a compound
              // brings its comparison.
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
