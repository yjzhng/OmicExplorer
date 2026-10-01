/**
 * Background export of the plot tiles whose results exist only as a view — Enrichment and STRING —
 * to the project's temp folder, beside the Clean data / Compare / Contrast CSVs the runs write.
 *
 * A tile only computes the facet on screen; this computes EVERY facet, in the background, whenever
 * what the tile would show changes (its upstream Compare result, or a setting that changes the
 * numbers), and writes one file per tile with a `facet` column:
 *
 *   <tile>.enrichment.csv      every tested term, per facet and direction
 *   <tile>.string-nodes.csv    the drawn network's nodes (gene, log₂FC, links, module), per facet
 *   <tile>.string-edges.csv    its edges (two genes and the STRING score), per facet
 *
 * `<tile>` is the plot node's id, or `<group>-<child>` for a plot inside a group tile. Enrichment
 * runs in the engine's background worker (GSEA's permutations are heavy), facet by facet, so
 * progress can be shown; STRING reads the locally cached interactome through the main process. The
 * computations are the tile's own (enrichTermGroups, stringModel.ts), so the files hold exactly what
 * the tile shows — all of it, not just the top few.
 */
import { useEffect } from 'react'
import type { Edge } from '@xyflow/react'
import { create } from 'zustand'

import {
  enrichSourcesPresent,
  enrichTermGroups,
  facetCompareRows,
  facetDims,
  facetLabel,
  resolveEnrichSource,
  type CompareResultRow
} from '../engine'
import { engineBg } from '../engine/client'
import { fingerprintOf } from './fingerprint'
import { dominantTaxon } from '../graph/requirements'
import { tempWriteScope, useGraph } from '../graph/store'
import {
  isStep,
  type EnrichConfig,
  type GraphNode,
  type NodeConfig,
  type NodeKind,
  type NodeResult,
  type PlotGroupConfig,
  type StringConfig
} from '../graph/types'
import {
  buildStringModel,
  stringNetFromResponse,
  stringQueryGenes,
  stringSendIds,
  stringSendLimit
} from '../ui/stringModel'

/** A background export's progress, per tile (see tileKey): facets done of total. */
interface TempJobs {
  progress: Record<string, { done: number; total: number }>
  set: (key: string, p: { done: number; total: number } | null) => void
}
export const useTempJobs = create<TempJobs>((set) => ({
  progress: {},
  set: (key, p) =>
    set((s) => {
      const next = { ...s.progress }
      if (p) next[key] = p
      else delete next[key]
      return { progress: next }
    })
}))

/** A plot tile's key — its file stem: the node id, or `<group>-<child>` for a group subcard. */
export const tileKey = (nodeId: string, childId?: string): string =>
  childId ? `${nodeId}-${childId}` : nodeId

interface Target {
  key: string
  kind: 'enrich' | 'string'
  config: NodeConfig
  upstreamId: string
}

/** Every Enrichment / STRING plot in the workflow — standalone, or a subcard of a group tile. */
function targetsOf(nodes: GraphNode[], edges: Edge[]): Target[] {
  const out: Target[] = []
  for (const n of nodes) {
    if (!isStep(n)) continue
    const upstreamId = edges.find((e) => e.target === n.id)?.source
    if (!upstreamId) continue
    const add = (kind: NodeKind, config: NodeConfig, childId?: string): void => {
      if (kind === 'enrich' || kind === 'string')
        out.push({ key: tileKey(n.id, childId), kind, config, upstreamId })
    }
    if (n.data.kind === 'plotGroup')
      for (const c of (n.data.config as PlotGroupConfig).children) add(c.kind, c.config, c.id)
    else add(n.data.kind, n.data.config)
  }
  return out
}

/** Bumped when what an export writes changes, so files from an older build are redone. */
const EXPORT_VERSION = 1

/** What decides a tile's numbers: its upstream result's content, and the settings that change them
 *  (not the look). Unchanged → its files are current — across restarts too (see sidecarName). */
function signatureOf(t: Target, upstream: CompareResult, where: string): string {
  const c = t.config as Partial<EnrichConfig & StringConfig>
  const relevant =
    t.kind === 'enrich'
      ? { method: c.method, source: c.source }
      : {
          confidence: c.confidence,
          maxGenes: c.maxGenes,
          addInteractors: c.addInteractors,
          species: c.species
        }
  return `v${EXPORT_VERSION}|${t.kind}|${where}|${fingerprintOf(upstream)}|${JSON.stringify(relevant)}`
}

/** The small file beside a tile's tables recording the signature they were written for, so a later
 *  session can tell they're current without recomputing them. */
const sidecarName = (t: Target): string =>
  `${t.key}.${t.kind === 'enrich' ? 'enrichment' : 'string'}.meta.json`

/** Rows → CSV text (header = every key, in first-seen order; quoted where needed). */
function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = []
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k)
  const cell = (v: unknown): string => {
    if (v == null) return ''
    const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n')
}

/** The tile's facets, as the tile splits them. */
function facetsOf(rows: CompareResultRow[]): { label: string; rows: CompareResultRow[] }[] {
  return facetCompareRows(rows, facetDims(rows)).map((g) => ({
    label: facetLabel(g.values),
    rows: g.rows
  }))
}

type CompareResult = Extract<NodeResult, { kind: 'compare' }>

async function exportEnrichment(
  t: Target,
  up: CompareResult,
  write: (name: string, rows: Record<string, unknown>[]) => Promise<void>,
  live: () => boolean
): Promise<void> {
  const cfg = t.config as EnrichConfig
  const ann = up.annotationMap ?? {}
  const cats = up.keggCategories
  // The source the tile resolves to (its saved one when the data carries it, else the fallback).
  const source = resolveEnrichSource(cfg.source ?? 'go', enrichSourcesPresent(ann, cats))
  if (!source) return
  const opts = {
    method: cfg.method ?? 'ora',
    source,
    annotationMap: ann,
    displayMap: up.displayMap,
    keggCategories: source.startsWith('kegg') ? cats : undefined,
    termGroups: enrichTermGroups(source, ann, cats)
  }
  const facets = facetsOf(up.cmp.rows)
  const rows: Record<string, unknown>[] = []
  const progress = useTempJobs.getState().set
  for (let i = 0; i < facets.length; i++) {
    if (!live()) return
    progress(t.key, { done: i, total: facets.length })
    rows.push(...(await engineBg.enrichmentTable(facets[i].rows, opts, facets[i].label)))
  }
  if (live()) await write(`${t.key}.enrichment.csv`, rows)
}

const SCORE_OF = { low: 150, medium: 400, high: 700, highest: 900 } as const

async function exportString(
  t: Target,
  up: CompareResult,
  write: (name: string, rows: Record<string, unknown>[]) => Promise<void>,
  live: () => boolean
): Promise<void> {
  const cfg = t.config as StringConfig
  const ann = up.annotationMap ?? {}
  const species = cfg.species && cfg.species > 0 ? cfg.species : dominantTaxon(ann)
  if (!species) return
  const maxGenes = cfg.maxGenes > 0 ? cfg.maxGenes : 40
  const addInteractors = cfg.addInteractors ?? false
  const score = SCORE_OF[cfg.confidence ?? 'medium']
  const facets = facetsOf(up.cmp.rows)
  const nodes: Record<string, unknown>[] = []
  const edges: Record<string, unknown>[] = []
  const progress = useTempJobs.getState().set
  for (let i = 0; i < facets.length; i++) {
    if (!live()) return
    progress(t.key, { done: i, total: facets.length })
    const f = facets[i]
    const genes = stringQueryGenes(f.rows, up.displayMap, ann, stringSendLimit(maxGenes))
    if (genes.length < 2) continue
    const res = await window.api.fetchStringNetwork(
      stringSendIds(genes),
      species,
      score,
      addInteractors ? maxGenes : 0
    )
    const m = buildStringModel(stringNetFromResponse(res, genes), genes, ann, maxGenes)
    m.vis.forEach((n, k) => {
      const mod = m.moduleByNode[k]
      nodes.push({
        facet: f.label,
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
        facet: f.label,
        geneA: m.vis[a].name,
        geneB: m.vis[b].name,
        stringIdA: m.vis[a].key,
        stringIdB: m.vis[b].key,
        score: m.eScore[k]
      })
    )
  }
  if (!live()) return
  await write(`${t.key}.string-nodes.csv`, nodes)
  await write(`${t.key}.string-edges.csv`, edges)
}

/** The tile signatures whose files are current, and the job running now. */
const written = new Map<string, string>()
let running: Promise<void> | null = null
let again = false

/** Bring every tile's temp files up to date — one tile at a time, the latest state each round. */
async function sync(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = (async () => {
    do {
      again = false
      const s = useGraph.getState()
      const dir = s.dataDir
      if (!dir) break
      const scope = tempWriteScope(s)
      const where = `${dir}|${scope ?? ''}`
      for (const t of targetsOf(s.nodes, s.edges)) {
        const up = s.results[t.upstreamId]
        if (up?.kind !== 'compare') continue
        const sig = signatureOf(t, up, where)
        if (written.get(t.key) === sig) continue
        // Not known this session: the sidecar says whether the files on disk are already current.
        try {
          const meta = await window.api.readTempFile(dir, sidecarName(t), scope)
          if (meta && (JSON.parse(meta) as { signature?: string }).signature === sig) {
            written.set(t.key, sig)
            continue
          }
        } catch {
          // unreadable sidecar → just recompute
        }
        // Still worth finishing only while nothing it depends on has changed meanwhile.
        const live = (): boolean => {
          const cur = useGraph.getState()
          const u = cur.results[t.upstreamId]
          const tt = targetsOf(cur.nodes, cur.edges).find((x) => x.key === t.key)
          return (
            u?.kind === 'compare' &&
            !!tt &&
            cur.dataDir === dir &&
            signatureOf(tt, u, `${cur.dataDir}|${tempWriteScope(cur) ?? ''}`) === sig
          )
        }
        const write = (name: string, rows: Record<string, unknown>[]): Promise<void> =>
          window.api.writeTempFile(dir, name, toCsv(rows), scope)
        try {
          if (t.kind === 'enrich') await exportEnrichment(t, up, write, live)
          else await exportString(t, up, write, live)
          if (live()) {
            // The sidecar last, so it never vouches for tables that weren't all written.
            await window.api.writeTempFile(
              dir,
              sidecarName(t),
              JSON.stringify({ signature: sig, written: new Date().toISOString() }),
              scope
            )
            written.set(t.key, sig)
          }
        } catch {
          // Best-effort: a failed export is retried on the next change.
        } finally {
          useTempJobs.getState().set(t.key, null)
        }
        // A change arrived mid-job: start the round over from the latest state.
        if (again) break
      }
    } while (again)
  })()
  try {
    await running
  } finally {
    running = null
  }
}

/** Keep the temp folder's Enrichment / STRING tables current, for the app's lifetime. Mount once. */
export function useTempResultExports(): void {
  useEffect(() => {
    let timer: number | undefined
    const kick = (): void => {
      window.clearTimeout(timer)
      // Debounced: a run of edits (dragging a slider, renaming) settles before anything is computed.
      timer = window.setTimeout(() => void sync(), 1500)
    }
    kick()
    const unsub = useGraph.subscribe((s, prev) => {
      if (
        s.results !== prev.results ||
        s.nodes !== prev.nodes ||
        s.edges !== prev.edges ||
        s.dataDir !== prev.dataDir
      )
        kick()
    })
    return () => {
      unsub()
      window.clearTimeout(timer)
    }
  }, [])
}
