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
 * Build the path (relative to the export base dir) for one output. `folder` is the output
 * subfolder name (a processing step's — see graph/diskNames.ts). Selected-only variants are filed under a
 * `selected` subfolder so they never overwrite the all-genes version of the same plot.
 */
export function exportPath(
  folder: string,
  fileBase: string,
  structure: 'subfolder' | 'flat',
  ext: string,
  selected = false
): string {
  const file = `${sanitize(fileBase)}.${ext}`
  if (structure === 'subfolder')
    return selected ? `${folder}/selected/${file}` : `${folder}/${file}`
  return selected ? `selected/${folder}__${file}` : `${folder}__${file}`
}
