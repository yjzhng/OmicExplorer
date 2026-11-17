/** What a Load tile's check (the store's checkLoad) says — on its status dot and summary, and as
 *  Clean data's error when it can't read the files. Pure. */
import type { FileStamp, LoadCheck, LoadMode } from './types'

/** ok: ready; warn: runs, with something to know; busy: re-converting; bad: can't run. */
export type LoadTone = 'ok' | 'warn' | 'busy' | 'bad'

const listed = (names: string[]): string =>
  names.length > 3
    ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
    : names.join(', ')

/** The check's tone and the sentence it shows. */
export function loadCheckInfo(check: LoadCheck, mode: LoadMode): { tone: LoadTone; label: string } {
  switch (check.state) {
    case 'ok':
      return { tone: 'ok', label: 'Ready' }
    case 'converting':
      return { tone: 'busy', label: 'Raw data changed — converting it with the saved import…' }
    case 'sourceMissing':
      return {
        tone: 'warn',
        label: `Raw data not found (${check.name.replace(/^.*[\\/]/, '')}) — running from its converted copy`
      }
    case 'filesChanged':
      return {
        tone: 'warn',
        label: `${listed(check.names)} changed since Clean data read ${check.names.length === 1 ? 'it' : 'them'} — run Clean data again`
      }
    case 'filesMissing':
      return {
        tone: 'bad',
        label:
          mode === 'interactive'
            ? `Converted files and the raw data not found (${listed(check.names)}) — pick the raw data file again`
            : `File not found: ${listed(check.names)}`
      }
    case 'columns':
      return {
        tone: 'bad',
        label: `The raw data lacks ${check.missing.length === 1 ? 'a column' : `${check.missing.length} columns`} the import uses (${listed(check.missing)}) — edit samples`
      }
    case 'error':
      return { tone: 'bad', label: check.message }
  }
}

/** Why Clean data can't read the tile's files now, or null when it can. */
export function loadCheckProblem(check: LoadCheck, mode: LoadMode): string | null {
  const { tone, label } = loadCheckInfo(check, mode)
  return tone === 'bad' ? label : null
}

/** A file's size and modified time as data:stat reports it (and its SHA-1, when asked). */
export type FileStat = { size: number; mtime: number; hash?: string }

export const stampOf = (name: string, st: FileStat): FileStamp => ({
  name,
  size: st.size,
  mtime: st.mtime,
  ...(st.hash ? { hash: st.hash } : null)
})

/** A file now (`name`, `st`) against its stamp: the same ('same'), another ('changed'), or the
 *  same bytes under a new time or name (a move, a copy, a sync, the file picked again after its
 *  folder moved) — then its new stamp. Hashed only when the size holds but the time or name
 *  moved. */
export async function againstStamp(
  stamp: FileStamp,
  name: string,
  st: FileStat,
  hashNow: () => Promise<FileStat | null>
): Promise<'same' | 'changed' | FileStamp> {
  if (stamp.size !== st.size) return 'changed'
  if (stamp.name === name && stamp.mtime === st.mtime) return 'same'
  if (!stamp.hash) return 'changed'
  const now = await hashNow()
  return now?.hash === stamp.hash ? stampOf(name, now) : 'changed'
}
