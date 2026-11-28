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
 * A Curve fit by the response surface method adds its model view (detector / descriptor) — a
 * context every plot below it follows, as the conditions are (engine/modelView.ts).
 *
 * Renders nothing for a non-faceted group (e.g. a Clean data tile's heatmap or cluster).
 */
import { type CSSProperties, type ReactNode } from 'react'

import { hasResponseFits, type ModelView } from '../engine'
import type { AnalysisGroup } from '../graph/groups'
import { useGraph } from '../graph/store'
import { type CompareConfig, isStep, modelViewOf, type NodeResult } from '../graph/types'
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
  // A response surface method Curve fit: which model its plots show (one row's check, per result)
  const root = results[group.rootId]
  const fits = group.kind === 'curveFit' && root?.kind === 'compare' && hasResponseFits(root.cmp)
  const view = useGraph((s): ModelView | null => {
    if (!fits) return null
    const n = s.nodes.find((x) => x.id === group.rootId)
    return n && isStep(n) ? modelViewOf(n.data.config as CompareConfig) : null
  })
  const setView = useGraph((s) => s.setModelView)
  if (!bars.length && !view) return null
  return (
    <div style={styles.facetBar}>
      {view && (
        <div style={styles.facetGroup}>
          <span style={styles.facetLabel}>model</span>
          <ChoiceSwitch
            fit
            pager={false}
            label="Model"
            value={view}
            options={MODEL_OPTIONS}
            onChange={(v) => setView(group.rootId, v)}
          />
        </div>
      )}
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
              fit
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

/** The model switch's two views (see engine/modelView.ts). */
const MODEL_OPTIONS: ReadonlyArray<{ value: ModelView; label: string; title: string }> = [
  {
    value: 'detector',
    label: 'detector',
    title: 'The spline: its peak as the fold change, its fit drawn — what was tested'
  },
  {
    value: 'descriptor',
    label: 'descriptor',
    title: 'The description (4PL, line, joint model): its peak and curve; NA where undescribed'
  }
]

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
  // Never wider than the bar: it shrinks to the room and the pills wrap (as SwitchBar's).
  facetGroup: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    flex: '0 1 auto',
    minWidth: 0,
    maxWidth: '100%'
  },
  facetLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  }
}
