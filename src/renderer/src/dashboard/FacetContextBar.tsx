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

import { facetDims, facetKeyLabel, type ContextRow } from '../engine'
import type { AnalysisGroup } from '../graph/groups'
import type { NodeResult } from '../graph/types'
import { UI } from '../ui/theme'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { EMPTY_SEL, resolveFacets, useFacet } from './facet'

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
  const sel = useFacet((s) => s.sel[group.id]) ?? EMPTY_SEL
  const setLevel = useFacet((s) => s.setLevel)
  const bars = useMemo(() => {
    if (!rows) return []
    const dims = facetDims(rows)
    return dims.length ? resolveFacets(rows, dims, sel).bars : []
  }, [rows, sel])
  if (!bars.length) return null
  return (
    <div style={styles.facetBar}>
      {bars.map(({ dim, value, options }) => (
        <div key={dim} style={styles.facetGroup}>
          <span style={styles.facetLabel}>{facetKeyLabel(dim)}</span>
          <ToggleSwitch
            label={`${facetKeyLabel(dim)} level`}
            value={String(value)}
            // One-sided contrast level (outer-join rows with nothing to pair): greyed, not
            // selectable — the tooltip says which side has the data.
            options={options.map(({ value: v, onlyOn }) => ({
              value: String(v),
              label: String(v),
              disabled: !!onlyOn,
              title: onlyOn
                ? `${facetKeyLabel(dim)} = ${v} is only on ${onlyOn} — no partner to contrast`
                : undefined
            }))}
            onChange={(v) => setLevel(group.id, dim, v)}
          />
        </div>
      ))}
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
