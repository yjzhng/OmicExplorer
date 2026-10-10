import { describe, expect, it } from 'vitest'

import {
  dataFolderName,
  dataRootOf,
  outDirName,
  pathSeg,
  planRenames,
  uniqueSeg,
  withDiskNames,
  workflowDirOf
} from './diskNames'
import { emptyWorkflow, newFolder, type ProjectFolder } from './project'

describe('pathSeg', () => {
  it('keeps readable names and replaces illegal characters', () => {
    expect(pathSeg('WT vs clpP')).toBe('WT vs clpP')
    expect(pathSeg('a/b:c*d')).toBe('a_b_c_d')
  })
  it('never yields an empty, hidden or traversal segment', () => {
    expect(pathSeg('  ')).toBe('untitled')
    expect(pathSeg('..')).toBe('untitled')
    expect(pathSeg('.hidden')).toBe('hidden')
    expect(pathSeg('trailing. ', 'x')).toBe('trailing')
    expect(pathSeg('', 'Step')).toBe('Step')
  })
})

describe('uniqueSeg', () => {
  it('suffixes a taken name, ignoring case', () => {
    expect(uniqueSeg('Compare', [])).toBe('Compare')
    expect(uniqueSeg('Compare', ['compare'])).toBe('Compare (2)')
    expect(uniqueSeg('Compare', ['Compare', 'Compare (2)'])).toBe('Compare (3)')
  })
})

describe('dataFolderName', () => {
  it('is the project name plus _data', () => {
    expect(dataFolderName('My Study')).toBe('My Study_data')
  })
})

describe('withDiskNames', () => {
  const folder = (): ProjectFolder => {
    const f = newFolder('/data/exp')
    const w2 = { ...emptyWorkflow('Workflow 1') } // same name as the first
    return { ...f, workflows: [...f.workflows, w2] }
  }

  it('pins unique workflow folders, and the data folder once saved', () => {
    const unsaved = withDiskNames([folder()], false, 'Untitled project')
    expect(unsaved[0].workflows.map((w) => w.dir)).toEqual(['Workflow 1', 'Workflow 1 (2)'])
    expect(unsaved[0].dataName).toBeUndefined()

    const saved = withDiskNames(unsaved, true, 'My Study')
    expect(saved[0].dataName).toBe('My Study_data')
  })

  it('leaves pinned names alone and returns the same array when nothing is missing', () => {
    const once = withDiskNames([folder()], true, 'A')
    const renamed = once.map((f) => ({
      ...f,
      workflows: f.workflows.map((w) => ({ ...w, name: 'Renamed' }))
    }))
    const again = withDiskNames(renamed, true, 'B')
    expect(again).toBe(renamed)
    expect(again[0].dataName).toBe('A_data')
    expect(again[0].workflows[0].dir).toBe('Workflow 1')
  })
})

describe('dataRootOf / workflowDirOf', () => {
  const f = { ...newFolder('/data/exp'), id: 'fd-9', dataName: 'Old_data' }
  it('uses the stored data folder once saved, the scratch before', () => {
    expect(dataRootOf(f, { saved: true, projectName: 'New', scratch: '/tmp/s' })).toBe(
      '/data/exp/Old_data'
    )
    expect(dataRootOf(f, { saved: false, projectName: 'New', scratch: '/tmp/s' })).toBe(
      '/tmp/s/fd-9'
    )
    expect(dataRootOf(f, { saved: false, projectName: 'New', scratch: null })).toBeNull()
  })
  it('puts a workflow under its stored folder name', () => {
    const w = { ...emptyWorkflow('Shown name'), dir: 'Disk name' }
    expect(workflowDirOf('/r', w)).toBe('/r/Disk name')
  })
})

describe('outDirName', () => {
  it('keeps a stored name, else derives a unique one from the title', () => {
    expect(outDirName({ s1: 'Kept' }, 's1', 'Whatever')).toBe('Kept')
    expect(outDirName({ s1: 'Compare' }, 's2', 'Compare')).toBe('Compare (2)')
    expect(outDirName(undefined, 's1', 'WT vs clpP')).toBe('WT vs clpP')
  })
})

describe('planRenames', () => {
  it('renames only what changed, and never onto an untouched sibling', () => {
    const plan = planRenames([
      { key: 'a', dir: 'A', want: 'A' },
      { key: 'b', dir: 'B', want: 'A' }
    ])
    expect(plan.find((p) => p.key === 'a')?.to).toBe('A')
    expect(plan.find((p) => p.key === 'b')?.to).toBe('A (2)')
  })
  it('lets two folders swap names', () => {
    const plan = planRenames([
      { key: 'a', dir: 'A', want: 'B' },
      { key: 'b', dir: 'B', want: 'A' }
    ])
    expect(Object.fromEntries(plan.map((p) => [p.key, p.to]))).toEqual({ a: 'B', b: 'A' })
  })
  it('allows a case-only rename', () => {
    expect(planRenames([{ key: 'a', dir: 'compare', want: 'Compare' }])[0].to).toBe('Compare')
  })
})
