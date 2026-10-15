import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_LIVE, glSlot, resetGlBudget } from './glBudget'

const plot = (dense: boolean, shown: boolean) => {
  const calls: boolean[] = []
  const slot = glSlot({ dense, shown }, (a) => calls.push(a))
  return { slot, calls }
}

describe('glBudget', () => {
  beforeEach(() => {
    resetGlBudget()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('grants WebGL only to dense plots, up to MAX_LIVE', () => {
    const sparse = plot(false, true)
    expect(sparse.slot.allowed()).toBe(false)
    const dense = Array.from({ length: MAX_LIVE + 1 }, () => plot(true, true))
    expect(dense.filter((p) => p.slot.allowed()).length).toBe(MAX_LIVE)
  })

  it('a newly shown tab takes over; the hidden plots give WebGL up only when idle', () => {
    const tabA = Array.from({ length: MAX_LIVE }, () => plot(true, true))
    expect(tabA.every((p) => p.slot.allowed())).toBe(true)
    // switch tabs: A hidden, B shown
    tabA.forEach((p) => p.slot.update({ shown: false }))
    const tabB = Array.from({ length: 2 }, () => plot(true, true))
    expect(tabB.every((p) => p.slot.allowed())).toBe(true)
    // A keeps its WebGL through the switch (no re-render of a tab being left)…
    expect(tabA.filter((p) => p.slot.allowed()).length).toBe(MAX_LIVE)
    // …until idle, when the least recent give it up
    vi.advanceTimersByTime(2000)
    const live = [...tabA, ...tabB].filter((p) => p.slot.allowed()).length
    expect(live).toBe(MAX_LIVE)
    expect(tabA.filter((p) => !p.slot.allowed()).length).toBe(2)
    expect(tabA.flatMap((p) => p.calls)).toEqual([false, false])
  })

  it('a plot whose context was lost stays SVG and frees its slot', () => {
    const ps = Array.from({ length: MAX_LIVE + 1 }, () => plot(true, true))
    const loser = ps.find((p) => !p.slot.allowed())!
    const winner = ps.find((p) => p.slot.allowed())!
    winner.slot.lost()
    expect(winner.slot.allowed()).toBe(false)
    expect(winner.calls).toEqual([false])
    expect(loser.slot.allowed()).toBe(true)
    expect(loser.calls).toEqual([true])
  })

  it('3-D scenes take contexts off the top; the dense plots share the rest', () => {
    const dense = Array.from({ length: MAX_LIVE }, () => plot(true, true))
    expect(dense.every((p) => p.slot.allowed())).toBe(true)
    // one scene mounted: a dense plot gives its slot up at once (it's on screen)
    const scene = glSlot({ dense: false, shown: true, scenes: 1 }, () => {})
    expect(dense.filter((p) => p.slot.allowed()).length).toBe(MAX_LIVE - 1)
    // the scene unmounted: the slot comes back
    scene.release()
    expect(dense.filter((p) => p.slot.allowed()).length).toBe(MAX_LIVE)
  })

  it('a released plot frees its slot; density changes are followed', () => {
    const ps = Array.from({ length: MAX_LIVE + 1 }, () => plot(true, true))
    const waiting = ps.find((p) => !p.slot.allowed())!
    ps.find((p) => p.slot.allowed())!.slot.release()
    expect(waiting.slot.allowed()).toBe(true)
    waiting.slot.update({ dense: false })
    expect(waiting.slot.allowed()).toBe(false)
  })
})
