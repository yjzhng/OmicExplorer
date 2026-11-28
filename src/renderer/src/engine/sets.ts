/**
 * Set comparison (the Set comparison plot): sets of genes or of enriched terms, their exclusive
 * intersections (an UpSet's columns, a Venn's regions), and an area-proportional Venn of two or
 * three of them.
 *
 * Every set is a SetDef — a key, a name, its members — whatever it was read from, so the plot's
 * drawing never asks where a set came from. Each upstream contract has its own reader:
 *
 *  - Clean data (quantity): the genes measured in each sample — a value, not imputed —
 *    (measuredSets, in the worker), grouped into a set per sample or per condition group
 *    (quantitySets), a gene in a group's set when measured in enough of its samples;
 *  - a Compare / Curve fit (comparison, curves): each facet's significant genes, up and down
 *    (callSets — the facets every faceted plot of it switches between);
 *  - its enrichment (the enrichment plot's run): each facet's significant terms (termSets).
 *
 * Gene sets the user saved join as sets of their own (the plot adds them; they're SetDefs too).
 */
import { condValue } from './compare'
import { distinctOf, facetGroupsOf, type FacetIndexGroup } from './contextIndex'
import { holderTable } from './lazyRows'
import { facetCompareRows, facetLabel, type ContextRow, type EnrichData } from './plotData'
import { sampleIndex } from './sampleIndex'
import { sampleLabel, sampleName } from './sampleLabel'
import {
  type ConditionKey,
  type CompareResultRow,
  type NumericConds,
  type StandardRow,
  VALID_CONDITIONS,
  customCond,
  orderConds
} from './types'
import { tableColumn } from './wire'

/** One set to compare. `group` is what a set is picked by in the settings — the facet or sample
 *  group it comes from, the same whichever direction(s) of it are drawn. */
export interface SetDef {
  key: string
  group: string
  label: string
  members: readonly string[]
}

// ── Clean data: the genes measured in each sample ──────────────────────────────────────────────

/** A sample's conditions and replicate (as a row carries them). */
export type SampleOf = Pick<StandardRow, 'cell' | 'cmpd' | 'dose' | 'time' | 'rep' | 'extra'>

/** Which genes each sample measured — the run's result for a Clean data upstream. Each sample's
 *  genes are a bitset over `genes` (bit g = gene g), base64: a project file keeps a few hundred
 *  bytes per sample, not a list of every gene. */
export interface MeasuredSets {
  genes: string[]
  samples: SampleOf[]
  measured: string[]
}

/** Measured: a finite, non-zero value that imputation didn't fill in. */
export function measuredSets(holder: { rows: readonly StandardRow[] }): MeasuredSets {
  const ix = sampleIndex(holder)
  const bytes = (ix.genes.length + 7) >> 3
  const bits = ix.reps.map(() => new Uint8Array(bytes))
  for (let r = 0; r < ix.n; r++) {
    const v = ix.value[r]
    if (ix.imputed[r] || !Number.isFinite(v) || v === 0) continue
    const g = ix.gene[r]
    bits[ix.sample[r]][g >> 3] |= 1 << (g & 7)
  }
  return {
    genes: ix.genes,
    samples: ix.reps.map(({ cell, cmpd, dose, time, rep, extra }) => ({
      cell,
      cmpd,
      dose,
      time,
      rep,
      ...(extra && Object.keys(extra).length ? { extra } : null)
    })),
    measured: bits.map(toBase64)
  }
}

function toBase64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000)
    s += String.fromCharCode(...b.subarray(i, Math.min(b.length, i + 0x8000)))
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const decoded = new WeakMap<MeasuredSets, Uint8Array[]>()
const bitsOf = (m: MeasuredSets): Uint8Array[] => {
  let b = decoded.get(m)
  if (!b) decoded.set(m, (b = m.measured.map(fromBase64)))
  return b
}

/** The conditions the samples carry a value of, in canonical order. */
export function sampleConds(samples: readonly SampleOf[]): ConditionKey[] {
  const out = new Set<ConditionKey>()
  for (const s of samples) {
    for (const c of VALID_CONDITIONS) {
      const v = condValue(s as StandardRow, c)
      if (v != null && v !== '') out.add(c)
    }
    for (const k of Object.keys(s.extra ?? {})) if (s.extra![k] !== '') out.add(customCond(k))
  }
  return orderConds([...out])
}

/** A set of samples: its key, its name and its samples (indices into `samples`). */
export interface SampleGroup {
  key: string
  label: string
  samples: number[]
}

/** The samples as sets: one per sample (`by` 'sample'), or one per distinct tuple of the `by`
 *  conditions — ordered as the facets are (numeric conditions numerically), each sample's group in
 *  replicate order. */
export function sampleGroups(
  samples: readonly SampleOf[],
  by: readonly ConditionKey[] | 'sample',
  numeric: NumericConds
): SampleGroup[] {
  const dims = by === 'sample' ? sampleConds(samples) : by.filter((c) => c !== ('rep' as never))
  const rows = samples.map((s, i) => ({ ...(s as unknown as ContextRow), rep: s.rep, i }))
  const groups = facetCompareRows(rows, dims, numeric)
  if (by !== 'sample')
    return groups.map((g) => ({
      key: g.key || 'all',
      label: facetLabel(g.values) || 'all samples',
      samples: g.rows.map((r) => r.i)
    }))
  return groups.flatMap((g) =>
    [...g.rows]
      .sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0))
      .map((r) => ({
        key: sampleLabel(samples[r.i] as StandardRow),
        label: sampleName(samples[r.i] as StandardRow),
        samples: [r.i]
      }))
  )
}

/** A group's set: the genes measured in at least `minShare` of its samples (at least one). */
export function quantitySets(
  m: MeasuredSets,
  groups: readonly SampleGroup[],
  minShare: number
): SetDef[] {
  const bits = bitsOf(m)
  const n = m.genes.length
  return groups.map((g) => {
    const need = Math.max(1, Math.ceil(minShare * g.samples.length - 1e-9))
    const count = new Uint16Array(n)
    for (const s of g.samples) {
      const b = bits[s]
      if (!b) continue
      for (let i = 0; i < b.length; i++) {
        const byte = b[i]
        if (!byte) continue
        for (let k = 0; k < 8; k++) if (byte & (1 << k)) count[(i << 3) + k]++
      }
    }
    const members: string[] = []
    for (let i = 0; i < n; i++) if (count[i] >= need) members.push(m.genes[i])
    return { key: g.key, group: g.key, label: g.label, members }
  })
}

// ── a Compare / Curve fit: each facet's calls ──────────────────────────────────────────────────

/** A facet's significant genes (uniqIDs), up and down. */
export interface CallGroup {
  key: string
  label: string
  up: string[]
  down: string[]
}

/** A facet's key and name as a set: a facet with no dimension of its own (one comparison, one
 *  context) is 'all', named by its comparison(s). */
function facetName(
  holder: { rows: readonly CompareResultRow[] },
  g: Pick<FacetIndexGroup, 'key' | 'values'>
): { key: string; label: string } {
  const names = (): string =>
    [...distinctOf(holder, 'comparison')].filter((c) => typeof c === 'string' && c).join(' / ')
  return { key: g.key || 'all', label: facetLabel(g.values) || names() || 'all' }
}

/** The facets of a comparison result as sets would be picked by (facetGroupsOf: the facets its
 *  faceted plots switch between) — their keys and names, no row read. */
export function facetNames(
  holder: { rows: readonly CompareResultRow[] },
  numeric: NumericConds
): Array<{ key: string; label: string }> {
  return facetGroupsOf(holder, numeric).map((g) => facetName(holder, g))
}

/** Each facet of a comparison result (as facetNames) with its significant genes each way — read off
 *  its columns, no row built. */
export function callSets(
  holder: { rows: readonly CompareResultRow[] },
  numeric: NumericConds
): CallGroup[] {
  const t = holderTable(holder)
  const col = (k: string): ((r: number) => unknown) =>
    t
      ? (tableColumn(t, k) ?? ((): undefined => undefined))
      : (r) => (holder.rows[r] as unknown as Record<string, unknown>)[k]
  const uid = col('uniqID')
  const signf = col('signf')
  const effect = col('effect')
  return facetGroupsOf(holder, numeric).map((g) => {
    const up = new Set<string>()
    const down = new Set<string>()
    for (let k = 0; k < g.idx.length; k++) {
      const r = g.idx[k]
      if (!signf(r)) continue
      const e = effect(r)
      if (e === 'up') up.add(uid(r) as string)
      else if (e === 'down') down.add(uid(r) as string)
    }
    return { ...facetName(holder, g), up: [...up], down: [...down] }
  })
}

/** Which of a facet's genes (or terms) make its set: up, down, either, or up and down as two
 *  sets. */
export type SetDirection = 'any' | 'up' | 'down' | 'split'

const UP = '↑'
const DOWN = '↓'

/** Each group's set(s) for a direction. */
export function directedSets(
  groups: ReadonlyArray<{
    key: string
    label: string
    up: readonly string[]
    down: readonly string[]
  }>,
  direction: SetDirection
): SetDef[] {
  return groups.flatMap((g): SetDef[] => {
    const up = { key: `${g.key}¦up`, group: g.key, label: `${g.label} ${UP}`, members: g.up }
    const down = {
      key: `${g.key}¦down`,
      group: g.key,
      label: `${g.label} ${DOWN}`,
      members: g.down
    }
    if (direction === 'up') return [up]
    if (direction === 'down') return [down]
    if (direction === 'split') return [up, down]
    return [
      { key: g.key, group: g.key, label: g.label, members: [...new Set([...g.up, ...g.down])] }
    ]
  })
}

/** Each facet's terms significant at `fdr` (BH-adjusted p below it), up and down, from an
 *  enrichment run (its facets by the same keys as `groups`) for one method × source. */
export function termGroups(
  groups: readonly CallGroup[],
  facets: Record<string, Record<string, EnrichData>>,
  combo: string,
  fdr: number
): CallGroup[] {
  const sig = (ts: EnrichData['up'] | undefined): string[] =>
    (ts ?? []).filter((t) => t.pAdjust < fdr).map((t) => t.term)
  return groups.map((g) => {
    // (a result with one facet keys it '' — callSets names it 'all')
    const e = facets[g.key === 'all' ? '' : g.key]?.[combo]
    return { key: g.key, label: g.label, up: sig(e?.up), down: sig(e?.down) }
  })
}

// ── intersections ──────────────────────────────────────────────────────────────────────────────

/** The members in exactly these sets (indices into the sets compared, ascending) — an UpSet's
 *  column, a Venn's region. `id` names it by its sets. */
export interface Intersection {
  id: string
  sets: number[]
  members: string[]
}

/** Every non-empty exclusive intersection of the sets: each member lands in exactly one, the one
 *  of the sets it's in. */
export function intersections(sets: readonly SetDef[]): Intersection[] {
  const where = new Map<string, number[]>()
  sets.forEach((s, i) => {
    for (const m of s.members) {
      const at = where.get(m)
      if (!at) where.set(m, [i])
      else if (at[at.length - 1] !== i) at.push(i)
    }
  })
  const by = new Map<string, Intersection>()
  for (const [m, ix] of where) {
    const id = ix.join('&')
    let x = by.get(id)
    if (!x) by.set(id, (x = { id, sets: ix, members: [] }))
    x.members.push(m)
  }
  return [...by.values()]
}

/** How an UpSet orders its columns: largest first, or by how many sets (one set's own first),
 *  largest first within each. Ties: by the sets' order. */
export type IntersectionOrder = 'size' | 'degree'

export function sortIntersections(
  xs: readonly Intersection[],
  order: IntersectionOrder
): Intersection[] {
  const bySets = (a: Intersection, b: Intersection): number => {
    for (let i = 0; i < Math.min(a.sets.length, b.sets.length); i++)
      if (a.sets[i] !== b.sets[i]) return a.sets[i] - b.sets[i]
    return a.sets.length - b.sets.length
  }
  return [...xs].sort((a, b) =>
    order === 'degree'
      ? a.sets.length - b.sets.length || b.members.length - a.members.length || bySets(a, b)
      : b.members.length - a.members.length || a.sets.length - b.sets.length || bySets(a, b)
  )
}

/** The bitmask of an intersection's sets (set i → bit i) — a Venn region's. */
export const maskOf = (sets: readonly number[]): number => sets.reduce((m, i) => m | (1 << i), 0)

// ── an area-proportional Venn ──────────────────────────────────────────────────────────────────

export interface Circle {
  x: number
  y: number
  r: number
}

/** The area two circles share, radii r1 and r2, centres d apart. */
export function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2
  const a = Math.acos(Math.max(-1, Math.min(1, (d * d + r1 * r1 - r2 * r2) / (2 * d * r1))))
  const b = Math.acos(Math.max(-1, Math.min(1, (d * d + r2 * r2 - r1 * r1) / (2 * d * r2))))
  const k = (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2)
  return r1 * r1 * a + r2 * r2 * b - 0.5 * Math.sqrt(Math.max(0, k))
}

/** Sets that share nothing are drawn this far apart, as a share of the smaller radius. */
const APART = 0.15

/** The distance between two circles' centres at which they share `overlap` of area: apart where
 *  they share nothing, the smaller inside the larger (touching its edge) where it's all shared,
 *  else by bisection (the shared area falls as they move apart). */
export function distanceFor(r1: number, r2: number, overlap: number): number {
  if (overlap <= 0) return r1 + r2 + APART * Math.min(r1, r2)
  const full = Math.PI * Math.min(r1, r2) ** 2
  if (overlap >= full * (1 - 1e-9)) return Math.abs(r1 - r2)
  let lo = Math.abs(r1 - r2)
  let hi = r1 + r2
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (lensArea(r1, r2, mid) > overlap) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Two or three circles, each of area its set's size, placed so each pair overlaps by the members
 *  the two share (in any other sets as well). Exact for two sets; for three, every pair's overlap is
 *  matched where a triangle allows it (else as near as it can be, by least squares on the
 *  distances), and the region all three share is what that placement leaves — a three-set Venn
 *  can't in general match all seven areas with circles. Centred on the origin. */
export function vennLayout(sets: readonly SetDef[]): Circle[] {
  const n = sets.length
  const r = sets.map((s) => Math.sqrt(new Set(s.members).size / Math.PI))
  const member = sets.map((s) => new Set(s.members))
  const shared = (i: number, j: number): number => {
    let k = 0
    const [a, b] = member[i].size < member[j].size ? [member[i], member[j]] : [member[j], member[i]]
    for (const m of a) if (b.has(m)) k++
    return k
  }
  const d = (i: number, j: number): number => distanceFor(r[i], r[j], shared(i, j))
  let pts: Array<[number, number]>
  if (n <= 1) pts = [[0, 0]]
  else if (n === 2)
    pts = [
      [0, 0],
      [d(0, 1), 0]
    ]
  else {
    const ab = d(0, 1)
    const ac = d(0, 2)
    const bc = d(1, 2)
    const x = ab > 0 ? (ac * ac - bc * bc + ab * ab) / (2 * ab) : ac
    const y = Math.sqrt(Math.max(0, ac * ac - x * x))
    pts = [
      [0, 0],
      [ab, 0],
      [x, y]
    ]
    // Where the three distances can't make a triangle, settle them by least squares.
    const want = [
      [0, 1, ab],
      [0, 2, ac],
      [1, 2, bc]
    ] as const
    const err = (): number =>
      want.reduce(
        (e, [i, j, w]) => e + (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) - w) ** 2,
        0
      )
    const scale = Math.max(ab, ac, bc, 1e-9)
    if (err() > 1e-12 * scale * scale)
      for (let it = 0; it < 400; it++) {
        const g = pts.map(() => [0, 0])
        for (const [i, j, w] of want) {
          const dx = pts[i][0] - pts[j][0]
          const dy = pts[i][1] - pts[j][1]
          const len = Math.hypot(dx, dy) || 1e-9
          const f = (len - w) / len
          g[i][0] += f * dx
          g[i][1] += f * dy
          g[j][0] -= f * dx
          g[j][1] -= f * dy
        }
        for (let i = 0; i < 3; i++) {
          pts[i][0] -= 0.25 * g[i][0]
          pts[i][1] -= 0.25 * g[i][1]
        }
      }
  }
  // centred on the middle of the circles' bounding box
  const x0 = Math.min(...pts.map(([x], i) => x - r[i]))
  const x1 = Math.max(...pts.map(([x], i) => x + r[i]))
  const y0 = Math.min(...pts.map(([, y], i) => y - r[i]))
  const y1 = Math.max(...pts.map(([, y], i) => y + r[i]))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return pts.map(([x, y], i) => ({ x: x - cx, y: y - cy, r: r[i] }))
}

/** The region of a point: the circles it's inside, as a mask (circle i → bit i). */
export function regionAt(circles: readonly Circle[], x: number, y: number): number {
  let m = 0
  circles.forEach((c, i) => {
    if (Math.hypot(x - c.x, y - c.y) < c.r) m |= 1 << i
  })
  return m
}

/** A point well inside each region the circles draw — the one farthest from any circle's edge, on
 *  a grid over them, and that distance (`margin`) — where its count is written. A region the layout doesn't draw (its area too
 *  small to place, or none) isn't in the map. */
export function regionPoints(
  circles: readonly Circle[],
  steps = 120
): Map<number, { x: number; y: number; margin: number }> {
  const out = new Map<number, { x: number; y: number; margin: number }>()
  if (!circles.length) return new Map()
  const x0 = Math.min(...circles.map((c) => c.x - c.r))
  const x1 = Math.max(...circles.map((c) => c.x + c.r))
  const y0 = Math.min(...circles.map((c) => c.y - c.r))
  const y1 = Math.max(...circles.map((c) => c.y + c.r))
  for (let i = 0; i <= steps; i++)
    for (let j = 0; j <= steps; j++) {
      const x = x0 + ((x1 - x0) * i) / steps
      const y = y0 + ((y1 - y0) * j) / steps
      let mask = 0
      let margin = Infinity
      circles.forEach((c, k) => {
        if (c.r <= 0) return
        const dist = Math.hypot(x - c.x, y - c.y)
        if (dist < c.r) mask |= 1 << k
        margin = Math.min(margin, Math.abs(dist - c.r))
      })
      if (!mask) continue
      const had = out.get(mask)
      if (!had || margin > had.margin) out.set(mask, { x, y, margin })
    }
  return out
}
