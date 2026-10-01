/**
 * External annotation fetching (renderer → main IPC). Runs in the main process so it isn't
 * subject to the renderer's CSP. UniProt REST supplies protein/gene/GO/STRING-id/organism by
 * accession and the cross-references the other sources key off:
 *
 *   KEGG      xref_kegg    → KEGG REST (gene → pathway names, BRITE top-level categories)
 *   COG       xref_eggnog  → NCBI COG2020 + KOG defs (group name + functional category)
 *   Reactome  accession    → Reactome's UniProt2Reactome map (lowest-level pathway names)
 *   MSigDB    gene symbol  → the hallmark GMT for the protein's species (human / mouse only)
 *
 * Results are cached app-wide (see cache.ts) keyed by accession + UniProt release, so the same
 * proteins are never re-fetched across projects. Only accessions not already covered for the
 * requested fields — or whose cached release is older than the live one — hit the network.
 */
import { ipcMain } from 'electron'
import { cacheRoot, readJson, writeJson } from './cache'
import { cegClass } from './cegEssential'
import { isEssentialAccession } from './degEssential'
import { join } from 'path'

/** Requested field id → the UniProtKB REST return field to query and the DB column it fills. */
const UNIPROT_FIELD: Record<string, { uni: string; col: string }> = {
  protein_name: { uni: 'protein_name', col: 'proteinName' },
  gene_names: { uni: 'gene_names', col: 'geneName' },
  // GO by aspect: biological process / molecular function / cellular component.
  go_bp: { uni: 'go_p', col: 'GO_BP' },
  go_mf: { uni: 'go_f', col: 'GO_MF' },
  go_cc: { uni: 'go_c', col: 'GO_CC' },
  string: { uni: 'xref_string', col: 'stringId' }
}
/** KEGG pathway name(s), with each one's pathway category and pathway group (BRITE br08901's top
 *  two levels) in KEGG_cat / KEGG_grp, '; '-joined in the SAME order — one per pathway, so a reader
 *  can pair them up (empty where KEGG files a pathway under none). */
const KEGG_COL = 'KEGG'
const KEGG_CAT_COL = 'KEGG_cat'
const KEGG_GRP_COL = 'KEGG_grp'
/** Orthologous groups, as two parallel column sets: prokaryotic proteins land in COGs, eukaryotic
 *  ones in KOGs — the two halves of one scheme, sharing the functional-category letters and areas.
 *  Each set: the group name(s), e.g. 'ATP-dependent protease HslVU' (names only — the id is a lookup
 *  key, not something to read off a plot); the functional category description(s), the level
 *  enrichment is normally read at; and the functional area each category sits under, '; '-joined in
 *  the SAME order (one per category; empty where NCBI gives none), read from cog-24.fun.tab. */
const OG_COLS = {
  COG: { group: 'COG', cat: 'COG_cat', area: 'COG_area' },
  KOG: { group: 'KOG', cat: 'KOG_cat', area: 'KOG_area' }
} as const
const MSIG_COL = 'MSigDB'
/** Reactome at three levels of its hierarchy. The TERM (`Reactome`) is the level-3 pathway — e.g.
 *  "Signaling by EGFR", "Interferon Signaling", "G2/M Checkpoints": Reactome maps a protein to its
 *  lowest-level pathways, ~2,000 small sets too thin to enrich on, so each is rolled up to its
 *  level-3 ancestor (a pathway that stops above level 3 stays itself). `Reactome_grp` is that
 *  term's level-2 parent ("Signaling by Receptor Tyrosine Kinases"), `Reactome_cat` its top-level
 *  pathway ("Signal Transduction"), each '; '-joined in the SAME order as the terms — one per term,
 *  so a reader can pair them up; the rare term under two parents carries both, ' / '-joined. */
const REACTOME_COL = 'Reactome'
const REACTOME_GRP_COL = 'Reactome_grp'
const REACTOME_CAT_COL = 'Reactome_cat'
/** DB column stamped 'essential' for genes whose UniProt accession is in DEG (Database of Essential
 *  Genes). Locally derived — never fetched. The results menu's Essentiality tab reads it. */
const ESSENTIAL_COL = 'DEG'
/** DB column stamped 'essential' / 'non-essential' from the Hart gold-standard human sets. Also a
 *  purely local join. Separate from DEG rather than merged: the two disagree (DEG is a union of
 *  screens, so it calls context-specific hits essential), and folding them together would bury
 *  that behind a single verdict. */
const CEG_COL = 'CEG_NEG'
/** Internal (never returned) column holding the accession's NCBI taxon, cached for STRING. */
const TAXON_COL = '_taxon'
/** Internal column holding the accession's KEGG organism code (e.g. 'hsa'), for STRING pathway mode. */
const KEGGORG_COL = '_keggOrg'
/** Resolver-version markers recorded in a cache entry's `got` beside the real columns.
 *
 *  `got` says which columns were LOOKED UP, so "resolved to nothing" and "resolved to a value" look
 *  identical to the cache — which means fixing a resolver would never reach accessions already
 *  cached: they stay covered, and stay blank, until UniProt cuts a new release. Bumping a source's
 *  number here retires its old entries and re-resolves them on the next fetch.
 *
 *  cog:2 — v1 recognised COG ids only, so every eukaryotic protein (UniProt gives those a KOG)
 *          cached an empty COG column.
 *  cog:3 — v2 prefixed each group name with its id ('COG5405 …'); the names now stand alone. */
export const RESOLVER_TOKEN = {
  // 4: categories now come with their functional area (cogArea), so earlier fetches are redone.
  // 5: COGs and KOGs split into their own column sets (COG_* / KOG_*).
  cog: '@cog:5',
  // 2: each pathway now carries its pathway category and group (KEGG_cat / KEGG_grp).
  kegg: '@kegg:2',
  msigdb: '@msigdb:1',
  // 3: terms are level-3 pathways, with their level-2 group and top-level category.
  reactome: '@reactome:3'
} as const

export interface AnnotResult {
  /** accession → { columnName → value } */
  byId: Record<string, Record<string, string>>
  /** output column names, in order */
  fields: string[]
  found: number
  /** dominant NCBI taxon id across the fetched proteins (for STRING); 0 if unknown */
  taxon?: number
  /** dominant KEGG organism code (e.g. 'hsa') across the fetched proteins; '' if unknown */
  keggOrg?: string
  /** pathway name → top-level KEGG category (BRITE), for grouping enrichment terms. Empty/omitted
   *  when KEGG wasn't fetched or nothing was newly fetched (caller keeps any prior map). */
  keggCategories?: Record<string, string>
  error?: string
}

/** Per-accession cache entry: which columns were fetched (`got`, so an empty value is still
 *  "covered"), the non-empty values, and the UniProt release they came from. */
interface UniEntry {
  got: string[]
  fields: Record<string, string>
  release: string
}
interface UniStore {
  byAcc: Record<string, UniEntry>
}
const storePath = (): string => join(cacheRoot(), 'uniprot', 'store.json')

/** Trim UniProt's verbose formatting to a clean cell value. */
function cleanValue(col: string, raw: string): string {
  const v = raw.trim()
  if (!v) return v
  if (col === 'proteinName') return v.replace(/\s*[([].*$/, '').trim()
  if (col === 'geneName') return v.split(/\s+/)[0].trim()
  if (col.startsWith('GO')) return v.replace(/\s*\[GO:\d+\]/g, '').trim()
  if (col === 'stringId') return v.split(';')[0].trim()
  return v
}

const CHUNK = 80
/** Per-request network timeout so a stalled UniProt/KEGG connection fails instead of hanging the
 *  whole import forever. */
const FETCH_TIMEOUT = 45000
/** Reference downloads (Reactome's UniProt map, the COG defs, an MSigDB GMT) are whole databases
 *  rather than one page of results, so they get a longer leash. */
const BULK_TIMEOUT = 300000
const fetchT = (url: string, ms: number = FETCH_TIMEOUT): Promise<Response> =>
  fetch(url, { signal: AbortSignal.timeout(ms) })

/** UniProt fields fetched to FEED another source rather than to be shown. They are requested after
 *  the user's own picks, so the TSV column order stays `accession, …outCols, …extras`. */
type ExtraKey = 'kegg' | 'organism' | 'eggnog' | 'symbol'
const EXTRA_UNI: Record<ExtraKey, string> = {
  kegg: 'xref_kegg', // "hsa:7157" — the KEGG gene id, for pathway lookup
  organism: 'organism_id', // NCBI taxon, for STRING and for picking the MSigDB species
  eggnog: 'xref_eggnog', // "COG5405;" — the orthologous group, for COG
  symbol: 'gene_names' // only when the user didn't already pick gene names (MSigDB keys on symbols)
}
/** accession → raw value, per extra field. */
type ExtraValues = Record<ExtraKey, Record<string, string>>
const emptyExtras = (): ExtraValues => ({ kegg: {}, organism: {}, eggnog: {}, symbol: {} })

/** Fetch a batch of accessions from UniProt for the given native fields, into `byId` (cleaned
 *  output columns) and `extra` (the raw feed-in fields above). Records the response's UniProt
 *  release into `meta`. */
async function fetchUniprotChunk(
  accessions: string[],
  uniFields: string[],
  outCols: string[],
  extras: ExtraKey[],
  byId: Record<string, Record<string, string>>,
  extra: ExtraValues,
  meta: { release: string }
): Promise<void> {
  const query = accessions.map((a) => `accession:${a}`).join(' OR ')
  const fields = ['accession', ...uniFields, ...extras.map((k) => EXTRA_UNI[k])].join(',')
  const url =
    `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(query)}` +
    `&fields=${fields}&format=tsv&size=500`
  const res = await fetchT(url)
  if (!res.ok) throw new Error(`UniProt HTTP ${res.status}`)
  meta.release = res.headers.get('x-uniprot-release') ?? meta.release
  const lines = (await res.text()).replace(/\r/g, '').split('\n').filter(Boolean)
  // When the user already picked gene names, take the symbols from their column rather than asking
  // UniProt for the same field twice — but from the RAW cell, which still carries the synonyms.
  const pickedSymbols = uniFields.indexOf(EXTRA_UNI.symbol)
  for (let r = 1; r < lines.length; r++) {
    const vals = lines[r].split('\t')
    const acc = vals[0]?.trim()
    if (!acc) continue
    const rec: Record<string, string> = byId[acc] ?? (byId[acc] = {})
    for (let c = 0; c < outCols.length; c++)
      rec[outCols[c]] = cleanValue(outCols[c], vals[c + 1] ?? '')
    for (let e = 0; e < extras.length; e++) {
      const v = (vals[outCols.length + 1 + e] ?? '').trim()
      if (v) extra[extras[e]][acc] = v
    }
    if (pickedSymbols >= 0) {
      const v = (vals[pickedSymbols + 1] ?? '').trim()
      if (v) extra.symbol[acc] = v
    }
  }
}

/** map number (5 digits) → its pathway category and pathway group, parsed from the br08901 BRITE
 *  hierarchy. Organism-independent (keyed by the shared map number), so it's fetched + memoised once. */
interface BriteLevels {
  cat: string
  grp: string
}
let briteCache: Record<string, BriteLevels> | null = null
async function loadBrite(): Promise<Record<string, BriteLevels>> {
  if (briteCache) return briteCache
  const out: Record<string, BriteLevels> = {}
  try {
    const res = await fetchT('https://rest.kegg.jp/get/br:br08901')
    if (res.ok) {
      let cat = ''
      let grp = ''
      // htext levels: A = pathway category, B = pathway group, C = "<mapNumber>  <pathway name>".
      // A/B lines may be "A<b>Metabolism</b>" or "A09100 Metabolism" — strip markup + any code.
      const label = (line: string): string =>
        line
          .slice(1)
          .replace(/<[^>]+>/g, '')
          .trim()
          .replace(/^\d+\s+/, '')
          .trim()
      for (const line of (await res.text()).split('\n')) {
        if (!line) continue
        if (line[0] === 'A') {
          cat = label(line)
          grp = ''
        } else if (line[0] === 'B') grp = label(line)
        else if (line[0] === 'C') {
          const m = line
            .slice(1)
            .trim()
            .match(/^(\d{5})\s+(.*)$/)
          if (m && cat) out[m[1]] = { cat, grp }
        }
      }
    }
  } catch {
    /* best-effort — no levels just means ungrouped pathways */
  }
  briteCache = out
  return out
}

/** Clean KEGG's `list/pathway` name ("… - Homo sapiens (human)") to the bare pathway name. Must
 *  match the cleaning in addKeggPathways so category keys line up with the stored KEGG pathway names. */
const cleanPathwayName = (name: string): string => name.replace(/\s*-\s*[^-]+$/, '').trim()

/** KEGG pathway names for each accession's KEGG gene id: link genes→pathways, then name them —
 *  each with its pathway category and group from BRITE, in aligned columns. */
async function addKeggPathways(
  keggByAcc: Record<string, string>,
  byId: Record<string, Record<string, string>>,
  onProgress?: (done: number, total: number) => void
): Promise<void> {
  // UniProt's KEGG cross-reference is a ';'-terminated list ("hsa:7157;"), possibly of several
  // gene ids — split it, so each id matches the bare ids KEGG's own replies use.
  const genesOf = (raw: string): string[] =>
    raw
      .split(';')
      .map((g) => g.trim())
      .filter(Boolean)
  const genes = [...new Set(Object.values(keggByAcc).flatMap(genesOf))]
  if (genes.length === 0) return
  const norm = (p: string): string => p.replace(/^path:/, '').trim()
  const pathByGene: Record<string, string[]> = {}
  // One request per 100 genes — a few in flight at once (KEGG serves them one by one, and a large
  // dataset needs dozens), each reported, and a failed chunk skipped rather than sinking the rest.
  const chunks: string[][] = []
  for (let i = 0; i < genes.length; i += 100) chunks.push(genes.slice(i, i + 100))
  let done = 0
  onProgress?.(0, chunks.length)
  const linkChunk = async (chunk: string[]): Promise<void> => {
    try {
      const res = await fetchT(`https://rest.kegg.jp/link/pathway/${chunk.join('+')}`)
      if (!res.ok) return
      for (const line of (await res.text()).split('\n')) {
        const [g, p] = line.split('\t')
        if (g && p) (pathByGene[g.trim()] ??= []).push(norm(p))
      }
    } catch {
      /* this chunk's genes go without pathways */
    } finally {
      onProgress?.(++done, chunks.length)
    }
  }
  const KEGG_PARALLEL = 3
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(KEGG_PARALLEL, chunks.length) }, async () => {
      while (next < chunks.length) await linkChunk(chunks[next++])
    })
  )
  const orgs = [...new Set(genes.map((g) => g.split(':')[0]))]
  const nameByPath: Record<string, string> = {}
  for (const org of orgs) {
    try {
      const res = await fetchT(`https://rest.kegg.jp/list/pathway/${org}`)
      if (!res.ok) continue
      for (const line of (await res.text()).split('\n')) {
        const [p, name] = line.split('\t')
        if (p && name) nameByPath[norm(p)] = cleanPathwayName(name)
      }
    } catch {
      /* best-effort — unnamed pathways fall back to their id */
    }
  }
  const brite = await loadBrite()
  for (const [acc, raw] of Object.entries(keggByAcc)) {
    // One entry per distinct pathway name, its levels from the map number the pathway id carries.
    const seen = new Map<string, BriteLevels | undefined>()
    for (const p of genesOf(raw).flatMap((g) => pathByGene[g] ?? [])) {
      const name = nameByPath[p] ?? p
      if (!name || seen.has(name)) continue
      const mapNum = p.match(/(\d{5})/)?.[1]
      seen.set(name, mapNum ? brite[mapNum] : undefined)
    }
    if (seen.size === 0) continue
    const rec = (byId[acc] ??= {})
    const levels = [...seen.values()]
    rec[KEGG_COL] = [...seen.keys()].join('; ')
    if (levels.some(Boolean)) {
      rec[KEGG_CAT_COL] = levels.map((l) => l?.cat ?? '').join('; ')
      rec[KEGG_GRP_COL] = levels.map((l) => l?.grp ?? '').join('; ')
    }
  }
}

/** Pathway name → top-level KEGG category for the given organism codes. Built at the ORGANISM level
 *  (list/pathway + BRITE), so it works even when every accession was already cached and no per-gene
 *  KEGG fetch ran. Best-effort — network failures just yield fewer categories. */
async function buildKeggCategories(orgs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (orgs.length === 0) return out
  const norm = (p: string): string => p.replace(/^path:/, '').trim()
  const brite = await loadBrite()
  if (Object.keys(brite).length === 0) return out
  for (const org of orgs) {
    try {
      const res = await fetchT(`https://rest.kegg.jp/list/pathway/${org}`)
      if (!res.ok) continue
      for (const line of (await res.text()).split('\n')) {
        const [p, name] = line.split('\t')
        if (!p || !name) continue
        const mapNum = norm(p).match(/(\d{5})/)?.[1]
        const cat = mapNum ? brite[mapNum]?.cat : undefined
        if (cat) out[cleanPathwayName(name)] = cat
      }
    } catch {
      /* best-effort per org */
    }
  }
  return out
}

// ── COG (orthologous groups) ─────────────────────────────────────────────────────

/** NCBI's orthologous-group reference tables, all Windows-1252 rather than UTF-8 (Greek letters
 *  appear in group names) and all small, static and organism-independent, so they're fetched once
 *  per session:
 *
 *    cog-24.fun.tab   the functional-category alphabet, grouped: a `n \t AREA NAME` line heads
 *                     each functional area, then `letter \t n \t colour \t description` per
 *                     category in it (COG2024's; same letters and descriptions as COG2020's
 *                     fun-20.tab, which lacks the areas)
 *    cog-20.def.tab   `COGid \t letters \t name \t gene \t pathway \t PubMed \t PDB`
 *    KOG/kog          `[letters] KOGid name`, then one indented member line per organism
 *
 *  KOG is the eukaryotic half of the same scheme and uses the very same category letters (a strict
 *  subset of COG2020's), so both tables fold into one id → name/category map. Without it every
 *  eukaryotic protein would come back bare: UniProt hands out `KOG…` there, never `COG…`. */
const COG_DEF_URL = 'https://ftp.ncbi.nlm.nih.gov/pub/COG/COG2020/data/cog-20.def.tab'
const COG_FUN_URL = 'https://ftp.ncbi.nlm.nih.gov/pub/COG/COG2024/data/cog-24.fun.tab'
const KOG_DEF_URL = 'https://ftp.ncbi.nlm.nih.gov/pub/COG/KOG/kog'
/** A COG or KOG id as UniProt's eggNOG cross-reference spells it. eggNOG's own `ENOG…` groups have
 *  no NCBI definition and are skipped. */
const COG_ID = /^[CK]OG\d{4,5}$/
const latin1 = (buf: ArrayBuffer): string => new TextDecoder('windows-1252').decode(buf)

interface CogDefs {
  /** COG/KOG id → group name */
  name: Record<string, string>
  /** COG/KOG id → its functional category description(s), '; '-joined */
  cats: Record<string, string>
  /** category description → the functional area it sits under */
  area: Record<string, string>
}
let cogCache: CogDefs | null = null
/** Load (and memoise) the COG + KOG defs. Throws on a network/HTTP failure so nothing is marked
 *  cached from a half-resolved run — only a successful load is memoised. */
async function loadCogDefs(): Promise<CogDefs> {
  if (cogCache) return cogCache
  const funRes = await fetchT(COG_FUN_URL, BULK_TIMEOUT)
  if (!funRes.ok) throw new Error(`COG HTTP ${funRes.status}`)
  const letter: Record<string, string> = {}
  const areaOf: Record<string, string> = {}
  const areaName: Record<string, string> = {}
  for (const line of latin1(await funRes.arrayBuffer()).split('\n')) {
    const cols = line.split('\t').map((c) => c.trim())
    if (!cols[0]) continue
    // An area heading: `n \t NAME` (upper case in the file; sentence case reads better in a menu).
    if (/^\d+$/.test(cols[0])) {
      if (cols[1]) areaName[cols[0]] = cols[1].charAt(0) + cols[1].slice(1).toLowerCase()
      continue
    }
    // A category: `letter \t n \t colour \t description` — the description is the last column
    // (one line, X, has no colour).
    const desc = cols[cols.length - 1]
    if (cols.length < 3 || !desc) continue
    letter[cols[0]] = desc
    areaOf[desc] = cols[1]
  }
  const area: Record<string, string> = {}
  for (const desc in areaOf) if (areaName[areaOf[desc]]) area[desc] = areaName[areaOf[desc]]
  const defs: CogDefs = { name: {}, cats: {}, area }
  // A group can sit in several categories ("EH"); keep every one we can name.
  const add = (id: string, letters: string, nm: string): void => {
    if (nm) defs.name[id] = nm
    const ds = [...new Set([...letters].map((c) => letter[c]).filter(Boolean))]
    if (ds.length) defs.cats[id] = ds.join('; ')
  }
  const defRes = await fetchT(COG_DEF_URL, BULK_TIMEOUT)
  if (!defRes.ok) throw new Error(`COG HTTP ${defRes.status}`)
  for (const line of latin1(await defRes.arrayBuffer()).split('\n')) {
    const [id, fun, nm] = line.split('\t')
    if (id?.startsWith('COG')) add(id, (fun ?? '').trim(), (nm ?? '').trim())
  }
  const kogRes = await fetchT(KOG_DEF_URL, BULK_TIMEOUT)
  if (!kogRes.ok) throw new Error(`KOG HTTP ${kogRes.status}`)
  for (const line of latin1(await kogRes.arrayBuffer()).split('\n')) {
    // Group headers only — member lines are indented, so an unanchored match would be wrong.
    const m = line.match(/^\[(\w+)\]\s+(KOG\d+)\s+(.*?)\s*$/)
    if (m) add(m[2], m[1], m[3])
  }
  cogCache = defs
  return defs
}

/** Turn each accession's eggNOG cross-reference into orthologous-group names + functional
 *  categories — COGs into the COG_* columns, KOGs into the KOG_* ones. Proteins whose only group is
 *  an eggNOG-native `ENOG…` get neither. */
async function addCogGroups(
  eggnogByAcc: Record<string, string>,
  byId: Record<string, Record<string, string>>,
  kinds: ('COG' | 'KOG')[]
): Promise<void> {
  const idsOf = (acc: string): string[] => [
    ...new Set(
      eggnogByAcc[acc]
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter((t) => COG_ID.test(t) && kinds.some((k) => t.startsWith(k)))
    )
  ]
  const accs = Object.keys(eggnogByAcc)
  // Don't pull the defs for a dataset that has no resolvable group at all.
  if (!accs.some((a) => idsOf(a).length > 0)) return
  const defs = await loadCogDefs()
  for (const acc of accs) {
    const all = idsOf(acc)
    if (all.length === 0) continue
    const rec = (byId[acc] ??= {})
    for (const kind of kinds) {
      const ids = all.filter((i) => i.startsWith(kind))
      if (ids.length === 0) continue
      const cols = OG_COLS[kind]
      // Names, not ids — falling back to the id only for a group NCBI doesn't name, where it's
      // the only thing left to show. Two ids can share a name, so dedupe after resolving.
      rec[cols.group] = [...new Set(ids.map((i) => defs.name[i] || i))].join('; ')
      const cats = [
        ...new Set(ids.flatMap((i) => (defs.cats[i] ?? '').split('; ').filter(Boolean)))
      ]
      if (cats.length) {
        rec[cols.cat] = cats.join('; ')
        // Aligned with the categories, one area each, so a reader can pair them up.
        rec[cols.area] = cats.map((c) => defs.area[c] ?? '').join('; ')
      }
    }
  }
}

// ── MSigDB (hallmark gene sets) ──────────────────────────────────────────────────

/** The hallmark collection ships for human and mouse only, keyed by gene SYMBOL. */
const MSIG_BASE = 'https://data.broadinstitute.org/gsea-msigdb/msigdb/release'
const MSIG_SPECIES: Record<number, { sp: 'Hs' | 'Mm'; file: 'h' | 'mh' }> = {
  9606: { sp: 'Hs', file: 'h' },
  10090: { sp: 'Mm', file: 'mh' }
}
/** Used when the release catalogue can't be reached; the catalogue is the normal path. */
const MSIG_FALLBACK: Record<'Hs' | 'Mm', string> = { Hs: '2025.1.Hs', Mm: '2025.1.Mm' }
let msigVersions: Record<'Hs' | 'Mm', string> | null = null
/** Newest release id per species, from MSigDB's own catalogue ("2026.1.Hs"). */
async function msigVersion(sp: 'Hs' | 'Mm'): Promise<string> {
  if (!msigVersions) {
    const out = { ...MSIG_FALLBACK }
    try {
      const res = await fetchT(`${MSIG_BASE}/msigdb_releases.json`)
      if (res.ok) {
        const cat = (await res.json()) as { releases?: { versionId?: string }[] }
        for (const k of ['Hs', 'Mm'] as const) {
          const ids = (cat.releases ?? [])
            .map((r) => r.versionId ?? '')
            .filter((v) => v.endsWith(`.${k}`))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          if (ids.length) out[k] = ids[ids.length - 1]
        }
      }
    } catch {
      /* best-effort — fall back to the pinned release */
    }
    msigVersions = out
  }
  return msigVersions[sp]
}

/** UPPERCASE gene symbol → hallmark set names, from the species' `*.all.*.symbols.gmt`
 *  (`setName \t url \t symbol \t symbol …`). Uppercased so mouse's Title-case symbols match. */
const msigCache: Partial<Record<'Hs' | 'Mm', Record<string, string[]>>> = {}
async function loadHallmark(sp: 'Hs' | 'Mm', file: 'h' | 'mh'): Promise<Record<string, string[]>> {
  const hit = msigCache[sp]
  if (hit) return hit
  const ver = await msigVersion(sp)
  const res = await fetchT(`${MSIG_BASE}/${ver}/${file}.all.v${ver}.symbols.gmt`, BULK_TIMEOUT)
  if (!res.ok) throw new Error(`MSigDB HTTP ${res.status}`)
  const bySymbol: Record<string, string[]> = {}
  for (const line of (await res.text()).split('\n')) {
    const cells = line.split('\t')
    const set = cells[0]?.trim()
    if (!set) continue
    for (let i = 2; i < cells.length; i++) {
      const sym = cells[i].trim().toUpperCase()
      if (sym) (bySymbol[sym] ??= []).push(set)
    }
  }
  msigCache[sp] = bySymbol
  return bySymbol
}

/** Tag each accession with the hallmark sets its gene symbol belongs to. Set names are kept verbatim
 *  (`HALLMARK_APOPTOSIS`) — that's the identifier people match against MSigDB. `namesOf` is the raw
 *  UniProt gene-names cell, primary symbol first: every synonym is tried, because UniProt and MGI
 *  don't always agree on the primary (mouse p53 is `Tp53` in UniProt, `Trp53` in MSigDB).
 *  Accessions from a species with no hallmark collection are skipped. */
async function addMsigdbSets(
  accs: string[],
  namesOf: (acc: string) => string,
  taxonOf: (acc: string) => string,
  byId: Record<string, Record<string, string>>
): Promise<void> {
  for (const acc of accs) {
    const species = MSIG_SPECIES[parseInt(taxonOf(acc), 10)]
    const symbols = namesOf(acc).trim().toUpperCase().split(/\s+/).filter(Boolean)
    if (!species || symbols.length === 0) continue
    const bySymbol = await loadHallmark(species.sp, species.file)
    const sets = symbols.map((sym) => bySymbol[sym]).find((hit) => hit?.length)
    if (sets) (byId[acc] ??= {})[MSIG_COL] = [...new Set(sets)].join('; ')
  }
}

// ── Reactome (pathways) ──────────────────────────────────────────────────────────

/** Reactome's accession→pathway table, all species in one file: `accession \t stId \t url \t name
 *  \t evidence \t species`. It's ~40 MB of text (a few MB gzipped on the wire) and there is no
 *  batch lookup endpoint, so one pass over it beats thousands of per-accession requests. Scanned
 *  line by line and discarded — only the requested accessions are kept. */
const REACTOME_URL = 'https://reactome.org/download/current/UniProt2Reactome.txt'
/** Reactome's pathway hierarchy (`parent stId \t child stId`, every species) and its pathway list
 *  (`stId \t name \t species`) — together, every pathway's paths from the top level down. */
const REACTOME_REL_URL = 'https://reactome.org/download/current/ReactomePathwaysRelation.txt'
const REACTOME_NAMES_URL = 'https://reactome.org/download/current/ReactomePathways.txt'
/** One pathway's level 3 / 2 / 1 names along one path from the top (the pathway itself standing in
 *  for a level it doesn't reach). */
interface ReactomeLevels {
  term: string
  grp: string
  cat: string
}
let reactomeLevelCache: Map<string, ReactomeLevels[]> | null = null
/** stId → its levels along every path from the top (a pathway can sit under two parents).
 *  Best-effort: a failure leaves the pathways unannotated rather than mislabelled. */
async function loadReactomeLevels(): Promise<Map<string, ReactomeLevels[]>> {
  if (reactomeLevelCache) return reactomeLevelCache
  const levels = new Map<string, ReactomeLevels[]>()
  try {
    const [relRes, namesRes] = await Promise.all([
      fetchT(REACTOME_REL_URL, BULK_TIMEOUT),
      fetchT(REACTOME_NAMES_URL, BULK_TIMEOUT)
    ])
    if (relRes.ok && namesRes.ok) {
      const parents = new Map<string, string[]>()
      for (const line of (await relRes.text()).split('\n')) {
        const [p, c] = line.split('\t').map((t) => t?.trim())
        if (p && c) (parents.get(c) ?? parents.set(c, []).get(c)!).push(p)
      }
      const name = new Map<string, string>()
      for (const line of (await namesRes.text()).split('\n')) {
        const [id, nm] = line.split('\t')
        if (id && nm) name.set(id.trim(), nm.trim())
      }
      // Every path from a top-level pathway down to `id`, memoised (the hierarchy is a DAG).
      const pathMemo = new Map<string, string[][]>()
      const pathsTo = (id: string, seen: Set<string>): string[][] => {
        const hit = pathMemo.get(id)
        if (hit) return hit
        const ps = (parents.get(id) ?? []).filter((p) => !seen.has(p))
        const next = new Set(seen).add(id)
        const paths = ps.length
          ? ps.flatMap((p) => pathsTo(p, next).map((path) => [...path, id]))
          : [[id]]
        pathMemo.set(id, paths)
        return paths
      }
      for (const id of name.keys()) {
        const seen = new Set<string>()
        const out: ReactomeLevels[] = []
        for (const path of pathsTo(id, new Set())) {
          const at = (i: number): string => name.get(path[Math.min(i, path.length - 1)]) ?? ''
          const lv = { term: at(2), grp: at(1), cat: at(0) }
          const key = `${lv.term}\t${lv.grp}\t${lv.cat}`
          if (lv.term && !seen.has(key)) {
            seen.add(key)
            out.push(lv)
          }
        }
        levels.set(id, out)
      }
    }
  } catch {
    /* best-effort */
  }
  reactomeLevelCache = levels
  return levels
}

async function addReactomePathways(
  accs: string[],
  byId: Record<string, Record<string, string>>
): Promise<void> {
  if (accs.length === 0) return
  const need = new Set(accs)
  const [res, levels] = await Promise.all([
    fetchT(REACTOME_URL, BULK_TIMEOUT),
    loadReactomeLevels()
  ])
  if (!res.ok) throw new Error(`Reactome HTTP ${res.status}`)
  const text = await res.text()
  // accession → the stIds of its (lowest-level) pathways
  const hits: Record<string, Set<string>> = {}
  for (let pos = 0; pos < text.length;) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = text.length
    const tab = text.indexOf('\t', pos)
    // Check the accession before slicing the rest of the line — most lines are other species.
    if (tab > pos && tab < end && need.has(text.slice(pos, tab))) {
      const cells = text.slice(pos, end).split('\t')
      const id = cells[1]?.trim()
      if (id) (hits[cells[0]] ??= new Set()).add(id)
    }
    pos = end + 1
  }
  for (const [acc, ids] of Object.entries(hits)) {
    // Roll each pathway up to its level-3 term; a term reached along two paths keeps both parents.
    const terms = new Map<string, { grp: Set<string>; cat: Set<string> }>()
    for (const id of ids)
      for (const lv of levels.get(id) ?? []) {
        const t =
          terms.get(lv.term) ?? terms.set(lv.term, { grp: new Set(), cat: new Set() }).get(lv.term)!
        t.grp.add(lv.grp)
        t.cat.add(lv.cat)
      }
    if (terms.size === 0) continue
    const rec = (byId[acc] ??= {})
    rec[REACTOME_COL] = [...terms.keys()].join('; ')
    rec[REACTOME_GRP_COL] = [...terms.values()].map((t) => [...t.grp].join(' / ')).join('; ')
    rec[REACTOME_CAT_COL] = [...terms.values()].map((t) => [...t.cat].join(' / ')).join('; ')
  }
}

/** Drop the per-session reference memos so a forced refresh re-pulls them. Without this a table
 *  that loaded empty earlier in the session (KEGG's BRITE hierarchy swallows its own failures)
 *  would be reused, and "re-query the sources" wouldn't actually re-query them. */
function resetReferenceMemos(): void {
  briteCache = null
  reactomeLevelCache = null
  cogCache = null
  msigVersions = null
  for (const sp of Object.keys(msigCache) as ('Hs' | 'Mm')[]) delete msigCache[sp]
}

export function registerAnnotate(): void {
  ipcMain.handle(
    'annot:uniprot',
    async (
      evt,
      accessions: string[],
      fields: string[],
      opts?: { refresh?: boolean }
    ): Promise<AnnotResult> => {
      const onProg = (done: number, total: number, stage?: string): void =>
        evt.sender.send('annot:progress', { done, total, stage })
      const uniq = [...new Set((accessions ?? []).map((a) => a?.trim()).filter(Boolean))]
      const want = new Set(fields ?? [])
      const uni = Object.keys(UNIPROT_FIELD)
        .filter((id) => want.has(id))
        .map((id) => UNIPROT_FIELD[id])
      const withKegg = want.has('kegg')
      const withCog = want.has('cog')
      const withKog = want.has('kog')
      const ogKinds = [...(withCog ? ['COG' as const] : []), ...(withKog ? ['KOG' as const] : [])]
      const withMsig = want.has('msigdb')
      const withReactome = want.has('reactome')
      // Species is fetched alongside STRING ids, and for MSigDB to pick the hallmark collection.
      const withTaxon = want.has('string') || withMsig
      // Essentiality is a purely LOCAL join against the vendored DEG accession set — no network, no
      // UniProt cache. Kept out of outFields/requiredCols so it never forces a refetch; stamped into
      // the result below and appended to the returned column list.
      const withEssential = want.has('essentiality')
      const withCeg = want.has('ceg')
      const outCols = uni.map((u) => u.col)
      // MSigDB keys on gene symbols; ask for them only when the user's own picks don't already
      // include the gene-names field (fetchUniprotChunk reuses that cell when they do).
      const needSymbol = withMsig && !uni.some((u) => u.uni === EXTRA_UNI.symbol)
      const extras: ExtraKey[] = [
        ...(withKegg ? (['kegg'] as const) : []),
        ...(withTaxon ? (['organism'] as const) : []),
        ...(ogKinds.length ? (['eggnog'] as const) : []),
        ...(needSymbol ? (['symbol'] as const) : [])
      ]
      const outFields = [
        ...outCols,
        ...(withKegg ? [KEGG_COL, KEGG_CAT_COL, KEGG_GRP_COL] : []),
        ...ogKinds.flatMap((k) => [OG_COLS[k].group, OG_COLS[k].cat, OG_COLS[k].area]),
        ...(withMsig ? [MSIG_COL] : []),
        ...(withReactome ? [REACTOME_COL, REACTOME_GRP_COL, REACTOME_CAT_COL] : [])
      ]
      const resultFields = [
        ...outFields,
        ...(withEssential ? [ESSENTIAL_COL] : []),
        ...(withCeg ? [CEG_COL] : [])
      ]
      // What a full fetch must have covered, for the cache test: the output columns, the internal
      // taxon / KEGG-org, and a version marker per source whose resolution has changed since.
      const requiredCols = [
        ...outFields,
        ...(withTaxon ? [TAXON_COL] : []),
        ...(withKegg ? [KEGGORG_COL, RESOLVER_TOKEN.kegg] : []),
        ...(ogKinds.length ? [RESOLVER_TOKEN.cog] : []),
        ...(withMsig ? [RESOLVER_TOKEN.msigdb] : []),
        ...(withReactome ? [RESOLVER_TOKEN.reactome] : [])
      ]
      if (uniq.length === 0) return { byId: {}, fields: resultFields, found: 0, taxon: 0 }

      // A refresh re-queries every source for every accession, cache or no cache. It's the way out
      // when a cached value is wrong rather than merely old — the version markers above only retire
      // entries for a source whose resolver we KNEW had changed.
      const refresh = opts?.refresh === true
      if (refresh) resetReferenceMemos()
      const store = (await readJson<UniStore>(storePath())) ?? { byAcc: {} }
      const covers = (acc: string): boolean => {
        if (refresh) return false
        const e = store.byAcc[acc]
        return !!e && requiredCols.every((c) => e.got.includes(c))
      }

      let error: string | undefined
      // Fetch a set of accessions from UniProt and fold them into the store.
      const fetchInto = async (accs: string[]): Promise<string> => {
        const byId: Record<string, Record<string, string>> = {}
        const extra = emptyExtras()
        const meta = { release: '' }
        onProg(0, accs.length)
        for (let i = 0; i < accs.length; i += CHUNK) {
          await fetchUniprotChunk(
            accs.slice(i, i + CHUNK),
            uni.map((u) => u.uni),
            outCols,
            extras,
            byId,
            extra,
            meta
          )
          onProg(Math.min(i + CHUNK, accs.length), accs.length)
        }
        // The taxon is the one extra that's also persisted — STRING reads it back from the cache.
        for (const [acc, t] of Object.entries(extra.organism)) (byId[acc] ??= {})[TAXON_COL] = t
        if (withKegg) {
          onProg(0, 0, 'Resolving KEGG pathways…')
          await addKeggPathways(extra.kegg, byId, (d, t) =>
            onProg(0, 0, `Resolving KEGG pathways… ${d}/${t}`)
          )
          // Stash each accession's KEGG organism code (the 'hsa' of 'hsa:7157') for STRING pathway mode.
          for (const [acc, kg] of Object.entries(extra.kegg)) {
            const org = kg.split(':')[0].trim()
            if (org) (byId[acc] ??= {})[KEGGORG_COL] = org
          }
        }
        if (ogKinds.length) {
          onProg(0, 0, `Resolving ${ogKinds.join(' / ')} groups…`)
          await addCogGroups(extra.eggnog, byId, ogKinds)
        }
        if (withMsig) {
          onProg(0, 0, 'Loading MSigDB hallmark sets…')
          await addMsigdbSets(
            accs,
            (acc) => extra.symbol[acc] ?? '',
            (acc) => extra.organism[acc] ?? '',
            byId
          )
        }
        if (withReactome) {
          onProg(0, 0, 'Downloading the Reactome pathway map…')
          await addReactomePathways(accs, byId)
        }
        for (const acc of accs) {
          const e = (store.byAcc[acc] ??= { got: [], fields: {}, release: meta.release })
          for (const c of requiredCols) if (!e.got.includes(c)) e.got.push(c)
          // This fetch REPLACES what it re-resolved: a value it no longer produces (a stale group
          // from an older resolver, a pathway since dropped) must not outlive it in the cache.
          for (const c of outFields) delete e.fields[c]
          const rec = byId[acc]
          if (rec) for (const [c, v] of Object.entries(rec)) if (v) e.fields[c] = v
          if (meta.release) e.release = meta.release
        }
        return meta.release
      }

      try {
        // Nothing to look up remotely — every selected field is a local accession join (DEG,
        // CEG/NEG). Skip the round-trip instead of asking UniProt for a column of bare accessions.
        const uncovered = outFields.length > 0 ? uniq.filter((a) => !covers(a)) : []
        let release = ''
        if (uncovered.length > 0) release = await fetchInto(uncovered)
        // Version check: once we know the live release, refresh any covered accession stamped with
        // an older one. (Skipped entirely when everything was already cached — stays offline.)
        if (release) {
          const stale = uniq.filter((a) => covers(a) && store.byAcc[a]?.release !== release)
          if (stale.length > 0) await fetchInto(stale)
        }
        if (uncovered.length > 0) await writeJson(storePath(), store)
      } catch (e) {
        error = e instanceof Error ? e.message : 'Annotation fetch failed'
      }

      // Build the result (requested columns only) and the dominant taxon / KEGG org from the store.
      const byId: Record<string, Record<string, string>> = {}
      const taxonTally = new Map<number, number>()
      const keggOrgTally = new Map<string, number>()
      let found = 0
      for (const acc of uniq) {
        const e = store.byAcc[acc]
        const rec: Record<string, string> = {}
        if (e) for (const c of outFields) if (e.fields[c]) rec[c] = e.fields[c]
        // Local lookups — independent of whether UniProt had the accession.
        if (withEssential && isEssentialAccession(acc)) rec[ESSENTIAL_COL] = 'essential'
        if (withCeg) {
          const cls = cegClass(acc)
          if (cls) rec[CEG_COL] = cls
        }
        if (Object.keys(rec).length > 0) {
          byId[acc] = rec
          found++
        }
        if (e && withTaxon) {
          const t = parseInt(e.fields[TAXON_COL] ?? '', 10)
          if (Number.isFinite(t) && t > 0) taxonTally.set(t, (taxonTally.get(t) ?? 0) + 1)
        }
        if (e && withKegg) {
          const org = (e.fields[KEGGORG_COL] ?? '').trim()
          if (org) keggOrgTally.set(org, (keggOrgTally.get(org) ?? 0) + 1)
        }
      }
      let taxon = 0
      let bestN = 0
      for (const [t, n] of taxonTally) if (n > bestN) [taxon, bestN] = [t, n]
      let keggOrg = ''
      let bestK = 0
      for (const [org, n] of keggOrgTally) if (n > bestK) [keggOrg, bestK] = [org, n]

      // KEGG categories, built at the organism level so they populate even when every accession was
      // already cached (the per-gene KEGG fetch above only runs on uncovered accessions).
      let keggCategories: Record<string, string> = {}
      if (withKegg) {
        try {
          keggCategories = await buildKeggCategories([...keggOrgTally.keys()])
        } catch {
          /* best-effort — no categories just means uncoloured labels */
        }
      }

      return {
        byId,
        fields: resultFields,
        found,
        taxon,
        keggOrg,
        ...(Object.keys(keggCategories).length ? { keggCategories } : {}),
        error
      }
    }
  )
}
