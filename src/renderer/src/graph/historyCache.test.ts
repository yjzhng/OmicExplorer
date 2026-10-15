/** The undo history's result versions: current ones cost nothing, a few replaced ones stay in
 *  memory, the rest spill to disk and read back, unreferenced ones are forgotten, and the disk cap
 *  drops the oldest. */
import { describe, expect, it } from 'vitest'

import { HistoryCache, type HistoryIO } from './historyCache'
import type { NodeResult } from './types'

function fakeDisk(): HistoryIO & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    write: async (key, pieces) => void files.set(key, pieces.join('')),
    read: async (key) => {
      const t = files.get(key)
      if (t == null) throw new Error('missing')
      return t
    },
    drop: async (key) => void files.delete(key),
    pack: (results) => [JSON.stringify(results)],
    unpack: (text) => JSON.parse(text)
  }
}

const res = (tag: string, size = 10): NodeResult =>
  ({ kind: 'pca', tag, pad: 'x'.repeat(size) }) as unknown as NodeResult

describe('HistoryCache', () => {
  it('keeps current versions in memory and writes nothing for them', async () => {
    const io = fakeDisk()
    const h = new HistoryCache(io, { hot: 0 })
    const a = res('a')
    const v = h.ref({ x: a })
    h.sync({ x: a }, new Set(Object.values(v)))
    await h.idle()
    expect(io.files.size).toBe(0)
    expect(h.peek(v.x)).toBe(a)
  })

  it('spills a replaced version past the hot few, and reads it back', async () => {
    const io = fakeDisk()
    const h = new HistoryCache(io, { hot: 1 })
    const ids: number[] = []
    const objs = ['a', 'b', 'c'].map((t) => res(t))
    for (const o of objs) ids.push(h.ref({ x: o }).x)
    // c is current; b is the most recently replaced (hot); a spills.
    h.sync({ x: objs[2] }, new Set(ids))
    await h.idle()
    expect(io.files.size).toBe(1)
    expect(h.peek(ids[0])).toBeUndefined()
    expect(h.peek(ids[1])).toBe(objs[1])
    expect(await h.load(ids[0])).toEqual(objs[0])
  })

  it('forgets versions no snapshot records, files included', async () => {
    const io = fakeDisk()
    const h = new HistoryCache(io, { hot: 0 })
    const a = res('a')
    const b = res('b')
    const ia = h.ref({ x: a }).x
    h.ref({ x: b })
    h.sync({ x: b }, new Set([ia]))
    await h.idle()
    expect(io.files.size).toBe(1)
    h.sync({ x: b }, new Set())
    await h.idle()
    expect(io.files.size).toBe(0)
    expect(h.has(ia)).toBe(false)
    expect(await h.load(ia)).toBeUndefined()
  })

  it('records a threshold family once, and spills it once', async () => {
    const io = fakeDisk()
    const h = new HistoryCache(io, { hot: 0 })
    const base = res('run')
    const id = h.ref({ cmp: base }).cmp
    let cur = base
    for (const t of ['t1', 't2', 't3']) {
      const next = res(t)
      h.derive(next, cur)
      expect(h.ref({ cmp: next }).cmp).toBe(id)
      cur = next
    }
    // While a member is current, nothing is written; once the family is replaced, one file.
    h.sync({ cmp: cur }, new Set([id]))
    await h.idle()
    expect(io.files.size).toBe(0)
    h.sync({ cmp: res('rerun') }, new Set([id]))
    await h.idle()
    expect(io.files.size).toBe(1)
  })

  it('drops the oldest spilled versions past the disk cap', async () => {
    const io = fakeDisk()
    const h = new HistoryCache(io, { hot: 0, diskCap: 250 })
    const objs = ['a', 'b', 'c', 'd'].map((t) => res(t, 100))
    const ids = objs.map((o) => h.ref({ x: o }).x)
    h.sync({ x: res('now') }, new Set(ids))
    await h.idle()
    expect(h.stats().diskSize).toBeLessThanOrEqual(250)
    expect(h.has(ids[0])).toBe(false) // the oldest went
    expect(h.has(ids[3])).toBe(true)
  })

  it('a failed write keeps the version in memory', async () => {
    const io = fakeDisk()
    io.write = async () => {
      throw new Error('disk full')
    }
    const h = new HistoryCache(io, { hot: 0 })
    const a = res('a')
    const ia = h.ref({ x: a }).x
    h.sync({ x: res('b') }, new Set([ia]))
    await h.idle()
    expect(h.peek(ia)).toBe(a)
  })
})
