/** "This tile has finished drawing" — the signal the dashboard's reveal queue waits on.
 *
 * A dashboard tile provides a tracker around its body; every PlotlyChart inside registers each
 * Plotly.react it starts (`begin`) and ends it when that render settles or fails. The tile arms
 * the tracker with the queue's `done` when its reveal runs, and reports the reveal's commit
 * (`committed`): a frame later (so charts that mount on that commit have started their draws),
 * once no draw is pending — straight away for a tile with no chart, e.g. a table — `done` fires.
 * Charts outside a tile see no tracker and register nothing. */
import { createContext } from 'react'

export interface DrawTracker {
  /** A Plotly render started; call the returned function (idempotent) when it settles. */
  begin(): () => void
  /** A reveal ran: call `done` once the tile it updated has drawn. Replaces any earlier one. */
  arm(done: () => void): void
  /** The reveal's update committed: from a frame on, `done` fires as soon as nothing is drawing. */
  committed(): void
  /** Forget the armed `done` (the tile unmounted). */
  disarm(): void
}

export const TileDrawContext = createContext<DrawTracker | null>(null)

export function createDrawTracker(): DrawTracker {
  let pending = 0
  let armed: (() => void) | null = null
  /** The armed reveal has committed and its frame has passed: `done` may fire. */
  let ripe = false
  let raf = 0
  const check = (): void => {
    if (!armed || !ripe || pending > 0) return
    const done = armed
    armed = null
    ripe = false
    done()
  }
  return {
    begin() {
      pending++
      let ended = false
      return () => {
        if (ended) return
        ended = true
        pending--
        check()
      }
    },
    arm(done) {
      armed = done
      ripe = false
    },
    committed() {
      if (!armed) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        ripe = true
        check()
      })
    },
    disarm() {
      cancelAnimationFrame(raf)
      raf = 0
      armed = null
      ripe = false
    }
  }
}
