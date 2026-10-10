/** A tiny global reveal scheduler for dashboard tiles.
 *
 * Building a tile's plot data is synchronous and can block for a while (clustering,
 * correlation, big pivots). If every tile reveals on the same frame, all those builds run
 * back-to-back in one long stretch and the whole app freezes until they finish. This admits
 * one reveal per animation frame instead, so the browser gets to paint and process input
 * between builds — the app stays responsive and tiles pop in progressively.
 *
 * Two lanes: URGENT reveals (tiles on screen) go first, one per frame; BACKGROUND ones (tiles
 * scrolled away, or in a tab not on view) only once no urgent one is waiting, one per idle
 * moment — so everything gets built eventually, but never ahead of what's being looked at. A
 * tile that comes into view re-enqueues as urgent (cancelling its background entry).
 *
 * A build longer than a frame still hitches that one frame (it can't be split here); pacing
 * only stops many builds from concatenating into a single long freeze.
 */
type Job = () => void

let urgent: Job[] = []
let background: Job[] = []
let framePending = false
let idlePending = false

/** When the main thread is next idle (a short timeout where there's no idle callback). */
const whenIdle = (cb: () => void): void => {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb)
  else window.setTimeout(cb, 50)
}

function schedule(): void {
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

function pump(): void {
  const job = urgent.shift() ?? background.shift()
  if (job) job()
  schedule()
}

/** Enqueue a reveal; it runs on a later animation frame (one per frame) — or, with `urgent` false,
 *  once no urgent reveal is waiting and the thread is idle. Returns a cancel function to call if
 *  the tile unmounts (or re-enqueues) before its turn. */
export function enqueueReveal(job: Job, isUrgent = true): () => void {
  ;(isUrgent ? urgent : background).push(job)
  schedule()
  return () => {
    urgent = urgent.filter((j) => j !== job)
    background = background.filter((j) => j !== job)
  }
}
