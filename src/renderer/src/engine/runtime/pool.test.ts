/** The engine pool's scheduling: never more jobs in flight than workers, one fewer while the UI
 *  thread is stalling, and every job answered in order. Run against a stand-in Worker. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Msg = { op: string; id?: number; batch?: Array<{ x: number[]; y: number[] }> }
let inFlight = 0
let peak = 0
const queued: Array<() => void> = []
class FakeWorker {
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  postMessage(m: Msg): void {
    if (m.op !== 'fit') return
    inFlight++
    peak = Math.max(peak, inFlight)
    // answer later, when the test releases it: one null fit per curve
    queued.push(() => {
      inFlight--
      this.onmessage?.({ data: { id: m.id, ok: true, result: m.batch!.map(() => null) } })
    })
  }
  terminate(): void {}
}
const drain = async (): Promise<void> => {
  while (queued.length) {
    queued.shift()!()
    await Promise.resolve()
  }
}

describe('engine pool', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('Worker', FakeWorker)
    inFlight = 0
    peak = 0
    queued.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  const batch = Array.from({ length: 400 }, (_, i) => ({ x: [i], y: [i] }))

  it('keeps at most `size` jobs in flight, and answers in order', async () => {
    const m = await import('./pool')
    m.configurePool(3)
    const done = m.pool()!.fit(batch)
    await drain()
    const out = await done
    expect(peak).toBe(3)
    expect(out).toHaveLength(batch.length)
  })

  it('holds one worker back while the UI is busy, and resumes after', async () => {
    const m = await import('./pool')
    m.configurePool(3)
    m.setUiBusy(true)
    const done = m.pool()!.fit(batch)
    expect(inFlight).toBe(2)
    m.setUiBusy(false)
    expect(inFlight).toBe(3)
    await drain()
    expect((await done).length).toBe(batch.length)
    expect(peak).toBe(3)
  })

  it('computes in place when sized under 2', async () => {
    const m = await import('./pool')
    m.configurePool(1)
    expect(m.pool()).toBeNull()
  })
})
