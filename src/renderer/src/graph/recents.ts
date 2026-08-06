/** Recently opened/saved projects, persisted to localStorage (like the theme pref). */
export interface RecentProject {
  path: string
  name: string
  /** ms epoch of last open/save */
  ts: number
}

const KEY = 'omicexplorer-recent-projects'
const MAX = 12

export function loadRecents(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as RecentProject[]
    return Array.isArray(arr) ? arr.filter((r) => r && typeof r.path === 'string') : []
  } catch {
    return []
  }
}

/** Add/move a project to the front; returns the new list (also persisted). */
export function pushRecent(
  list: RecentProject[],
  entry: { path: string; name: string }
): RecentProject[] {
  const next: RecentProject[] = [
    { path: entry.path, name: entry.name, ts: Date.now() },
    ...list.filter((r) => r.path !== entry.path)
  ].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // ignore quota/availability errors — recents are best-effort
  }
  return next
}

export function removeRecent(list: RecentProject[], path: string): RecentProject[] {
  return saveRecents(list.filter((r) => r.path !== path))
}

/** Persist a recents list verbatim (already filtered/ordered by the caller). */
export function saveRecents(list: RecentProject[]): RecentProject[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // ignore quota/availability errors — recents are best-effort
  }
  return list
}
