/** A project folder clean-up removes only what the project no longer uses. */
import { describe, expect, it, vi } from 'vitest'

// A fake disk: folder path → its entries.
const tree: Record<string, string[]> = {
  '/data/P_data': ['WF', 'Old workflow/', 'stray.txt'],
  '/data/P_data/WF': ['input/', 'output/', 'notes.txt'],
  '/data/P_data/WF/input': ['m.csv', 'm_wide.csv', 'm_samplesheet.csv', 'unused.csv'],
  '/data/P_data/WF/output': [
    'Compare/',
    'Deleted step/',
    'Clean data/',
    'loose.csv',
    'Compare__Volcano_x.png',
    'Deleted step__Volcano_y.png',
    'selected/'
  ]
}
tree['/data/P_data'][0] = 'WF/'
const listDir = async (dir: string) => {
  const names = tree[dir]
  if (!names) throw new Error('missing')
  return names.map((n) => ({
    name: n.replace(/\/$/, ''),
    path: `${dir}/${n.replace(/\/$/, '')}`,
    dir: n.endsWith('/')
  }))
}
const noop = (): void => {}
vi.stubGlobal('window', {
  api: new Proxy({ listDir } as Record<string, unknown>, {
    get: (t, k: string) => t[k] ?? (() => noop)
  }),
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop, removeItem: noop })

const { useGraph } = await import('./store')
import type { GraphNode } from './types'

const step = (id: string, kind: string, config: Record<string, unknown> = {}): GraphNode =>
  ({ id, type: 'step', position: { x: 0, y: 0 }, data: { kind, config, status: 'done' } }) as never

describe('project folder clean-up', () => {
  it('lists what the project no longer uses, and nothing it does', async () => {
    useGraph.setState({
      projectPath: '/data/P.omicexplorer',
      projectName: 'P',
      activeFolderId: 'f',
      activeWorkflowId: 'w',
      nodes: [
        step('load', 'load', {
          matrix: 'm.csv',
          data: 'm_wide.csv',
          samplesheet: 'm_samplesheet.csv'
        }),
        step('std', 'standardize'),
        step('cmp', 'compare')
      ],
      edges: [],
      folders: [
        {
          id: 'f',
          path: '/data',
          dataName: 'P_data',
          workflows: [
            {
              id: 'w',
              name: 'WF',
              dir: 'WF',
              outDirs: { cmp: 'Compare', gone: 'Deleted step' },
              doc: { nodes: [], edges: [] }
            }
          ]
        }
      ] as never
    })
    const plan = await useGraph.getState().planCleanup('f')
    expect(plan?.root).toBe('/data/P_data')
    expect(plan?.remove.sort()).toEqual(
      [
        '/data/P_data/Old workflow',
        '/data/P_data/stray.txt',
        '/data/P_data/WF/notes.txt',
        '/data/P_data/WF/input/unused.csv',
        '/data/P_data/WF/output/Deleted step',
        '/data/P_data/WF/output/loose.csv',
        '/data/P_data/WF/output/Deleted step__Volcano_y.png'
      ].sort()
    )
    // kept: the live steps' folders (Compare pinned; Clean data not yet pinned, by its name) and
    // the input files the Load tile reads
  })
})
