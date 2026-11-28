/**
 * Every upgrade a project file has had, in one place and in release order.
 *
 * A project file is read through `upgradeProjectFile` before anything else looks at it, so the app
 * only ever sees the current form — whichever release wrote the file. The home page's Fix is the
 * same read, written straight back (a copy of the old file kept beside it).
 *
 * Adding an upgrade (a renamed key, a moved field, a new tile type, a new layout):
 *   1. append a step at the END of UPGRADES, `since` = the release that ships it;
 *   2. never edit or remove an earlier step — files from before it still need it (a step that
 *      turns out wrong is corrected by a later one);
 *   3. make it idempotent: files saved before 0.3.5 don't say which app wrote them, so every step
 *      runs on those, and must leave an already-upgraded file as it is. A file that says which
 *      release saved it skips the steps from earlier releases (upgradeProjectFile).
 * MIGRATED_THROUGH follows from the last step, so files saved before it are offered Fix.
 *
 * An upgrade changes how a file is written down, never what was computed: results from an older
 * engine aren't recomputed (a step that changes a computation should mark those steps for re-run).
 */
import { groupedOrder } from '../canvas/frameOrder'
import { geneMaskKey } from './geneMask'
import { wrapLonePlots } from '../results/plotGroups'
import { renameStoredResults } from './resultPack'
import { toPaletteRef, type PaletteRef } from '../../ui/color/palettes'
import {
  type GeneSet,
  type GraphNode,
  isComparisonKind,
  isStep,
  migrateCurveCompare,
  type NodeConfig,
  type PanelLayoutItem,
  type PlotGroupConfig,
  plotResultKey
} from '../types'
import { type CompareConfig, normalizeCompareConfig } from '../config/compare'
import { WORKFLOW_DOC_VERSION, type WorkflowDoc } from './workflowDoc'

/** A project file as parsed — of any release, so every field is optional and loosely typed. */
export interface RawWorkflow {
  id?: string
  name?: string
  doc?: WorkflowDoc
  results?: unknown
  mask?: string
  [k: string]: unknown
}
export interface RawFolder {
  id?: string
  name?: string
  path?: string
  workflows?: RawWorkflow[]
  activeWorkflowId?: string
  [k: string]: unknown
}
export interface RawProject {
  folders?: RawFolder[]
  geneSets?: GeneSet[]
  /** v1 (before folders) */
  dataDir?: string | null
  workflows?: RawWorkflow[]
  activeWorkflowId?: string
  [k: string]: unknown
}

/** What a step may need from its caller (ids are minted by the project layer). */
export interface UpgradeContext {
  nextFolderId: () => string
}

export interface Upgrade {
  /** the release that introduced it */
  since: string
  /** what changed, in a line */
  what: string
  run: (raw: RawProject, ctx: UpgradeContext) => void
}

// ── 0.1.0: workflows grouped into folders ────────────────────────────────────────────────────

function foldersFromFlat(raw: RawProject, ctx: UpgradeContext): void {
  if (Array.isArray(raw.folders) && raw.folders.length) return
  const path = raw.dataDir ?? ''
  raw.folders = [
    {
      id: ctx.nextFolderId(),
      name: path ? (path.split(/[/\\]/).pop() ?? path) : 'Folder 1',
      path,
      workflows: Array.isArray(raw.workflows) ? raw.workflows : [],
      ...(raw.activeWorkflowId ? { activeWorkflowId: raw.activeWorkflowId } : null)
    }
  ]
  delete raw.workflows
  delete raw.dataDir
  delete raw.activeWorkflowId
}

// ── 0.3.3: the `strain` condition renamed `cell` ─────────────────────────────────────────────

/** Object keys renamed by the strain → cell condition rename (v0.3.3). */
const RENAMED_KEYS: Record<string, string> = { strain: 'cell' }
/** The boolean "per strain/cell" clean-up flag became a list of grouping conditions (v0.3.3):
 *  true → ['cell'], false → pooled (key dropped). Config key → new key, result key → new key. */
const PER_CELL_FLAGS: Record<string, string> = {
  minSamplePctPerStrain: 'minSamplePctBy',
  minSamplePctPerCell: 'minSamplePctBy',
  perStrain: 'by',
  perCell: 'by'
}
/** Keys whose string value names one condition. */
const COND_VALUE_KEYS = new Set(['condition', 'condition2', 'colorBy'])
/** Keys whose array value lists conditions. */
const COND_LIST_KEYS = new Set(['match', 'activeConditions'])

/** The `strain` condition was renamed `cell` (v0.3.3). Rewrite every place a saved project names
 *  it — row/selector/config keys, condition-valued fields, condition lists and `cmp_cond` labels
 *  (`cmpd:strain`) — in place, so projects saved before the rename open unchanged. Walks node
 *  configs and embedded results alike; a key already present under its new name wins. */
export function migrateStrainToCell(v: unknown): void {
  if (Array.isArray(v)) {
    for (const x of v) migrateStrainToCell(x)
    return
  }
  if (v === null || typeof v !== 'object') return
  const o = v as Record<string, unknown>
  for (const k of Object.keys(o)) {
    const val = o[k]
    if (typeof val === 'string') {
      if (COND_VALUE_KEYS.has(k) && val === 'strain') o[k] = 'cell'
      else if (k === 'cmp_cond' && val.includes('strain'))
        o[k] = val
          .split(':')
          .map((c) => (c === 'strain' ? 'cell' : c))
          .join(':')
    } else if (Array.isArray(val) && COND_LIST_KEYS.has(k)) {
      o[k] = val.map((c) => (c === 'strain' ? 'cell' : c))
    } else migrateStrainToCell(val)
    const to = RENAMED_KEYS[k]
    if (to !== undefined) {
      if (!(to in o)) o[to] = o[k]
      delete o[k]
    }
    const flagTo = PER_CELL_FLAGS[k]
    if (flagTo !== undefined) {
      if (o[k] === true && !(flagTo in o)) o[flagTo] = ['cell']
      delete o[k]
    }
  }
}

// ── 0.3.6: genesets belong to the project, not each workflow ────────────────────────────────

/** The genesets a workflow saved before they became the project's (0.3.6) — legacy flat
 *  favourites as a single "Favourites" geneset. */
export function legacyGeneSets(doc: WorkflowDoc): GeneSet[] {
  if (doc.geneSets) return doc.geneSets
  return doc.favourites?.length
    ? [{ id: 'gs_favourites', name: 'Favourites', genes: doc.favourites }]
    : []
}

/** Genesets were per workflow before 0.3.6: gather every workflow's into the project's list, and
 *  record on each workflow the mask its results were classified under (its own hidden sets), so
 *  opening it re-applies the project's. A set found in several workflows (same id — a copied
 *  workflow, or the legacy Favourites) becomes one: its genes united, hidden if hidden in any. */
function gatherGeneSets(folders: RawFolder[]): GeneSet[] {
  const byId = new Map<string, GeneSet>()
  for (const f of folders)
    for (const w of f.workflows ?? []) {
      if (!w.doc) continue
      const own = legacyGeneSets(w.doc)
      if (w.mask === undefined) w.mask = geneMaskKey(own)
      for (const g of own) {
        const had = byId.get(g.id)
        if (!had) {
          byId.set(g.id, { ...g, genes: [...g.genes] })
          continue
        }
        const ids = new Set(had.genes.map((x) => x.id))
        had.genes.push(...g.genes.filter((x) => !ids.has(x.id)))
        if (g.hidden) had.hidden = true
        if (!had.color && g.color) had.color = g.color
      }
    }
  return [...byId.values()]
}

function geneSetsToProject(raw: RawProject): void {
  const folders = raw.folders ?? []
  if (!Array.isArray(raw.geneSets)) raw.geneSets = gatherGeneSets(folders)
  for (const f of folders)
    for (const w of f.workflows ?? [])
      if (w.doc) {
        delete w.doc.geneSets
        delete w.doc.favourites
      }
}

// ── 0.3.7: every workflow in the current form ───────────────────────────────────────────────

/** Scale saved layouts to the current grid. Columns and rows scale independently:
 *  v2→v3 doubled BOTH axes (12→24 cols, 40→20px rows); v3→v4 doubled COLUMNS only (24→48 cols). */
function scaleLayouts(
  m: Record<string, PanelLayoutItem[]>,
  kx: number,
  ky: number
): Record<string, PanelLayoutItem[]> {
  const out: Record<string, PanelLayoutItem[]> = {}
  for (const [rootId, items] of Object.entries(m))
    out[rootId] = items.map((it) => ({
      ...it,
      x: it.x * kx,
      y: it.y * ky,
      w: it.w * kx,
      h: it.h * ky
    }))
  return out
}

/**
 * One workflow's document in the current form — its stored `results` (packed or plain) are
 * renamed in place where a tile's result moves. The parts date from several releases:
 *
 *   0.2.0  Compare settings from the explicit numerator / denominator model (legacy veh_norm,
 *          direct, factor-only two-way)
 *   0.3.0  the dashboard grid's resolution (v2→v3 both axes ×2, v3→v4 columns ×2)
 *   0.3.3  no step before one of its inputs; a frame's steps kept together
 *   0.3.5  every plot inside a plot group (a lone plot becomes a group of one; its dashboard tile
 *          and its result move to the subcard)
 *   0.3.6  a Compare in curve-fit mode is a Curve fit tile
 *
 * Until 0.3.7 they were applied as each workflow was opened on the canvas, so a file from before
 * it can hold workflows never brought up to date — this step brings them all, on read.
 */
export function upgradeWorkflowDoc(doc: WorkflowDoc, results?: unknown): WorkflowDoc {
  const version = doc.version ?? 1
  const kx = (version < 3 ? 2 : 1) * (version < 4 ? 2 : 1) // x, w
  const ky = version < 3 ? 2 : 1 // y, h
  const layouts =
    version >= 2
      ? kx === 1 && ky === 1
        ? (doc.groupLayouts ?? {})
        : scaleLayouts(doc.groupLayouts ?? {}, kx, ky)
      : {}
  const groupMeta = version >= 2 ? (doc.groupMeta ?? {}) : {}

  // A node without its data isn't one any release wrote: passed through as it is, untouched.
  const all = doc.nodes ?? []
  const odd = all.filter((n) => !n?.data?.kind)
  // Each step's own upgrades, as the graph's nodes (the plot-group wrap works on those).
  const nodes = all
    .filter((n) => n?.data?.kind)
    .map((n): GraphNode => {
      let data: { kind: GraphNode['data']['kind']; config: NodeConfig } = migrateCurveCompare({
        kind: n.data.kind,
        config: n.data.config
      })
      if (data.kind === 'compare' || data.kind === 'curveFit')
        data = {
          ...data,
          config: normalizeCompareConfig(data.config as CompareConfig) as unknown as NodeConfig
        }
      return {
        id: n.id,
        type: 'step',
        position: n.position,
        data: { ...data, status: 'idle', ...(n.data.name ? { name: n.data.name } : {}) }
      } as GraphNode
    })
  const edges = (doc.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target }))
  const frames = doc.frames ?? []

  // Wiring order, a frame's steps together.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const ordered = groupedOrder(
    nodes.map((n) => n.id),
    edges,
    frames
  ).flatMap((id) => {
    const n = byId.get(id)
    return n ? [n] : []
  })

  // Lone plots into groups of one; each one's result follows it to the subcard.
  const maxIdx = nodes.reduce((m, n) => {
    const k = Number(n.id.split('-').pop())
    return Number.isFinite(k) ? Math.max(m, k) : m
  }, 1)
  const wrapped = wrapLonePlots(ordered, doc.nextId ?? maxIdx + 1, layouts)
  const moved = new Map<string, string>()
  wrapped.nodes.forEach((n, i) => {
    const was = ordered[i]
    if (n.data.kind !== 'plotGroup' || was.data.kind === 'plotGroup') return
    const child = (n.data.config as PlotGroupConfig).children[0]
    if (child) moved.set(n.id, plotResultKey(n.id, child.id))
  })
  renameStoredResults(results, moved)

  const out: WorkflowDoc = {
    version: WORKFLOW_DOC_VERSION,
    nextId: wrapped.nextId,
    nodes: [
      ...wrapped.nodes.filter(isStep).map((n) => ({
        id: n.id,
        type: 'step',
        position: n.position,
        data: {
          kind: n.data.kind,
          config: n.data.config,
          ...(n.data.name ? { name: n.data.name } : {})
        }
      })),
      ...odd
    ],
    edges,
    ...(Object.keys(wrapped.layouts).length ? { groupLayouts: wrapped.layouts } : {}),
    ...(Object.keys(groupMeta).length ? { groupMeta } : {}),
    ...(frames.length ? { frames } : {}),
    // Legacy genesets stay until the project step lifts them (it runs first; kept for a doc
    // upgraded on its own).
    ...(doc.geneSets ? { geneSets: doc.geneSets } : {}),
    ...(doc.favourites ? { favourites: doc.favourites } : {})
  }
  return out
}

function workflowsToCurrent(raw: RawProject): void {
  for (const f of raw.folders ?? [])
    for (const w of f.workflows ?? []) if (w.doc) w.doc = upgradeWorkflowDoc(w.doc, w.results)
}

// ── 0.3.8: the 2-way ANOVA became the ANOVA ─────────────────────────────────────────────────

/** A Compare saved as a 'two_way_anova' (before 0.3.8) reads as the ANOVA, its two factors the
 *  compared conditions, kept as factors (see normalizeCompareConfig). */
function twoWayToAnova(raw: RawProject): void {
  for (const f of raw.folders ?? [])
    for (const w of f.workflows ?? [])
      for (const n of w.doc?.nodes ?? []) {
        const c = n?.data?.config as CompareConfig | undefined
        if (n?.data?.kind === 'compare' && (c?.analysis as string) === 'two_way_anova')
          n.data.config = normalizeCompareConfig(c as CompareConfig) as unknown as NodeConfig
      }
}

// ── 0.5.0: Clean data's values are quantities ──────────────────────────────────────────────

/** A Contrast of Clean data saved its sides' kind as 'abundance'; it is 'quantity' now (an
 *  abundance, or a fraction of a reference protein). Its saved result, packed or plain. */
function contrastQuantity(raw: RawProject): void {
  for (const f of raw.folders ?? [])
    for (const w of f.workflows ?? []) {
      const res = w.results as { results?: Record<string, unknown> } | undefined
      const byNode = (res?.results ?? res) as Record<string, unknown> | undefined
      for (const r of Object.values(byNode ?? {})) {
        const ctr = (r as { kind?: string; ctr?: { valueKind?: string } } | null)?.ctr
        if ((r as { kind?: string })?.kind === 'contrast' && ctr?.valueKind === 'abundance')
          ctr.valueKind = 'quantity'
      }
    }
}

// ── 0.5.0: a plot's effect colours are the plot's ───────────────────────────────────────────

/** The plots that drew a Compare's class colours, and where each keeps its own up / down / none
 *  colours now: a point plot's group colours (its style), another plot's `effectColors`. */
const POINT_PLOTS = new Set(['volcano', 'ma', 'scatter', 'potency', 'curveMad'])
const OWN_COLOUR_PLOTS = new Set(['enrich', 'bubble', 'string'])

/** A Compare no longer colours its classes (a plot's colours come from the plot: its own, else its
 *  FC palette). Where one did, each plot it fed that drew them — one without a palette of its own,
 *  which overrode them — takes them as its own colours, so it looks as it did. Then dropped. */
function effectColoursToPlots(raw: RawProject): void {
  type Cfg = Record<string, unknown>
  type Colours = Partial<Record<'up' | 'down' | 'none', string>>
  const KEYS = ['up', 'down', 'none'] as const
  const give = (kind: string, cfg: Cfg | undefined, from: Colours): void => {
    if (!cfg || toPaletteRef(cfg.fcPalette as PaletteRef | undefined)) return
    for (const k of KEYS) {
      const c = from[k]
      if (!c || c === 'auto') continue
      if (POINT_PLOTS.has(kind)) {
        const style = ((cfg.style as Cfg | undefined) ?? {}) as Cfg
        const groups = ((style.groups as Record<string, Cfg> | undefined) ?? {}) as Record<
          string,
          Cfg
        >
        const g = groups[k] ?? {}
        if (g.color == null || g.color === 'auto')
          cfg.style = { ...style, groups: { ...groups, [k]: { ...g, color: c } } }
      } else if (OWN_COLOUR_PLOTS.has(kind)) {
        const own = ((cfg.effectColors as Colours | undefined) ?? {}) as Colours
        if (own[k] == null || own[k] === 'auto') cfg.effectColors = { ...own, [k]: c }
      }
    }
  }
  for (const f of raw.folders ?? [])
    for (const w of f.workflows ?? []) {
      const doc = w.doc
      if (!doc?.nodes) continue
      const byId = new Map(doc.nodes.map((n) => [n.id, n]))
      for (const n of doc.nodes) {
        const cfg = n?.data?.config as Cfg | undefined
        const from = cfg?.effectColors as Colours | undefined
        if (!isComparisonKind(n?.data?.kind) || !cfg || !from) continue
        for (const e of doc.edges ?? []) {
          if (e.source !== n.id) continue
          const t = byId.get(e.target)
          if (!t?.data) continue
          if (t.data.kind === 'plotGroup')
            for (const ch of (t.data.config as PlotGroupConfig).children ?? [])
              give(ch.kind, ch.config as unknown as Cfg, from)
          else give(t.data.kind, t.data.config as unknown as Cfg, from)
        }
        delete cfg.effectColors
      }
    }
}

// ── 0.5.0: a reference protein divides ─────────────────────────────────────────────────────

/** Whether release `a` came before release `b` (x.y.z). */
function releasedBefore(a: string, b: string): boolean {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0)
  return false
}

/** Normalising to a reference protein used to shift each sample, so the protein read the same in
 *  all of them; since 0.5.0 it divides by the protein in each sample, so values are fractions of
 *  it. A Clean data step's saved result from before holds the shifted values, which the app would
 *  now present as fractions: its result is dropped, so the step shows as not run until re-run.
 *  Fold changes are the same either way (the two differ by one factor per protein), so the steps
 *  after it keep theirs. Only files an earlier release saved — a 0.5.0 file's result is divided. */
function refProteinRerun(raw: RawProject): void {
  const savedBy = typeof raw.appVersion === 'string' ? raw.appVersion : null
  if (savedBy && !releasedBefore(savedBy, '0.5.0')) return
  for (const f of raw.folders ?? [])
    for (const w of f.workflows ?? []) {
      const res = w.results as { results?: Record<string, unknown> } | undefined
      const byNode = (res?.results ?? res) as Record<string, unknown> | undefined
      for (const n of w.doc?.nodes ?? []) {
        const cfg = n?.data?.config as
          { normalizeEnabled?: boolean; normalizeReference?: string } | undefined
        if (n?.data?.kind !== 'standardize' || !cfg?.normalizeEnabled) continue
        if (cfg.normalizeReference !== 'protein') continue
        if (byNode) delete byNode[n.id]
      }
    }
}

// ── the list ────────────────────────────────────────────────────────────────────────────────

/** Every upgrade, in release order. APPEND new ones; never edit or remove one (see top). */
export const UPGRADES: readonly Upgrade[] = [
  { since: '0.1.0', what: 'workflows grouped into folders', run: foldersFromFlat },
  {
    since: '0.3.3',
    what: 'the strain condition is called cell',
    run: (raw) => migrateStrainToCell(raw)
  },
  { since: '0.3.6', what: 'genesets belong to the project', run: geneSetsToProject },
  { since: '0.3.7', what: 'every workflow in the current form', run: workflowsToCurrent },
  { since: '0.3.8', what: 'the 2-way ANOVA is the ANOVA', run: twoWayToAnova },
  { since: '0.5.0', what: 'a Contrast of Clean data compares quantities', run: contrastQuantity },
  {
    since: '0.5.0',
    what: "a plot's effect colours are its own, not its Compare's",
    run: effectColoursToPlots
  },
  {
    since: '0.5.0',
    what: 'a reference protein divides: re-run its Clean data',
    run: refProteinRerun
  }
]

/** The release of the last upgrade: a file saved before it is written in an older form (Fix). */
export const MIGRATED_THROUGH = UPGRADES[UPGRADES.length - 1].since

/** Bring a parsed project file, of any release, to the current form — in place, every step in
 *  order (each one idempotent). */
export function upgradeProjectFile(raw: RawProject, ctx: UpgradeContext): RawProject {
  // A file that names the release that saved it skips the steps from before that release: it was
  // written in their form already. (Some walk the whole file, results included — a quarter of a
  // second on a large project, at every open.) A step from the saving release itself still runs —
  // a development build may have saved before the step was added — and so does every step on a
  // file from before 0.3.5, which names none.
  const savedBy = typeof raw.appVersion === 'string' ? raw.appVersion : null
  for (const u of UPGRADES) if (!savedBy || !newerThan(savedBy, u.since)) u.run(raw, ctx)
  return raw
}

/** Whether release `a` is later than release `b` (as project.ts's isNewerVersion). */
function newerThan(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}
