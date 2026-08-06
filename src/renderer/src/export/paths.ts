/** Output-path helpers shared by plot and table export. Kept pure/tiny so both the
 *  renderer planning code and the tests can use them. */

/** Make a string safe for a file/dir name. */
export function sanitize(s: string): string {
  return (
    (s || 'item')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^[_.]+|_+$/g, '')
      .slice(0, 80) || 'item'
  )
}

/**
 * Assign each analysis root a unique subfolder name. Distinct analyses can share a label
 * (e.g. two "clpP | WT" comparisons); when a sanitised label is claimed by more than one
 * root, disambiguate by appending the root id so their outputs never land in one folder.
 */
export function buildFolderMap(
  entries: Array<{ rootId: string; analysis: string }>
): Map<string, string> {
  // One label per root (first wins; all entries for a root carry the same analysis).
  const byRoot = new Map<string, string>()
  for (const e of entries) if (!byRoot.has(e.rootId)) byRoot.set(e.rootId, e.analysis)

  const labelUses = new Map<string, number>()
  for (const label of byRoot.values()) {
    const s = sanitize(label)
    labelUses.set(s, (labelUses.get(s) ?? 0) + 1)
  }
  const out = new Map<string, string>()
  for (const [rootId, label] of byRoot) {
    const s = sanitize(label)
    out.set(rootId, (labelUses.get(s) ?? 0) > 1 ? `${s}_${sanitize(rootId)}` : s)
  }
  return out
}

/**
 * Build the path (relative to the export base dir) for one output. `folder` is the resolved
 * per-analysis folder name (see buildFolderMap). GOI-subset variants are filed under a `GOI`
 * subfolder so they never overwrite the all-genes version of the same plot.
 */
export function exportPath(
  folder: string,
  fileBase: string,
  structure: 'subfolder' | 'flat',
  ext: string,
  goi = false
): string {
  const file = `${sanitize(fileBase)}.${ext}`
  if (structure === 'subfolder') return goi ? `${folder}/GOI/${file}` : `${folder}/${file}`
  return goi ? `GOI/${folder}__${file}` : `${folder}__${file}`
}
