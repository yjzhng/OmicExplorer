/** The gene menu's gene groupings: lookups across every tab, and the active tab's tree — searched,
 *  tallied and laid out as the rows it shows (see GeneSelectMenu). */
import { useCallback, useDeferredValue, useMemo, useState } from 'react'

import {
  MIN_SEARCH,
  runsByGroup,
  toggleIn,
  type Gene,
  type GeneCategory,
  type GeneGroupTab,
  type GenePathway,
  type TreeRow
} from './geneMenuModel'

/** The active tab and per-gene lookups across every tab. */
export function useGeneIndex(
  tabs: GeneGroupTab[],
  tabKey: string | undefined
): {
  activeTab: GeneGroupTab | undefined
  categories: GeneCategory[]
  labelById: Map<string, string>
  descById: Map<string, string>
} {
  const activeTab = tabs.find((t) => t.key === tabKey) ?? tabs[0]
  // The active grouping, minus empty pathways and categories (nothing to show or select there).
  const categories = useMemo(
    () =>
      (activeTab?.categories ?? [])
        .map((c) =>
          c.pathways ? { ...c, pathways: c.pathways.filter((pw) => pw.genes.length > 0) } : c
        )
        .filter((c) => (c.genes ?? c.pathways ?? []).length > 0),
    [activeTab]
  )
  // id → label across every tab, so a geneset saved from the selection carries display labels.
  const labelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tabs)
      for (const c of t.categories) {
        for (const g of c.genes ?? []) m.set(g.id, g.label)
        for (const pw of c.pathways ?? []) for (const g of pw.genes) m.set(g.id, g.label)
      }
    return m
  }, [tabs])
  // id → protein description (UniProt), so both the gene list and expanded geneset members can show
  // it right of the name.
  const descById = useMemo(() => {
    const m = new Map<string, string>()
    const put = (g: Gene): void => {
      if (g.desc && !m.has(g.id)) m.set(g.id, g.desc)
    }
    for (const t of tabs)
      for (const c of t.categories) {
        for (const g of c.genes ?? []) put(g)
        for (const pw of c.pathways ?? []) for (const g of pw.genes) put(g)
      }
    return m
  }, [tabs])
  return { activeTab, categories, labelById, descById }
}

export interface GeneTree {
  /** the search's gene matches (every tab), or null when not searching */
  found: { genes: Gene[] } | null
  /** the active grouping, narrowed by the search */
  treeCats: GeneCategory[]
  /** category and group tallies (selected/total), keyed as their rows */
  treeTally: Map<string, { ids: string[]; sel: number }>
  treeRows: TreeRow[]
  treeKey: (i: number) => string
  /** whether a category / group / pathway row is open (shows what's under it) */
  rowOpen: (r: TreeRow) => boolean
  /** open or close a category / group / pathway row */
  toggleRow: (r: TreeRow) => void
}

export function useGeneTree({
  open,
  tabs,
  categories,
  q,
  checkedIds
}: {
  open: boolean
  tabs: GeneGroupTab[]
  categories: GeneCategory[]
  /** the search box's text */
  q: string
  checkedIds: Set<string>
}): GeneTree {
  const [openCat, setOpenCat] = useState<Set<string>>(() => new Set())
  const [openPath, setOpenPath] = useState<Set<string>>(() => new Set())
  // Search. The box updates as typed; the filtering follows a deferred copy of the text, so a
  // keystroke never waits on the list. One character matches nearly everything and isn't searched.
  // A search shows matching genes as a flat, capped list above the tabs, and filters the grouped
  // tree below (treeCats), its pathways collapsed. Expanding the whole tree around every match drew
  // tens of thousands of rows per keystroke (one letter matches nearly every GO term) and froze
  // the app.
  const deferredQ = useDeferredValue(q)
  const needle = deferredQ.trim().toLowerCase()
  const searching = needle.length >= MIN_SEARCH
  // Built once per grouping while the menu is open: each gene once, its text lower-cased once.
  const searchIndex = useMemo(() => {
    if (!open) return null
    const genes = new Map<string, { gene: Gene; hay: string }>()
    const addGene = (g: Gene): void => {
      if (!genes.has(g.id))
        genes.set(g.id, { gene: g, hay: `${g.label}\n${g.id}\n${g.desc ?? ''}`.toLowerCase() })
    }
    // Every tab, so the gene results — shown above the tabs — don't depend on which one is open.
    for (const t of tabs)
      for (const c of t.categories) {
        for (const g of c.genes ?? []) addGene(g)
        for (const pw of c.pathways ?? []) for (const g of pw.genes) addGene(g)
      }
    return [...genes.values()]
  }, [open, tabs])
  const found = useMemo(() => {
    if (!searching || !searchIndex) return null
    return { genes: searchIndex.filter((e) => e.hay.includes(needle)).map((e) => e.gene) }
  }, [searching, searchIndex, needle])

  // The tree follows the search too: only categories / groups / pathways holding a matching gene
  // (narrowed to those genes), or whose own name matches (kept whole). Categories and groups open,
  // pathways stay collapsed (see levelOpen), and the chips count the matches.
  const treeCats = useMemo((): GeneCategory[] => {
    if (!found) return categories
    const hit = new Set(found.genes.map((g) => g.id))
    const named = (name?: string): boolean => !!name && name.toLowerCase().includes(needle)
    const narrow = (genes: Gene[]): Gene[] => genes.filter((g) => hit.has(g.id))
    return categories
      .map((c): GeneCategory => {
        if (named(c.name)) return c
        if (c.genes) return { ...c, genes: narrow(c.genes) }
        const pathways = (c.pathways ?? [])
          .map((pw) =>
            named(pw.name) || named(pw.group) ? pw : { ...pw, genes: narrow(pw.genes) }
          )
          .filter((pw) => pw.genes.length > 0)
        return { ...c, pathways }
      })
      .filter((c) => (c.genes ?? c.pathways ?? []).length > 0)
  }, [found, categories, needle])

  // The tree's category and group tallies (selected/total, deduped — for the count chips and
  // tri-state boxes), worked out once per selection (or grouping) change, not
  // on every render — a hover or tooltip re-renders the menu, and these walk every gene.
  const treeTally = useMemo(() => {
    const m = new Map<string, { ids: string[]; sel: number }>()
    if (!open) return m
    const count = (idLists: string[][]): { ids: string[]; sel: number } => {
      const ids = [...new Set(idLists.flat())]
      return { ids, sel: ids.filter((id) => checkedIds.has(id)).length }
    }
    for (const c of treeCats) {
      const pws = c.pathways ?? []
      m.set(
        c.name,
        c.genes
          ? count([c.genes.map((g) => g.id)])
          : count(pws.map((pw) => pw.genes.map((g) => g.id)))
      )
      const byGroup = new Map<string, string[][]>()
      for (const pw of pws)
        if (pw.group) {
          const lists = byGroup.get(pw.group) ?? []
          lists.push(pw.genes.map((g) => g.id))
          byGroup.set(pw.group, lists)
        }
      for (const [g, lists] of byGroup) m.set(`${c.name}::grp::${g}`, count(lists))
    }
    return m
  }, [open, treeCats, checkedIds])

  // While searching, categories and groups open by themselves (pathways stay collapsed — their genes
  // are what would run to thousands of rows; categories and groups page their pathways). A level
  // collapsed during a search stays collapsed until the search text changes; clearing the search
  // goes back to what was open before.
  const [searchShut, setSearchShut] = useState<{ needle: string; keys: Set<string> }>({
    needle: '',
    keys: new Set()
  })
  const shut = searchShut.needle === needle ? searchShut.keys : null
  const levelOpen = (key: string, opened: Set<string>): boolean =>
    found ? !shut?.has(key) : opened.has(key)
  const toggleLevel = (
    key: string,
    opened: Set<string>,
    setOpened: (s: Set<string>) => void
  ): void => {
    if (!found) return toggleIn(opened, setOpened, key)
    const keys = new Set(shut ?? [])
    if (keys.has(key)) keys.delete(key)
    else keys.add(key)
    setSearchShut({ needle, keys })
  }
  // The tree as the rows it shows, in order — categories, groups, pathways and the genes of the
  // open ones — so it renders as one windowed list (ui/table/VirtualRows): however many pathways a
  // category holds (GO puts thousands straight under each aspect) or genes a pathway, every row
  // is reachable by scrolling and only those in view are drawn.
  const treeRows = useMemo((): TreeRow[] => {
    const rows: TreeRow[] = []
    const genes = (parent: string, gs: Gene[], indent: number): void => {
      for (const g of gs) rows.push({ t: 'gene', key: `${parent}//${g.id}`, g, indent })
    }
    const pathway = (c: GeneCategory, pw: GenePathway, head: number, geneIndent: number): void => {
      const key = `${c.name}::${pw.name}`
      rows.push({ t: 'path', key, c, pw, indent: head })
      if (openPath.has(key)) genes(key, pw.genes, geneIndent)
    }
    for (const c of treeCats) {
      rows.push({ t: 'cat', key: c.name, c })
      if (!levelOpen(c.name, openCat)) continue
      if (c.genes) {
        genes(c.name, c.genes, 26)
        continue
      }
      // Pathways in order, a run sharing a middle-level group gathered under its own header (one
      // more indent level); ungrouped ones sit directly in the category.
      for (const run of runsByGroup(c.pathways ?? [])) {
        if (!run.group) {
          for (const pw of run.pathways) pathway(c, pw, 18, 40)
          continue
        }
        const gKey = `${c.name}::grp::${run.group}`
        rows.push({ t: 'group', key: gKey, c, name: run.group })
        if (levelOpen(gKey, openPath)) for (const pw of run.pathways) pathway(c, pw, 32, 54)
      }
    }
    return rows
    // levelOpen reads found / shut, listed here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeCats, openCat, openPath, found, shut])
  const treeKey = useCallback((i: number) => treeRows[i].key, [treeRows])

  // A pathway opens by itself only (a search leaves pathways collapsed); a category or group
  // follows the search (see levelOpen). A category row's key is its name.
  const rowOpen = (r: TreeRow): boolean =>
    r.t === 'path'
      ? openPath.has(r.key)
      : r.t === 'group'
        ? levelOpen(r.key, openPath)
        : r.t === 'cat'
          ? levelOpen(r.key, openCat)
          : false
  const toggleRow = (r: TreeRow): void => {
    if (r.t === 'path') toggleIn(openPath, setOpenPath, r.key)
    else if (r.t === 'group') toggleLevel(r.key, openPath, setOpenPath)
    else if (r.t === 'cat') toggleLevel(r.key, openCat, setOpenCat)
  }
  return { found, treeCats, treeTally, treeRows, treeKey, rowOpen, toggleRow }
}
