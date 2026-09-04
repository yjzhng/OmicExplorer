/**
 * Context switch-tabs for any comparison/contrast plot. One row of tabs per context
 * condition (e.g. `strain: WT clpP` / `dose: 2.5 5 10`), one value selected in each,
 * so the wrapped plot shows a single full context tuple — no context is pooled.
 *
 * Context dims come from `facetContextDims` (the comparison's own `cmp_cond` dims are
 * excluded); pass `exclude` for dims the plot itself consumes as an axis (e.g. the
 * dose/time axis of a dose-response or bubble plot). With no context dims, the plot
 * renders alone with no tabs. The child renders the plot from the selected context's
 * rows and the supplied title.
 */
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'

import { facetDims, type ContextRow, type ConditionKey } from '../engine'
import { UI } from '../ui/theme'
import { resolveFacets } from './facet'

export function FacetedPlot<T extends ContextRow>({
  rows,
  exclude,
  children,
  facetSel
}: {
  rows: T[]
  exclude?: ConditionKey[]
  children: (contextRows: T[]) => ReactNode
  /** when set, the selection is driven externally — the shared results-header control, or
   *  batch export forcing one facet per file — so this plot renders no tabs of its own.
   *  Undefined = standalone, with its own interactive tabs. */
  facetSel?: Record<string, string>
}) {
  const dims = useMemo(() => facetDims(rows, exclude), [rows, exclude])
  const [selState, setSel] = useState<Record<string, string>>({})
  const sel = facetSel ?? selState
  const { bars, rows: groupRows } = useMemo(() => resolveFacets(rows, dims, sel), [rows, dims, sel])

  if (dims.length === 0) return <div style={styles.single}>{children(rows)}</div>

  // Shared/forced selection: a global control (or export) owns it, so just render the
  // resolved facet — no tabs here.
  if (facetSel) return <div style={styles.single}>{children(groupRows)}</div>

  return (
    <div style={styles.root}>
      <div style={styles.bars}>
        {bars.map(({ dim, value, options }) => (
          <div key={dim} style={styles.bar} role="tablist" aria-label={`${dim} level`}>
            <span style={styles.barLabel}>{dim}</span>
            {options.map((v) => (
              <button
                key={String(v)}
                role="tab"
                aria-selected={String(v) === String(value)}
                onClick={() => setSel((s) => ({ ...s, [dim]: String(v) }))}
                style={{
                  ...styles.tab,
                  ...(String(v) === String(value) ? styles.tabActive : null)
                }}
              >
                {String(v)}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div style={styles.body}>{children(groupRows)}</div>
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
    borderBottom: `1px solid ${UI.border}`,
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
  tab: {
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 12,
    padding: '2px 10px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  tabActive: { background: UI.accent, color: UI.accentText, borderColor: UI.accent },
  body: { flex: 1, minHeight: 0 }
}
