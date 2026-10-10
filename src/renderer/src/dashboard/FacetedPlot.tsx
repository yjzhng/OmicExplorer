/**
 * Context switch-tabs for any comparison/contrast plot. One row of tabs per context
 * condition (e.g. `cell: WT clpP` / `dose: 2.5 5 10`), one value selected in each,
 * so the wrapped plot shows a single full context tuple — no context is pooled.
 *
 * Context dims come from `facetContextDims` (the comparison's own `cmp_cond` dims are
 * excluded); pass `exclude` for dims the plot itself consumes as an axis (e.g. the
 * dose/time axis of a dose-response or bubble plot). With no context dims, the plot
 * renders alone with no tabs. The child renders the plot from the selected context's
 * rows and the supplied title.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { facetDims, facetKeyLabel, type ContextRow, type ConditionKey } from '../engine'
import { UI } from '../ui/theme'
import { ToggleSwitch } from '../ui/ToggleSwitch'
import { resolveFacets } from './facet'

export function FacetedPlot<T extends ContextRow>({
  rows,
  exclude,
  children,
  facetSel
}: {
  rows: T[]
  exclude?: ConditionKey[]
  /** the facet on show: its rows, and its key (FacetGroup key, '' unfaceted) — what a plot's run
   *  keys its per-facet results by */
  children: (contextRows: T[], facetKey: string) => ReactNode
  /** when set, the selection is driven externally — the shared results-header control, or
   *  batch export forcing one facet per file — so this plot renders no tabs of its own.
   *  Undefined = standalone, with its own interactive tabs. */
  facetSel?: Record<string, string>
}) {
  const dims = useMemo(() => facetDims(rows, exclude), [rows, exclude])
  const [selState, setSel] = useState<Record<string, string>>({})
  const sel = facetSel ?? selState
  const {
    bars,
    rows: groupRows,
    key: facetKey
  } = useMemo(() => resolveFacets(rows, dims, sel), [rows, dims, sel])

  if (dims.length === 0) return <div style={styles.single}>{children(rows, '')}</div>

  // Shared/forced selection: a global control (or export) owns it, so just render the
  // resolved facet — no tabs here.
  if (facetSel) return <div style={styles.single}>{children(groupRows, facetKey)}</div>

  return (
    <div style={styles.root}>
      <div className="oe-switch-strip" style={styles.bars}>
        {bars.map(({ dim, value, options }) => (
          <div key={dim} style={styles.bar}>
            <span style={styles.barLabel}>{facetKeyLabel(dim)}</span>
            {/* The plot tiles' switch (as in SwitchBar). A one-sided contrast level (outer-join
                rows with nothing to pair) is greyed, not selectable — the tooltip says which side
                has the data. */}
            <ToggleSwitch
              size="sm"
              label={`${facetKeyLabel(dim)} level`}
              value={String(value)}
              options={options.map(({ value: v, onlyOn }) => ({
                value: String(v),
                label: String(v),
                disabled: !!onlyOn,
                title: onlyOn
                  ? `${facetKeyLabel(dim)} = ${v} is only on ${onlyOn} — no partner to contrast`
                  : undefined
              }))}
              onChange={(v) => setSel((s) => ({ ...s, [dim]: v }))}
            />
          </div>
        ))}
      </div>
      <div style={styles.body}>{children(groupRows, facetKey)}</div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  single: { height: '100%', minHeight: 0 },
  // Condition groups flow on one row with a gap, wrapping only when they don't fit.
  bars: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: 4,
    columnGap: 14,
    padding: '3px 10px',
    flex: '0 0 auto'
  },
  bar: { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  barLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  body: { flex: 1, minHeight: 0 }
}
