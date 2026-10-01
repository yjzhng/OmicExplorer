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
const KEGG_COL = 'keggPathway'
/** Name(s) of the accession's orthologous group(s), e.g. 'ATP-dependent protease HslVU'. Names
 *  only — the COG/KOG id is a lookup key, not something to read off a plot or a table.
 *  Prokaryotic proteins land in COGs, eukaryotic ones in KOGs — the two halves of the same scheme. */
const COG_COL = 'COG'
/** The COG functional category description(s) — the level COG enrichment is normally read at. */
const COG_CAT_COL = 'cogCategory'
/** The functional area each of those categories sits under, '; '-joined in the SAME order (one per
 *  category; empty where NCBI gives none) — NCBI's own grouping, read from cog-24.fun.tab. */
const COG_AREA_COL = 'cogArea'
const MSIG_COL = 'msigdbSet'
const REACTOME_COL = 'reactomePathway'
/** DB column stamped 'essential' for genes whose UniProt accession is in DEG (Database of Essential
 *  Genes). Locally derived — never fetched. The results menu buckets any /essential/i column. */
const ESSENTIAL_COL = 'essentiality'
/** DB column stamped 'essential' / 'non-essential' from the Hart gold-standard human sets. Also a
 *  purely local join. Separate from DEG rather than merged: the two disagree (DEG is a union of
 *  screens, so it calls context-specific hits essential), and folding them together would bury
 *  that behind a single verdict. */
const CEG_COL = 'essentialityCEG'
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
  cog: '@cog:4',
  msigdb: '@msigdb:1',
  reactome: '@reactome:1'
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

/** map number (5 digits) → top-level KEGG pathway category, parsed from the br08901 BRITE hierarchy.
 *  Organism-independent (keyed by the shared map number), so it's fetched + memoised once. */
let briteCache: Record<string, string> | null = null
async function loadBriteCategories(): Promise<Record<string, string>> {
  if (briteCache) return briteCache
  const out: Record<string, string> = {}
  try {
    const res = await fetchT('https://rest.kegg.jp/get/br:br08901')
    if (res.ok) {
      let cat = ''
      for (const line of (await res.text()).split('\n')) {
        if (!line) continue
        // htext levels: A = top category, B = subcategory, C = "<mapNumber>  <pathway name>".
        // A-lines may be "A<b>Metabolism</b>" or "A09100 Metabolism" — strip markup + any leading code.
        if (line[0] === 'A')
          cat = line
            .slice(1)
            .replace(/<[^>]+>/g, '')
            .replace(/^\d+\s+/, '')
            .trim()
        else if (line[0] === 'C') {
          const m = line
            .slice(1)
            .trim()
            .match(/^(\d{5})\s+(.*)$/)
          if (m && cat) out[m[1]] = cat
        }
      }
    }
  } catch {
    /* best-effort — no categories just means uncoloured labels */
  }
  briteCache = out
  return out
}

/** Clean KEGG's `list/pathway` name ("… - Homo sapiens (human)") to the bare pathway name. Must
 *  match the cleaning in addKeggPathways so category keys line up with the stored keggPathway names. */
const cleanPathwayName = (name: string): string => name.replace(/\s*-\s*[^-]+$/, '').trim()

/** KEGG pathway names for each accession's KEGG gene id: link genes→pathways, then name them. */
async function addKeggPathways(
  keggByAcc: Record<string, string>,
  byId: Record<string, Record<string, string>>
): Promise<void> {
  const genes = [...new Set(Object.values(keggByAcc))]
  if (genes.length === 0) return
  const norm = (p: string): string => p.replace(/^path:/, '').trim()
  const pathByGene: Record<string, string[]> = {}
  for (let i = 0; i < genes.length; i += 100) {
    const chunk = genes.slice(i, i + 100)
    const res = await fetchT(`https://rest.kegg.jp/link/pathway/${chunk.join('+')}`)
    if (!res.ok) continue
    for (const line of (await res.text()).split('\n')) {
      const [g, p] = line.split('\t')
      if (g && p) (pathByGene[g.trim()] ??= []).push(norm(p))
    }
  }
  const orgs = [...new Set(genes.map((g) => g.split(':')[0]))]
  const nameByPath: Record<string, string> = {}
  for (const org of orgs) {
    const res = await fetchT(`https://rest.kegg.jp/list/pathway/${org}`)
    if (!res.ok) continue
    for (const line of (await res.text()).split('\n')) {
      const [p, name] = line.split('\t')
      if (p && name) nameByPath[norm(p)] = cleanPathwayName(name)
    }
  }
  for (const [acc, gene] of Object.entries(keggByAcc)) {
    const names = (pathByGene[gene] ?? []).map((p) => nameByPath[p] ?? p).filter(Boolean)
    if (names.length) (byId[acc] ??= {})[KEGG_COL] = [...new Set(names)].join('; ')
  }
}

/** Pathway name → top-level KEGG category for the given organism codes. Built at the ORGANISM level
 *  (list/pathway + BRITE), so it works even when every accession was already cached and no per-gene
 *  KEGG fetch ran. Best-effort — network failures just yield fewer categories. */
async function buildKeggCategories(orgs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (orgs.length === 0) return out
  const norm = (p: string): string => p.replace(/^path:/, '').trim()
  const brite = await loadBriteCategories()
  if (Object.keys(brite).length === 0) return out
  for (const org of orgs) {
    try {
      const res = await fetchT(`https://rest.kegg.jp/list/pathway/${org}`)
      if (!res.ok) continue
      for (const line of (await res.text()).split('\n')) {
        const [p, name] = line.split('\t')
        if (!p || !name) continue
        const mapNum = norm(p).match(/(\d{5})/)?.[1]
        const cat = mapNum ? brite[mapNum] : undefined
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

/** Turn each accession's eggNOG cross-reference into an orthologous-group name + functional
 *  category. Proteins whose only group is an eggNOG-native `ENOG…` get no COG columns. */
async function addCogGroups(
  eggnogByAcc: Record<string, string>,
  byId: Record<string, Record<string, string>>
): Promise<void> {
  const idsOf = (acc: string): string[] => [
    ...new Set(
      eggnogByAcc[acc]
        .split(/[;,]/)
        .map((t) => t.trim())
        .filter((t) => COG_ID.test(t))
    )
  ]
  const accs = Object.keys(eggnogByAcc)
  // Don't pull the defs for a dataset that has no resolvable group at all.
  if (!accs.some((a) => idsOf(a).length > 0)) return
  const defs = await loadCogDefs()
  for (const acc of accs) {
    const ids = idsOf(acc)
    if (ids.length === 0) continue
    const rec = (byId[acc] ??= {})
    // Names, not ids — falling back to the id only for a group NCBI doesn't name, where it's the
    // only thing left to show. Two ids can share a name, so dedupe after resolving.
    rec[COG_COL] = [...new Set(ids.map((i) => defs.name[i] || i))].join('; ')
    const cats = [...new Set(ids.flatMap((i) => (defs.cats[i] ?? '').split('; ').filter(Boolean)))]
    if (cats.length) {
      rec[COG_CAT_COL] = cats.join('; ')
      // Aligned with the categories, one area each, so a reader can pair them up.
      rec[COG_AREA_COL] = cats.map((c) => defs.area[c] ?? '').join('; ')
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
async function addReactomePathways(
  accs: string[],
  byId: Record<string, Record<string, string>>
): Promise<void> {
  if (accs.length === 0) return
  const need = new Set(accs)
  const res = await fetchT(REACTOME_URL, BULK_TIMEOUT)
  if (!res.ok) throw new Error(`Reactome HTTP ${res.status}`)
  const text = await res.text()
  const hits: Record<string, Set<string>> = {}
  for (let pos = 0; pos < text.length;) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = text.length
    const tab = text.indexOf('\t', pos)
    // Check the accession before slicing the rest of the line — most lines are other species.
    if (tab > pos && tab < end && need.has(text.slice(pos, tab))) {
      const cells = text.slice(pos, end).split('\t')
      const name = cells[3]?.trim()
      if (name) (hits[cells[0]] ??= new Set()).add(name)
    }
    pos = end + 1
  }
  for (const [acc, names] of Object.entries(hits))
    (byId[acc] ??= {})[REACTOME_COL] = [...names].join('; ')
}

/** Drop the per-session reference memos so a forced refresh re-pulls them. Without this a table
 *  that loaded empty earlier in the session (KEGG's BRITE hierarchy swallows its own failures)
 *  would be reused, and "re-query the sources" wouldn't actually re-query them. */
function resetReferenceMemos(): void {
  briteCache = null
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
        ...(withCog ? (['eggnog'] as const) : []),
        ...(needSymbol ? (['symbol'] as const) : [])
      ]
      const outFields = [
        ...outCols,
        ...(withKegg ? [KEGG_COL] : []),
        ...(withCog ? [COG_COL, COG_CAT_COL, COG_AREA_COL] : []),
        ...(withMsig ? [MSIG_COL] : []),
        ...(withReactome ? [REACTOME_COL] : [])
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
        ...(withKegg ? [KEGGORG_COL] : []),
        ...(withCog ? [RESOLVER_TOKEN.cog] : []),
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
          await addKeggPathways(extra.kegg, byId)
          // Stash each accession's KEGG organism code (the 'hsa' of 'hsa:7157') for STRING pathway mode.
          for (const [acc, kg] of Object.entries(extra.kegg)) {
            const org = kg.split(':')[0]
            if (org) (byId[acc] ??= {})[KEGGORG_COL] = org
          }
        }
        if (withCog) {
          onProg(0, 0, 'Resolving COG groups…')
          await addCogGroups(extra.eggnog, byId)
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
