/**
 * A long run's progress: how many of its units (curves, surfaces, simulations) are done of all it
 * will fit, and the stage it's in. One total over the whole run, so a progress bar fills once:
 * the engine's steps add each stage's units to the total as they become known (`plan`, or
 * `remaining` to set what's left exactly), name the stage (`stage`), and the drivers count units
 * as they come back (`add`). The worker posts what it sees, throttled.
 */
export interface Progress {
  stage: string
  done: number
  /** 0: not known yet */
  total: number
}

export interface ProgressTracker {
  /** the stage under way */
  stage(label: string): void
  /** `n` more units to come (added to the total) */
  plan(n: number): void
  /** exactly `n` units left to come (the total re-set to what's done plus them) */
  remaining(n: number): void
  /** `n` more units done */
  add(n: number): void
}

/** The tracker that reports nowhere (a run nobody watches). */
export const NO_PROGRESS: ProgressTracker = {
  stage: () => {},
  plan: () => {},
  remaining: () => {},
  add: () => {}
}

/** A tracker reporting to `report`: on every new stage, and at most every `everyMs` otherwise. */
export function progressTracker(
  report: (p: Progress) => void,
  everyMs = 150,
  now: () => number = () => Date.now()
): ProgressTracker {
  const cur: Progress = { stage: '', done: 0, total: 0 }
  let last = -Infinity
  // An update held back by the throttle goes out once the interval is up — otherwise a stage's
  // planned total, set just after the stage was named, never arrived until the first unit was
  // counted (and the bar had nothing to show until then).
  let trailing: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    trailing = null
    last = now()
    report({ ...cur })
  }
  const send = (force: boolean): void => {
    const t = now()
    if (!force && t - last < everyMs) {
      trailing ??= setTimeout(flush, everyMs - (t - last))
      return
    }
    if (trailing) {
      clearTimeout(trailing)
      trailing = null
    }
    last = t
    report({ ...cur })
  }
  return {
    stage(label) {
      cur.stage = label
      send(true)
    },
    plan(n) {
      cur.total += n
      send(false)
    },
    remaining(n) {
      cur.total = cur.done + n
      send(false)
    },
    add(n) {
      cur.done = cur.total ? Math.min(cur.total, cur.done + n) : cur.done + n
      send(false)
    }
  }
}
