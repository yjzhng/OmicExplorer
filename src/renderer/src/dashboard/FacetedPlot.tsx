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

import {
  quantityOnScale,
  contextOf,
  facetDims,
  rowsOfContexts,
  rowsOfFeatureNamed,
  rowsOfKind,
  type ConditionKey,
  type ContextRow,
  type ContrastResultRow,
  type NumericConds,
  type ValueScale
} from '../engine'
import { UI } from '../ui/theme'
import { ChoiceSwitch, PILL_CAP } from '../ui/ChoiceSwitch'
import { facetBarLabel, facetChoice, isNumericFacet, pickFacet, resolveFacets } from './facet'
import { PlotScopeContext } from '../ui/plotly/selectRegion'
import { plotCached } from '../ui/plotCache'

/** A result to facet without building all of its rows: the facets resolve over its context tuples
 *  (contextIndex.ts) and only the facet on show is built. The options narrow it as the readers of
 *  whole row arrays did — plain values, so the facet's rows stay the same array render to render. */
export interface FacetSource<T extends ContextRow> {
  /** the result holding the rows (`r.cmp`, `r.ctr`) */
  of: { rows: readonly T[] }
  /** a two-way ANOVA's kind of row on show (rowsOfKind) */
  show?: string
  /** a contrast's feature on show, by its switcher label (rowsOfFeatureNamed); null = its first */
  feature?: string | null
  /** an abundance contrast's plot scale (quantityOnScale) */
  scale?: ValueScale
}

export function FacetedPlot<T extends ContextRow>({
  rows: given,
  numeric,
  exclude,
  together,
  children,
  facetSel
}: {
  /** the rows to facet, or a result to facet without building its rows (FacetSource) */
  rows: T[] | FacetSource<T>
  /** the dataset's numeric conditions (numericOfResult of the upstream): their levels are ordered */
  numeric: NumericConds
  exclude?: ConditionKey[]
  /** the comparisons are drawn together by the plot (one series each, in its legend), not a facet
   *  to switch between — e.g. a Contrast's two sides' curves */
  together?: boolean
  /** the facet on show: its rows, and its key (FacetGroup key, '' unfaceted) — what a plot's run
   *  keys its per-facet results by */
  children: (contextRows: T[], facetKey: string) => ReactNode
  /** when set, the selection is driven externally — the shared results-header control, or
   *  batch export forcing one facet per file — so this plot renders no tabs of its own.
   *  Undefined = standalone, with its own interactive tabs. */
  facetSel?: Record<string, string>
}) {
  const src = Array.isArray(given) ? null : given
  const of = src?.of
  const show = src?.show
  const feature = src?.feature
  const scale = src?.scale
  const ix = useMemo(() => (of ? contextOf(of) : null), [of])
  // what the facets resolve over: the rows, or the result's context tuples narrowed as asked
  const rows = useMemo((): ContextRow[] => {
    if (!ix) return given as T[]
    let ctx = ix.rows
    if (show !== undefined) ctx = rowsOfKind(ctx, show)
    if (feature !== undefined)
      ctx = rowsOfFeatureNamed(ctx as ContrastResultRow[], feature ?? undefined)
    return ctx
  }, [ix, given, show, feature])
  /** The rows behind some of `rows`: themselves, or the result's rows built for those tuples. */
  const realise = (ctx: ContextRow[]): T[] => {
    if (!of || !ix) return ctx as T[]
    const built = rowsOfContexts(of, ix, ctx)
    return (scale ? quantityOnScale(built as unknown as ContrastResultRow[], scale) : built) as T[]
  }
  const dims = useMemo(
    () => facetDims(rows, exclude).filter((d) => !(together && d === 'comparison')),
    [rows, exclude, together]
  )
  const [selState, setSel] = useState<Record<string, string>>({})
  const sel = facetSel ?? selState
  const {
    bars,
    rows: groupCtx,
    key: facetKey
  } = useMemo(() => resolveFacets(rows, dims, sel, numeric), [rows, dims, sel, numeric])
  // the facet on show's rows (every row when unfaceted) — the only ones built from a source, and
  // kept app-wide by the result and the facet (ui/plotCache): the same array when the facet, or
  // the plot, comes back, so its plot data is taken from the cache too rather than built again
  const groupRows = useMemo(
    () => {
      const ctx = dims.length === 0 ? rows : groupCtx
      if (!of) return realise(ctx)
      const facet = dims.length === 0 ? '' : facetKey
      return plotCached('facetRows', [of, scale, show, feature, dims.join(','), facet], () =>
        realise(ctx)
      )
    },
    // realise reads of / ix / scale, all listed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [of, ix, scale, rows, groupCtx, dims, facetKey, show, feature]
  )

  // The facet on show scopes the plot's box / lasso regions: a new pick clears them.
  const scoped = (
    <PlotScopeContext.Provider value={facetKey}>
      {children(groupRows, dims.length === 0 ? '' : facetKey)}
    </PlotScopeContext.Provider>
  )
  if (dims.length === 0) return <div style={styles.single}>{scoped}</div>

  // Shared/forced selection: a global control (or export) owns it, so just render the
  // resolved facet — no tabs here.
  if (facetSel) return <div style={styles.single}>{scoped}</div>

  return (
    <div style={styles.root}>
      <div className="oe-switch-strip" style={styles.bars}>
        {bars.map((bar) => {
          const { dim, value, options } = bar
          return (
            <div key={dim} style={styles.bar}>
              <span style={styles.barLabel}>{facetBarLabel(bar)}</span>
              {/* The plot tiles' switch (as in SwitchBar). A one-sided contrast level (outer-join
                rows with nothing to pair), or one not measured alongside the picks to its left, is
                greyed, not selectable — the tooltip says why. Past PILL_CAP levels of a categorical condition, a searchable
                dropdown. */}
              <ChoiceSwitch
                size="sm"
                cap={isNumericFacet(dim, numeric) ? Infinity : PILL_CAP}
                fit
                counter
                label={facetBarLabel(bar)}
                value={String(value)}
                options={options.map((o) => facetChoice(dim, o, bars))}
                onChange={(v) => setSel((s) => pickFacet(rows, dims, s, dim, v, numeric))}
              />
            </div>
          )
        })}
      </div>
      <div style={styles.body}>{scoped}</div>
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
  // Never wider than the strip: it shrinks to the room and the pills wrap (as SwitchBar's).
  bar: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 1 auto',
    minWidth: 0,
    maxWidth: '100%'
  },
  barLabel: {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  body: { flex: 1, minHeight: 0 }
}
