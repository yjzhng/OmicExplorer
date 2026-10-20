/**
 * A plot tile's data, on request — the Enrichment and STRING tiles' data-export button (beside
 * Download). The tile draws one facet and its top hits; this saves ALL of it, every facet, with a
 * `facet` column:
 *
 *   Enrichment   every tested term, per facet and direction
 *   STRING       the drawn network's nodes (gene, log₂FC, links, module) and edges (two genes and
 *                the STRING score), per facet — two files, `…_nodes` and `…_edges`
 *
 * Built from the plot's run result with the tile's own computations (enrichTermRows,
 * stringModel.ts), so the files hold exactly what the tile shows.
 */
import {
  enrichSourcesPresent,
  enrichTermRows,
  facetCompareRows,
  facetDims,
  facetLabel,
  resolveEnrichSource
} from '../engine'
import {
  plotTableFiles,
  plotTableTargets,
  tileKey,
  type PlotTableTarget
} from '../graph/plotTables'
import { useGraph } from '../graph/store'
import {
  isStep,
  numericOfResult,
  type EnrichConfig,
  type NodeResult,
  type StringConfig
} from '../graph/types'
import {
  autoStringLevel,
  buildStringModel,
  stringVariant,
  type StringLevel,
  stringLevelsFromScore,
  stringNetFromResponse,
  stringQueryGenes,
  stringSendLimit
} from '../ui/stringModel'

type Target = PlotTableTarget

/** Which of a plot's tables a builder produces; mapped to its file (plotTableFiles). */
type TablePart = 'enrichment' | 'nodes' | 'edges'

type CompareResult = Extract<NodeResult, { kind: 'compare' }>

/** The plot's run computed every method × source per facet; take the one the tile shows. */
async function exportEnrichment(
  t: Target,
  up: CompareResult,
  run: Extract<NodeResult, { kind: 'enrich' }>,
  write: (part: TablePart, rows: Record<string, unknown>[]) => Promise<void>
): Promise<void> {
  const cfg = t.config as EnrichConfig
  // The source the tile resolves to (its saved one when the data carries it, else the fallback).
  const source = resolveEnrichSource(
    cfg.source ?? 'go',
    enrichSourcesPresent(up.annotationMap ?? {}, up.keggCategories)
  )
  if (!source) return
  const combo = `${cfg.method ?? 'ora'}|${source}`
  const rows: Record<string, unknown>[] = []
  for (const g of facetCompareRows(up.cmp.rows, facetDims(up.cmp.rows), numericOfResult(up))) {
    const e = run.facets[g.key]?.[combo]
    if (e) rows.push(...enrichTermRows(e, facetLabel(g.values)))
  }
  await write('enrichment', rows)
}

/** The plot's run read every setting per facet; take the one the tile shows. */
async function exportString(
  t: Target,
  up: CompareResult,
  run: Extract<NodeResult, { kind: 'string' }>,
  write: (part: TablePart, rows: Record<string, unknown>[]) => Promise<void>
): Promise<void> {
  const cfg = t.config as StringConfig
  const ann = up.annotationMap ?? {}
  const maxGenes = cfg.maxGenes > 0 ? cfg.maxGenes : 40
  const addInteractors = cfg.addInteractors ?? false
  const caps = run.caps
  const nodes: Record<string, unknown>[] = []
  const edges: Record<string, unknown>[] = []
  for (const g of facetCompareRows(up.cmp.rows, facetDims(up.cmp.rows), numericOfResult(up))) {
    const all = run.facets[g.key]
    if (!all) continue
    const genes = stringQueryGenes(g.rows, up.displayMap, ann, stringSendLimit(maxGenes))
    if (genes.length < 2) continue
    // As the tile draws it: the chosen level — or, unset (auto), the highest this setting has a
    // network at (the best score doesn't depend on the level).
    const level: StringLevel =
      cfg.confidence ??
      (() => {
        const probe = stringVariant(all, genes, caps, maxGenes, 'low', addInteractors)
        const levels = stringLevelsFromScore(
          addInteractors ? probe.maxLinkScore : probe.maxQueryScore
        )
        return levels && levels.size ? autoStringLevel(levels) : 'low'
      })()
    const res = stringVariant(all, genes, caps, maxGenes, level, addInteractors)
    const m = buildStringModel(stringNetFromResponse(res, genes), genes, ann, maxGenes)
    const facet = facetLabel(g.values)
    m.vis.forEach((n, k) => {
      const mod = m.moduleByNode[k]
      nodes.push({
        facet,
        gene: n.name,
        uniqID: m.uniqByStringId.get(n.key) ?? m.uniqByStringIdAll.get(n.key) ?? '',
        stringId: n.key,
        query: n.isQuery ? 'yes' : 'no',
        log2FC: n.isQuery ? n.log2FC : null,
        links: m.degree[k],
        module: mod >= 0 ? mod + 1 : null,
        moduleLabel: mod >= 0 ? m.territoryGroups[mod].label : null
      })
    })
    m.eIdx.forEach(([a, b], k) =>
      edges.push({
        facet,
        geneA: m.vis[a].name,
        geneB: m.vis[b].name,
        stringIdA: m.vis[a].key,
        stringIdB: m.vis[b].key,
        score: m.eScore[k]
      })
    )
  }
  await write('nodes', nodes)
  await write('edges', edges)
}

/** A plot tile's data-export target and default file stem, or why it has none. */
export function plotDataTarget(
  nodeId: string,
  childId?: string
): { target: Target } | { error: string } {
  const s = useGraph.getState()
  const key = tileKey(nodeId, childId)
  const target = plotTableTargets(s.nodes.filter(isStep), s.edges).find((t) => t.key === key)
  if (!target) return { error: 'this plot has no data to export' }
  return { target }
}

/** Rows → the export's columns (every key, first-seen order) and cells. */
function toTable(rows: Record<string, unknown>[]): {
  columns: string[]
  rows: Array<Array<string | number | null>>
} {
  const columns: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k)
  const cell = (v: unknown): string | number | null =>
    v == null ? null : typeof v === 'number' ? (Number.isFinite(v) ? v : null) : String(v)
  return { columns, rows: rows.map((r) => columns.map((c) => cell(r[c]))) }
}

/**
 * Save a plot's data next to `path` (the file the save window chose): Enrichment to `path` itself,
 * STRING to `<stem>_nodes` and `<stem>_edges` beside it. In the app-wide table format.
 */
export async function exportPlotData(
  target: Target,
  path: string,
  format: 'csv' | 'xlsx'
): Promise<{ written: number; errors: string[] }> {
  const s = useGraph.getState()
  const up = s.results[target.upstreamId]
  const run = s.results[target.resultKey]
  if (up?.kind !== 'compare') throw new Error('run the Compare step first')
  if (run?.kind !== target.kind) throw new Error('run the plot first')
  const parts = new Map<TablePart, Record<string, unknown>[]>()
  const collect = async (part: TablePart, rows: Record<string, unknown>[]): Promise<void> => {
    parts.set(part, rows)
  }
  if (run.kind === 'enrich') await exportEnrichment(target, up, run, collect)
  else if (run.kind === 'string') await exportString(target, up, run, collect)

  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const baseDir = path.slice(0, cut)
  const stem = path.slice(cut + 1).replace(/\.[^.]+$/, '')
  const [first, second] = plotTableFiles(target.kind, stem)
  const files: Array<[TablePart, string]> =
    target.kind === 'enrich'
      ? [['enrichment', first]]
      : [
          ['nodes', first],
          ['edges', second]
        ]
  return window.api.exportTables({
    baseDir,
    format,
    items: files.map(([part, file]) => ({
      relPath: file.replace(/\.csv$/, `.${format}`),
      sheetName: part,
      ...toTable(parts.get(part) ?? [])
    }))
  })
}
