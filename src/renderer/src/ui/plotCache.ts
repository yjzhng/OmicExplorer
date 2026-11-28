/** The app-wide plot-data cache. A plot's data (its traces' points, a facet's rows) is built
 *  from a result that stays the same object until it's run again, so it's kept here by what it
 *  was built from rather than per mount: a remount (Results opened again, a tab, facet or gene
 *  switched back) takes it at once instead of building it again on the UI thread.
 *
 *  Entries hang off the first object among the inputs (a result's rows, a facet's rows) in a
 *  WeakMap, so they go when it does; a few are kept per object (LRU), so a threshold dragged
 *  through many values, or many facets visited, don't pile up. Inputs with no object are kept
 *  in one small LRU of their own. */
import { useMemo } from 'react'

/** entries kept per root object, and in the loose list */
const PER_ROOT = 6
const LOOSE = 32

let nextId = 1
const ids = new WeakMap<object, number>()
/** an object's identity, as a key part — it's the same object or it isn't */
function idOf(o: object): number {
  let id = ids.get(o)
  if (id === undefined) ids.set(o, (id = nextId++))
  return id
}
const isObj = (v: unknown): v is object =>
  (typeof v === 'object' && v !== null) || typeof v === 'function'

function keyOf(name: string, deps: readonly unknown[]): string {
  let k = name
  for (const d of deps) k += '\u0000' + (isObj(d) ? `#${idOf(d)}` : `${typeof d}:${String(d)}`)
  return k
}

const byRoot = new WeakMap<object, Map<string, unknown>>()
const loose = new Map<string, unknown>()

/** `build()`'s value for `name` and these inputs: the one built before, or built now and kept.
 *  `deps` must be everything the build reads (objects by identity, the rest by value). */
export function plotCached<T>(name: string, deps: readonly unknown[], build: () => T): T {
  const root = deps.find(isObj)
  let m = root ? byRoot.get(root) : loose
  if (!m) byRoot.set(root!, (m = new Map()))
  const key = keyOf(name, deps)
  if (m.has(key)) {
    const v = m.get(key) as T
    // most recently used last
    m.delete(key)
    m.set(key, v)
    return v
  }
  const v = build()
  m.set(key, v)
  const cap = root ? PER_ROOT : LOOSE
  while (m.size > cap) m.delete(m.keys().next().value as string)
  return v
}

/** plotCached as a hook: the cached value, the same object for as long as `deps` don't change. */
export function usePlotCached<T>(name: string, deps: readonly unknown[], build: () => T): T {
  const key = [name, ...deps]
  // A generic helper can't hand the hooks lint a literal deps array; the deps ARE the key.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  return useMemo(() => plotCached(name, deps, build), key)
}
