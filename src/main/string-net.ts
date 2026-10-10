/**
 * STRING protein–protein interactions (renderer → main IPC). Runs in the main process (no renderer
 * CSP; filesystem access).
 *
 * Strict separation of concerns:
 *  - `string:ensureOrg` (import stage only) downloads a whole organism's interactome (links + info)
 *    plus a canonical gene-name map (from protein.aliases) into the app cache, version-stamped. This
 *    is the ONLY place that talks to STRING's network — so data updates only when the user re-runs
 *    the metadata import.
 *  - `string:network` (plot) is purely a LOCAL read: it filters the cached organism file to the
 *    requested genes (optionally adding first-shell interactors). It never fetches; if the organism
 *    isn't cached it returns a message telling the user to download it in the import.
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { createReadStream } from 'fs'
import { rm, writeFile } from 'fs/promises'
import { createInterface } from 'readline'
import { join } from 'path'
import { cacheRoot, downloadGunzip, ensureDir, fileExists, readJson, writeJson } from './cache'

// STRING endpoints. Bulk files come from the downloads host; the version is discovered live.
const VERSION_URL = 'https://string-db.org/api/json/version'
const DL_BASE = 'https://stringdb-downloads.org/download'
const linksUrl = (taxon: number, ver: string): string =>
  `${DL_BASE}/protein.links.v${ver}/${taxon}.protein.links.v${ver}.txt.gz`
const infoUrl = (taxon: number, ver: string): string =>
  `${DL_BASE}/protein.info.v${ver}/${taxon}.protein.info.v${ver}.txt.gz`
// STRING protein.aliases — maps STRING ids to UniProt gene names for canonical node labels.
const aliasUrl = (taxon: number, ver: string): string =>
  `${DL_BASE}/protein.aliases.v${ver}/${taxon}.protein.aliases.v${ver}.txt.gz`

export interface StringResult {
  /** query genes plus (optionally) first-shell interactors, `isQuery` flagged */
  nodes: StringNode[]
  edges: { aId: string; bId: string; score: number }[]
  /** the best link score (0–1000) between two query proteins, at any confidence (−1 = none) — the
   *  highest level a query-only network has anything at */
  maxQueryScore?: number
  /** the best link score from a query protein to any protein (−1 = none) — the highest level a
   *  network with first-shell interactors has anything at */
  maxLinkScore?: number
  error?: string
}
export interface EnsureOrgResult {
  cached: boolean
  version: string
  error?: string
}
/** A node in the STRING network. */
export interface StringNode {
  id: string
  name: string
  /** true = a differential (query) gene; false = a first-shell interactor pulled in for context */
  isQuery: boolean
}

const orgDir = (taxon: number): string => join(cacheRoot(), 'string', String(taxon))
const manifestPath = (taxon: number): string => join(orgDir(taxon), 'manifest.json')
const linksPath = (taxon: number, ver: string): string => join(orgDir(taxon), `links.v${ver}.tsv`)
const infoPath = (taxon: number, ver: string): string => join(orgDir(taxon), `info.v${ver}.tsv`)
/** STRING-id → canonical UniProt gene name, built at import from the aliases file
 *  (`stringId\tgeneName` per line). Used for node labels so context genes read in the same
 *  namespace as the dataset instead of STRING's `preferred_name`. */
const namesPath = (taxon: number, ver: string): string => join(orgDir(taxon), `names.v${ver}.tsv`)

/** The current STRING version (e.g. "12.0"), or '' if it can't be determined. */
async function stringVersion(): Promise<string> {
  try {
    const res = await fetch(VERSION_URL)
    if (!res.ok) return ''
    const j = (await res.json()) as { string_version?: string }[]
    return String(j?.[0]?.string_version ?? '')
  } catch {
    return ''
  }
}

/** Cached org version if the links+info files are present (interactome ready), else ''. */
async function cachedVersion(taxon: number): Promise<string> {
  const m = await readJson<{ version: string }>(manifestPath(taxon))
  if (!m?.version) return ''
  const ok =
    (await fileExists(linksPath(taxon, m.version))) &&
    (await fileExists(infoPath(taxon, m.version)))
  return ok ? m.version : ''
}

const namesCache = new Map<string, Map<string, string>>()
/** Canonical gene names (STRING id → UniProt gene name) built at import, memoised per session.
 *  Null when the names file isn't present (older cache) — callers fall back to STRING preferred_name. */
async function loadCanonicalNames(taxon: number, ver: string): Promise<Map<string, string> | null> {
  const key = `${taxon}:${ver}`
  const hit = namesCache.get(key)
  if (hit) return hit
  if (!(await fileExists(namesPath(taxon, ver)))) return null
  const m = new Map<string, string>()
  const rl = createInterface({
    input: createReadStream(namesPath(taxon, ver)),
    crlfDelay: Infinity
  })
  for await (const line of rl) {
    if (!line) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const id = line.slice(0, tab)
    const nm = line.slice(tab + 1)
    if (id && nm) m.set(id, nm)
  }
  namesCache.set(key, m)
  return m
}

/** id → display name for the requested ids: the canonical UniProt gene name (aliases-derived) when
 *  available, else STRING's `preferred_name` from the info file. */
async function readNames(
  taxon: number,
  ver: string,
  need: Set<string>
): Promise<Map<string, string>> {
  const nameById = new Map<string, string>()
  if (need.size === 0) return nameById
  const rl = createInterface({ input: createReadStream(infoPath(taxon, ver)), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue
    const tab = line.indexOf('\t')
    if (tab < 0) continue
    const id = line.slice(0, tab)
    if (!need.has(id)) continue
    const tab2 = line.indexOf('\t', tab + 1)
    nameById.set(id, line.slice(tab + 1, tab2 < 0 ? undefined : tab2))
  }
  // Prefer canonical UniProt gene names over STRING's preferred_name where we have them.
  const canon = await loadCanonicalNames(taxon, ver)
  if (canon)
    for (const id of need) {
      const g = canon.get(id)
      if (g) nameById.set(id, g)
    }
  return nameById
}

/** Stream the links file, invoking `cb` for each interaction at/above `cut` (0–1000). `below`, if
 *  given, also sees the interactions under the cut — but only those scoring above its `floor()`,
 *  so a caller tracking a best score pays for the ids (string slices) of almost none of them. */
async function scanLinks(
  taxon: number,
  ver: string,
  cut: number,
  cb: (a: string, b: string, score: number) => void,
  below?: {
    floor: () => number
    /** skip a line by its first protein alone, before the second is sliced */
    wantA?: (a: string) => boolean
    cb: (a: string, b: string, score: number) => void
  }
): Promise<void> {
  // The file is sorted by its first protein, so consecutive lines share it: reuse the last slice.
  let lastA = ''
  const rl = createInterface({
    input: createReadStream(linksPath(taxon, ver)),
    crlfDelay: Infinity
  })
  let first = true
  for await (const line of rl) {
    if (first) {
      first = false
      if (/protein1/i.test(line)) continue // header
    }
    if (!line) continue
    const sp = line.indexOf(' ')
    const sp2 = line.indexOf(' ', sp + 1)
    if (sp < 0 || sp2 < 0) continue
    const score = parseInt(line.slice(sp2 + 1), 10)
    if (!Number.isFinite(score)) continue
    if (score < cut) {
      if (below && score > below.floor()) {
        const a =
          sp === lastA.length && line.startsWith(lastA) ? lastA : (lastA = line.slice(0, sp))
        if (below.wantA && !below.wantA(a)) continue
        below.cb(a, line.slice(sp + 1, sp2), score)
      }
      continue
    }
    cb(line.slice(0, sp), line.slice(sp + 1, sp2), score)
  }
}

/**
 * Download the org's STRING aliases file once and parse STRING id → canonical UniProt gene name
 * (node labels), preferring curated over BLAST-inferred. The (large) file is removed after parsing.
 * Returns null if it can't be fetched.
 */
async function downloadAndParseAliases(
  taxon: number,
  ver: string,
  send: (stage: string, loaded: number, total: number) => void
): Promise<Map<string, string> | null> {
  send('aliases', 0, 0)
  await ensureDir(orgDir(taxon))
  const aliasFile = join(orgDir(taxon), `aliases.v${ver}.tmp.tsv`)
  try {
    await downloadGunzip(aliasUrl(taxon, ver), aliasFile, (l, t) => send('aliases', l, t))
  } catch {
    return null
  }
  const geneByString = new Map<string, string>()
  const geneRank = new Map<string, number>() // lower = more trustworthy source
  const rl = createInterface({ input: createReadStream(aliasFile), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line || line.startsWith('#')) continue
    // tab: string_protein_id, alias, source
    const c = line.split('\t')
    if (c.length < 3) continue
    const [sid, alias, source] = c
    if (/UniProt_GN/i.test(source)) {
      const rank = source.includes('BLAST') ? 1 : 0 // prefer curated gene names over BLAST-inferred
      const prev = geneRank.get(sid)
      if (prev === undefined || rank < prev) {
        geneRank.set(sid, rank)
        geneByString.set(sid, alias)
      }
    }
  }
  await rm(aliasFile, { force: true })
  return geneByString
}

/**
 * Strength-mode network among the query ids. When `maxInteractors > 0`, also pulls in first-shell
 * interactors — proteins that connect to the query set above the score threshold — ranked by how
 * many query proteins they touch, and keeps the top `maxInteractors` of them ON TOP of the full
 * query set. Returns nodes (`isQuery` flagged) plus the interactions among them.
 */
async function localNetwork(
  taxon: number,
  ver: string,
  query: Set<string>,
  cut: number,
  maxInteractors: number
): Promise<StringResult> {
  let N: Set<string>
  if (maxInteractors > 0) {
    // Pass 1: count, for each non-query protein, how many query proteins it connects to ≥ threshold.
    const connCount = new Map<string, number>()
    await scanLinks(taxon, ver, cut, (a, b) => {
      const aq = query.has(a)
      const bq = query.has(b)
      if (aq === bq) return // both query or both non-query: not a first-shell link
      const ctx = aq ? b : a
      connCount.set(ctx, (connCount.get(ctx) ?? 0) + 1)
    })
    const keptContext = [...connCount.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, maxInteractors)
      .map(([id]) => id)
    N = new Set<string>([...query, ...keptContext])
  } else {
    N = query
  }
  // Interactions among the node set (deduped to undirected pairs) — and, in the same pass, the best
  // link score at ANY confidence that this kind of network draws from (query–query without
  // interactors, query–anything with them), so the caller knows which levels would draw a network
  // without reading again. Under the cut, a line is only looked at when it beats that best so far,
  // and (query-only) when its first protein is a query one — so the extra cost is a few lines.
  const edges: { aId: string; bId: string; score: number }[] = []
  let maxQuery = -1
  let maxLink = -1
  const track = (a: string, b: string, score: number): void => {
    const aq = query.has(a)
    const bq = query.has(b)
    if (aq && bq && score > maxQuery) maxQuery = score
    if ((aq || bq) && score > maxLink) maxLink = score
  }
  await scanLinks(
    taxon,
    ver,
    cut,
    (a, b, score) => {
      track(a, b, score)
      if (a < b && N.has(a) && N.has(b)) edges.push({ aId: a, bId: b, score: score / 1000 })
    },
    maxInteractors > 0
      ? { floor: () => maxLink, cb: track }
      : { floor: () => maxQuery, wantA: (a) => query.has(a), cb: track }
  )
  const nameById = await readNames(taxon, ver, N)
  const nodes: StringNode[] = [...N].map((id) => ({
    id,
    name: nameById.get(id) ?? id,
    isQuery: query.has(id)
  }))
  return { nodes, edges, maxQueryScore: maxQuery, maxLinkScore: maxLink }
}

/** The STRING confidence levels the tile offers (0–1000): low, medium, high, highest. */
const LEVELS = [150, 400, 700, 900]

/** Everything every setting of a STRING tile can draw for one query, from two scans: per gene cap
 *  (`caps[c]`: its query is the first `genes` genes, with up to `k` interactors) and per level, the
 *  interactors it would pull in; and every link, at any level, among the widest query plus all of
 *  those interactors. A setting's network is then a filter of it (see the renderer's
 *  stringVariant) — switching settings never reads the file again. */
export interface StringAllResult {
  /** the widest query's proteins plus every candidate interactor, with display names */
  nodes: { id: string; name: string }[]
  /** every link among `nodes` at or above the lowest level, each pair once (score 0–1) */
  edges: { aId: string; bId: string; score: number }[]
  /** `interactors[cap][level]`: the interactors that setting pulls in, best first */
  interactors: string[][][]
  /** `maxLinkScore[cap]`: the best link (0–1000) from that cap's query to any protein, −1 = none */
  maxLinkScore: number[]
  error?: string
}

/** Stream the links file at/above `cut`, handing `cb` only lines whose first protein `wantA`
 *  accepts — tested before the second id is sliced, and the first reused while it repeats (the file
 *  is sorted by it), so skipping the rest of the file costs almost nothing per line. */
async function scanFrom(
  taxon: number,
  ver: string,
  cut: number,
  wantA: (a: string) => boolean,
  cb: (a: string, b: string, score: number) => void
): Promise<void> {
  let lastA = ''
  let lastWant = false
  const rl = createInterface({
    input: createReadStream(linksPath(taxon, ver)),
    crlfDelay: Infinity
  })
  let first = true
  for await (const line of rl) {
    if (first) {
      first = false
      if (/protein1/i.test(line)) continue // header
    }
    if (!line) continue
    const sp = line.indexOf(' ')
    if (sp < 0) continue
    if (!(sp === lastA.length && line.startsWith(lastA))) {
      lastA = line.slice(0, sp)
      lastWant = wantA(lastA)
    }
    if (!lastWant) continue
    const sp2 = line.indexOf(' ', sp + 1)
    if (sp2 < 0) continue
    const score = parseInt(line.slice(sp2 + 1), 10)
    if (!Number.isFinite(score) || score < cut) continue
    cb(lastA, line.slice(sp + 1, sp2), score)
  }
}

async function localNetworkAll(
  taxon: number,
  ver: string,
  genes: string[][],
  caps: { genes: number; k: number }[]
): Promise<StringAllResult> {
  // Each protein's rank: the index of its gene in the (strongest-first) query; a cap's query is the
  // genes ranked below its `genes`.
  const rank = new Map<string, number>()
  genes.forEach((ids, g) => ids.forEach((id) => rank.has(id) || rank.set(id, g)))
  // Pass 1: the query's links (the file lists each link both ways, so every link touching the query
  // shows up with a query protein first). Per cap and level, count how many of that cap's query
  // proteins each OTHER protein links to — the interactor ranking — and the cap's best link.
  const counts = caps.map(() => LEVELS.map(() => new Map<string, number>()))
  const maxLink = caps.map(() => -1)
  await scanFrom(
    taxon,
    ver,
    LEVELS[0],
    (a) => rank.has(a),
    (a, b, score) => {
      const ra = rank.get(a)!
      const rb = rank.get(b)
      caps.forEach((cap, c) => {
        if (ra >= cap.genes) return
        if (score > maxLink[c]) maxLink[c] = score
        if (rb != null && rb < cap.genes) return // both in this cap's query: not an interactor link
        LEVELS.forEach((lv, l) => {
          if (score >= lv) counts[c][l].set(b, (counts[c][l].get(b) ?? 0) + 1)
        })
      })
    }
  )
  // Each setting's interactors: the most-connected, up to the cap's k (ties keep file order).
  const interactors = counts.map((byLevel, c) =>
    byLevel.map((m) =>
      [...m.entries()]
        .sort((x, y) => y[1] - x[1])
        .slice(0, caps[c].k)
        .map(([id]) => id)
    )
  )
  // Pass 2: every link among the widest query and all candidate interactors, at any level.
  const S = new Set<string>([...rank.keys(), ...interactors.flat(2)])
  const edges: { aId: string; bId: string; score: number }[] = []
  await scanFrom(
    taxon,
    ver,
    LEVELS[0],
    (a) => S.has(a),
    (a, b, score) => {
      if (a < b && S.has(b)) edges.push({ aId: a, bId: b, score: score / 1000 })
    }
  )
  const nameById = await readNames(taxon, ver, S)
  return {
    nodes: [...S].map((id) => ({ id, name: nameById.get(id) ?? id })),
    edges,
    interactors,
    maxLinkScore: maxLink
  }
}

/** Sentinel error the plot recognises to show "download it in the import" guidance. */
export const NO_LOCAL_DATA = 'NO_LOCAL_DATA'

export function registerStringNet(): void {
  // Download an organism's interactome into the cache (idempotent; skips if current). Streams
  // progress back to the caller's window as `string:progress` events.
  ipcMain.handle(
    'string:ensureOrg',
    async (evt: IpcMainInvokeEvent, taxon: number): Promise<EnsureOrgResult> => {
      if (!taxon || taxon <= 0)
        return { cached: false, version: '', error: 'No species (taxon) given.' }
      const live = await stringVersion()
      const have = await cachedVersion(taxon)
      const version = live || have
      if (!version)
        return {
          cached: false,
          version: '',
          error: 'Could not determine the STRING version (offline?).'
        }
      const send = (stage: string, loaded: number, total: number): void =>
        evt.sender.send('string:progress', { taxon, stage, loaded, total })
      const namesReady = await fileExists(namesPath(taxon, version))
      if (have === version && namesReady) return { cached: true, version }
      try {
        if (have !== version) {
          await downloadGunzip(linksUrl(taxon, version), linksPath(taxon, version), (l, t) =>
            send('links', l, t)
          )
          await downloadGunzip(infoUrl(taxon, version), infoPath(taxon, version), (l, t) =>
            send('info', l, t)
          )
          await writeJson(manifestPath(taxon), { version })
        }
        // Canonical gene-name labels come from the aliases file — download and parse it when missing.
        if (!namesReady) {
          const geneByString = await downloadAndParseAliases(taxon, version, send)
          if (geneByString && geneByString.size > 0) {
            await writeFile(
              namesPath(taxon, version),
              [...geneByString].map(([s, g]) => `${s}\t${g}`).join('\n')
            )
            namesCache.delete(`${taxon}:${version}`)
          }
        }
        return { cached: false, version }
      } catch (e) {
        return {
          cached: false,
          version,
          error: e instanceof Error ? e.message : 'STRING download failed'
        }
      }
    }
  )

  // Every setting's network for one query at once (see StringAllResult): `genes` is the widest query,
  // strongest first, each gene's STRING ids; `caps` the gene caps the tile offers.
  ipcMain.handle(
    'string:networkAll',
    async (
      _evt,
      genes: string[][],
      species: number,
      caps: { genes: number; k: number }[]
    ): Promise<StringAllResult> => {
      const empty = { nodes: [], edges: [], interactors: [], maxLinkScore: [] }
      const g = (genes ?? []).map((ids) => (ids ?? []).map((s) => s?.trim()).filter(Boolean))
      if (!g.some((ids) => ids.length)) return empty
      if (!species || species <= 0) return { ...empty, error: NO_LOCAL_DATA }
      const ver = await cachedVersion(species)
      if (!ver) return { ...empty, error: NO_LOCAL_DATA }
      try {
        return await localNetworkAll(species, ver, g, caps ?? [])
      } catch (e) {
        return { ...empty, error: e instanceof Error ? e.message : 'Local STRING read failed' }
      }
    }
  )

  ipcMain.handle(
    'string:network',
    async (
      _evt,
      identifiers: string[],
      species: number,
      requiredScore: number,
      maxInteractors = 0
    ): Promise<StringResult> => {
      const ids = [...new Set((identifiers ?? []).map((s) => s?.trim()).filter(Boolean))]
      if (ids.length === 0) return { nodes: [], edges: [] }
      if (!species || species <= 0) return { nodes: [], edges: [], error: NO_LOCAL_DATA }
      // Purely local: read the cached organism file, or tell the caller to fetch it in the import.
      const ver = await cachedVersion(species)
      if (!ver) return { nodes: [], edges: [], error: NO_LOCAL_DATA }
      try {
        const score = Math.max(0, Math.min(1000, Math.round(requiredScore || 400)))
        return await localNetwork(
          species,
          ver,
          new Set(ids),
          score,
          Math.max(0, Math.trunc(maxInteractors))
        )
      } catch (e) {
        return {
          nodes: [],
          edges: [],
          error: e instanceof Error ? e.message : 'Local STRING read failed'
        }
      }
    }
  )
}
