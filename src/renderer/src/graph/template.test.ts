import { describe, expect, it } from 'vitest'

import {
  deserializeProject,
  relocateFolders,
  serializeProject,
  withRelPaths,
  type ProjectFile
} from './project'
import { NODE_SPECS } from './registry'
import {
  buildTemplate,
  DEFAULT_TEMPLATE_SECTIONS,
  fitTemplateSpec,
  isTemplateSpec,
  isTemplateText,
  projectFromTemplate,
  serializeTemplate
} from './template'
import type { InteractiveImport, LoadConfig, NodeResult, PlotGroupConfig } from './types'
import type { WorkflowDoc } from './workflowDoc'

const spec: InteractiveImport = {
  columns: ['PG.ProteinGroups', 'S1_DMSO_1', 'S2_E28_1', 'Q.Value'],
  roles: { 'PG.ProteinGroups': 'id', S1_DMSO_1: 'sample', S2_E28_1: 'sample', 'Q.Value': 'filter' },
  conditions: {
    S1_DMSO_1: { include: true, cmpd: 'DMSO', rep: '1' },
    S2_E28_1: { include: true, cmpd: 'E28', rep: '1' }
  } as unknown as InteractiveImport['conditions'],
  separator: '_',
  preset: 'spectronaut',
  customConditions: ['batch'],
  filters: { 'Q.Value': { max: 0.01 } } as unknown as InteractiveImport['filters'],
  spans: { S1_DMSO_1: { cmpd: [1, 2] } },
  step: 4,
  annotations: { source: 'uniprot', fields: ['geneNames'], byId: { P1: { geneNames: 'A' } } }
}

function doc(): WorkflowDoc {
  const load: LoadConfig = {
    mode: 'interactive',
    data: 'data.csv',
    samplesheet: 'ss.csv',
    db: 'db.csv',
    matrix: '/abs/report.tsv',
    units: { dose: 'µM' } as unknown as LoadConfig['units'],
    interactive: spec
  }
  const std = { ...NODE_SPECS.standardize.defaultConfig(), minValid: 3 }
  const volcano = { ...NODE_SPECS.volcano.defaultConfig(), labelTop: 5 }
  const group: PlotGroupConfig = {
    children: [
      {
        id: 'c1',
        kind: 'heatmap',
        config: { ...NODE_SPECS.heatmap.defaultConfig(), maxGenes: 99 },
        status: 'done'
      }
    ]
  }
  return {
    version: 3,
    nextId: 5,
    nodes: [
      { id: 'load-1', position: { x: 0, y: 0 }, data: { kind: 'load', config: load } },
      { id: 'std-2', position: { x: 1, y: 0 }, data: { kind: 'standardize', config: std } },
      { id: 'vol-3', position: { x: 2, y: 0 }, data: { kind: 'volcano', config: volcano } },
      { id: 'grp-4', position: { x: 3, y: 0 }, data: { kind: 'plotGroup', config: group } }
    ],
    edges: [{ id: 'e1', source: 'load-1', target: 'std-2' }],
    groupLayouts: { 'std-2': [{ i: 'vol-3', x: 0, y: 0, w: 4, h: 4 }] },
    groupMeta: { 'std-2': { label: 'Main', order: 0 } },
    frames: [{ id: 'fr-1', label: 'QC', members: ['std-2'] }]
  }
}

function project(): ProjectFile {
  return {
    format: 'omicexplorer-project',
    version: 3,
    name: 'Study',
    activeFolderId: 'fd-1',
    folders: [
      {
        id: 'fd-1',
        name: 'exp1',
        path: '/Users/a/study/exp1',
        rel: 'exp1',
        dataName: 'Study_data',
        activeWorkflowId: 'wf-1',
        workflows: [
          {
            id: 'wf-1',
            name: 'Main',
            doc: doc(),
            results: { 'std-2': { kind: 'plot' } as NodeResult },
            dir: 'Main',
            outDirs: { 'std-2': 'Clean' },
            mask: ''
          }
        ]
      }
    ],
    geneSets: [{ id: 'gs-1', name: 'Hits', genes: [{ id: 'g1', label: 'A' }] }]
  }
}

const nodeCfg = <T>(d: WorkflowDoc, id: string): T =>
  d.nodes.find((n) => n.id === id)!.data.config as T

describe('templates', () => {
  it('keeps the structure and chosen sections, never the data', () => {
    const t = buildTemplate(project(), DEFAULT_TEMPLATE_SECTIONS, 'My template')
    expect(isTemplateText(serializeTemplate(t))).toBe(true)
    const f = t.folders[0]
    expect(f).toEqual(expect.objectContaining({ name: 'exp1', path: '' }))
    expect(f.rel).toBeUndefined()
    expect(f.dataName).toBeUndefined()
    const w = f.workflows[0]
    expect(w.results).toEqual({})
    expect(w.dir).toBeUndefined()
    expect(w.outDirs).toBeUndefined()
    expect(w.doc.edges).toHaveLength(1)
    expect(w.doc.frames).toHaveLength(1)
    expect(w.doc.groupMeta).toEqual({ 'std-2': { label: 'Main', order: 0 } })

    const load = nodeCfg<LoadConfig>(w.doc, 'load-1')
    expect([load.data, load.samplesheet, load.db, load.matrix]).toEqual([null, null, null, null])
    expect(load.units).toEqual({ dose: 'µM' })
    expect(load.interactive?.columns).toEqual([])
    expect(load.interactive?.annotations).toBeUndefined()
    expect(load.interactive?.step).toBe(1)
    expect(load.interactive?.roles['Q.Value']).toBe('filter')

    expect(nodeCfg<{ minValid: number }>(w.doc, 'std-2').minValid).toBe(3)
    expect(nodeCfg<{ labelTop: number }>(w.doc, 'vol-3').labelTop).toBe(5)
    const child = nodeCfg<PlotGroupConfig>(w.doc, 'grp-4').children[0]
    expect(child.status).toBeUndefined()
    expect((child.config as { maxGenes: number }).maxGenes).toBe(99)
    expect(t.geneSets).toEqual([]) // off by default
  })

  it('resets the unticked sections to a fresh tile’s', () => {
    const t = buildTemplate(
      project(),
      {
        analysis: false,
        importMapping: false,
        plotLayout: false,
        plotSettings: false,
        geneSets: true
      },
      'Bare'
    )
    const d = t.folders[0].workflows[0].doc
    const load = nodeCfg<LoadConfig>(d, 'load-1')
    expect(load.interactive).toBeUndefined()
    expect(load.units).toBeUndefined()
    expect(load.mode).toBe('interactive')
    expect(nodeCfg(d, 'std-2')).toEqual(NODE_SPECS.standardize.defaultConfig())
    expect(nodeCfg(d, 'vol-3')).toEqual(NODE_SPECS.volcano.defaultConfig())
    expect(nodeCfg<PlotGroupConfig>(d, 'grp-4').children[0].config).toEqual(
      NODE_SPECS.heatmap.defaultConfig()
    )
    expect(d.groupLayouts).toBeUndefined()
    expect(d.groupMeta).toBeUndefined()
    expect(d.nodes).toHaveLength(4) // the workflow itself always stays
    expect(t.geneSets?.map((g) => g.name)).toEqual(['Hits'])
  })

  it('opens as a new project with folders waiting for data', () => {
    const t = buildTemplate(project(), DEFAULT_TEMPLATE_SECTIONS, 'T')
    const p = projectFromTemplate(serializeTemplate(t))
    expect(p.format).toBe('omicexplorer-project')
    expect(p.folders.map((f) => [f.name, f.path])).toEqual([['exp1', '']])
    expect(p.folders[0].workflows[0].doc.nodes).toHaveLength(4)
    expect(() => projectFromTemplate(serializeProject(project()))).toThrow()
  })
})

describe('fitTemplateSpec', () => {
  it('carries over what matches the new matrix’s headers', () => {
    const tpl = buildTemplate(project(), DEFAULT_TEMPLATE_SECTIONS, 'T')
    const kept = nodeCfg<LoadConfig>(tpl.folders[0].workflows[0].doc, 'load-1').interactive!
    expect(isTemplateSpec(kept)).toBe(true)
    const read: InteractiveImport = {
      columns: ['PG.ProteinGroups', 'S1_DMSO_1', 'S9_E28_2', 'Q.Value'],
      roles: {
        'PG.ProteinGroups': 'id',
        S1_DMSO_1: 'sample',
        S9_E28_2: 'sample',
        'Q.Value': 'meta'
      },
      conditions: {}
    }
    const fit = fitTemplateSpec(kept, read)
    expect(isTemplateSpec(fit)).toBe(false)
    expect(fit.columns).toEqual(read.columns)
    expect(fit.roles['Q.Value']).toBe('filter') // the template's role wins where the header exists
    expect(fit.roles.S9_E28_2).toBe('sample') // a new sample keeps the read role
    expect(Object.keys(fit.roles)).not.toContain('S2_E28_1') // gone from the new matrix
    expect(Object.keys(fit.conditions)).toEqual(['S1_DMSO_1'])
    expect(fit.spans).toEqual({ S1_DMSO_1: { cmpd: [1, 2] } })
    expect(Object.keys(fit.filters ?? {})).toEqual(['Q.Value'])
    expect(fit).toEqual(
      expect.objectContaining({
        separator: '_',
        preset: 'spectronaut',
        customConditions: ['batch']
      })
    )
  })

  it('keeps which custom conditions were declared numeric', () => {
    const tpl = buildTemplate(project(), DEFAULT_TEMPLATE_SECTIONS, 'T')
    const kept = nodeCfg<LoadConfig>(tpl.folders[0].workflows[0].doc, 'load-1').interactive!
    const read: InteractiveImport = { columns: ['PG.ProteinGroups'], roles: {}, conditions: {} }
    expect(
      fitTemplateSpec({ ...kept, numericConditions: ['batch'] }, read).numericConditions
    ).toEqual(['batch'])
  })
})

describe('relative folder paths', () => {
  it('are written at save and survive the round trip', () => {
    const p = project()
    p.folders[0].rel = undefined
    const folders = withRelPaths(p.folders, '/Users/a/study/Study.omicexplorer')
    expect(folders[0].rel).toBe('exp1')
    const back = deserializeProject(serializeProject({ ...p, folders }))
    expect(back.folders[0].rel).toBe('exp1')
    // a folder with no relative path drops a stale one
    expect(withRelPaths(folders, 'C:\\proj\\P.omicexplorer')[0].rel).toBeUndefined()
  })

  it('find a copied project’s folders; the relative path wins when it exists', async () => {
    const p = project()
    const exists = (dirs: string[]) => (q: string) => Promise.resolve(dirs.includes(q))
    // copied to another machine: only the relative location exists
    let r = await relocateFolders(
      p.folders,
      '/Users/b/study/Study.omicexplorer',
      exists(['/Users/b/study/exp1'])
    )
    expect(r.folders[0].path).toBe('/Users/b/study/exp1')
    expect(r.moved).toBe(1)
    // a copy on the same machine: both exist — the copy's own folder, not the original's
    r = await relocateFolders(
      p.folders,
      '/Users/a/copy/Study.omicexplorer',
      exists(['/Users/a/study/exp1', '/Users/a/copy/exp1'])
    )
    expect(r.folders[0].path).toBe('/Users/a/copy/exp1')
    // only the project file moved: the full path is kept
    r = await relocateFolders(
      p.folders,
      '/Users/a/Desktop/Study.omicexplorer',
      exists(['/Users/a/study/exp1'])
    )
    expect(r.folders[0].path).toBe('/Users/a/study/exp1')
    expect(r.moved).toBe(0)
  })
})
