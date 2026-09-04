import { describe, expect, it } from 'vitest'

import {
  deserializeProject,
  newProjectFile,
  nextWorkflowId,
  serializeProject,
  type ProjectFile
} from './project'
import type { NodeResult } from './types'
import { emptyWorkflowDoc } from './workflowDoc'

function sampleResults(): Record<string, NodeResult> {
  return {
    'std-1': {
      kind: 'standardize',
      std: {
        rows: [{ uniqID: 'g1', strain: '', cmpd: 'E28', dose: 0.3, time: 72, rep: 1, value: 9.2 }],
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
    expect(back.version).toBe(2)
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

  it('newProjectFile starts with one folder + one workflow, no data path', () => {
    const p = newProjectFile('Fresh')
    expect(p.name).toBe('Fresh')
    expect(p.folders).toHaveLength(1)
    expect(p.folders[0].path).toBe('')
    expect(p.folders[0].workflows).toHaveLength(1)
    expect(p.activeFolderId).toBe(p.folders[0].id)
  })
})
