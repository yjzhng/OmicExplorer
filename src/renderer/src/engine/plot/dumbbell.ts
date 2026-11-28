/**
 * The dumbbell plot (contrast): each gene's two fold changes joined.
 * Plain data for the renderer to turn into Plotly traces (no Plotly dependency here).
 */
import type { ContrastResultRow } from '../compare/contrast'
import { pickTop, type TopSplitSpec } from '../stats/topPick'
import { geneLimit } from './dr'

// ── dumbbell (contrast) ──────────────────────────────────────────────────────────

export interface DumbbellRow {
  label: string
  uniqID: string
  fc1: number
  fc2: number
  signf: boolean
  effect: string
}
export interface DumbbellData {
  rows: DumbbellRow[]
  xLabel1: string
  xLabel2: string
  /** total genes available before the cap (for a "top N of M" note) */
  total: number
}
export interface DumbbellOptions {
  topGenes: number
  /** how the top-N splits between FCdiff up and down (see topPick; default proportional) */
  split?: TopSplitSpec
  displayMap?: Record<string, string>
  /** focus genes (uniqIDs): when non-empty, show exactly these genes instead of top-N */
  focus?: string[]
  /** linked-selection genes (uniqIDs) appended after the chosen set (hover/pin highlight) */
  extra?: string[]
  /** display order of the chosen genes: by the first side's value (fc1), the second's (fc2), both
   *  high → low, or by |FCdiff| (diff, the default). The top-N pick is always by |FCdiff|. */
  order?: DumbbellOrder
}
export type DumbbellOrder = 'fc1' | 'fc2' | 'diff'
/** The dumbbell's gene orders, for its switch bar and gear setting. */
export const DUMBBELL_ORDERS: readonly DumbbellOrder[] = ['fc1', 'fc2', 'diff']
/** An order's display name: a side's own name (the contrast's cmp1/cmp2), or "change". */
export function dumbbellOrderLabel(
  o: string,
  rows: readonly { cmp1?: string; cmp2?: string }[] | undefined
): string {
  if (o === 'fc1') return rows?.[0]?.cmp1 ?? 'side 1'
  if (o === 'fc2') return rows?.[0]?.cmp2 ?? 'side 2'
  return 'change'
}

/** Dumbbell: FC1 vs FC2 per gene as connected dots. Only SIGNIFICANT genes are shown (top-N by
 *  |FCdiff|); an explicit focus/GOI pick or a linked selection still surfaces any gene. */
/** buildDumbbell's part that reads every row — the valid rows in |FCdiff| order and the genes
 *  shown before any linked selection is added — kept apart, so a hover or a pin (which only
 *  appends genes) doesn't sort every row again (dumbbellWith). */
export interface DumbbellBase {
  valid: ContrastResultRow[]
  /** each valid row's position in `valid` */
  at: Map<string, number>
  base: ContrastResultRow[]
  baseIds: Set<string>
  sigCount: number
  xLabel1: string
  xLabel2: string
}

export function dumbbellBase(
  rows: ContrastResultRow[],
  opts: Omit<DumbbellOptions, 'extra'>
): DumbbellBase {
  const valid = rows.filter((r) => r.FC1 != null && r.FC2 != null)
  valid.sort((a, b) => Math.abs(b.FCdiff ?? 0) - Math.abs(a.FCdiff ?? 0))
  const sig = valid.filter((r) => r.signf)
  // the top-N by |FCdiff|, split by its direction as set; kept in the |FCdiff| order
  const pickRows = (list: ContrastResultRow[]): ContrastResultRow[] => {
    const cands = list.map((r) => ({ id: r.uniqID, signed: r.FCdiff ?? 0 }))
    const keep = new Set(
      opts.topGenes > 0
        ? pickTop(cands, opts.topGenes, opts.split)
        : pickTop(cands, geneLimit(0, list.length))
    )
    return list.filter((r) => keep.has(r.uniqID))
  }
  const focus = opts.focus ?? []
  const focusSet = new Set(focus)
  const base = focus.length > 0 ? valid.filter((r) => focusSet.has(r.uniqID)) : pickRows(sig) // significant only; unset ⇒ all (safety-capped)
  const at = new Map<string, number>()
  valid.forEach((r, i) => at.set(r.uniqID, i))
  return {
    valid,
    at,
    base,
    baseIds: new Set(base.map((r) => r.uniqID)),
    sigCount: sig.length,
    xLabel1: rows[0]?.cmp1 ?? 'FC1',
    xLabel2: rows[0]?.cmp2 ?? 'FC2'
  }
}

/** A dumbbell from its base, with the linked selection's genes (`extra`) appended. */
export function dumbbellWith(
  b: DumbbellBase,
  opts: Pick<DumbbellOptions, 'extra' | 'order' | 'displayMap'>
): DumbbellData {
  // Append linked-selection genes not already shown (hover/pin highlight), preserving the
  // |FCdiff| order, so a selected gene appears at the end of the list instead of replacing.
  const extraAt = [
    ...new Set((opts.extra ?? []).filter((id) => !b.baseIds.has(id) && b.at.has(id)))
  ]
    .map((id) => b.at.get(id)!)
    .sort((x, y) => x - y)
  // Order each part by the chosen side, high → low (stable, so ties keep the |FCdiff| order);
  // linked-selection genes stay at the end either way.
  const key = opts.order === 'fc1' ? 'FC1' : opts.order === 'fc2' ? 'FC2' : undefined
  const ordered = (list: ContrastResultRow[]): ContrastResultRow[] =>
    key ? [...list].sort((a, b) => (b[key] as number) - (a[key] as number)) : list
  const top = [...ordered(b.base), ...ordered(extraAt.map((i) => b.valid[i]))]
  return {
    rows: top.map((r) => ({
      label: opts.displayMap?.[r.uniqID] ?? r.uniqID,
      uniqID: r.uniqID,
      fc1: r.FC1 as number,
      fc2: r.FC2 as number,
      signf: r.signf,
      effect: r.effect
    })),
    xLabel1: b.xLabel1,
    xLabel2: b.xLabel2,
    total: b.sigCount
  }
}

export function buildDumbbell(rows: ContrastResultRow[], opts: DumbbellOptions): DumbbellData {
  return dumbbellWith(dumbbellBase(rows, opts), opts)
}
