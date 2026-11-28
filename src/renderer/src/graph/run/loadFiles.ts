import type { ScalePreview } from '../../engine'
import type { FileStat } from './loadCheck'
import { type WorkflowLocation } from '../state/shared'
import { type Getter, type Setter } from '../store'
import { isStep, type NodeConfig } from '../types'
import type { LoadCheck, LoadConfig } from '../config/load'

/** Clean data's data-scale previews, per data file (dir | workflow | name) — a file is parsed once
 *  per session for its preview; a re-converted import writes a new set of rows the next run sees,
 *  and the preview follows on the next session. */
export const scalePreviews = new Map<string, ScalePreview>()
// ── Load tile checks: are its files still the ones converted / read? ─────────────────────────────
/** The named data files' sizes and times (hashed with `hash`), as data:read finds them; nulls
 *  for each with a main process from before a restart (no data:stat). */
export async function statFiles(
  dir: string,
  names: string[],
  scope?: WorkflowLocation['scope'],
  hash = false
): Promise<Array<FileStat | null>> {
  if (typeof window.api.statDataFiles !== 'function') return names.map(() => null)
  return window.api.statDataFiles(dir, names, scope, hash).catch(() => names.map(() => null))
}
/** Set (or clear) a Load tile's check — unless the tile is gone meanwhile. */
export function putCheck(
  get: Getter,
  set: Setter,
  id: string,
  check: LoadCheck | undefined
): LoadCheck | undefined {
  if (!get().nodes.some((n) => n.id === id)) return check
  const loadChecks = { ...get().loadChecks }
  if (check) loadChecks[id] = check
  else delete loadChecks[id]
  set({ loadChecks })
  return check
}
/** A Load tile's stamps updated in place — not an edit (no undo step, nothing out of date). */
export function patchLoadStamps(
  get: Getter,
  set: Setter,
  id: string,
  patch: Partial<LoadConfig>
): void {
  if (!Object.keys(patch).length) return
  set({
    nodes: get().nodes.map((n) =>
      n.id === id && isStep(n)
        ? { ...n, data: { ...n.data, config: { ...n.data.config, ...patch } as NodeConfig } }
        : n
    )
  })
}
