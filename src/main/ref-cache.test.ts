/**
 * Settings › Database, against a real cache folder on disk: the summary's counts, versions
 * and sizes, that each clear removes exactly what it names, and that a source's
 * Update re-fetches it for the proteins that have it.
 */
import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (evt: unknown, ...args: unknown[]) => Promise<unknown>
const handlers: Record<string, Handler> = {}
let root = ''
vi.mock('electron', () => ({
  app: { getPath: () => root },
  ipcMain: { handle: (ch: string, fn: Handler) => void (handlers[ch] = fn) }
}))

const { registerRefCache } = await import('./ref-cache')
const { RESOLVER_TOKEN } = await import('./annotate')
registerRefCache()

interface Summary {
  uniprot: {
    accessions: number
    releases: { release: string; count: number }[]
    sources: { label: string; field: string; count: number; outdated: number }[]
    species: {
      taxon: number
      count: number
      releases: string[]
      sources: { label: string; count: number; outdated: number }[]
      bytes: number
    }[]
  } | null
  string: { taxon: number; version: string; bytes: number; oldBytes: number; names: boolean }[]
}
const summary = (): Promise<Summary> => handlers['refcache:summary']({}) as Promise<Summary>
const clear = (target: unknown): Promise<boolean> =>
  handlers['refcache:clear']({ sender: {} }, target) as Promise<boolean>

const cache = (...p: string[]): string => join(root, 'reference-cache', ...p)
const write = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'oe-refcache-'))
  write(
    cache('uniprot', 'store.json'),
    JSON.stringify({
      byAcc: {
        P1: {
          got: ['geneName', 'KEGG', RESOLVER_TOKEN.kegg, '_taxon'],
          fields: { geneName: 'A', _taxon: '9606' },
          release: '2026_03'
        },
        P2: {
          got: ['geneName', 'KEGG', '@kegg:1', '_taxon'],
          fields: { _taxon: '9606' },
          release: '2026_02'
        },
        Q3: { got: ['geneName'], fields: {}, release: '2026_03' }
      }
    })
  )
  write(cache('string', '9606', 'manifest.json'), JSON.stringify({ version: '12.0' }))
  write(cache('string', '9606', 'links.v12.0.tsv'), 'x'.repeat(100))
  write(cache('string', '9606', 'info.v12.0.tsv'), 'x'.repeat(10))
  write(cache('string', '9606', 'names.v12.0.tsv'), 'x'.repeat(5))
  write(cache('string', '9606', 'links.v11.5.tsv'), 'x'.repeat(40))
  // a download that never finished: no complete version
  write(cache('string', '562', 'manifest.json'), JSON.stringify({ version: '12.0' }))
  write(cache('string', '562', 'links.v12.0.tsv.part'), 'x'.repeat(7))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('reference cache summary', () => {
  it('counts proteins by release, source (current vs older resolver) and species', async () => {
    const { uniprot } = await summary()
    expect(uniprot?.accessions).toBe(3)
    expect(uniprot?.releases).toEqual([
      { release: '2026_03', count: 2 },
      { release: '2026_02', count: 1 }
    ])
    expect(uniprot?.sources).toEqual([
      { label: 'Gene names', field: 'gene_names', count: 3, outdated: 0 },
      { label: 'KEGG pathways', field: 'kegg', count: 1, outdated: 1 }
    ])
    const species = uniprot?.species ?? []
    expect(species.map((sp) => [sp.taxon, sp.count, sp.releases])).toEqual([
      [9606, 2, ['2026_03', '2026_02']],
      [0, 1, ['2026_03']]
    ])
    // per species, the same sources in the same order
    expect(species[0].sources.map((x) => [x.label, x.count, x.outdated])).toEqual([
      ['Gene names', 2, 0],
      ['KEGG pathways', 1, 1]
    ])
    expect(species[1].sources.map((x) => [x.label, x.count, x.outdated])).toEqual([
      ['Gene names', 1, 0],
      ['KEGG pathways', 0, 0]
    ])
    expect(species.every((sp) => sp.bytes > 0)).toBe(true)
  })

  it("sizes each organism's current files apart from older versions and unfinished downloads", async () => {
    const { string } = await summary()
    expect(string).toEqual([
      expect.objectContaining({ taxon: 562, version: '', bytes: 0, oldBytes: 7, names: false }),
      expect.objectContaining({
        taxon: 9606,
        version: '12.0',
        bytes: 115,
        oldBytes: 40,
        names: true
      })
    ])
  })
})

describe('clearing the reference cache', () => {
  it('clears the UniProt store', async () => {
    expect(await clear({ kind: 'uniprot' })).toBe(true)
    expect((await summary()).uniprot).toBeNull()
  })

  it("clears one species' proteins, keeping the rest", async () => {
    expect(await clear({ kind: 'uniprot-taxon', taxon: 9606 })).toBe(true)
    const { uniprot } = await summary()
    expect(uniprot?.accessions).toBe(1)
    expect(uniprot?.species.map((sp) => sp.taxon)).toEqual([0])
  })

  it('deletes one organism', async () => {
    expect(await clear({ kind: 'string', taxon: 9606 })).toBe(true)
    expect((await summary()).string.map((o) => o.taxon)).toEqual([562])
  })

  it('removes older versions only, keeping the ones networks read', async () => {
    expect(await clear({ kind: 'string-old' })).toBe(true)
    expect(existsSync(cache('string', '9606', 'links.v11.5.tsv'))).toBe(false)
    expect(existsSync(cache('string', '9606', 'links.v12.0.tsv'))).toBe(true)
    expect(existsSync(cache('string', '562', 'links.v12.0.tsv.part'))).toBe(false)
    expect((await summary()).string.every((o) => o.oldBytes === 0)).toBe(true)
  })
})

describe('updating a source', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("re-fetches it for every cached protein that has it, rewriting only that source's column", async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return new Response('Entry\tGene Names\nP1\tNEW1 ALIAS\nP2\tNEW2\nQ3\tNEW3\n', {
        headers: { 'x-uniprot-release': '2026_04' }
      })
    })
    const update = handlers['refcache:updateSource']
    const res = (await update({ sender: { send: () => {} } }, 'gene_names')) as { proteins: number }
    expect(res).toEqual({ proteins: 3 })
    expect(asked).toHaveLength(1)
    expect(decodeURIComponent(asked[0])).toContain('fields=accession,gene_names')
    const store = JSON.parse(readFileSync(cache('uniprot', 'store.json'), 'utf8'))
    expect(store.byAcc.P1.fields).toEqual({ geneName: 'NEW1', _taxon: '9606' })
    expect(store.byAcc.Q3.fields.geneName).toBe('NEW3')
    expect(store.byAcc.P1.release).toBe('2026_04')
    // KEGG's coverage (and its older-resolver mark on P2) is left as it was
    expect(store.byAcc.P2.got).toContain('@kegg:1')
  })

  it('refuses a source it does not know', async () => {
    const res = (await handlers['refcache:updateSource']({ sender: {} }, 'nope')) as {
      error?: string
    }
    expect(res.error).toMatch(/Unknown source/)
  })
})

describe('reference cache browser', () => {
  interface Page {
    cols: string[]
    total: number
    rows: { acc: string; gene: string; values: string[] }[]
  }
  const browse = (q: object): Promise<Page> =>
    handlers['refcache:browse'](
      {},
      { taxon: 9606, field: 'kegg', query: '', offset: 0, limit: 100, ...q }
    ) as Promise<Page>

  it("lists one species' proteins looked up for one source, with that source's columns", async () => {
    const r = await browse({})
    expect(r.cols).toEqual(['KEGG', 'KEGG_cat', 'KEGG_grp'])
    expect(r.rows).toEqual([
      { acc: 'P1', gene: 'A', values: ['', '', ''] },
      { acc: 'P2', gene: '', values: ['', '', ''] }
    ])
  })

  it('keeps to the species: no taxon recorded is its own', async () => {
    const r = await browse({ taxon: 0, field: 'gene_names' })
    expect(r.rows.map((x) => x.acc)).toEqual(['Q3'])
    expect(r.cols).toEqual(['geneName'])
  })

  it('matches every term against the accession, gene and values, case-insensitively', async () => {
    expect((await browse({ query: 'a' })).rows.map((x) => x.acc)).toEqual(['P1'])
    expect((await browse({ query: 'p2' })).rows.map((x) => x.acc)).toEqual(['P2'])
    expect((await browse({ query: 'p1 zzz' })).total).toBe(0)
  })

  it('finds proteins looked up for the source but with no value for it', async () => {
    const r = await browse({ field: 'gene_names', emptyOnly: true })
    expect(r.rows.map((x) => x.acc)).toEqual(['P2'])
  })

  it('pages', async () => {
    expect(await browse({ offset: 1, limit: 1 })).toMatchObject({ total: 2, rows: [{ acc: 'P2' }] })
  })
})
