/** Off the UI thread: whether a project file's upgrades change it (project.ts upgradeChanges) — a
 *  full parse of what may be a large file, for the home page's version tags. Null when it can't be
 *  read. */
import { upgradeChanges } from './project'

self.onmessage = (e: MessageEvent<{ id: number; text: string }>): void => {
  let changes: boolean | null
  try {
    changes = upgradeChanges(e.data.text)
  } catch {
    changes = null
  }
  self.postMessage({ id: e.data.id, changes })
}
