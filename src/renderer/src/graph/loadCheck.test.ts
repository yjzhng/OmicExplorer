import { describe, expect, it } from 'vitest'

import { matrixColumns, missingImportColumns } from '../engine/interactive'
import { againstStamp, loadCheckInfo, loadCheckProblem } from './loadCheck'

describe('Load tile checks', () => {
  it("reads a matrix's columns from its first line", () => {
    expect(matrixColumns('﻿id\t"s 1"\ts2\r\nP1\t1\t2\n')).toEqual(['id', 's 1', 's2'])
    expect(matrixColumns('id,s1')).toEqual(['id', 's1'])
  })

  it('names the columns the saved import uses that a new raw file lacks', () => {
    const roles = { id: 'id', s1: 'sample', s2: 'sample', note: 'ignore' } as const
    expect(missingImportColumns(['id', 's1', 's2', 'extra'], roles)).toEqual([])
    // an ignored column may go; a sample may not
    expect(missingImportColumns(['id', 's1'], roles)).toEqual(['s2'])
  })

  it('stops a run only when the files can’t be read', () => {
    expect(loadCheckProblem({ state: 'ok' }, 'interactive')).toBeNull()
    expect(
      loadCheckProblem({ state: 'sourceMissing', name: '/a/b/raw.tsv' }, 'interactive')
    ).toBeNull()
    expect(
      loadCheckInfo({ state: 'sourceMissing', name: '/a/b/raw.tsv' }, 'interactive').label
    ).toContain('(raw.tsv)')
    expect(loadCheckProblem({ state: 'filesChanged', names: ['d.csv'] }, 'manual')).toBeNull()
    expect(loadCheckProblem({ state: 'filesMissing', names: ['d.csv'] }, 'manual')).toBe(
      'File not found: d.csv'
    )
    expect(
      loadCheckProblem({ state: 'columns', missing: ['a', 'b', 'c', 'd'] }, 'interactive')
    ).toContain('a, b, c and 1 more')
  })
})

describe('a file against its stamp', () => {
  const stamp = { name: 'raw.tsv', size: 10, mtime: 100, hash: 'abc' }
  const hashed = (hash: string) => async () => ({ size: 10, mtime: 200, hash })

  it('is the same file at the same size and time, without hashing', async () => {
    const never = async () => {
      throw new Error('hashed')
    }
    expect(await againstStamp(stamp, 'raw.tsv', { size: 10, mtime: 100 }, never)).toBe('same')
  })

  it('is another file at another size', async () => {
    expect(await againstStamp(stamp, 'raw.tsv', { size: 11, mtime: 100 }, hashed('abc'))).toBe(
      'changed'
    )
  })

  it('is re-stamped when moved, copied or picked again with the same bytes', async () => {
    expect(
      await againstStamp(stamp, '/new/raw.tsv', { size: 10, mtime: 200 }, hashed('abc'))
    ).toEqual({ name: '/new/raw.tsv', size: 10, mtime: 200, hash: 'abc' })
    expect(await againstStamp(stamp, 'raw.tsv', { size: 10, mtime: 200 }, hashed('xyz'))).toBe(
      'changed'
    )
  })
})
