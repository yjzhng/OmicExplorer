/**
 * The annotation handler end to end, offline: a canned UniProt TSV plus the NCBI COG/KOG tables are
 * served to a stubbed `fetch`, and the handler's result is checked. The point is the wiring that
 * has no other guard — UniProt's columns are read BY POSITION, so the order the handler asks for
 * fields in has to match the order it unpacks them, and a feed-in field (the eggNOG xref) must not
 * leak into the output columns.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (
  evt: unknown,
  accessions: string[],
  fields: string[],
  opts?: { refresh?: boolean }
) => Promise<AnnotOut>
interface AnnotOut {
  byId: Record<string, Record<string, string>>
  fields: string[]
  found: number
  taxon?: number
  error?: string
}

const handlers: Record<string, Handler> = {}
vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: Handler) => void (handlers[ch] = fn) }
}))
// Stand in for the on-disk accession cache. `seedStore` pre-loads it; otherwise runs start cold.
interface UniEntry {
  got: string[]
  fields: Record<string, string>
  release: string
}
let seedStore: { byAcc: Record<string, UniEntry> } | null = null
let written: { byAcc: Record<string, UniEntry> } | null = null
vi.mock('./cache', () => ({
  cacheRoot: () => '/tmp/omicexplorer-test',
  readJson: async () => seedStore,
  writeJson: async (_p: string, v: unknown) => void (written = v as typeof written)
}))

const { registerAnnotate, RESOLVER_TOKEN } = await import('./annotate')

// Stand-in rows, one per case the resolver has to handle: a prokaryote with a COG, a eukaryote with
// a KOG (what UniProt hands out there instead), and a protein whose only group is an eggNOG-native
// ENOG that NCBI doesn't define. The accessions are labels — the eggNOG values are chosen to cover
// the branches, not copied from live UniProt (real TP53, for one, is an ENOG case).
const UNIPROT_COLS = [
  'protein_name',
  'gene_names',
  'xref_string',
  'xref_kegg',
  'organism_id',
  'xref_eggnog'
]
const UNIPROT_ROWS: Record<string, string[]> = {
  P0A7B8: [
    'ATP-dependent protease subunit HslV',
    'hslV',
    '83333.b3932',
    'eco:b3932;',
    '83333',
    'COG5405;'
  ],
  P04637: [
    'Cellular tumor antigen p53',
    'TP53 P53',
    '9606.ENSP00000269305',
    'hsa:7157;',
    '9606',
    'KOG4281;'
  ],
  Q9XXXX: ['Uncharacterized protein', 'yfoo', '', '', '9606', 'ENOG502QVY3;'],
  // Two groups at once, one of which NCBI doesn't define.
  Q8DUM1: ['Hypothetical protein', 'hypo', '', '', '9606', 'COG9999;COG5405;']
}
// Lines as NCBI's cog-24.fun.tab has them: an area heading (`n \t NAME`), then its categories
// (`letter \t n \t colour \t description`).
const FUN_TAB = [
  '1\tINFORMATION STORAGE AND PROCESSING',
  'K\t1\tFCDCEC\tTranscription',
  '2\tCELLULAR PROCESSES AND SIGNALING',
  'O\t2\t9CFC9C\tPosttranslational modification, protein turnover, chaperones',
  // The one category the file gives no colour.
  'X\t2\tMobilome: prophages, transposons'
].join('\n')
const COG_DEF =
  'COG5405\tO\tATP-dependent protease HslVU (ClpYQ), peptidase subunit\tHslV\t\t\t1G3I'
// Group headers are unindented; the member lines under them must not be picked up as groups.
const KOG_DEF = ['[K] KOG4281 Transcription factor p53', '  hsa:  7157', '  mmu:  22059'].join('\n')

const ok = (body: string): Response =>
  ({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === 'x-uniprot-release' ? '2026_01' : null) },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer
  }) as unknown as Response

let asked: string[] = []
beforeEach(() => {
  asked = []
  seedStore = null
  written = null
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url)
    if (url.includes('cog-24.fun.tab')) return ok(FUN_TAB)
    if (url.includes('cog-20.def.tab')) return ok(COG_DEF)
    if (url.includes('/KOG/kog')) return ok(KOG_DEF)
    if (url.includes('rest.uniprot.org')) {
      // Answer in the order the handler asked for the fields, as UniProt does.
      const cols = new URL(url).searchParams.get('fields')!.split(',')
      const want = decodeURIComponent(url)
        .match(/accession:(\w+)/g)!
        .map((m) => m.slice(10))
      const row = (acc: string): string =>
        [acc, ...cols.slice(1).map((c) => UNIPROT_ROWS[acc][UNIPROT_COLS.indexOf(c)] ?? '')].join(
          '\t'
        )
      return ok([cols.join('\t'), ...want.map(row)].join('\n'))
    }
    // Reactome: P04637 sits in a pathway FOUR levels deep (Cell Cycle › Checkpoints › G1/S
    // checkpoints › TP53 regulates G1/S), and in a level-2 pathway under two top-level ones.
    if (url.includes('UniProt2Reactome'))
      return ok(
        [
          'P04637\tR-HSA-6\turl\tTP53 regulates G1/S\tTAS\tHomo sapiens',
          'P04637\tR-HSA-5\turl\tShared step\tTAS\tHomo sapiens'
        ].join('\n')
      )
    if (url.includes('ReactomePathwaysRelation'))
      return ok(
        [
          'R-HSA-1\tR-HSA-2',
          'R-HSA-2\tR-HSA-3',
          'R-HSA-3\tR-HSA-6',
          'R-HSA-1\tR-HSA-5',
          'R-HSA-4\tR-HSA-5'
        ].join('\n')
      )
    if (url.includes('ReactomePathways.txt'))
      return ok(
        [
          'R-HSA-1\tCell Cycle\tHomo sapiens',
          'R-HSA-2\tCell Cycle Checkpoints\tHomo sapiens',
          'R-HSA-3\tG1/S DNA Damage Checkpoints\tHomo sapiens',
          'R-HSA-4\tDisease\tHomo sapiens',
          'R-HSA-5\tShared step\tHomo sapiens',
          'R-HSA-6\tTP53 regulates G1/S\tHomo sapiens'
        ].join('\n')
      )
    if (url.includes('rest.kegg.jp/link/pathway')) return ok('eco:b3932\tpath:eco03050')
    if (url.includes('rest.kegg.jp/list/pathway'))
      return ok('eco03050\tProteasome - Escherichia coli')
    // BRITE br08901's htext: A = pathway category, B = pathway group, C = the pathway.
    if (url.includes('rest.kegg.jp/get/br:br08901'))
      return ok(
        'A09120 Genetic Information Processing\nB  09123 Folding, sorting and degradation\nC    03050 Proteasome'
      )
    throw new Error(`unexpected fetch ${url}`)
  })
  registerAnnotate()
})

const run = (fields: string[]): Promise<AnnotOut> =>
  handlers['annot:uniprot']({ sender: { send: () => {} } }, Object.keys(UNIPROT_ROWS), fields)

describe('annot:uniprot — essentiality', () => {
  // Both sources are local accession joins, so they must report even for an accession UniProt has
  // nothing for — and must stay in their own columns rather than being merged into one verdict.
  const ESS = 'P06493' // CDK1, in CEGv2
  const NON = 'Q9H221' // ABCG8, in NEGv1

  it('reports CEG/NEG as essential, non-essential or absent, in its own column', async () => {
    const res = await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      [ESS, NON, 'P0A7B8'],
      ['ceg']
    )
    expect(res.fields).toEqual(['CEG_NEG'])
    expect(res.byId[ESS]?.CEG_NEG).toBe('essential')
    expect(res.byId[NON]?.CEG_NEG).toBe('non-essential')
    // A bacterial accession is in neither set: absent, which is NOT the same as non-essential.
    expect(res.byId['P0A7B8']?.CEG_NEG).toBeUndefined()
  })

  it('keeps DEG and CEG/NEG as separate columns when both are asked for', async () => {
    const res = await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      [ESS],
      ['essentiality', 'ceg']
    )
    expect(res.fields).toEqual(['DEG', 'CEG_NEG'])
  })

  it('needs no network — the sets are vendored', async () => {
    await handlers['annot:uniprot']({ sender: { send: () => {} } }, [ESS], ['ceg'])
    expect(asked).toEqual([])
  })
})

describe('annot:uniprot — COG / KOG', () => {
  it('resolves COGs for prokaryotes and KOGs for eukaryotes', async () => {
    const res = await run(['protein_name', 'cog', 'kog'])
    expect(res.error).toBeUndefined()
    expect(res.fields).toEqual([
      'proteinName',
      'COG',
      'COG_cat',
      'COG_area',
      'KOG',
      'KOG_cat',
      'KOG_area'
    ])
    expect(res.byId.P0A7B8.COG).toBe('ATP-dependent protease HslVU (ClpYQ), peptidase subunit')
    expect(res.byId.P0A7B8.COG_cat).toBe(
      'Posttranslational modification, protein turnover, chaperones'
    )
    expect(res.byId.P0A7B8.KOG).toBeUndefined()
    // The eukaryotic half — in its own KOG columns, never the COG ones.
    expect(res.byId.P04637.KOG).toBe('Transcription factor p53')
    expect(res.byId.P04637.KOG_cat).toBe('Transcription')
    expect(res.byId.P04637.COG).toBeUndefined()
    expect(res.byId.P04637.COG_cat).toBeUndefined()
  })

  it("gives each category the area NCBI's file puts it under, in the same order", async () => {
    const res = await run(['protein_name', 'cog', 'kog'])
    expect(res.byId.P0A7B8.COG_area).toBe('Cellular processes and signaling')
    expect(res.byId.P04637.KOG_area).toBe('Information storage and processing')
    expect(res.byId.Q9XXXX.COG_area).toBeUndefined()
  })

  it('names the group instead of printing its id, keeping the id only when unnamed', async () => {
    const res = await run(['protein_name', 'cog', 'kog'])
    // The id is a lookup key, not a label — but a group with no definition has nothing else to show.
    expect(res.byId.Q8DUM1.COG).toBe(
      'COG9999; ATP-dependent protease HslVU (ClpYQ), peptidase subunit'
    )
    expect(res.byId.P0A7B8.COG).not.toMatch(/COG\d/)
    expect(res.byId.P04637.KOG).not.toMatch(/KOG\d/)
  })

  it('leaves eggNOG-native groups unannotated rather than inventing a category', async () => {
    const res = await run(['protein_name', 'cog', 'kog'])
    expect(res.byId.Q9XXXX.COG).toBeUndefined()
    expect(res.byId.Q9XXXX.COG_cat).toBeUndefined()
    expect(res.byId.Q9XXXX.KOG).toBeUndefined()
    expect(res.byId.Q9XXXX.proteinName).toBe('Uncharacterized protein')
  })

  it('keeps the eggNOG feed-in field out of the returned columns', async () => {
    const res = await run(['protein_name', 'cog', 'kog'])
    for (const rec of Object.values(res.byId))
      expect(Object.keys(rec).every((c) => !c.startsWith('_'))).toBe(true)
    expect(res.fields).not.toContain('_eggnog')
  })

  it('unpacks the right column when other sources shift the field order', async () => {
    // KEGG and STRING both add fields ahead of the eggNOG xref; a positional slip shows up here.
    const res = await run(['protein_name', 'gene_names', 'kegg', 'cog', 'kog', 'string'])
    expect(res.byId.P0A7B8.proteinName).toBe('ATP-dependent protease subunit HslV')
    expect(res.byId.P0A7B8.geneName).toBe('hslV')
    expect(res.byId.P0A7B8.COG_cat).toBe(
      'Posttranslational modification, protein turnover, chaperones'
    )
    expect(res.byId.P04637.KOG_cat).toBe('Transcription')
    expect(res.taxon).toBe(9606) // dominant taxon across the three
  })

  it('re-resolves accessions left behind by an older COG resolver', async () => {
    // An entry an earlier build wrote and marked covered — the value it holds is one no current
    // build would produce. Without the version marker the entry looks complete and is served
    // forever, so neither a missing KOG (v1) nor a stale format (v2) could ever be corrected.
    seedStore = {
      byAcc: {
        P04637: {
          got: ['proteinName', 'COG', 'cogCategory', '@cog:1'],
          fields: { proteinName: 'Cellular tumor antigen p53', COG: 'COG0000 stale format' },
          release: '2026_01'
        }
      }
    }
    const res = await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      ['P04637'],
      ['protein_name', 'cog', 'kog']
    )
    expect(res.byId.P04637.KOG).toBe('Transcription factor p53')
    expect(res.byId.P04637.KOG_cat).toBe('Transcription')
    expect(res.byId.P04637.COG).toBeUndefined() // the stale COG value isn't carried over
    expect(written?.byAcc.P04637.got).toContain(RESOLVER_TOKEN.cog)
  })

  it('serves an accession cached by the CURRENT resolver without re-fetching', async () => {
    seedStore = {
      byAcc: {
        P04637: {
          got: [
            'proteinName',
            'COG',
            'COG_cat',
            'COG_area',
            'KOG',
            'KOG_cat',
            'KOG_area',
            RESOLVER_TOKEN.cog
          ],
          fields: {
            proteinName: 'Cellular tumor antigen p53',
            KOG: 'Transcription factor p53'
          },
          release: '2026_01'
        }
      }
    }
    const res = await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      ['P04637'],
      ['protein_name', 'cog', 'kog']
    )
    expect(res.byId.P04637.KOG).toBe('Transcription factor p53')
    expect(asked).toEqual([]) // fully cached — stays offline
  })

  it('re-queries everything when asked to refresh, however complete the cache looks', async () => {
    // The escape hatch for a cached value that is wrong rather than merely old — no version marker
    // can retire an entry whose resolver nobody knew was broken.
    seedStore = {
      byAcc: {
        P04637: {
          got: [
            'proteinName',
            'COG',
            'COG_cat',
            'COG_area',
            'KOG',
            'KOG_cat',
            'KOG_area',
            RESOLVER_TOKEN.cog
          ],
          fields: { proteinName: 'stale name', KOG: 'stale group' },
          release: '2026_01'
        }
      }
    }
    const res = await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      ['P04637'],
      ['protein_name', 'cog', 'kog'],
      { refresh: true }
    )
    expect(res.byId.P04637.proteinName).toBe('Cellular tumor antigen p53')
    expect(res.byId.P04637.KOG).toBe('Transcription factor p53')
    expect(asked.some((u) => u.includes('rest.uniprot.org'))).toBe(true)
    expect(asked.some((u) => u.includes('ftp.ncbi.nlm.nih.gov'))).toBe(true)
  })

  it('a refresh re-pulls the reference tables too, not just the accessions', async () => {
    const ncbi = (): boolean => asked.some((u) => u.includes('ftp.ncbi.nlm.nih.gov'))
    // The COG/KOG defs are memoised for the whole session, so an ordinary fetch reuses them…
    await run(['protein_name', 'cog', 'kog'])
    asked = []
    await run(['protein_name', 'cog', 'kog'])
    expect(ncbi()).toBe(false)
    // …but a refresh has to drop that memo, or "re-query the sources" quietly wouldn't.
    asked = []
    await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      Object.keys(UNIPROT_ROWS),
      ['protein_name', 'cog', 'kog'],
      { refresh: true }
    )
    expect(ncbi()).toBe(true)
  })

  it("doesn't touch NCBI when no accession has a definable group", async () => {
    const res = await handlers['annot:uniprot'](
      { sender: { send: () => {} } },
      ['Q9XXXX'],
      ['cog', 'kog']
    )
    expect(res.byId.Q9XXXX).toBeUndefined()
    expect(asked.some((u) => u.includes('ftp.ncbi.nlm.nih.gov'))).toBe(false)
  })

  it('fetches COG and KOG as separate picks', async () => {
    const cog = await run(['protein_name', 'cog'])
    expect(cog.fields).toEqual(['proteinName', 'COG', 'COG_cat', 'COG_area'])
    expect(cog.byId.P0A7B8.COG_cat).toBeDefined()
    expect(cog.byId.P04637.KOG).toBeUndefined()
    const kog = await run(['protein_name', 'kog'])
    expect(kog.fields).toEqual(['proteinName', 'KOG', 'KOG_cat', 'KOG_area'])
    expect(kog.byId.P04637.KOG_cat).toBe('Transcription')
    expect(kog.byId.P0A7B8.COG).toBeUndefined()
  })
})

describe('annot:uniprot — KEGG', () => {
  it('gives each pathway its pathway category and group, in aligned columns', async () => {
    const res = await run(['protein_name', 'kegg'])
    expect(res.fields).toEqual(['proteinName', 'KEGG', 'KEGG_cat', 'KEGG_grp'])
    expect(res.byId.P0A7B8.KEGG).toBe('Proteasome')
    expect(res.byId.P0A7B8.KEGG_cat).toBe('Genetic Information Processing')
    expect(res.byId.P0A7B8.KEGG_grp).toBe('Folding, sorting and degradation')
  })
})

describe('annot:uniprot — Reactome', () => {
  it('rolls each pathway up to its level-3 term, with level-2 group and top-level category', async () => {
    const res = await run(['protein_name', 'reactome'])
    expect(res.fields).toEqual(['proteinName', 'Reactome', 'Reactome_grp', 'Reactome_cat'])
    // the level-4 pathway is tested as its level-3 ancestor; the level-2 one stays itself, and
    // carries both its top-level parents
    expect(res.byId.P04637.Reactome).toBe('G1/S DNA Damage Checkpoints; Shared step')
    expect(res.byId.P04637.Reactome_grp).toBe('Cell Cycle Checkpoints; Shared step')
    expect(res.byId.P04637.Reactome_cat).toBe('Cell Cycle; Cell Cycle / Disease')
  })
})
