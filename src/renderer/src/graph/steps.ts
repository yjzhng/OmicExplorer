/** Work written as steps: a generator that yields between pieces of it. Run to the end at once
 *  (`runSteps`), or a slice at a time with a pause between slices (`runStepsSliced`), so long
 *  background work leaves the main thread free for the user's clicks and the page's drawing. */
export type Steps<T> = Generator<void, T, void>

export function runSteps<T>(steps: Steps<T>): T {
  let r = steps.next()
  while (!r.done) r = steps.next()
  return r.value
}

/** How long one slice may run before it pauses for the page. */
export const SLICE_MS = 8

const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

export async function runStepsSliced<T>(steps: Steps<T>, sliceMs = SLICE_MS): Promise<T> {
  let start = performance.now()
  let r = steps.next()
  while (!r.done) {
    if (performance.now() - start >= sliceMs) {
      await pause()
      start = performance.now()
    }
    r = steps.next()
  }
  return r.value
}
