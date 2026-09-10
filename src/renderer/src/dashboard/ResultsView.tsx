/** The results dashboard: one tab per analysis group, each a reconfigurable grid
 *  of panel tiles. Replaces the old two-level (section pill → tile tab) OutputDock
 *  that showed a single plot at a time. Grouping is derived from the pipeline DAG;
 *  tile layout is drag/resizable in edit mode (persisted with the workflow later). */
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import { facetDims, type ContextRow } from '../engine'
import {
  deriveGroups,
  expandMembers,
  parsePanelId,
  topoStepOrder,
  type AnalysisGroup
} from '../graph/groups'
import { NODE_SPECS } from '../graph/registry'
import { useGraph } from '../graph/store'
import { isStep, type NodeResult, type PlotGroupConfig, type StepNode } from '../graph/types'
import type { PanelLayoutItem } from '../graph/types'
import { GeneSelectMenu } from '../ui/GeneSelectMenu'
import { UI } from '../ui/theme'
import { useAppView } from '../ui/useAppView'
import { DashboardGrid } from './DashboardGrid'
import { EMPTY_SEL, resolveFacets, useFacet } from './facet'
import { autoLayout, geometryChanged, reconcileLayout, type PanelLayout } from './panels'
import { PanelTile } from './PanelTile'

/** The comparison strings a run produced (compare/contrast), else none. */
function groupComparisons(group: AnalysisGroup, results: Record<string, NodeResult>): string[] {
  const r = results[group.rootId]
  if (r?.kind === 'compare') return r.cmp.comparisons
  if (r?.kind === 'contrast') return r.ctr.comparisons
  return []
}

/** Tab label = the step tile's user-given name if set, else its type label (kind, e.g.
 *  "Compare"). What's actually being compared lives in the hover tooltip (groupTitle). */
function groupLabel(group: AnalysisGroup, name?: string): string {
  return name || NODE_SPECS[group.kind].label
}

/** Full comparison list for the tab's hover tooltip (the label itself is trimmed). */
function groupTitle(group: AnalysisGroup, results: Record<string, NodeResult>): string {
  const comps = groupComparisons(group, results)
  return comps.length ? comps.join(', ') : group.label
}

/** Pick a gene's protein description from its annotation record: the UniProt `proteinName` column
 *  first, else a data column whose name reads like a protein name / description / product. */
function pickDesc(rec: Record<string, string> | undefined): string | undefined {
  if (!rec) return undefined
  if (rec.proteinName) return rec.proteinName
  const key = Object.keys(rec).find((c) => /protein[_. ]?name|description|product/i.test(c))
  return key ? rec[key] : undefined
}

export function ResultsView(): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const groupLayouts = useGraph((s) => s.groupLayouts)
  const setGroupLayout = useGraph((s) => s.setGroupLayout)
  const groupMeta = useGraph((s) => s.groupMeta)
  const reorderGroups = useGraph((s) => s.reorderGroups)
  const editMode = useAppView((s) => s.editMode)
  const toggleEdit = useAppView((s) => s.toggleEdit)
  // Active tab lives in the app-view store (not local state) so it survives Results unmounting
  // when you switch to the canvas — returning lands on the same tab, not the first.
  const activeId = useAppView((s) => s.resultsTab)
  const setResultsTab = useAppView((s) => s.setResultsTab)
  // Tab being dragged (rootId) and the insertion index a drop would land at (0..n), for the live
  // placeholder shown between tabs while dragging.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  const groups = useMemo(() => {
    const derived = deriveGroups(nodes, edges)
    // Default order follows workflow TOPOLOGY (upstream analyses first), not creation order.
    const topo = topoStepOrder(nodes, edges)
    const rank = new Map(topo.map((id, i) => [id, i]))
    // A user-set `order` (from drag-reorder) wins; otherwise fall back to the topological rank.
    return derived
      .map((g) => ({ g, rank: rank.get(g.rootId) ?? Infinity, order: groupMeta[g.rootId]?.order }))
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.rank - b.rank)
      .map((x) => x.g)
  }, [nodes, edges, groupMeta])

  // Drop `fromId` into insertion slot `index` (0..n in the current order) and persist.
  const dropTabAt = (fromId: string, index: number): void => {
    const ids = groups.map((g) => g.rootId)
    const from = ids.indexOf(fromId)
    if (from < 0) return
    ids.splice(from, 1)
    // Removing the dragged tab shifts later slots left by one.
    const to = from < index ? index - 1 : index
    if (to === from) return // no-op (dropped back onto its own slot)
    ids.splice(to, 0, fromId)
    reorderGroups(ids)
  }
  const endDrag = (): void => {
    setDragId(null)
    setDropIndex(null)
  }
  const active = groups.find((g) => g.id === activeId) ?? groups[0] ?? null
  // Tabs are kept alive once opened: building a tab's plots costs ~1s, and
  // unmounting on every switch made you pay it again each time you came back.
  // Panes are only created on first visit, so unopened tabs still cost nothing.
  // Results changing (a re-run) flows into the mounted panes as new props, and
  // leaving Results unmounts the lot — so nothing here can go stale.
  const [visited, setVisited] = useState<string[]>([])
  const openTab = (id: string): void => {
    // Remember the tab being left as well as the one being opened, so the pane we are
    // navigating away from stays mounted (that is the whole point of keeping them).
    const keep = [...visited, active?.id, id].filter((v): v is string => !!v)
    setVisited([...new Set(keep)])
    setResultsTab(id)
  }

  const nodeById = useMemo(() => new Map(nodes.filter(isStep).map((n) => [n.id, n])), [nodes])

  // uniqID → display name, merged across every result's displayMap, so the selected-genes chips
  // can show gene names for the pinned selection (which carries only ids).
  const geneLabels = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of Object.values(results)) {
      const dm = r.kind === 'standardize' ? r.std.displayMap : r.displayMap
      if (dm) for (const k in dm) if (!(k in m)) m[k] = dm[k]
    }
    return m
  }, [results])
  // Merged per-gene annotations across EVERY result that carries them — Standardize (std) as well as
  // Compare — so the description (proteinName) and pathway tags show even in a Standardize-only flow
  // (previously only Compare results were read, so a Standardize-driven menu had no proteinName).
  const annById = useMemo(() => {
    const m: Record<string, Record<string, string>> = {}
    for (const r of Object.values(results)) {
      const am =
        r.kind === 'standardize' ? r.std.annotationMap : r.kind === 'compare' ? r.annotationMap : undefined
      if (!am) continue
      for (const id in am) {
        const rec = m[id] ?? (m[id] = {})
        for (const c in am[id]) if (rec[c] == null) rec[c] = am[id][c]
      }
    }
    return m
  }, [results])
  // Pathway → BRITE category, merged the same way (Standardize + Compare).
  const kcatAll = useMemo(() => {
    const m: Record<string, string> = {}
    for (const r of Object.values(results)) {
      const kc =
        r.kind === 'standardize' ? r.std.keggCategories : r.kind === 'compare' ? r.keggCategories : undefined
      if (kc) for (const k in kc) if (!(k in m)) m[k] = kc[k]
    }
    return m
  }, [results])
  // Genes grouped pathway-CATEGORY → PATHWAY → gene for the multi-select menu. Pathways come from the
  // merged per-gene annotationMap (keggPathway; ';'/'|'-separated); each pathway's category from the
  // merged keggCategories map (BRITE top level). A gene appears under every pathway it's annotated
  // with. Genes with no pathway → "No pathway"; pathways with no known category → "Other".
  const geneCategories = useMemo(() => {
    const ann = annById
    const kcat = kcatAll
    const NONE = 'No pathway'
    const OTHER = 'Other'
    type Gene = { id: string; label: string }
    // category → pathway → genes
    const cats = new Map<string, Map<string, Gene[]>>()
    const put = (cat: string, path: string, gene: Gene): void => {
      let byPath = cats.get(cat)
      if (!byPath) cats.set(cat, (byPath = new Map()))
      const arr = byPath.get(path)
      if (arr) arr.push(gene)
      else byPath.set(path, [gene])
    }
    for (const id in geneLabels) {
      const gene = { id, label: geneLabels[id], desc: pickDesc(ann[id]) }
      const paths = [
        ...new Set(
          (ann[id]?.keggPathway ?? '')
            .split(/[;|]/)
            .map((s) => s.trim())
            .filter(Boolean)
        )
      ]
      if (paths.length === 0) put(NONE, NONE, gene)
      else for (const pw of paths) put(kcat[pw] ?? OTHER, pw, gene)
    }
    const byName = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { numeric: true })
    // "No pathway"/"Other" sink to the bottom; genes and pathways sorted by name.
    const rank = (name: string): number => (name === NONE ? 2 : name === OTHER ? 1 : 0)
    return [...cats.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || byName(a[0], b[0]))
      .map(([name, byPath]) => ({
        name,
        pathways: [...byPath.entries()]
          .sort((a, b) => byName(a[0], b[0]))
          .map(([pw, genes]) => ({
            name: pw,
            genes: genes.sort((x, y) => byName(x.label, y.label))
          }))
      }))
  }, [annById, kcatAll, geneLabels])

  // Genes grouped by essentiality — Essential / NA — a flat two-level tree for the menu's second
  // tab. Backed by DEG (Database of Essential Genes, essential-only), so the model is binary: a gene
  // flagged essential lands in Essential; everything else (not in DEG, or unannotated) is NA. The
  // flag is read from any per-gene annotation column whose name mentions "essential".
  const geneEssentiality = useMemo(() => {
    const ann = annById
    // Which annotation column carries essentiality, if any.
    const essCol = [...new Set(Object.values(ann).flatMap((rec) => Object.keys(rec)))].find((c) =>
      /essential/i.test(c)
    )
    // DEG is essential-only: a positive flag → Essential, anything else → NA.
    const isEssential = (v: string | undefined): boolean => {
      const s = (v ?? '').trim().toLowerCase()
      if (s === '' || s.startsWith('non')) return false
      return s.includes('essential') || s === 'e' || s === 'yes' || s === 'true' || s === '1'
    }
    const byName = (a: string, b: string): number =>
      a.localeCompare(b, undefined, { numeric: true })
    const buckets: Record<'Essential' | 'NA', { id: string; label: string; desc?: string }[]> = {
      Essential: [],
      NA: []
    }
    for (const id in geneLabels)
      buckets[essCol && isEssential(ann[id]?.[essCol]) ? 'Essential' : 'NA'].push({
        id,
        label: geneLabels[id],
        desc: pickDesc(ann[id])
      })
    return (['Essential', 'NA'] as const).map((name) => ({
      name,
      genes: buckets[name].sort((x, y) => byName(x.label, y.label))
    }))
  }, [annById, geneLabels])

  if (groups.length === 0) {
    return (
      <div style={styles.view}>
        <div style={styles.empty}>
          No analyses yet. Add a Standardize, Compare, or Contrast step with its plots on the
          canvas.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.view}>
      <div style={styles.header}>
        <div style={styles.tabRow}>
          <div
            style={styles.tabs}
            // Dropping anywhere in the row uses the last-computed insertion index.
            onDragOver={(e) => {
              if (dragId) e.preventDefault()
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragId && dropIndex != null) dropTabAt(dragId, dropIndex)
              endDrag()
            }}
          >
            {groups.map((g, i) => {
              const isActive = g.id === active?.id
              return (
                <Fragment key={g.id}>
                  {dropIndex === i && dragId && <div style={styles.dropMark} />}
                  <button
                    draggable
                    onClick={() => openTab(g.id)}
                    onDragStart={(e) => {
                      setDragId(g.rootId)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      if (!dragId) return
                      e.preventDefault() // allow the drop
                      e.dataTransfer.dropEffect = 'move'
                      // Insert before this tab or after it, by which half the cursor is over.
                      const r = e.currentTarget.getBoundingClientRect()
                      const after = e.clientX > r.left + r.width / 2
                      const idx = i + (after ? 1 : 0)
                      if (idx !== dropIndex) setDropIndex(idx)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragId && dropIndex != null) dropTabAt(dragId, dropIndex)
                      endDrag()
                    }}
                    onDragEnd={endDrag}
                    style={{
                      ...styles.tab,
                      ...(isActive ? styles.tabActive : {}),
                      ...(dragId === g.rootId ? { opacity: 0.4 } : {})
                    }}
                    title={groupTitle(g, results)}
                  >
                    {groupLabel(g, nodeById.get(g.rootId)?.data.name)}
                    {/* Real panel count: plot groups unfold into one panel per subcard, so this
                        matches the tiles actually shown (a folded group is not counted as 1). */}
                    <span style={styles.tabCount}>{expandMembers(g.memberIds, nodes).length}</span>
                  </button>
                </Fragment>
              )
            })}
            {dropIndex === groups.length && dragId && <div style={styles.dropMark} />}
          </div>
        </div>
        {/* Controls row below the tabs: the shared condition switchers on the left, the gene
            selector and layout toggle pinned right. Keeping these off the tab row lets the tabs
            scroll horizontally on their own when many analyses don't fit, and keeps the gene
            selector / Edit-layout controls fixed regardless of how far the tabs are scrolled.
            FacetContextBar renders nothing for a non-faceted group — the right controls remain. */}
        <div style={styles.controlRow}>
          {active && <FacetContextBar group={active} results={results} />}
          <div style={styles.controlRight}>
            {/* Searchable multi-select of all genes (drives the pinned selection). */}
            <GeneSelectMenu
              tabs={[
                { key: 'pathway', label: 'Pathway', categories: geneCategories },
                { key: 'essentiality', label: 'Essentiality', categories: geneEssentiality }
              ]}
            />
            <button
              onClick={toggleEdit}
              title={editMode ? 'Done editing layout' : 'Edit dashboard layout'}
              style={{
                ...styles.editBtn,
                background: editMode ? UI.accent : 'transparent',
                color: editMode ? UI.accentText : UI.text,
                borderColor: editMode ? UI.accent : UI.border
              }}
            >
              {editMode ? 'Done' : 'Edit layout'}
            </button>
          </div>
        </div>
      </div>
      <div style={styles.panes}>
        {groups
          .filter((g) => visited.includes(g.id) || g.id === active?.id)
          .map((g) => (
            <div
              key={g.id}
              // `display:none` rather than `visibility:hidden`: it makes the charts
              // inside report `offsetParent === null`, which is how PlotlyChart knows
              // to skip highlight work for a tab nobody is looking at. The grid
              // remembers its measured width across the hide (see DashboardGrid).
              style={{
                ...styles.pane,
                ...(g.id === active?.id ? null : styles.paneHidden)
              }}
              aria-hidden={g.id !== active?.id}
            >
              <GroupPane
                group={g}
                nodeById={nodeById}
                edges={edges}
                results={results}
                saved={groupLayouts[g.id] as PanelLayout | undefined}
                editing={editMode}
                onLayout={setGroupLayout}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

/** The shared facet switcher for one analysis group, shown on the results tab row. Reads
 *  the group's comparison rows for the full context (strain/dose/time) and writes the one
 *  selection every FacetedPlot in the group follows. Renders nothing for a non-faceted
 *  group (e.g. a Standardize's heatmap/bar/cluster). */
function FacetContextBar({
  group,
  results
}: {
  group: AnalysisGroup
  results: Record<string, NodeResult>
}): ReactNode {
  const r = results[group.rootId]
  const rows: ContextRow[] | null =
    r?.kind === 'compare' ? r.cmp.rows : r?.kind === 'contrast' ? r.ctr.rows : null
  const sel = useFacet((s) => s.sel[group.id]) ?? EMPTY_SEL
  const setLevel = useFacet((s) => s.setLevel)
  const bars = useMemo(() => {
    if (!rows) return []
    const dims = facetDims(rows)
    return dims.length ? resolveFacets(rows, dims, sel).bars : []
  }, [rows, sel])
  if (!bars.length) return null
  return (
    <div style={styles.facetBar}>
      {bars.map(({ dim, value, options }) => (
        <div key={dim} style={styles.facetGroup} role="tablist" aria-label={`${dim} level`}>
          <span style={styles.facetLabel}>{dim}</span>
          {/* Fused pill, matching the main-nav Workflow/Results switch and the in-plot
              SwitchBar: a rounded track whose active level is an accent-filled chip. */}
          <div style={styles.facetPill}>
            {options.map((v) => {
              const on = String(v) === String(value)
              return (
                <button
                  key={String(v)}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setLevel(group.id, dim, String(v))}
                  style={{
                    ...styles.facetTab,
                    background: on ? UI.accent : 'transparent',
                    color: on ? UI.accentText : UI.text
                  }}
                >
                  {String(v)}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/** One tab's grid. Split out so each pane owns its own layout/handler and a hidden
 *  pane re-renders no more than a visible one. */
function GroupPane({
  group,
  nodeById,
  edges,
  results,
  saved,
  editing,
  onLayout
}: {
  group: AnalysisGroup
  nodeById: Map<string, StepNode>
  edges: Edge[]
  results: Record<string, NodeResult>
  saved: PanelLayout | undefined
  editing: boolean
  onLayout: (id: string, layout: PanelLayoutItem[]) => void
}): ReactNode {
  // Group tiles are transparent in Results: each subcard becomes its own panel.
  const nodes = [...nodeById.values()]
  const panelIds = expandMembers(group.memberIds, nodes)
  const layout = reconcileLayout(saved ?? autoLayout(panelIds), panelIds)
  // The shared facet selection for this group (from the header control); every faceted
  // plot reads it in place of its own tabs. Stable EMPTY_SEL until the user picks a level.
  const facetSel = useFacet((s) => s.sel[group.id]) ?? EMPTY_SEL
  return (
    <DashboardGrid
      ids={panelIds}
      layout={layout}
      editing={editing}
      onLayoutChange={(next) => {
        // RGL emits on mount and every drag frame; only persist a real geometry change.
        if (geometryChanged(layout, next)) onLayout(group.id, next as PanelLayoutItem[])
      }}
    >
      {(panelId) => {
        const { nodeId, childId } = parsePanelId(panelId)
        const n = nodeById.get(nodeId)
        if (!n) return null
        const child = childId
          ? (n.data.config as PlotGroupConfig).children.find((c) => c.id === childId)
          : undefined
        // A stale child id (subcard removed after the layout was saved) → skip.
        if (childId && !child) return null
        return (
          <PanelTile
            node={n}
            edges={edges}
            results={results}
            editing={editing}
            child={child}
            facetSel={facetSel}
          />
        )
      }}
    </DashboardGrid>
  )
}

const styles: Record<string, CSSProperties> = {
  view: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, background: UI.bg },
  panes: { flex: 1, minHeight: 0, position: 'relative' },
  pane: { position: 'absolute', inset: 0, overflow: 'auto', padding: '8px 10px 40px' },
  paneHidden: { display: 'none' },
  // The results header: analysis tabs on top (scrolling horizontally on overflow), then a
  // controls row — condition switchers left, gene selector + Edit-layout right.
  header: {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 auto',
    borderBottom: `1px solid ${UI.border}`
  },
  // The tab row: analysis tabs only. They fill the row and scroll horizontally on overflow.
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 14px 6px'
  },
  // Controls row under the tabs: condition switchers (left) + gene selector/Edit-layout (right).
  controlRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '2px 14px 8px',
    minWidth: 0
  },
  // Gene selector + layout toggle, pinned to the right of the controls row (top-aligned so they
  // stay put when the condition switchers wrap to multiple lines).
  controlRight: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    marginLeft: 'auto',
    flex: '0 0 auto'
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflowX: 'auto'
  },
  // Live insertion marker shown between tabs while dragging one — a thin accent bar. It must not
  // intercept drag events (else the underlying tab's dragOver stops firing), hence pointerEvents.
  dropMark: {
    flex: '0 0 auto',
    alignSelf: 'stretch',
    width: 3,
    minHeight: 22,
    margin: '0 -3px',
    borderRadius: 2,
    background: UI.accent,
    pointerEvents: 'none'
  },
  editBtn: {
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    height: 30,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 600,
    border: `1px solid ${UI.border}`,
    borderRadius: 6,
    cursor: 'pointer'
  },
  // Shared facet control, left side of the controls row: one labelled pill group per context
  // dim. Grows to fill the space left of the right-pinned controls and wraps to multiple lines
  // when many switchers don't fit, rather than crowding them.
  facetBar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    flex: 1,
    minWidth: 0
  },
  facetGroup: { display: 'inline-flex', alignItems: 'center', gap: 7, flex: '0 0 auto' },
  facetLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto'
  },
  // Fused pill: a rounded track holding the level chips (active = accent fill).
  facetPill: {
    display: 'inline-flex',
    gap: 4,
    border: `1px solid ${UI.border}`,
    borderRadius: 999,
    padding: 2,
    background: UI.panel,
    flex: '0 0 auto'
  },
  facetTab: {
    border: 'none',
    borderRadius: 999,
    padding: '3px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    flex: '0 0 auto'
  },
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    whiteSpace: 'nowrap',
    maxWidth: 260,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    background: 'transparent',
    color: UI.textMuted,
    border: `1px solid ${UI.border}`,
    borderRadius: 16,
    padding: '5px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  },
  tabActive: { color: UI.accentText, background: UI.accent, borderColor: UI.accent },
  tabCount: { fontSize: 10, opacity: 0.7 },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    color: UI.textMuted,
    fontSize: 13,
    textAlign: 'center',
    padding: 24
  }
}
