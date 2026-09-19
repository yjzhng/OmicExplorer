import { beforeEach, describe, expect, it } from 'vitest'

import { loadLastView, saveLastView } from './lastView'

/** Minimal in-memory localStorage for the node test environment. */
function stubStorage(): void {
  const m = new Map<string, string>()
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0
  } as Storage
}

describe('last view memory', () => {
  beforeEach(stubStorage)

  it('round-trips a position per project path', () => {
    saveLastView('/a.omicexplorer', {
      folderId: 'f1',
      workflowId: 'w2',
      view: 'results',
      resultsTab: 'compare-3'
    })
    expect(loadLastView('/a.omicexplorer')).toEqual({
      folderId: 'f1',
      workflowId: 'w2',
      view: 'results',
      resultsTab: 'compare-3'
    })
    expect(loadLastView('/b.omicexplorer')).toBeNull()
  })

  it('overwrites the same path and keeps other projects', () => {
    const pos = { folderId: 'f1', workflowId: 'w1', view: 'canvas' as const, resultsTab: null }
    saveLastView('/a', pos)
    saveLastView('/b', { ...pos, workflowId: 'w9' })
    saveLastView('/a', { ...pos, view: 'results' })
    expect(loadLastView('/a')?.view).toBe('results')
    expect(loadLastView('/b')?.workflowId).toBe('w9')
  })

  it('tolerates garbage in storage', () => {
    localStorage.setItem('omicexplorer-last-view', '{not json')
    expect(loadLastView('/a')).toBeNull()
    localStorage.setItem('omicexplorer-last-view', JSON.stringify({ '/a': { view: 'bogus' } }))
    expect(loadLastView('/a')).toEqual({
      folderId: null,
      workflowId: null,
      view: 'canvas',
      resultsTab: null
    })
  })
})
