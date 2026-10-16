/**
 * Settings › Database: what the app-wide reference cache (cache.ts) holds — the UniProt
 * accession store and each STRING organism's files — with their versions and sizes, and clearing
 * them. Clearing never touches a project: annotations already fetched into one are saved with it.
 */
import { ipcMain } from 'electron'
import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'

import {
  annotateAccessions,
  CACHE_SOURCES,
  CACHE_TAXON_COL,
  uniprotRelease,
  uniprotStorePath,
  type UniStore
} from './annotate'
import { cacheRoot, readJson, writeJson } from './cache'
import { forgetStringOrg, stringVersion } from './string-net'

export interface UniprotCacheSummary {
  bytes: number
  /** ms epoch the store was last written */
  updated: number
  accessions: number
  /** UniProt release → accessions fetched from it, newest first */
  releases: { release: string; count: number }[]
  /** per source: accessions covered, and those covered by an older resolver (re-resolved at the
   *  next import that asks for the source) */
  sources: SourceCount[]
  /** the same, per NCBI taxon, most proteins first */
  species: UniprotTaxonSummary[]
}

/** One source's proteins: covered, and covered by an older resolver (`field` = its import id). */
export interface SourceCount {
  label: string
  field: string
  count: number
  outdated: number
}

export interface UniprotTaxonSummary {
  /** NCBI taxon; 0 = not recorded (the taxon is only fetched alongside STRING ids or MSigDB) */
  taxon: number
  count: number
  /** the UniProt releases its proteins came from, newest first */
  releases: string[]
  /** per source, as UniprotCacheSummary.sources (every source listed there, in its order) */
  sources: SourceCount[]
  /** about how much of the store its proteins take */
  bytes: number
}

export interface StringOrgSummary {
  taxon: number
  /** the version the organism's network is read from ('' = none complete) */
  version: string
  /** bytes of the current version's files */
  bytes: number
  /** bytes of files left from earlier versions (or unfinished downloads) */
  oldBytes: number
  /** the canonical gene-name map is present (labels read as UniProt gene names) */
  names: boolean
  /** ms epoch of the last download */
  updated: number
}

export interface RefCacheSummary {
  root: string
  uniprot: UniprotCacheSummary | null
  string: StringOrgSummary[]
}

/** One cached protein in Settings' browser: its gene name and the chosen source's values. */
export interface UniprotCacheRow {
  acc: string
  gene: string
  /** the source's values, one per `UniprotBrowseResult.cols` ('' where none) */
  values: string[]
}

/** One species' proteins for one source — the browser shows a single slice at a time. */
export interface UniprotBrowseQuery {
  /** NCBI taxon (0 = not recorded) */
  taxon: number
  /** the source's import field id (CACHE_SOURCES) */
  field: string
  /** whitespace-separated terms, each to appear in the accession, gene or a value */
  query: string
  /** only proteins looked up for the source but with no value for it */
  emptyOnly?: boolean
  offset: number
  limit: number
}

export interface UniprotBrowseResult {
  /** the source's columns, in order */
  cols: string[]
  /** proteins matching the query (before offset/limit) */
  total: number
  rows: UniprotCacheRow[]
}

export type RefCacheTarget =
  | { kind: 'uniprot' }
  | { kind: 'uniprot-taxon'; taxon: number }
  | { kind: 'string'; taxon: number }
  | { kind: 'string-old' }

const statOrNull = async (p: string): Promise<{ size: number; mtimeMs: number } | null> => {
  try {
    return await stat(p)
  } catch {
    return null
  }
}

/** A cache entry's NCBI taxon; 0 when it wasn't recorded. */
function taxonOf(e: UniStore['byAcc'][string]): number {
  const t = parseInt(e.fields?.[CACHE_TAXON_COL] ?? '', 10)
  return Number.isFinite(t) && t > 0 ? t : 0
}

async function uniprotSummary(): Promise<UniprotCacheSummary | null> {
  const st = await statOrNull(uniprotStorePath())
  if (!st) return null
  const store = await readJson<UniStore>(uniprotStorePath())
  const releases = new Map<string, number>()
  const newSources = (): SourceCount[] =>
    CACHE_SOURCES.map((s) => ({ label: s.label, field: s.field, count: 0, outdated: 0 }))
  const sources = newSources()
  const species = new Map<number, UniprotTaxonSummary & { rel: Set<string> }>()
  const entries = Object.entries(store?.byAcc ?? {})
  for (const [acc, e] of entries) {
    releases.set(e.release ?? '', (releases.get(e.release ?? '') ?? 0) + 1)
    const taxon = taxonOf(e)
    let sp = species.get(taxon)
    if (!sp) {
      sp = { taxon, count: 0, releases: [], sources: newSources(), bytes: 0, rel: new Set() }
      species.set(taxon, sp)
    }
    sp.count++
    sp.rel.add(e.release ?? '')
    // Its share of the file: the entry as the store writes it.
    sp.bytes += acc.length + JSON.stringify(e).length + 4
    const got = new Set(e.got ?? [])
    CACHE_SOURCES.forEach((s, i) => {
      if (!got.has(s.col)) return
      const key = s.token && !got.has(s.token) ? 'outdated' : 'count'
      sources[i][key]++
      sp.sources[i][key]++
    })
  }
  const listed = new Set(sources.filter((s) => s.count + s.outdated > 0).map((s) => s.label))
  return {
    bytes: st.size,
    updated: st.mtimeMs,
    accessions: entries.length,
    // UniProt releases are "YYYY_NN", so they sort as text.
    releases: [...releases]
      .map(([release, count]) => ({ release, count }))
      .sort((a, b) => b.release.localeCompare(a.release)),
    sources: sources.filter((s) => listed.has(s.label)),
    species: [...species.values()]
      .map(({ rel, ...sp }) => ({
        ...sp,
        releases: [...rel].filter(Boolean).sort().reverse(),
        sources: sp.sources.filter((s) => listed.has(s.label))
      }))
      .sort((a, b) => b.count - a.count)
  }
}

/** The parsed store, kept while the file is unchanged — the browser queries it per keystroke. */
let browseMemo: { mtimeMs: number; size: number; store: UniStore } | null = null
async function storeForBrowse(): Promise<UniStore | null> {
  const st = await statOrNull(uniprotStorePath())
  if (!st) return (browseMemo = null)
  if (browseMemo && browseMemo.mtimeMs === st.mtimeMs && browseMemo.size === st.size)
    return browseMemo.store
  const store = await readJson<UniStore>(uniprotStorePath())
  browseMemo = store ? { mtimeMs: st.mtimeMs, size: st.size, store } : null
  return store
}

/** One species' proteins looked up for one source, matching a search, accession order, a page. */
async function browseUniprot(q: UniprotBrowseQuery): Promise<UniprotBrowseResult> {
  const src = CACHE_SOURCES.find((s) => s.field === q.field)
  if (!src) return { cols: [], total: 0, rows: [] }
  const store = await storeForBrowse()
  if (!store) return { cols: src.cols, total: 0, rows: [] }
  const terms = (q.query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const hits: UniprotCacheRow[] = []
  for (const acc of Object.keys(store.byAcc).sort()) {
    const e = store.byAcc[acc]
    if (taxonOf(e) !== q.taxon || !e.got?.includes(src.col)) continue
    const values = src.cols.map((c) => e.fields?.[c] ?? '')
    if (q.emptyOnly && values.some(Boolean)) continue
    const gene = e.fields?.geneName ?? ''
    if (terms.length) {
      const cells = [acc, gene, ...values].map((c) => c.toLowerCase())
      if (!terms.every((t) => cells.some((c) => c.includes(t)))) continue
    }
    hits.push({ acc, gene, values })
  }
  const offset = Math.max(0, q.offset | 0)
  const limit = Math.min(500, Math.max(1, q.limit | 0))
  return { cols: src.cols, total: hits.length, rows: hits.slice(offset, offset + limit) }
}

const stringDir = (): string => join(cacheRoot(), 'string')

/** An organism's files, each with whether it belongs to the version its network is read from. */
async function orgFiles(
  taxon: number
): Promise<{ version: string; files: { path: string; current: boolean; size: number }[] }> {
  const dir = join(stringDir(), String(taxon))
  const manifest = await readJson<{ version: string }>(join(dir, 'manifest.json'))
  const version = manifest?.version ?? ''
  const files: { path: string; current: boolean; size: number }[] = []
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    if (name === 'manifest.json') continue
    const st = await statOrNull(join(dir, name))
    if (!st) continue
    // links/info/names.v<version>.tsv — a `.part` is an unfinished download, never current.
    const m = /\.v(.+)\.tsv$/.exec(name)
    files.push({ path: join(dir, name), current: !!m && m[1] === version, size: st.size })
  }
  return { version, files }
}

async function stringSummary(): Promise<StringOrgSummary[]> {
  const out: StringOrgSummary[] = []
  for (const name of await readdir(stringDir()).catch(() => [] as string[])) {
    const taxon = Number(name)
    if (!Number.isInteger(taxon) || taxon <= 0) continue
    const { version, files } = await orgFiles(taxon)
    const has = (kind: string): boolean =>
      files.some((f) => f.current && f.path.endsWith(`${kind}.v${version}.tsv`))
    const manifest = await statOrNull(join(stringDir(), name, 'manifest.json'))
    out.push({
      taxon,
      version: version && has('links') && has('info') ? version : '',
      bytes: files.filter((f) => f.current).reduce((n, f) => n + f.size, 0),
      oldBytes: files.filter((f) => !f.current).reduce((n, f) => n + f.size, 0),
      names: has('names'),
      updated: manifest?.mtimeMs ?? 0
    })
  }
  return out.sort((a, b) => a.taxon - b.taxon)
}

export function registerRefCache(): void {
  ipcMain.handle('refcache:summary', async (): Promise<RefCacheSummary> => ({
    root: cacheRoot(),
    uniprot: await uniprotSummary(),
    string: await stringSummary()
  }))

  // Reads the local store only — never the network.
  ipcMain.handle(
    'refcache:browse',
    async (_evt, q: UniprotBrowseQuery): Promise<UniprotBrowseResult> => browseUniprot(q)
  )

  // Asks the network — only when the user presses "Check for newer versions".
  ipcMain.handle('refcache:latest', async (): Promise<{ uniprot: string; string: string }> => {
    const [uniprot, string] = await Promise.all([uniprotRelease(), stringVersion()])
    return { uniprot, string }
  })

  // Re-fetch one source for every cached protein that has it (Settings' Update): the import's own
  // fetch with `refresh`, so it rewrites that source's columns only. Goes to the network.
  ipcMain.handle(
    'refcache:updateSource',
    async (evt, field: string): Promise<{ proteins: number; error?: string }> => {
      const src = CACHE_SOURCES.find((s) => s.field === field)
      if (!src) return { proteins: 0, error: `Unknown source: ${field}` }
      const store = await readJson<UniStore>(uniprotStorePath())
      const accs = Object.entries(store?.byAcc ?? {})
        .filter(([, e]) => e.got?.includes(src.col))
        .map(([acc]) => acc)
      if (accs.length === 0) return { proteins: 0 }
      const res = await annotateAccessions(accs, [field], { refresh: true }, (done, total, stage) =>
        evt.sender.send('refcache:progress', { done, total, stage })
      )
      return { proteins: accs.length, ...(res.error ? { error: res.error } : null) }
    }
  )

  // Deletes what it names — the renderer has already confirmed (Settings' delete dialog).
  ipcMain.handle('refcache:clear', async (_evt, target: RefCacheTarget): Promise<boolean> => {
    if (target.kind === 'uniprot') {
      await rm(uniprotStorePath(), { force: true })
    } else if (target.kind === 'uniprot-taxon') {
      const store = await readJson<UniStore>(uniprotStorePath())
      if (!store) return false
      for (const [acc, e] of Object.entries(store.byAcc))
        if (taxonOf(e) === target.taxon) delete store.byAcc[acc]
      await writeJson(uniprotStorePath(), store)
    } else if (target.kind === 'string') {
      if (!Number.isInteger(target.taxon) || target.taxon <= 0) return false
      await rm(join(stringDir(), String(target.taxon)), { recursive: true, force: true })
      forgetStringOrg(target.taxon)
    } else {
      for (const org of await stringSummary()) {
        const { files } = await orgFiles(org.taxon)
        for (const f of files) if (!f.current) await rm(f.path, { force: true })
      }
    }
    return true
  })
}
