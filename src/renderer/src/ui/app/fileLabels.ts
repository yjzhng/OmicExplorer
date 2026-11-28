/** File sizes and the OS file manager's name, as the file viewers show them. */

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

/** The reveal buttons' labels, in the OS file manager's own name: Finder on macOS, File Explorer
 *  on Windows; elsewhere (Linux file managers vary) just "folder". */
export const REVEAL =
  window.api.platform === 'darwin'
    ? { item: 'Show in Finder', folder: 'Open in Finder' }
    : window.api.platform === 'win32'
      ? { item: 'Show in File Explorer', folder: 'Open in File Explorer' }
      : { item: 'Show in folder', folder: 'Open folder' }
