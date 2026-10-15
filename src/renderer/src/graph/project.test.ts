import { describe, expect, it } from 'vitest'

import {
  deserializeProject,
  geneMaskKey,
  isNewerVersion,
  newProjectFile,
  nextWorkflowId,
  packedResultsChunks,
  ParkedRef,
  PROJECT_VERSION,
  RawJson,
  savedByVersion,
  serializeProject,
  serializeProjectChunks,
  unpackParked,
  type ProjectFile
} from './project'
import type { NodeResult } from './types'
import { emptyWorkflowDoc } from './workflowDoc'

function sampleResults(): Record<string, NodeResult> {
  return {
    'std-1': {
      kind: 'standardize',
      std: {
        rows: [{ uniqID: 'g1', cell: '', cmpd: 'E28', dose: 0.3, time: 72, rep: 1, value: 9.2 }],
        displayMap: { g1: 'Rv1155a' },
        activeConditions: ['cmpd', 'dose', 'time']
      }
    } as unknown as NodeResult
  }
}

describe('project (folders) serialization', () => {
  it('round-trips folders, their workflows, active ids, and embedded results', () => {
    const proj: ProjectFile = {
      format: 'omicexplorer-project',
      version: 2,
      name: 'My study',
      activeFolderId: 'fd-a',
      folders: [
        {
          id: 'fd-a',
          name: 'exp1',
          path: '/data/exp1',
          activeWorkflowId: 'wf-a',
          workflows: [
            { id: 'wf-a', name: 'QC', doc: emptyWorkflowDoc(), results: sampleResults() },
            { id: 'wf-b', name: 'Contrast', doc: emptyWorkflowDoc(), results: {} }
          ]
        },
        {
          id: 'fd-b',
          name: 'exp2',
          path: '/data/exp2',
          activeWorkflowId: 'wf-c',
          workflows: [{ id: 'wf-c', name: 'Main', doc: emptyWorkflowDoc(), results: {} }]
        }
      ]
    }
    const back = deserializeProject(serializeProject(proj))
    expect(back.name).toBe('My study')
    expect(back.activeFolderId).toBe('fd-a')
    expect(back.folders.map((f) => f.path)).toEqual(['/data/exp1', '/data/exp2'])
    expect(back.folders[0].workflows.map((w) => w.name)).toEqual(['QC', 'Contrast'])
    expect(Object.keys(back.folders[0].workflows[0].results)).toEqual(['std-1'])
  })

  it('migrates a v1 (flat dataDir + workflows) project into a single folder', () => {
    const v1 = JSON.stringify({
      format: 'omicexplorer-project',
      name: 'Legacy',
      dataDir: '/old/data',
      activeWorkflowId: 'w2',
      workflows: [
        { id: 'w1', name: 'A', doc: emptyWorkflowDoc(), results: {} },
        { id: 'w2', name: 'B', doc: emptyWorkflowDoc(), results: {} }
      ]
    })
    const back = deserializeProject(v1)
    expect(back.version).toBe(PROJECT_VERSION)
    expect(back.folders).toHaveLength(1)
    expect(back.folders[0].path).toBe('/old/data')
    expect(back.folders[0].workflows.map((w) => w.name)).toEqual(['A', 'B'])
    expect(back.folders[0].activeWorkflowId).toBe('w2')
  })

  it('fills defaults and repairs a dangling active folder id', () => {
    const back = deserializeProject(
      JSON.stringify({ name: 'x', activeFolderId: 'gone', folders: [] })
    )
    expect(back.folders).toHaveLength(1)
    expect(back.activeFolderId).toBe(back.folders[0].id)
  })

  it('reserves ids on load so a newly minted workflow id cannot collide with a saved one', () => {
    // Regression: the id counter resets each launch; without reservation the next id would be
    // wf-1, colliding with the saved wf-1 (so switching to the "new" workflow lands on the old one).
    deserializeProject(
      JSON.stringify({
        format: 'omicexplorer-project',
        version: 2,
        name: 'ids',
        activeFolderId: 'fd-7',
        folders: [
          {
            id: 'fd-7',
            name: 'f',
            path: '/d',
            activeWorkflowId: 'wf-3',
            workflows: [
              { id: 'wf-1', name: 'A', doc: emptyWorkflowDoc(), results: {} },
              { id: 'wf-2', name: 'B', doc: emptyWorkflowDoc(), results: {} },
              { id: 'wf-3', name: 'C', doc: emptyWorkflowDoc(), results: {} }
            ]
          }
        ]
      })
    )
    const fresh = nextWorkflowId()
    const n = Number(/-(\d+)$/.exec(fresh)?.[1])
    expect(n).toBeGreaterThan(3) // past wf-3 and fd-7 → no collision
  })

  it('migrates the pre-rename `strain` condition to `cell` in configs and embedded results', () => {
    const p = deserializeProject(
      JSON.stringify({
        format: 'omicexplorer-project',
        version: 2,
        name: 'old',
        activeFolderId: 'fd-1',
        folders: [
          {
            id: 'fd-1',
            name: 'f',
            path: '/d',
            activeWorkflowId: 'wf-1',
            workflows: [
              {
                id: 'wf-1',
                name: 'A',
                doc: {
                  ...emptyWorkflowDoc(),
                  nodes: [
                    {
                      id: 'std-1',
                      kind: 'standardize',
                      config: { activeConditions: ['strain', 'dose'], minSamplePctPerStrain: true }
                    },
                    {
                      id: 'cmp-1',
                      kind: 'compare',
                      config: {
                        num: { strain: ['M'] },
                        den: { strain: ['W'] },
                        match: ['strain', 'time'],
                        condition: 'strain',
                        condition2: 'time'
                      }
                    },
                    {
                      id: 'imp-1',
                      kind: 'interactive',
                      config: {
                        conditions: { s1: { sample: 's1', strain: 'WT', cmpd: 'A' } },
                        spans: { s1: { strain: [0, 2] } }
                      }
                    },
                    { id: 'cl-1', kind: 'cluster', config: { colorBy: 'strain' }, name: 'strain' }
                  ]
                },
                results: {
                  'std-1': {
                    kind: 'standardize',
                    std: {
                      rows: [{ uniqID: 'g1', strain: 'WT', cmpd: 'A', value: 1 }],
                      activeConditions: ['strain'],
                      cleanup: { perStrain: true }
                    }
                  },
                  'cmp-1': {
                    kind: 'compare',
                    cmp: { rows: [{ uniqID: 'g1', strain: 'M', cmp_cond: 'cmpd:strain' }] }
                  }
                }
              }
            ]
          }
        ]
      })
    )
    const nodes = p.folders[0].workflows[0].doc.nodes as unknown as {
      id: string
      config: Record<string, unknown>
      name?: string
    }[]
    const cfg = (id: string): Record<string, unknown> => nodes.find((n) => n.id === id)!.config
    expect(cfg('std-1')).toEqual({ activeConditions: ['cell', 'dose'], minSamplePctBy: ['cell'] })
    expect(cfg('cmp-1')).toEqual({
      num: { cell: ['M'] },
      den: { cell: ['W'] },
      match: ['cell', 'time'],
      condition: 'cell',
      condition2: 'time'
    })
    expect(cfg('imp-1')).toEqual({
      conditions: { s1: { sample: 's1', cell: 'WT', cmpd: 'A' } },
      spans: { s1: { cell: [0, 2] } }
    })
    expect(cfg('cl-1')).toEqual({ colorBy: 'cell' })
    // A user-visible node name is left alone — it's a label, not a key.
    expect(nodes.find((n) => n.id === 'cl-1')!.name).toBe('strain')
    const res = p.folders[0].workflows[0].results as unknown as Record<
      string,
      { std?: unknown; cmp?: { rows: unknown[] } }
    >
    expect(res['std-1'].std).toEqual({
      rows: [{ uniqID: 'g1', cell: 'WT', cmpd: 'A', value: 1 }],
      activeConditions: ['cell'],
      cleanup: { by: ['cell'] }
    })
    expect(res['cmp-1'].cmp?.rows[0]).toEqual({ uniqID: 'g1', cell: 'M', cmp_cond: 'cmpd:cell' })
    expect(JSON.stringify(p)).not.toMatch(/"strain"\s*:/) // no key left under the old name
  })

  it('migration is a no-op on a project already using `cell`, and `cell` wins over a stale `strain`', () => {
    const doc = {
      ...emptyWorkflowDoc(),
      nodes: [
        {
          id: 'cmp-1',
          kind: 'compare',
          config: { num: { cell: ['M'], strain: ['X'] }, match: ['cell'] }
        }
      ]
    }
    const p = deserializeProject(
      JSON.stringify({
        format: 'omicexplorer-project',
        version: 2,
        name: 'new',
        activeFolderId: 'fd-1',
        folders: [
          {
            id: 'fd-1',
            name: 'f',
            path: '/d',
            activeWorkflowId: 'wf-1',
            workflows: [{ id: 'wf-1', name: 'A', doc, results: {} }]
          }
        ]
      })
    )
    const node = p.folders[0].workflows[0].doc.nodes[0] as unknown as {
      config: Record<string, unknown>
    }
    expect(node.config).toEqual({ num: { cell: ['M'] }, match: ['cell'] })
  })

  it('newProjectFile starts with one folder + one workflow, no data path', () => {
    const p = newProjectFile('Fresh')
    expect(p.name).toBe('Fresh')
    expect(p.folders).toHaveLength(1)
    expect(p.folders[0].path).toBe('')
    expect(p.folders[0].workflows).toHaveLength(1)
    expect(p.activeFolderId).toBe(p.folders[0].id)
  })
})

describe('project genesets', () => {
  const gene = (id: string): { id: string; label: string } => ({ id, label: id })
  const wf = (id: string, doc: Record<string, unknown>): Record<string, unknown> => ({
    id,
    name: id,
    doc: { ...emptyWorkflowDoc(), ...doc },
    results: {}
  })

  it('gathers per-workflow genesets (before 0.3.6) into the project, out of the workflow docs', () => {
    const raw = {
      format: 'omicexplorer-project',
      version: 3,
      name: 'P',
      activeFolderId: 'fd-1',
      folders: [
        {
          id: 'fd-1',
          name: 'F',
          path: '/d',
          activeWorkflowId: 'wf-1',
          workflows: [
            wf('wf-1', {
              geneSets: [
                { id: 'gs_a', name: 'A', genes: [gene('g1')], hidden: true },
                { id: 'gs_b', name: 'B', genes: [gene('g2')] }
              ]
            }),
            // the same set (a copied workflow) merges: genes united, hidden if hidden in any
            wf('wf-2', { geneSets: [{ id: 'gs_a', name: 'A', genes: [gene('g1'), gene('g3')] }] }),
            // legacy flat favourites become the "Favourites" set
            wf('wf-3', { favourites: [gene('g4')] })
          ]
        }
      ]
    }
    const p = deserializeProject(JSON.stringify(raw))
    expect(p.geneSets).toEqual([
      { id: 'gs_a', name: 'A', genes: [gene('g1'), gene('g3')], hidden: true },
      { id: 'gs_b', name: 'B', genes: [gene('g2')] },
      { id: 'gs_favourites', name: 'Favourites', genes: [gene('g4')] }
    ])
    const ws = p.folders[0].workflows
    for (const w of ws) {
      expect(w.doc.geneSets).toBeUndefined()
      expect(w.doc.favourites).toBeUndefined()
    }
    // each workflow remembers the mask its results were classified under: its OWN hidden sets
    expect(ws[0].mask).toBe(geneMaskKey([{ id: 'x', name: 'x', genes: [gene('g1')], hidden: true }]))
    expect(ws[1].mask).toBe('')
    expect(ws[1].mask).not.toBe(geneMaskKey(p.geneSets ?? []))
  })

  it('round-trips project genesets and workflow masks', () => {
    const p = newProjectFile('P')
    p.geneSets = [{ id: 'gs_a', name: 'A', genes: [gene('g1')], hidden: true, color: '#ff0000' }]
    p.folders[0].workflows[0].mask = geneMaskKey(p.geneSets)
    const back = deserializeProject(serializeProject(p))
    expect(back.geneSets).toEqual(p.geneSets)
    expect(back.folders[0].workflows[0].mask).toBe(p.folders[0].workflows[0].mask)
  })

  it('keys the mask by the hidden sets\' genes only', () => {
    const a = { id: 'a', name: 'a', genes: [gene('g1'), gene('g2')], hidden: true }
    const b = { id: 'b', name: 'b', genes: [gene('g2'), gene('g1')], hidden: true }
    expect(geneMaskKey([])).toBe('')
    expect(geneMaskKey([{ ...a, hidden: false }])).toBe('')
    expect(geneMaskKey([a])).toBe(geneMaskKey([b]))
    expect(geneMaskKey([a])).not.toBe(geneMaskKey([{ ...a, genes: [gene('g1')] }]))
  })
})

describe('project format version', () => {
  it('records and reads back the app version that saved a file', () => {
    const text = serializeProject({ ...newProjectFile('P'), appVersion: '0.3.5' })
    expect(savedByVersion(text)).toBe('0.3.5')
    expect(savedByVersion(serializeProject(newProjectFile('P')))).toBeNull()
  })

  it('opens a file from a newer app or format (the open path only warns)', () => {
    const text = serializeProject({
      ...newProjectFile('P'),
      version: PROJECT_VERSION + 1,
      appVersion: '9.9.9'
    })
    expect(deserializeProject(text).name).toBe('P')
  })

  it('compares dotted versions numerically', () => {
    expect(isNewerVersion('0.3.10', '0.3.5')).toBe(true)
    expect(isNewerVersion('0.4.0', '0.3.5')).toBe(true)
    expect(isNewerVersion('0.3.5', '0.3.5')).toBe(false)
    expect(isNewerVersion('0.3.4', '0.3.5')).toBe(false)
  })
})

describe('serializeProjectChunks', () => {
  it('round-trips a project exactly as JSON would, results packed', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({
      uniqID: `g${i}`,
      cmpd: i % 2 ? 'A' : 'B',
      dose: i % 3 ? i : null,
      value: i === 5 ? NaN : i * 1.5,
      thrsh: 'linear, log2FC ∉ (-1.0, 1.0)',
      ...(i % 4 ? { cell: 'WT' } : null),
      curve: i % 5 ? { pec50: -i / 10, n: 6, axis: 'dose' } : undefined,
      extra: i % 7 ? null : { geno: 'x"y' },
      flag: i % 2 === 0
    }))
    const annot = { P1: { GO_BP: 'a;b' }, P2: { GO_BP: 'c' } }
    const proj = {
      format: 'omicexplorer-project',
      version: 2,
      name: 'p',
      folders: [
        {
          id: 'folder-1',
          name: 'f',
          path: '',
          activeWorkflowId: 'wf-1',
          workflows: [
            {
              id: 'wf-1',
              name: 'w',
              doc: { version: 1, nextId: 3, nodes: [], edges: [] },
              results: {
                s: { kind: 'standardize', std: { rows, annotationMap: annot } },
                c: {
                  kind: 'compare',
                  cmp: { rows, comparisons: ['A | B'] },
                  annotationMap: annot,
                  displayMap: {}
                }
              }
            }
          ]
        }
      ],
      activeFolderId: 'folder-1'
    } as unknown as Parameters<typeof serializeProjectChunks>[0]
    const text = serializeProjectChunks(proj).join('')
    expect(() => JSON.parse(text)).not.toThrow()
    // The annotation table is stored once, the row field names once per column.
    expect(text.split('"GO_BP"').length - 1).toBe(2)
    expect(text.split('"uniqID"').length - 1).toBe(2)
    const back = deserializeProject(text)
    const plain = JSON.parse(JSON.stringify(proj.folders[0].workflows[0].results))
    expect(back.folders[0].workflows[0].results).toEqual(plain)
    // Both results share one annotation table again, as they did in memory.
    const r = back.folders[0].workflows[0].results as unknown as Record<
      string,
      { std?: { annotationMap: unknown }; annotationMap?: unknown }
    >
    expect(r.s.std!.annotationMap).toBe(r.c.annotationMap)
  })

  it('still opens results saved unpacked (older files)', () => {
    const results = { s: { kind: 'standardize', std: { rows: [{ uniqID: 'a', value: 1 }] } } }
    const text = JSON.stringify({
      format: 'omicexplorer-project',
      version: 2,
      name: 'old',
      folders: [{ id: 'folder-1', path: '', workflows: [{ id: 'wf-1', results }] }],
      activeFolderId: 'folder-1'
    })
    expect(deserializeProject(text).folders[0].workflows[0].results).toEqual(results)
  })
})

describe('parked workflows in a saved project', () => {
  it('writes parked results as their packed text, identical on open, without the park key', () => {
    const results = {
      s: {
        kind: 'standardize',
        std: { rows: Array.from({ length: 50 }, (_, i) => ({ uniqID: `g${i}`, value: i })) }
      }
    } as unknown as ProjectWorkflowResults
    const parkedText = packedResultsChunks(results).join('')
    expect(unpackParked(parkedText)).toEqual(results)
    const proj = {
      format: 'omicexplorer-project',
      version: 2,
      name: 'p',
      folders: [
        {
          id: 'folder-1',
          name: 'f',
          path: '',
          activeWorkflowId: 'wf-1',
          workflows: [
            {
              id: 'wf-2',
              name: 'other',
              doc: { version: 1, nextId: 1, nodes: [], edges: [] },
              results: new RawJson(parkedText),
              parked: 'wf7'
            }
          ]
        }
      ],
      activeFolderId: 'folder-1'
    } as unknown as Parameters<typeof serializeProjectChunks>[0]
    const text = serializeProjectChunks(proj).join('')
    expect(text).not.toContain('"parked"')
    expect(deserializeProject(text).folders[0].workflows[0].results).toEqual(results)

    // Saved by reference instead (the save path): a { park } piece where the text was, which the
    // main process fills from the park file — giving exactly the same file.
    const wf = proj.folders[0].workflows[0] as unknown as Record<string, unknown>
    wf.results = new ParkedRef('wf7')
    const pieces = serializeProjectChunks(proj)
    expect(pieces).toContainEqual({ park: 'wf7' })
    const filled = pieces.map((p) => (typeof p === 'string' ? p : parkedText)).join('')
    expect(filled).toBe(text)
  })
})

type ProjectWorkflowResults = Parameters<typeof packedResultsChunks>[0]
