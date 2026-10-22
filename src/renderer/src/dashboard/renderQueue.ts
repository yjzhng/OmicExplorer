/** A tiny global reveal scheduler for dashboard tiles.
 *
 * Building a tile's plot data is synchronous and can block for a while (clustering,
 * correlation, big pivots), and its Plotly draw follows asynchronously, often heavier still. If
 * every tile reveals at once, all those builds and draws run back-to-back in one long stretch and
 * the whole app freezes until they finish. This admits one reveal at a time instead: a job runs,
 * then the queue WAITS until that tile says it has finished its first draw (the job's `done`) —
 * or a safety timeout passes, so a draw that never settles can't stall the rest — and then yields
 * a frame (or an idle moment) before the next one. The browser gets to paint and process input
 * between tiles — the app stays responsive and tiles pop in progressively, each fully drawn.
 *
 * Two lanes: URGENT reveals (tiles on screen) go first, one per frame; BACKGROUND ones (tiles
 * scrolled away, or in a tab not on view) only once no urgent one is waiting, one per idle
 * moment — so everything gets built eventually, but never ahead of what's being looked at. A
 * tile that comes into view re-enqueues as urgent (cancelling its background entry).
 *
 * A build longer than a frame still hitches that one frame (it can't be split here); pacing
 * only stops many builds from concatenating into a single long freeze.
 */

/** A reveal: does its work (a state update), then calls `done` once the tile has drawn. Calling
 *  `done` late, twice, or never is fine — the timeout covers never, later calls are ignored. */
export type RevealJob = (done: () => void) => void

export interface Reveal {
  /** Drop the job if it hasn't run yet; leaves a wait on it alone (it's what changed state). */
  drop(): void
  /** Drop the job, and if the queue is waiting on it, release the queue too (unmount, re-enqueue). */
  cancel(): void
}

/** How long a revealed tile may take to report its draw before the queue moves on regardless. */
export const REVEAL_TIMEOUT_MS = 1500

let urgent: RevealJob[] = []
let background: RevealJob[] = []
let framePending = false
let idlePending = false
/** The job that ran and is being waited on (its draw), with its timeout. */
let waiting: { job: RevealJob; timer: ReturnType<typeof setTimeout> } | null = null

/** When the main thread is next idle (a short timeout where there's no idle callback). */
const whenIdle = (cb: () => void): void => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb)
  else window.setTimeout(cb, 50)
}

function schedule(): void {
  if (waiting) return // the next job starts once the current tile has drawn (see release)
  if (urgent.length) {
    if (!framePending) {
      framePending = true
      requestAnimationFrame(() => {
        framePending = false
        pump()
      })
    }
  } else if (background.length && !idlePending && !framePending) {
    idlePending = true
    whenIdle(() => {
      idlePending = false
      pump()
    })
  }
}

/** Stop waiting on `job` (if it's the one waited on) and schedule the next — always at least a
 *  frame (or idle callback) later, never synchronously, so the thread gets its break. */
function release(job: RevealJob): void {
  if (!waiting || waiting.job !== job) return
  clearTimeout(waiting.timer)
  waiting = null
  schedule()
}

function pump(): void {
  if (waiting) return
  const job = urgent.shift() ?? background.shift()
  if (!job) return
  waiting = { job, timer: setTimeout(() => release(job), REVEAL_TIMEOUT_MS) }
  try {
    job(() => release(job))
  } catch (err) {
    release(job)
    throw err
  }
}

/** Enqueue a reveal; it runs on a later animation frame — or, with `urgent` false, once no urgent
 *  reveal is waiting and the thread is idle — and the next one only after it calls `done` (or the
 *  timeout). Returns handles to drop it before its turn, or cancel it (also releasing the queue if
 *  it's being waited on) when the tile unmounts or re-enqueues. */
export function enqueueReveal(job: RevealJob, isUrgent = true): Reveal {
  ;(isUrgent ? urgent : background).push(job)
  schedule()
  const drop = (): void => {
    urgent = urgent.filter((j) => j !== job)
    background = background.filter((j) => j !== job)
  }
  return {
    drop,
    cancel: () => {
      drop()
      release(job)
    }
  }
}

/** Test-only: forget all queued and waited-on work. */
export function resetRevealQueue(): void {
  if (waiting) clearTimeout(waiting.timer)
  waiting = null
  urgent = []
  background = []
  framePending = false
  idlePending = false
}
