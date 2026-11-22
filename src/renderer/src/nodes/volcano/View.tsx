import type { ReactNode } from 'react'
import { FacetedPlot } from '../../dashboard/FacetedPlot'
import {
  type CompareResultRow,
  DEFAULT_THRESHOLD,
  buildVolcano,
  nestedCol,
  nestedPresent,
  rowView
} from '../../engine'
import { useGraph } from '../../graph/store'
import {
  type CompareConfig,
  type VolcanoConfig,
  effectLabelsOf,
  labelCapOn,
  normalizeCompareConfig
} from '../../graph/types'
import { Built, Empty } from '../kit/views/common'
import { type ViewContext } from '../kit/views/context'
import { curvePointCounts, facetAlpha } from '../kit/views/helpers'
import { styles } from '../kit/views/styles'
import { VolcanoView } from './VolcanoView'

/** Where SAM's permutation FDR put the cutoff on |d| for the comparison a facet shows: the
 *  smallest |d| it called (from every gene, not just a selection on show), and the pooled t's
 *  usual degrees of freedom there — what the volcano needs to draw the boundary. Read off the
 *  result's columns (no row built) and cached per result, facet and cutoff, so each render hands
 *  the volcano the same object. */
export const samCuts = new WeakMap<object, Map<string, { c: number; df: number } | undefined>>()
export function samCutoff(
  all: { rows: readonly CompareResultRow[] },
  facet: CompareResultRow[],
  statMin: number
): { c: number; df: number } | undefined {
  const key = (vals: unknown[]): string => vals.join('|')
  const keyOf = (r: CompareResultRow): string =>
    key([r.comparison, r.cell, r.cmpd, r.dose, r.time, JSON.stringify(r.extra ?? {})])
  const keys = new Set(facet.map(keyOf))
  let m = samCuts.get(all)
  if (!m) samCuts.set(all, (m = new Map()))
  const ck = `${statMin}\u0000${[...keys].sort().join('\u0001')}`
  if (m.has(ck)) return m.get(ck)
  const v = rowView(all)
  const ctx = (['comparison', 'cell', 'cmpd', 'dose', 'time'] as const).map((k) => v.col(k))
  const extra = v.col('extra')
  const pQ = v.col('pQ')
  const has = nestedPresent(all, 'sam')
  const sd = nestedCol(all, 'sam', 'd')
  const sdf = nestedCol(all, 'sam', 'df')
  let c = Infinity
  const dfs = new Map<number, number>()
  for (let i = 0; i < v.n; i++) {
    if (!has(i)) continue
    if (!keys.has(key([...ctx.map((col) => col(i)), JSON.stringify(extra(i) ?? {})]))) continue
    const df = sdf(i) as number
    dfs.set(df, (dfs.get(df) ?? 0) + 1)
    if (((pQ(i) as number | null | undefined) ?? -Infinity) >= statMin)
      c = Math.min(c, Math.abs(sd(i) as number))
  }
  let df = 0
  let most = 0
  for (const [d, n] of dfs) if (n > most) [df, most] = [d, n]
  const out = Number.isFinite(c) && df > 0 ? { c, df } : undefined
  m.set(ck, out)
  return out
}
/** The volcano result body (nodes/views.ts). Plain render function: it runs inside
 *  PanelBody, so it must not call hooks — derive what needs a hook in usePlotContext. */
export function volcanoView(v: ViewContext): ReactNode {
  const { upstream, cfgSource, upStep, numeric, subSource, facetSel, effectsOf, upId } = v
  if (upstream?.kind !== 'compare')
    return <Empty text="Connect a Compare or Curve fit tile and run it." />
  const cfg = cfgSource as VolcanoConfig
  const dm = upstream.displayMap
  // The guide geometry (linear lines vs SAM curve) comes from the threshold the RESULT's calls
  // were made with — carried on the result itself — so the drawn boundary can never disagree
  // with the colours, even while the Compare config has moved on (an FDR-method change awaiting
  // a re-run). The node config is only the fallback for a result saved before it carried one.
  const upCfg = upStep ? normalizeCompareConfig(upStep.data.config as CompareConfig) : undefined
  const threshold = upstream.cmp.threshold ?? upCfg?.threshold ?? DEFAULT_THRESHOLD
  return (
    <div style={styles.chart}>
      <FacetedPlot numeric={numeric} rows={subSource(upstream.cmp)} facetSel={facetSel}>
        {(rows) => (
          <Built
            build={() =>
              buildVolcano(rows, {
                statType: threshold.statType,
                fcLow: threshold.fcLow,
                fcHigh: threshold.fcHigh,
                statMin: threshold.statMin,
                displayMap: dm
              })
            }
            deps={[
              rows,
              threshold.statType,
              threshold.fcLow,
              threshold.fcHigh,
              threshold.statMin,
              dm
            ]}
          >
            {(volcano) =>
              volcano.points.length === 0 && rows.length > 0 ? (
                <Empty text={untestedNote(upstream.cmp, rows, threshold.statType)} />
              ) : (
                <VolcanoView
                  volcano={volcano}
                  threshold={threshold}
                  curveNs={curvePointCounts(rows)}
                  samCut={
                    threshold.type === 'sam_fdr'
                      ? samCutoff(upstream.cmp, rows, threshold.statMin)
                      : undefined
                  }
                  ccAlpha={
                    threshold.type === 'curvecurator' && threshold.ccCallBy === 'fdr'
                      ? facetAlpha(upstream.cmp.ccAlpha, rows)
                      : undefined
                  }
                  effectLabels={effectLabelsOf(upCfg)}
                  effectColors={effectsOf(cfg)}
                  labelTop={labelCapOn(cfg) ? cfg.labelTop : 0}
                  style={cfg.style}
                  // Dragging a guide live-rethresholds the upstream Compare (re-classifies genes).
                  onThresholdChange={
                    upId
                      ? (partial) => useGraph.getState().setCompareThreshold(upId, partial)
                      : undefined
                  }
                />
              )
            }
          </Built>
        )}
      </FacetedPlot>
    </div>
  )

  return <Empty text="No output." />
}
/** Why a volcano has nothing to draw: its genes carry a fold change but no p-value — a side with
 *  one replicate can't be tested, or (both sides replicated) the t-test blocks on Clean data's
 *  batches and the two sides share none, so the comparison can't be told from the batch — and, of
 *  the whole Compare, the compounds that were tested (where to look instead). */
export function untestedNote(
  all: { rows: readonly CompareResultRow[] },
  shown: CompareResultRow[],
  stat: 'pP' | 'pQ'
): string {
  const word = stat === 'pQ' ? 'q' : 'p'
  const spread = (v: number | null | undefined): boolean => v != null && Number.isFinite(v)
  // a replicate SD on both sides: the test had replicates, so the batches stopped it
  if (shown.some((r) => spread(r.sd1) && spread(r.sd2)))
    return (
      `No ${word}-values here: both sides have replicates, but the t-test blocks on Clean data's ` +
      `batches, and here the two sides are never in the same batch (or too few samples are left ` +
      `once each batch is allowed for), so the comparison can't be told apart from the batch. Put ` +
      `samples of both sides in a shared batch, or clear the batches in Clean data for an ` +
      `unblocked t-test.`
    )
  // the compounds of the tested rows, read off the columns (no row built)
  const view = rowView(all)
  const p = view.col(stat)
  const cmpd = view.col('cmpd')
  const seen = new Set<unknown>()
  for (let i = 0; i < view.n; i++) {
    const v = p(i)
    const c = cmpd(i)
    if (v != null && Number.isFinite(v) && c) seen.add(c)
  }
  const cmpds = [...seen] as string[]
  const where = !cmpds.length
    ? ' No comparison in this Compare has one.'
    : ` Tested: ${cmpds.length > 6 ? `${cmpds.slice(0, 6).join(', ')} and ${cmpds.length - 6} more` : cmpds.join(', ')}.`
  return (
    `No ${word}-values here: these ${shown.length.toLocaleString()} genes have a ` +
    `fold change only — a side with one replicate can't be tested.${where}`
  )
}
