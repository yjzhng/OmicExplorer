/** A Load tile's declared numeric conditions: one declaration for both import modes (as its units),
 *  so switching the tile between the interactive import and manual keeps it. */
import { describe, expect, it, vi } from 'vitest'

const noop = (): void => {}
vi.stubGlobal('window', {
  api: new Proxy({}, { get: () => () => noop }),
  addEventListener: noop,
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop })
})
vi.stubGlobal('localStorage', { getItem: () => null, setItem: noop, removeItem: noop })

const { useGraph } = await import('./store')
const { declaredNumeric } = await import('./types')
type LoadConfig = import('./types').LoadConfig

// The seed pipeline's Load tile.
const load = (): LoadConfig =>
  useGraph.getState().nodes.find((n) => n.id === 'load-1')!.data.config as LoadConfig

describe('declaredNumeric', () => {
  it('reads the tile’s one declaration, else an older import’s', () => {
    expect(declaredNumeric({ data: null, samplesheet: null, db: null })).toEqual([])
    const legacy = {
      data: null,
      samplesheet: null,
      db: null,
      interactive: { numericConditions: ['temp'] }
    } as unknown as LoadConfig
    expect(declaredNumeric(legacy)).toEqual(['temp'])
    // once the tile has its own (even empty), that one wins
    expect(declaredNumeric({ ...legacy, numericConditions: [] })).toEqual([])
  })
})

describe('setLoadNumeric', () => {
  it('declares on the tile, whatever the mode, and survives a mode switch', () => {
    const s = useGraph.getState()
    s.updateConfig('load-1', { mode: 'interactive' })
    s.setLoadNumeric('load-1', 'temp', true, { stale: false })
    expect(declaredNumeric(load())).toEqual(['temp'])
    s.updateConfig('load-1', { mode: 'manual' })
    expect(declaredNumeric(load())).toEqual(['temp'])
    s.setLoadNumeric('load-1', 'temp', false)
    expect(declaredNumeric(load())).toEqual([])
  })
  it('takes an older import’s declaration over, so it no longer reads separately', () => {
    const s = useGraph.getState()
    s.updateConfig('load-1', {
      numericConditions: undefined,
      interactive: { ...(load().interactive ?? {}), numericConditions: ['temp'] }
    })
    expect(declaredNumeric(load())).toEqual(['temp'])
    s.setLoadNumeric('load-1', 'dose_x', true)
    expect(load().numericConditions).toEqual(['temp', 'dose_x'])
    expect(load().interactive?.numericConditions).toBeUndefined()
  })
})
