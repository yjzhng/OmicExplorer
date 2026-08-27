/** A tiny global reveal scheduler for dashboard tiles.
 *
 * Building a tile's plot data is synchronous and can block for a while (clustering,
 * correlation, big pivots). If every tile reveals on the same frame, all those builds run
 * back-to-back in one long stretch and the whole app freezes until they finish. This admits
 * one reveal per animation frame instead, so the browser gets to paint and process input
 * between builds — the app stays responsive and tiles pop in progressively.
 *
 * A build longer than a frame still hitches that one frame (it can't be split here); pacing
 * only stops many builds from concatenating into a single long freeze.
 */
let queue: Array<() => void> = []
let running = false

function pump(): void {
  const job = queue.shift()
  if (job) job()
  if (queue.length) requestAnimationFrame(pump)
  else running = false
}

/** Enqueue a reveal; it runs on a later animation frame (one per frame). Returns a cancel
 *  function to call if the tile unmounts before its turn. */
export function enqueueReveal(job: () => void): () => void {
  queue.push(job)
  if (!running) {
    running = true
    requestAnimationFrame(pump)
  }
  return () => {
    queue = queue.filter((j) => j !== job)
  }
}
