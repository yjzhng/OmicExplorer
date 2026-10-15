/** Relative paths between a project file and its data folders, so a project copied to another
 *  machine together with its folders finds them again (see openProject). Pure string work — the
 *  renderer has no `path` module — handling both POSIX and Windows paths. */

const split = (p: string): string[] =>
  p
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '')

const isWin = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

/** The folder holding `file` ('' when it names no folder). */
export function dirOf(file: string): string {
  const i = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return i < 0 ? '' : i === 0 ? file.slice(0, 1) : file.slice(0, i)
}

/** `to` relative to the folder `fromDir` ('/'-separated; '.' when they're the same), or null when
 *  there's no relative path between them (different Windows drives or shares, or a path that
 *  isn't absolute). */
export function relativeTo(fromDir: string, to: string): string | null {
  const win = isWin(fromDir)
  if (win !== isWin(to)) return null
  if (!win && (!fromDir.startsWith('/') || !to.startsWith('/'))) return null
  const a = split(fromDir)
  const b = split(to)
  // Windows: the drive (or UNC host + share) must match, ignoring case.
  const eq = (x: string, y: string): boolean =>
    win ? x.toLowerCase() === y.toLowerCase() : x === y
  const root = win ? (fromDir.startsWith('\\\\') ? 2 : 1) : 0
  for (let i = 0; i < root; i++) if (!a[i] || !b[i] || !eq(a[i], b[i])) return null
  let k = 0
  while (k < a.length && k < b.length && eq(a[k], b[k])) k++
  const rel = [...a.slice(k).map(() => '..'), ...b.slice(k)].join('/')
  return rel || '.'
}

/** `rel` (from relativeTo) resolved against the folder `dir`, in `dir`'s own separator style. */
export function resolveFrom(dir: string, rel: string): string {
  const win = isWin(dir)
  const sep = win && dir.includes('\\') ? '\\' : '/'
  const unc = dir.startsWith('\\\\')
  const parts = split(dir)
  const root = win ? (unc ? 2 : 1) : 0
  for (const seg of split(rel)) {
    if (seg === '.') continue
    if (seg === '..') {
      if (parts.length > root) parts.pop()
    } else parts.push(seg)
  }
  const body = parts.join(sep)
  return unc ? `${sep}${sep}${body}` : win ? body : `/${body}`
}
