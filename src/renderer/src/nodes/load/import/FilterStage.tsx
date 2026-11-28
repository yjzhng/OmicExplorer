/** The import's Filtering stage: one card per filter column, its kept values or range. */
import { type ReactNode, useMemo } from 'react'
import {
  columnFacet,
  type ColumnFacet,
  filterOn,
  type FilterSpec,
  filterStep,
  stepBy
} from '../../../engine'
import { NumberInput } from '../../../ui/controls/NumberInput'
import { ValueMultiSelect } from '../../../ui/controls/ValueMultiSelect'
import { ScrollFade } from '../../../ui/table/ScrollFade'
import { longestText } from '../../../ui/table/useVirtualRows'
import { ProbeRow, VirtualTbody } from '../../../ui/table/VirtualRows'
import { InfoTip } from '../../../ui/controls/InfoTip'
import { ROLE_COLORS } from './roles'
import { styles } from './styles'

/** Stage 2 (Filtering): one card per `filter`-role column. A categorical column picks its kept
 *  values from a floating multiselect dropdown; a numeric column offers a min/max range.
 *  Rows failing any active filter are dropped on convert. Only shown when ≥1 filter column. */
export function FilterStage({
  filterCols,
  allRows,
  filters,
  setFilters,
  columns
}: {
  filterCols: string[]
  allRows: Record<string, string>[]
  filters: Record<string, FilterSpec>
  setFilters: (next: Record<string, FilterSpec>) => void
  columns: string[]
}): ReactNode {
  const colKey = filterCols.join(' ')
  // Filter edits sync live: every control writes straight to the import config, and the stats +
  // data table below recompute immediately.
  const setFilter = (col: string, spec: FilterSpec): void => setFilters({ ...filters, [col]: spec })
  // The per-tile checkbox: activate/deactivate a column's filter (keeping any edited values).
  const setActive = (col: string, on: boolean): void =>
    setFilters({ ...filters, [col]: { ...(filters[col] ?? {}), active: on } })
  // Distinct-value / numeric-range facet per filter column, computed over ALL rows once.
  const facets = useMemo(() => {
    const m: Record<string, ColumnFacet> = {}
    for (const c of filterCols) m[c] = columnFacet(allRows, c)
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey, allRows])
  const total = allRows.length
  // One pass over every row: the DROPPED rows, then the kept ones, for the table below (so the user
  // can see exactly what a filter is removing) — all of them, windowed (ui/table/VirtualRows).
  const { kept, removedTotal, displayRows } = useMemo(() => {
    const active = filterCols
      .filter((c) => filters[c] && filterOn(filters[c]))
      .map((c) => ({ col: c, drop: new Set(filters[c].drop ?? []), spec: filters[c] }))
    let keptN = 0
    let removedN = 0
    // Removed rows first (shown on top, red), then kept.
    const removedRows: Record<string, string>[] = []
    const keptRows: Record<string, string>[] = []
    for (const r of allRows) {
      let ok = true
      for (const { col, drop, spec } of active) {
        const raw = (r[col] ?? '').trim()
        if (drop.size > 0 && drop.has(raw)) {
          ok = false
          break
        }
        if (spec.min != null || spec.max != null) {
          const x = Number(raw)
          if (
            !Number.isFinite(x) ||
            (spec.min != null && x < spec.min) ||
            (spec.max != null && x > spec.max)
          ) {
            ok = false
            break
          }
        }
      }
      if (ok) {
        keptN++
        keptRows.push(r)
      } else {
        removedN++
        removedRows.push(r)
      }
    }
    const displayRows = [
      ...removedRows.map((r) => ({ r, removed: true })),
      ...keptRows.map((r) => ({ r, removed: false }))
    ]
    return { kept: keptN, removedTotal: removedN, displayRows }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colKey, filters, allRows, total])

  const pct = total > 0 ? Math.round((kept / total) * 1000) / 10 : 0
  // Filter columns first (leftmost) so the values driving each drop are easy to scan, then the
  // rest of the matrix columns in their original order.
  const filterSet = new Set(filterCols)
  const orderedCols = [...filterCols, ...columns.filter((c) => !filterSet.has(c))]
  // Each column's widest value (from a sample), so the columns fit every row, not just those drawn.
  const orderKey = orderedCols.join('\u0000')
  const widest = useMemo(
    () => orderedCols.map((c) => longestText(allRows.length, (i) => allRows[i][c] ?? '')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderKey, allRows]
  )
  const numColor = ROLE_COLORS.filter!
  return (
    <>
      {/* A heading, as the other sections have; how filtering works is in its (i). */}
      <div style={{ ...styles.tableTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
        Filtering conditions
        <InfoTip label="How filtering works">
          These columns filter which feature rows are kept. Uncheck values to drop them, or set a
          numeric range — rows matching <b>all</b> filters are written; the rest are dropped.
        </InfoTip>
      </div>
      {/* The filters (and the row count) take what they need, up to what leaves the preview its
          room — scrolling themselves past that; the preview table fills the rest, as every other
          step's table fills its pane. */}
      <div style={styles.filterList}>
        {filterCols.map((col) => {
          const facet = facets[col]
          const spec = filters[col]
          if (!facet) return null
          const isActive = filterOn(spec)
          const dropSet = new Set(spec?.drop ?? [])
          return (
            <div
              key={col}
              style={
                isActive ? styles.filterCard : { ...styles.filterCard, ...styles.filterCardOff }
              }
            >
              {/* Checkbox at the far left turns the filter active; label next; controls at the right. */}
              <div style={styles.filterHead}>
                <input
                  type="checkbox"
                  checked={isActive}
                  title={
                    isActive
                      ? 'Active — uncheck to ignore this filter'
                      : 'Inactive — check to enable'
                  }
                  onChange={(e) => setActive(col, e.target.checked)}
                />
                <span style={{ ...styles.chipDot, background: numColor }} />
                <span style={{ ...styles.filterName, ...(isActive ? null : styles.offText) }}>
                  {col}
                </span>
                <span style={styles.filterMeta}>
                  {facet.numeric
                    ? `numeric · ${facet.min}–${facet.max}`
                    : `${facet.values.length}${facet.truncated ? '+' : ''} value${facet.values.length === 1 ? '' : 's'}`}
                </span>
                <div
                  style={{ ...styles.filterControls, ...(isActive ? null : styles.controlsOff) }}
                  aria-disabled={!isActive}
                >
                  {facet.numeric ? (
                    <>
                      <BoundInput
                        label="min"
                        value={spec?.min ?? null}
                        from={facet.min}
                        step={filterStep(facet.min, facet.max, facet.whole)}
                        disabled={!isActive}
                        onChange={(v) => setFilter(col, { ...spec, active: true, min: v })}
                      />
                      <BoundInput
                        label="max"
                        value={spec?.max ?? null}
                        from={facet.max}
                        step={filterStep(facet.min, facet.max, facet.whole)}
                        disabled={!isActive}
                        onChange={(v) => setFilter(col, { ...spec, active: true, max: v })}
                      />
                    </>
                  ) : (
                    // Categorical values are chosen from a floating multiselect dropdown.
                    // The app's searchable multi-select (ui/controls/ValueMultiSelect): the values kept.
                    <ValueMultiSelect
                      members
                      values={facet.values}
                      selected={facet.values.filter((v) => !dropSet.has(v))}
                      disabled={!isActive}
                      noun="value"
                      onChange={(next) => {
                        const keep = new Set(next)
                        const drop = facet.values.filter((v) => !keep.has(v))
                        setFilter(
                          col,
                          drop.length ? { ...spec, active: true, drop } : { active: true }
                        )
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Row stats, below the filter sections. */}
        <div style={styles.filterStats}>
          Removing <b style={styles.removingNum}>{removedTotal.toLocaleString()}</b> rows. Keeping{' '}
          <b>{kept.toLocaleString()}</b> of {total.toLocaleString()} rows ({pct}%).
        </div>
      </div>

      {/* Full data below: removed rows on top (red), then the kept rows — every one, windowed. */}
      <div style={styles.filterPreview}>
        <ScrollFade>
          <table style={{ ...styles.grid, tableLayout: 'auto' }}>
            <thead>
              <tr>
                {orderedCols.map((c) => (
                  <th
                    key={c}
                    style={filterSet.has(c) ? { ...styles.th, color: numColor } : styles.th}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <VirtualTbody
              count={displayRows.length}
              span={orderedCols.length}
              tail={<ProbeRow texts={widest} cellStyle={{ ...styles.td, ...styles.sampleCell }} />}
              row={(i) => {
                const { r, removed } = displayRows[i]
                return (
                  <tr key={i} style={removed ? styles.removedRow : undefined}>
                    {orderedCols.map((c) => (
                      <td key={c} style={{ ...styles.td, ...styles.sampleCell }} title={r[c]}>
                        {r[c] ?? ''}
                      </td>
                    ))}
                  </tr>
                )
              }}
            />
          </table>
        </ScrollFade>
      </div>
    </>
  )
}

/** A numeric filter's min or max: typed, or stepped by its ▲ ▼ (or the arrow keys) by a step
 *  sized to the column's range, starting from the column's own min / max when blank. The
 *  browser's spinner is hidden (oe-num, as the config panels' boxes): its first click on a box
 *  without focus was often lost, and it stepped a 0–1 q-value by whole 1s. */
function BoundInput({
  label,
  value,
  from,
  step,
  disabled,
  onChange
}: {
  label: string
  value: number | null
  /** where a blank box starts stepping: the column's own min (or max) */
  from: number
  step: number
  disabled: boolean
  onChange: (v: number | null) => void
}): ReactNode {
  const move = (dir: number): void => onChange(stepBy(value ?? from, step, dir))
  const arrow = (dir: number): ReactNode => (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      aria-label={`${dir > 0 ? 'Raise' : 'Lower'} ${label} by ${step}`}
      // keep the focus where it is (a typed value isn't interrupted)
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => move(dir)}
      style={styles.stepBtn}
    >
      <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden>
        <path d={dir > 0 ? 'M0 5L4 0l4 5z' : 'M0 0l4 5 4-5z'} fill="currentColor" />
      </svg>
    </button>
  )
  return (
    <label style={styles.numLabel}>
      {label}
      <span style={styles.stepWrap}>
        <NumberInput
          optional
          style={styles.numInput}
          step={step}
          disabled={disabled}
          placeholder={String(from)}
          value={value}
          // the arrow keys step as the buttons do (from the column's own bound when blank)
          ladder={(v, dir) => stepBy(v, step, dir)}
          ladderFrom={from}
          onChange={(v) => onChange(v ?? null)}
        />
        <span style={styles.stepBtns}>
          {arrow(1)}
          {arrow(-1)}
        </span>
      </span>
    </label>
  )
}
