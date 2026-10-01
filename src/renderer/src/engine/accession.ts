/**
 * Feature IDs as they arrive from search engines, and the proteins they name.
 *
 * A quantified feature is often a PROTEIN GROUP — proteins the observed peptides can't tell apart —
 * written as one `;`-joined ID (`Q6P1R3-3;Q6P1R3;Q6P1R3-2`), its members possibly wrapped as
 * `sp|ACC|NAME` and possibly isoforms (`-N`). The group is what was measured, so it stays ONE
 * feature, keyed by its ID exactly as it arrived. Its members are what external sources know about
 * (UniProt, GO, KEGG, STRING …), keyed by the canonical accession: every isoform of an entry folds
 * back into that entry.
 *
 * So annotation is fetched per member and saved per member, and a group carries the UNION of its
 * members' annotation — it is "one of these proteins", so it belongs wherever any of them does.
 */

/** A UniProt accession with an isoform suffix, capturing the accession. UniProt's own accession
 *  format (uniprot.org/help/accession_numbers), so only a real accession loses its `-N`: a gene
 *  symbol like `NKX2-1` or a decoy `REV__Q15147-5` doesn't match and is left alone. */
const UNIPROT_ISOFORM =
  /^((?:[OPQ][0-9][A-Z0-9]{3}[0-9])|(?:[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}))-\d+$/

/** The canonical accession for an isoform ID (`Q9ULV3-5` → `Q9ULV3`); anything else unchanged. */
export function canonicalAccession(id: string): string {
  return id.trim().replace(UNIPROT_ISOFORM, '$1')
}

/** The distinct proteins a feature ID names, canonical and in order: split on `;`, unwrap
 *  `db|ACC|NAME`, drop isoform suffixes. `Q6P1R3-3;Q6P1R3;Q6P1R3-2` → `['Q6P1R3']`. */
export function groupMembers(id: string): string[] {
  const out: string[] = []
  for (const raw of id.split(';')) {
    const t = raw.trim()
    if (!t) continue
    const parts = t.split('|')
    const acc = canonicalAccession(parts.length >= 3 ? parts[1] : t)
    if (acc && !out.includes(acc)) out.push(acc)
  }
  return out
}

/** One key for matching an ID against another: its canonical members, `;`-joined. A group and a
 *  differently-written copy of it (wrapped, isoform-suffixed, reordered duplicates) key alike. */
export function matchKey(id: string): string {
  return groupMembers(id).join(';')
}

/** The distinct `;`-separated tokens across several values, in first-seen order, `;`-joined.
 *  How a group's annotation column is formed from its members' (a term list stays a term list;
 *  members that disagree on a single-valued field keep both values). */
export function unionValues(values: Iterable<string>): string {
  const seen: string[] = []
  for (const v of values)
    for (const raw of v.split(';')) {
      const t = raw.trim()
      if (t && !seen.includes(t)) seen.push(t)
    }
  return seen.join(';')
}

/** Columns written as position-aligned lists: the i-th token of each follower belongs to the i-th
 *  of the key column (one COG/KOG area per functional category, one KEGG pathway category and group
 *  per pathway, one Reactome group and top-level pathway per term — repeats included). They're unioned as ROWS, keyed by the first column —
 *  deduplicating each on its own would shift the pairing. */
const ALIGNED_COLUMNS: string[][] = [
  ['COG_cat', 'COG_area'],
  ['KOG_cat', 'KOG_area'],
  ['KEGG', 'KEGG_cat', 'KEGG_grp'],
  ['Reactome', 'Reactome_grp', 'Reactome_cat']
]

const tokens = (v: string | undefined): string[] => (v ?? '').split(';').map((t) => t.trim())

/** Union several per-protein annotation records, column by column (see unionValues); aligned
 *  columns (ALIGNED_COLUMNS) pair by pair. */
export function unionRecords(
  recs: (Record<string, string> | undefined)[]
): Record<string, string> | undefined {
  const present = recs.filter((r): r is Record<string, string> => r != null)
  const out: Record<string, string> = {}
  const paired = new Set<string>()
  for (const [keyCol, ...valCols] of ALIGNED_COLUMNS) {
    for (const c of [keyCol, ...valCols]) paired.add(c)
    const rowsByKey = new Map<string, string[]>()
    for (const r of present) {
      const vals = valCols.map((c) => tokens(r[c]))
      tokens(r[keyCol]).forEach((k, i) => {
        if (k && !rowsByKey.has(k))
          rowsByKey.set(
            k,
            vals.map((v) => v[i] ?? '')
          )
      })
    }
    if (rowsByKey.size === 0) continue
    out[keyCol] = [...rowsByKey.keys()].join(';')
    valCols.forEach((c, j) => {
      const col = [...rowsByKey.values()].map((v) => v[j])
      if (col.some(Boolean)) out[c] = col.join(';')
    })
  }
  const cols = new Map<string, string[]>()
  for (const r of present)
    for (const c in r) {
      const v = r[c]
      if (paired.has(c) || v == null || v === '') continue
      const arr = cols.get(c)
      if (arr) arr.push(v)
      else cols.set(c, [v])
    }
  for (const [c, vals] of cols) {
    const u = unionValues(vals)
    if (u) out[c] = u
  }
  return Object.keys(out).length ? out : undefined
}

/** Key token → its paired token, across every gene, from two position-aligned columns (ALIGNED_
 *  COLUMNS): a KEGG pathway → its pathway category or group, a COG/KOG functional category → its
 *  area. First pairing seen wins; empty partners are skipped. */
export function pairsOf(
  ann: Record<string, Record<string, string>>,
  keyCol: string,
  valCol: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const uid in ann) {
    const rec = ann[uid]
    if (!rec[keyCol] || !rec[valCol]) continue
    const vals = tokens(rec[valCol])
    tokens(rec[keyCol]).forEach((k, i) => {
      if (k && vals[i] && !(k in out)) out[k] = vals[i]
    })
  }
  return out
}

/** DB column names read as another: earlier annotation fetches' names, and other DB formats' — so
 *  their files still enrich and group. A DB carrying the new name as well keeps its own. */
export const COLUMN_ALIASES: Record<string, string> = {
  cogCategory: 'COG_cat',
  cogArea: 'COG_area',
  keggPathway: 'KEGG',
  msigdbSet: 'MSigDB',
  reactomePathway: 'Reactome',
  essentiality: 'DEG',
  essentialityCEG: 'CEG_NEG',
  // the prokaryotic DB format's pathway column (its KG_PC / KG_PG levels aren't position-aligned
  // with it, so they can't stand in for KEGG_cat / KEGG_grp)
  KG_PW: 'KEGG'
}
