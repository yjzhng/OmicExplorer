/** Contrast-input helpers shared by the run path (store), the selector window, and the canvas. */
import {
  VALID_CONDITIONS,
  type ConditionKey,
  type ContrastSideRow,
  type StandardRow
} from '../engine'
import { resolveContrastSource, type ContrastConfig, type NodeResult } from './types'

/** A result as one side of a paired contrast: Compare → log2FC (+ significance); Standardize →
 *  per-sample log10 abundance (the engine averages replicates + unmatched dims to the matched
 *  context). Anything else can't be a side. */
export function toContrastSide(r: NodeResult | undefined): ContrastSideRow[] {
  if (r?.kind === 'compare')
    return r.cmp.rows.map((row) => ({
      uniqID: row.uniqID,
      cell: row.cell ?? null,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      value: row.log2FC,
      signf: row.signf,
      effect: row.effect,
      pP: row.pP,
      pQ: row.pQ,
      se: row.fcSE ?? null
    }))
  if (r?.kind === 'standardize')
    return r.std.rows.map((row) => ({
      uniqID: row.uniqID,
      cell: row.cell,
      cmpd: row.cmpd,
      dose: row.dose,
      time: row.time,
      value: row.value != null && row.value > 0 ? Math.log10(row.value) : null
    }))
  return []
}

/** Can this result be a side of a paired contrast? */
export const isPairable = (r: NodeResult | undefined): boolean =>
  r?.kind === 'compare' || r?.kind === 'standardize'

/** Which two of the wired inputs form dataset A (y) and B (x): the configured pick when both are
 *  still wired, else the first two edges in order. */
export function pairSides(cfg: ContrastConfig, upstreamIds: string[]): [string, string] | null {
  if (upstreamIds.length < 2) return null
  const a = cfg.pairA && upstreamIds.includes(cfg.pairA) ? cfg.pairA : undefined
  const b = cfg.pairB && upstreamIds.includes(cfg.pairB) && cfg.pairB !== a ? cfg.pairB : undefined
  const rest = upstreamIds.filter((u) => u !== a && u !== b)
  return [a ?? rest.shift()!, b ?? rest.shift()!]
}

/** Intra-dataset mode: which wired input the two groups are selected from — the configured pick
 *  while still wired, else the first edge. */
export function selectSource(cfg: ContrastConfig, upstreamIds: string[]): string | undefined {
  if (cfg.selectFrom && upstreamIds.includes(cfg.selectFrom)) return cfg.selectFrom
  return upstreamIds[0]
}

/** The wired inputs the tile actually consumes in its current mode — the rest are wired but idle
 *  (drawn dashed on the canvas). */
export function usedInputs(cfg: ContrastConfig, upstreamIds: string[]): Set<string> {
  if (resolveContrastSource(cfg, upstreamIds.length) === 'pair') {
    const s = pairSides(cfg, upstreamIds)
    return new Set(s ?? [])
  }
  const one = selectSource(cfg, upstreamIds)
  return new Set(one ? [one] : [])
}

/** A result's rows in the shape the group selector reads (uniqID + conditions), plus which
 *  conditions carry values. Compare rows are one per gene × comparison context; Standardize rows
 *  one per gene × sample. */
export function selectorRowsOf(r: NodeResult | undefined): {
  rows: StandardRow[]
  present: ConditionKey[]
} {
  const raw: Array<Record<string, unknown>> =
    r?.kind === 'compare'
      ? r.cmp.rows.map((x) => ({
          uniqID: x.uniqID,
          cell: x.cell ?? '',
          cmpd: x.cmpd,
          dose: x.dose,
          time: x.time
        }))
      : r?.kind === 'standardize'
        ? r.std.rows.map((x) => ({
            uniqID: x.uniqID,
            cell: x.cell,
            cmpd: x.cmpd,
            dose: x.dose,
            time: x.time
          }))
        : []
  const present = VALID_CONDITIONS.filter((c) => raw.some((row) => row[c] !== '' && row[c] != null))
  return { rows: raw as unknown as StandardRow[], present }
}
