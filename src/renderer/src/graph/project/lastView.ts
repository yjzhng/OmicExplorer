/** Where the user was in a project (folder, workflow, page, Results tab), remembered per project
 *  path in localStorage as they navigate — so reopening resumes there even when nothing was
 *  saved since (moving around isn't an edit and shouldn't dirty the file). The `.omicexplorer`
 *  file carries the same fields as a fallback for a project opened on another machine. */
export interface LastView {
  folderId: string | null
  workflowId: string | null
  view: 'canvas' | 'results'
  resultsTab: string | null
}

const KEY = 'omicexplorer-last-view'
const MAX = 24

type Stored = Record<string, LastView & { ts: number }>

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    const obj = raw ? (JSON.parse(raw) as unknown) : null
    return obj && typeof obj === 'object' ? (obj as Stored) : {}
  } catch {
    return {}
  }
}

export function loadLastView(path: string): LastView | null {
  const v = read()[path]
  if (!v || typeof v !== 'object') return null
  return {
    folderId: typeof v.folderId === 'string' ? v.folderId : null,
    workflowId: typeof v.workflowId === 'string' ? v.workflowId : null,
    view: v.view === 'results' ? 'results' : 'canvas',
    resultsTab: typeof v.resultsTab === 'string' ? v.resultsTab : null
  }
}

export function saveLastView(path: string, view: LastView): void {
  const all = read()
  all[path] = { ...view, ts: Date.now() }
  // Keep the map bounded: drop the stalest entries beyond MAX.
  const keys = Object.keys(all).sort((a, b) => all[b].ts - all[a].ts)
  const kept: Stored = {}
  for (const k of keys.slice(0, MAX)) kept[k] = all[k]
  try {
    localStorage.setItem(KEY, JSON.stringify(kept))
  } catch {
    // ignore quota/availability errors — best-effort, like recents
  }
}
