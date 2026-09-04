/**
 * External annotation fetching (renderer → main IPC). Runs in the main process so it isn't
 * subject to the renderer's CSP. UniProt REST supplies protein/gene/GO/STRING-id/organism by
 * accession; KEGG REST turns the UniProt→KEGG cross-reference into pathway names.
 *
 * Results are cached app-wide (see cache.ts) keyed by accession + UniProt release, so the same
 * proteins are never re-fetched across projects. Only accessions not already covered for the
 * requested fields — or whose cached release is older than the live one — hit the network.
 */
import { ipcMain } from 'electron'
import { cacheRoot, readJson, writeJson } from './cache'
import { isEssentialAccession } from './degEssential'
import { join } from 'path'

/** Requested field id → the UniProtKB REST return field to query and the DB column it fills. */
const UNIPROT_FIELD: Record<string, { uni: string; col: string }> = {
  protein_name: { uni: 'protein_name', col: 'proteinName' },
  gene_names: { uni: 'gene_names', col: 'geneName' },
  go: { uni: 'go', col: 'GO' },
  string: { uni: 'xref_string', col: 'stringId' }
}
const KEGG_COL = 'keggPathway'
/** DB column stamped 'essential' for genes whose UniProt accession is in DEG (Database of Essential
 *  Genes). Locally derived — never fetched. The results menu buckets any /essential/i column. */
const ESSENTIAL_COL = 'essentiality'
/** Internal (never returned) column holding the accession's NCBI taxon, cached for STRING. */
const TAXON_COL = '_taxon'
/** Internal column holding the accession's KEGG organism code (e.g. 'hsa'), for STRING pathway mode. */
const KEGGORG_COL = '_keggOrg'

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
  if (col === 'GO') return v.replace(/\s*\[GO:\d+\]/g, '').trim()
  if (col === 'stringId') return v.split(';')[0].trim()
  return v
}

const CHUNK = 80
/** Per-request network timeout so a stalled UniProt/KEGG connection fails instead of hanging the
 *  whole import forever. */
const FETCH_TIMEOUT = 45000
const fetchT = (url: string): Promise<Response> =>
  fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })

/** Fetch a batch of accessions from UniProt for the given native fields, into `byId` (cleaned
 *  columns; organism → the internal TAXON_COL when requested). Records the response's UniProt
 *  release into `meta`. When `xref_kegg` is requested, fills `keggByAcc` with the KEGG gene id. */
async function fetchUniprotChunk(
  accessions: string[],
  uniFields: string[],
  outCols: string[],
  withKegg: boolean,
  withTaxon: boolean,
  byId: Record<string, Record<string, string>>,
  keggByAcc: Record<string, string>,
  meta: { release: string }
): Promise<void> {
  const query = accessions.map((a) => `accession:${a}`).join(' OR ')
  const fields = [
    'accession',
    ...uniFields,
    ...(withKegg ? ['xref_kegg'] : []),
    ...(withTaxon ? ['organism_id'] : [])
  ].join(',')
  const url =
    `https://rest.uniprot.org/uniprotkb/search?query=${encodeURIComponent(query)}` +
    `&fields=${fields}&format=tsv&size=500`
  const res = await fetchT(url)
  if (!res.ok) throw new Error(`UniProt HTTP ${res.status}`)
  meta.release = res.headers.get('x-uniprot-release') ?? meta.release
  const lines = (await res.text()).replace(/\r/g, '').split('\n').filter(Boolean)
  const taxonIdx = outCols.length + 1 + (withKegg ? 1 : 0)
  for (let r = 1; r < lines.length; r++) {
    const vals = lines[r].split('\t')
    const acc = vals[0]?.trim()
    if (!acc) continue
    const rec: Record<string, string> = byId[acc] ?? (byId[acc] = {})
    for (let c = 0; c < outCols.length; c++) rec[outCols[c]] = cleanValue(outCols[c], vals[c + 1] ?? '')
    if (withKegg) {
      const kegg = (vals[outCols.length + 1] ?? '').split(';')[0].trim() // e.g. "hsa:7157"
      if (kegg) keggByAcc[acc] = kegg
    }
    if (withTaxon) {
      const taxon = (vals[taxonIdx] ?? '').trim()
      if (taxon) rec[TAXON_COL] = taxon
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
          const m = line.slice(1).trim().match(/^(\d{5})\s+(.*)$/)
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

export function registerAnnotate(): void {
  ipcMain.handle(
    'annot:uniprot',
    async (evt, accessions: string[], fields: string[]): Promise<AnnotResult> => {
      const onProg = (done: number, total: number): void =>
        evt.sender.send('annot:progress', { done, total })
      const uniq = [...new Set((accessions ?? []).map((a) => a?.trim()).filter(Boolean))]
      const want = new Set(fields ?? [])
      const uni = Object.keys(UNIPROT_FIELD).filter((id) => want.has(id)).map((id) => UNIPROT_FIELD[id])
      const withKegg = want.has('kegg')
      const withTaxon = want.has('string') // species is fetched only alongside STRING ids
      // Essentiality is a purely LOCAL join against the vendored DEG accession set — no network, no
      // UniProt cache. Kept out of outFields/requiredCols so it never forces a refetch; stamped into
      // the result below and appended to the returned column list.
      const withEssential = want.has('essentiality')
      const outCols = uni.map((u) => u.col)
      const outFields = [...outCols, ...(withKegg ? [KEGG_COL] : [])]
      const resultFields = [...outFields, ...(withEssential ? [ESSENTIAL_COL] : [])]
      // Columns a full fetch must cover (incl. the internal taxon / KEGG-org), for the cache test.
      const requiredCols = [
        ...outFields,
        ...(withTaxon ? [TAXON_COL] : []),
        ...(withKegg ? [KEGGORG_COL] : [])
      ]
      if (uniq.length === 0) return { byId: {}, fields: resultFields, found: 0, taxon: 0 }

      const store = (await readJson<UniStore>(storePath())) ?? { byAcc: {} }
      const covers = (acc: string): boolean => {
        const e = store.byAcc[acc]
        return !!e && requiredCols.every((c) => e.got.includes(c))
      }

      let error: string | undefined
      // Fetch a set of accessions from UniProt and fold them into the store.
      const fetchInto = async (accs: string[]): Promise<string> => {
        const byId: Record<string, Record<string, string>> = {}
        const keggByAcc: Record<string, string> = {}
        const meta = { release: '' }
        onProg(0, accs.length)
        for (let i = 0; i < accs.length; i += CHUNK) {
          await fetchUniprotChunk(
            accs.slice(i, i + CHUNK),
            uni.map((u) => u.uni),
            outCols,
            withKegg,
            withTaxon,
            byId,
            keggByAcc,
            meta
          )
          onProg(Math.min(i + CHUNK, accs.length), accs.length)
        }
        if (withKegg) await addKeggPathways(keggByAcc, byId)
        // Stash each accession's KEGG organism code (the 'hsa' of 'hsa:7157') for STRING pathway mode.
        if (withKegg)
          for (const [acc, kg] of Object.entries(keggByAcc)) {
            const org = kg.split(':')[0]
            if (org) (byId[acc] ??= {})[KEGGORG_COL] = org
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
        const uncovered = uniq.filter((a) => !covers(a))
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
        // Local DEG lookup — independent of whether UniProt had the accession.
        if (withEssential && isEssentialAccession(acc)) rec[ESSENTIAL_COL] = 'essential'
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
