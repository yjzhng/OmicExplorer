/** Orders the app's own file writes around a project save's folder renames: a write waits while
 *  folders are being moved, and a rename waits for writes already under way. A write resolves its
 *  path INSIDE `fn`, after any rename, so it never lands in a folder's old location. */

let lock: Promise<void> | null = null
const pending = new Set<Promise<unknown>>()

/** Run one write (path resolved inside `fn`), held back while folders are being moved. */
export async function diskWrite<T>(fn: () => Promise<T>): Promise<T> {
  while (lock) await lock
  const p = fn()
  pending.add(p)
  try {
    return await p
  } finally {
    pending.delete(p)
  }
}

/** Run `fn` (folder moves) with no write in flight and none starting until it's done. */
export async function exclusiveDisk<T>(fn: () => Promise<T>): Promise<T> {
  while (lock) await lock
  let release!: () => void
  lock = new Promise<void>((r) => (release = r))
  try {
    await Promise.allSettled([...pending])
    return await fn()
  } finally {
    lock = null
    release()
  }
}
