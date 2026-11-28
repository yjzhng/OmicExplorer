/**
 * GO's hierarchy, for the enrichment map's nesting: which enriched GO terms sit inside which. Read
 * from the ontology itself (go-basic.obo — GO's own release, acyclic, is_a and part_of only across
 * terms), fetched once and kept in the reference cache as each term's parents by NAME — the data
 * carries GO terms by name (annotate.ts strips the IDs), and a live term's name is unique in GO.
 *
 *   <userData>/reference-cache/go/hierarchy.json   { version, fetched, parents: name → names }
 *
 * The renderer asks for a set of terms (`go:ancestors`) and gets each one's ancestors among that
 * set only — not the whole ontology (~38k terms) over IPC.
 */
import { ipcMain } from 'electron'
import { join } from 'path'
import { cacheRoot, readJson, writeJson } from './cache'

const GO_OBO_URL = 'http://purl.obolibrary.org/obo/go/go-basic.obo'
/** The ontology's a ~30 MB download: a long leash. */
const FETCH_TIMEOUT = 300000
/** Fetched again after this long, when a request comes (GO releases monthly). */
const MAX_AGE_MS = 90 * 24 * 3600 * 1000

export interface GoHierarchy {
  /** the release ("releases/2026-07-26"), from the file's data-version */
  version: string
  /** term name → its parents' names (is_a and part_of), live terms only */
  parents: Record<string, string[]>
}

/** Parse go-basic.obo: each live [Term]'s name and its is_a / part_of parents, by name. Obsolete
 *  terms are dropped (their names are reused by nothing, but they've no place in the hierarchy). */
export function parseGoObo(text: string): GoHierarchy {
  const version = /^data-version:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''
  const nameOf = new Map<string, string>()
  const parentIds = new Map<string, string[]>()
  let id = ''
  let name = ''
  let obsolete = false
  let ps: string[] = []
  let inTerm = false
  const flush = (): void => {
    if (inTerm && id && name && !obsolete) {
      nameOf.set(id, name)
      parentIds.set(id, ps)
    }
    id = ''
    name = ''
    obsolete = false
    ps = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('[')) {
      flush()
      inTerm = line === '[Term]'
      continue
    }
    if (!inTerm) continue
    if (line.startsWith('id: ')) id = line.slice(4).trim()
    else if (line.startsWith('name: ')) name = line.slice(6).trim()
    else if (line === 'is_obsolete: true') obsolete = true
    else if (line.startsWith('is_a: ')) ps.push(line.slice(6).split(/\s/)[0])
    else if (line.startsWith('relationship: part_of ')) ps.push(line.slice(22).split(/\s/)[0])
  }
  flush()
  const parents: Record<string, string[]> = {}
  for (const [tid, pids] of parentIds) {
    const names = pids.map((p) => nameOf.get(p)).filter((n): n is string => !!n)
    parents[nameOf.get(tid)!] = [...new Set(names)]
  }
  return { version, parents }
}

/** Each of `names`' ancestors (transitively, over every path) that is itself among `names`. A name
 *  GO doesn't have (an obsolete term the data still carries) has none. */
export function ancestorsAmong(h: GoHierarchy, names: readonly string[]): Record<string, string[]> {
  const want = new Set(names)
  const memo = new Map<string, Set<string>>()
  const all = (n: string): Set<string> => {
    const hit = memo.get(n)
    if (hit) return hit
    const out = new Set<string>()
    memo.set(n, out) // (acyclic, but guard anyway)
    for (const p of h.parents[n] ?? []) {
      out.add(p)
      for (const a of all(p)) out.add(a)
    }
    return out
  }
  const res: Record<string, string[]> = {}
  for (const n of want) {
    const hits = [...all(n)].filter((a) => want.has(a) && a !== n)
    if (hits.length) res[n] = hits
  }
  return res
}

const cachePath = (): string => join(cacheRoot(), 'go', 'hierarchy.json')
let loaded: (GoHierarchy & { fetched: number }) | null = null
let loading: Promise<GoHierarchy & { fetched: number }> | null = null

/** The hierarchy: from memory, else the cache, else (or when it's old) GO itself. An old cache is
 *  kept when the fetch fails — offline, the last release still nests. */
async function hierarchy(): Promise<GoHierarchy & { fetched: number }> {
  if (loaded && Date.now() - loaded.fetched < MAX_AGE_MS) return loaded
  loading ??= (async () => {
    const cached = await readJson<GoHierarchy & { fetched: number }>(cachePath())
    if (cached && Date.now() - cached.fetched < MAX_AGE_MS) return cached
    try {
      const res = await fetch(GO_OBO_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
      if (!res.ok) throw new Error(`GO ontology: HTTP ${res.status}`)
      const h = { ...parseGoObo(await res.text()), fetched: Date.now() }
      if (Object.keys(h.parents).length === 0) throw new Error('GO ontology: no terms read')
      await writeJson(cachePath(), h)
      return h
    } catch (e) {
      if (cached) return cached
      throw e
    }
  })().finally(() => (loading = null))
  loaded = await loading
  return loaded
}

export function registerGoHierarchy(): void {
  ipcMain.handle(
    'go:ancestors',
    async (
      _evt,
      names: string[]
    ): Promise<{ ancestors: Record<string, string[]>; version?: string; error?: string }> => {
      try {
        const h = await hierarchy()
        return { ancestors: ancestorsAmong(h, names ?? []), version: h.version }
      } catch (e) {
        return { ancestors: {}, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )
}
