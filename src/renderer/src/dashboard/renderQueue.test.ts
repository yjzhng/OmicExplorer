import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { enqueueReveal, resetRevealQueue, REVEAL_TIMEOUT_MS, type RevealJob } from './renderQueue'
import { createDrawTracker } from '../ui/tileDraw'

// Frames and idle moments are driven by hand: `frame()` runs the pending rAF callbacks, `idle()`
// the pending idle callbacks.
let rafs: FrameRequestCallback[] = []
let idles: IdleRequestCallback[] = []
const frame = (): void => {
  const cbs = rafs
  rafs = []
  cbs.forEach((cb) => cb(0))
}
const idle = (): void => {
  const cbs = idles
  idles = []
  cbs.forEach((cb) => cb({ didTimeout: false, timeRemaining: () => 50 }))
}

beforeEach(() => {
  vi.useFakeTimers()
  rafs = []
  idles = []
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafs.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('requestIdleCallback', (cb: IdleRequestCallback) => idles.push(cb))
  resetRevealQueue()
})
afterEach(() => {
  resetRevealQueue()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A job that logs its run and keeps its `done` for the test to call. */
function job(log: string[], name: string, dones: Record<string, () => void>): RevealJob {
  return (done) => {
    log.push(name)
    dones[name] = done
  }
}

describe('renderQueue', () => {
  it('runs one job, waits for its done, then yields a frame before the next', () => {
    const log: string[] = []
    const d: Record<string, () => void> = {}
    enqueueReveal(job(log, 'a', d))
    enqueueReveal(job(log, 'b', d))
    frame()
    expect(log).toEqual(['a'])
    frame()
    frame()
    expect(log).toEqual(['a']) // still waiting on a's draw
    d.a()
    expect(log).toEqual(['a']) // never synchronously
    frame()
    expect(log).toEqual(['a', 'b'])
  })

  it('puts urgent jobs ahead of background ones, which run on idle', () => {
    const log: string[] = []
    const d: Record<string, () => void> = {}
    enqueueReveal(job(log, 'bg', d), false)
    enqueueReveal(job(log, 'u1', d))
    enqueueReveal(job(log, 'u2', d))
    frame()
    expect(log).toEqual(['u1'])
    d.u1()
    frame()
    expect(log).toEqual(['u1', 'u2'])
    d.u2()
    frame()
    idle()
    // the idle callback queued at the start may have fired first: either way bg runs only now
    expect(log).toEqual(['u1', 'u2', 'bg'])
  })

  it('moves on after the timeout when a draw never reports', () => {
    const log: string[] = []
    const d: Record<string, () => void> = {}
    enqueueReveal(job(log, 'stuck', d))
    enqueueReveal(job(log, 'next', d))
    frame()
    vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1)
    frame()
    expect(log).toEqual(['stuck'])
    vi.advanceTimersByTime(1)
    frame()
    expect(log).toEqual(['stuck', 'next'])
    d.stuck() // a late done is ignored
    frame()
    expect(log).toEqual(['stuck', 'next'])
  })

  it('drops a pending job without touching the wait; cancel releases the waited-on one', () => {
    const log: string[] = []
    const d: Record<string, () => void> = {}
    const a = enqueueReveal(job(log, 'a', d))
    const b = enqueueReveal(job(log, 'b', d))
    enqueueReveal(job(log, 'c', d))
    frame()
    expect(log).toEqual(['a'])
    b.drop()
    a.drop() // a already ran: drop leaves the wait alone
    frame()
    expect(log).toEqual(['a'])
    a.cancel() // the tile unmounted mid-draw
    frame()
    expect(log).toEqual(['a', 'c'])
  })

  it('a cancelled job that is not the waited-on one does not release the queue', () => {
    const log: string[] = []
    const d: Record<string, () => void> = {}
    enqueueReveal(job(log, 'a', d))
    const b = enqueueReveal(job(log, 'b', d))
    enqueueReveal(job(log, 'c', d))
    frame()
    b.cancel()
    frame()
    expect(log).toEqual(['a'])
    d.a()
    frame()
    expect(log).toEqual(['a', 'c'])
  })
})

describe('draw tracker', () => {
  it('fires done a frame after commit when nothing draws (a table)', () => {
    const t = createDrawTracker()
    const done = vi.fn()
    t.arm(done)
    t.committed()
    expect(done).not.toHaveBeenCalled()
    frame()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('waits for every chart draw to settle', () => {
    const t = createDrawTracker()
    const done = vi.fn()
    t.arm(done)
    const end1 = t.begin()
    const end2 = t.begin()
    t.committed()
    frame()
    end1()
    end1() // idempotent
    expect(done).not.toHaveBeenCalled()
    end2()
    expect(done).toHaveBeenCalledTimes(1)
    t.begin()() // later redraws don't re-fire
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('counts a draw that starts before the post-commit frame', () => {
    const t = createDrawTracker()
    const done = vi.fn()
    t.arm(done)
    t.committed()
    const end = t.begin()
    frame()
    expect(done).not.toHaveBeenCalled()
    end()
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('does nothing unarmed or after disarm', () => {
    const t = createDrawTracker()
    t.committed()
    frame()
    const done = vi.fn()
    t.arm(done)
    t.committed()
    t.disarm()
    frame()
    expect(done).not.toHaveBeenCalled()
  })
})
