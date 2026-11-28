/**
 * How many sub-workers the engine's pool (pool.ts) gets: half the logical cores, less one, at most
 * POOL_MAX — and none under 2, where a pool gains nothing over computing in place.
 *
 * Deliberately simple. Half the logical cores stands in for the physical ones (hyper-threading),
 * less one leaves the UI thread room to keep drawing. The exact number matters little: the pooled
 * work is split into small pieces taken from one queue (fast cores just take more), and the pool
 * holds a worker back while the UI thread is stalling (setUiBusy) — so a guess on the high side
 * costs a little speed, never responsiveness. Past four workers a run gains little more (a step is
 * bound by its largest single job), so that's the cap.
 */
export const POOL_MAX = 4

export function poolSizeFor(logicalCores: number): number {
  const n = Math.min(Math.floor(logicalCores / 2) - 1, POOL_MAX)
  return n >= 2 ? n : 0
}
