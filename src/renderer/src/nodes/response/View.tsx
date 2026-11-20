import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import { GeneSwitch } from '../../dashboard/GeneSwitch'
import { SwitchBar } from '../../dashboard/SwitchBar'
import {
  type CompareResultRow,
  condLabel,
  distinctOf,
  holderWhereNested,
  someNested
} from '../../engine'
import { firstRow, rowCount } from '../../engine/lazyRows'
import { quickOn } from '../../graph/registry'
import {
  type ResponseConfig,
  CURVE_OF_SLICE,
  SLICE_OF_CURVE,
  axisTitle,
  responseDim,
  responseLook,
  responseShow,
  responseShowWhy,
  responseSlice,
  responseSliceable
} from '../../graph/types'
import { Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { pagerGenes } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { ResponseSurfaceView } from './ResponseSurfaceView'

/** The value range the genes' surfaces span in a facet (their level means), padded — the curve-fit
 *  Response plot's global scale: every gene's, or only the selected ones' while any are selected
 *  (`only`, the genes the pager steps through). Cached per Compare result (`all`), facet and
 *  selection, so the same range object comes back each render and the plot
 *  doesn't redraw for it. */
export const surfaceRanges = new WeakMap<object, Map<string, [number, number] | undefined>>()
export function surfaceValueRange(
  all: object,
  facetKey: string,
  rows: CompareResultRow[],
  only?: readonly string[]
): [number, number] | undefined {
  let byFacet = surfaceRanges.get(all)
  if (!byFacet) surfaceRanges.set(all, (byFacet = new Map()))
  const key = only ? `${facetKey}\u0002${[...only].sort().join('\u0001')}` : facetKey
  if (byFacet.has(key)) return byFacet.get(key)
  const keep = only ? new Set(only) : null
  let lo = Infinity
  let hi = -Infinity
  for (const r of rows) {
    if (keep && !keep.has(r.uniqID)) continue
    for (const c of r.rs?.cells ?? [])
      if (Number.isFinite(c.y)) {
        if (c.y < lo) lo = c.y
        if (c.y > hi) hi = c.y
      }
  }
  // padded more than the measured plot's: a description's curve can run a little past its means
  const pad = (hi - lo) * 0.08 || 0.1
  const range: [number, number] | undefined = lo <= hi ? [lo - pad, hi + pad] : undefined
  byFacet.set(key, range)
  return range
}
/** The largest shift from the reference curve the genes' surfaces show in a facet — surfaces
 *  tested for response changes, coloured by it (see ResponseSurfaceView) — padded: their colour
 *  scale under the global scale, as surfaceValueRange is the values'. A cell's shift is its mean
 *  less the reference curve's at its response level: the compared axis's base level (dose 0) there,
 *  or the position itself (the reference's first point: 0). Cached alike. */
export const shiftRanges = new WeakMap<object, Map<string, number | undefined>>()
export function surfaceShiftRange(
  all: object,
  facetKey: string,
  rows: CompareResultRow[],
  only?: readonly string[]
): number | undefined {
  let byFacet = shiftRanges.get(all)
  if (!byFacet) shiftRanges.set(all, (byFacet = new Map()))
  const key = only ? `${facetKey}\u0002${[...only].sort().join('\u0001')}` : facetKey
  if (byFacet.has(key)) return byFacet.get(key)
  const keep = only ? new Set(only) : null
  let m = 0
  for (const r of rows) {
    const rs = r.rs
    if (!rs?.shift || (keep && !keep.has(r.uniqID))) continue
    const cells = rs.cells ?? []
    if (!cells.length) continue
    // the curves along the second axis (compared across the first), or the reverse
    const alongB = rs.shift.response === (rs.pair?.[1] ?? 'time')
    // the reference slice: the compared axis's control level as the Curve fit set it (else lowest)
    const ctl = alongB ? rs.maps?.[0]?.base : rs.maps?.[1]?.base
    const base = cells.some((c) => (alongB ? c.dose : c.time) === ctl)
      ? ctl!
      : Math.min(...cells.map((c) => (alongB ? c.dose : c.time)))
    const pos = alongB ? (rs.maps?.[1]?.base ?? 0) : (rs.maps?.[0]?.base ?? 0)
    const ref = new Map(
      cells
        .filter((c) => (alongB ? c.dose : c.time) === base)
        .map((c) => [alongB ? c.time : c.dose, c.y])
    )
    for (const c of cells) {
      const level = alongB ? c.time : c.dose
      const r0 = ref.get(level) ?? (level === pos ? 0 : undefined)
      if (r0 != null && Number.isFinite(c.y)) m = Math.max(m, Math.abs(c.y - r0))
    }
  }
  const range = m > 0 ? m * 1.08 : undefined
  byFacet.set(key, range)
  return range
}
/** The distinct surface descriptions (each `rs.surface`'s method, or none) among a Compare's
 *  rows, as rows the response helpers (responseSliceable / responseSlice) read — the same answers
 *  as over every row, read off the nested column. Cached per result. */
export const surfaceMethods = new WeakMap<
  object,
  Array<{ rs: { surface?: { method?: string } } }>
>()
export function surfaceMethodsOf(cmp: {
  rows: readonly CompareResultRow[]
}): Array<{ rs: { surface?: { method?: string } } }> {
  let out = surfaceMethods.get(cmp)
  if (!out) {
    const at = new Map<string, { rs: { surface?: { method?: string } } }>()
    someNested(cmp, 'rs', 'surface', (_, v) => {
      const sf = v as { method?: string } | null | undefined
      const k = sf ? `m¦${sf.method}` : ''
      if (!at.has(k)) at.set(k, { rs: { surface: sf ? { method: sf.method } : undefined } })
      return false
    })
    surfaceMethods.set(cmp, (out = [...at.values()]))
  }
  return out
}
/** The response result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function responseView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, genes, patchConfig, numeric, facetSel, responseRoles, units } = v
  if (upstream?.kind !== 'compare') return <Empty text="Connect a Curve fit tile and run it." />
  const cfg = cfgSource as ResponseConfig
  const dim = responseDim(cfg)
  const show = responseShow(cfg)
  const look = responseLook(cfg)
  // A Curve fit over two conditions: one surface per gene × compound, over its pair (dose × time
  // unless it says otherwise).
  const surfaces = holderWhereNested(
    upstream.cmp,
    'surfaces',
    [['rs', 'axis']],
    (_, v) => v[0] === 'surface'
  )
  if (!rowCount(surfaces))
    return <Empty text="Needs surfaces — set the Curve fit’s axis to a pair (e.g. dose × time)." />
  const [sa, sb] = firstRow(surfaces)?.rs?.pair ?? (['dose', 'time'] as const)
  const present = new Set(distinctOf(surfaces, 'uniqID') as ReadonlySet<string>)
  // The view by time or by dose slices (see responseSliceable / responseSlice).
  const methods = surfaceMethodsOf(surfaces)
  const sliceable = responseSliceable(dim, show, methods)
  const slice = responseSlice(cfg, methods)
  const projection = cfg.projection ?? 'orthographic'
  const yScale = cfg.yScale ?? 'gene'
  // A global scale spans the genes on show: the selected ones while any are selected, else all.
  const scaleGenes = genes.some((id) => present.has(id)) ? genes : undefined
  return (
    <div style={styles.chart}>
      <div style={styles.stack}>
        <div style={styles.stackBody}>
          {/* One gene at a time — every gene, or the selected ones while any are selected. */}
          <GeneSwitch
            genes={pagerGenes(genes, present)}
            present={present}
            displayMap={upstream.displayMap}
            // The view / show / lines / scale switches on the gene switcher's row, before the
            // gene — one strip, wrapping only as the tile's width needs.
            controls={
              <>
                {quickOn(cfg, 'dim') && (
                  <SwitchBar
                    inline
                    label="view"
                    value={dim}
                    options={['2d', '3d']}
                    optionLabel={(o) => o.toUpperCase()}
                    onChange={(v) => patchConfig({ dim: v })}
                  />
                )}
                {quickOn(cfg, 'show') && (
                  <SwitchBar
                    inline
                    label="show"
                    value={show}
                    options={['line', 'surface', 'heatmap']}
                    optionDisabled={(o) => responseShowWhy(dim, o)}
                    onChange={(v) => patchConfig({ show: v })}
                  />
                )}
                {sliceable && quickOn(cfg, 'slice') && (
                  <SwitchBar
                    inline
                    label="curve"
                    value={CURVE_OF_SLICE[slice]}
                    options={['dose', 'time']}
                    optionLabel={(o) => condLabel(o === 'dose' ? sa : sb)}
                    onChange={(v) => patchConfig({ slice: SLICE_OF_CURVE[v as 'dose' | 'time'] })}
                  />
                )}
                {dim === '3d' && quickOn(cfg, 'projection', 'response') && (
                  <SwitchBar
                    inline
                    label="projection"
                    value={projection}
                    options={['orthographic', 'perspective']}
                    onChange={(v) => patchConfig({ projection: v })}
                  />
                )}
                {quickOn(cfg, 'yScale') && (
                  <SwitchBar
                    inline
                    label="scale"
                    value={yScale}
                    options={['gene', 'global']}
                    optionLabel={(o) => (o === 'gene' ? 'adjusted' : 'global')}
                    onChange={(v) => patchConfig({ yScale: v })}
                  />
                )}
              </>
            }
          >
            {(gene) => (
              <FacetedPlot numeric={numeric} rows={{ of: surfaces }} facetSel={facetSel}>
                {(rows, facetKey) => (
                  <ResponseSurfaceView
                    row={rows.find((r) => r.uniqID === gene)}
                    dim={dim}
                    show={show}
                    look={look}
                    rolePalettes={responseRoles}
                    slice={slice}
                    projection={projection}
                    valueRange={
                      yScale === 'global'
                        ? surfaceValueRange(upstream.cmp, facetKey, rows, scaleGenes)
                        : undefined
                    }
                    shiftRange={
                      yScale === 'global'
                        ? surfaceShiftRange(upstream.cmp, facetKey, rows, scaleGenes)
                        : undefined
                    }
                    doseLabel={axisTitle(sa, units)}
                    timeLabel={axisTitle(sb, units)}
                    xRole={sa === 'time' ? 'time' : 'dose'}
                    yRole={sb === 'time' ? 'time' : 'dose'}
                  />
                )}
              </FacetedPlot>
            )}
          </GeneSwitch>
        </div>
      </div>
    </div>
  )

  return <Empty text="No output." />
}
