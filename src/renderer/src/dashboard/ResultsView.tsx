/** The results dashboard: one tab per analysis group, each a reconfigurable grid
 *  of panel tiles. Replaces the old two-level (section pill → tile tab) OutputDock
 *  that showed a single plot at a time. Grouping is derived from the pipeline DAG;
 *  tile layout is drag/resizable in edit mode (persisted with the workflow later). */
import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Edge } from '@xyflow/react'

import {
  deriveGroups,
  expandMembers,
  parsePanelId,
  topoStepOrder,
  type AnalysisGroup
} from '../graph/groups'
import { NODE_SPECS, stepTitle } from '../graph/registry'
import { useGraph } from '../graph/store'
import { isStep, type NodeResult, type PlotGroupConfig, type StepNode } from '../graph/types'
import type { PanelLayoutItem } from '../graph/types'
import { UI } from '../ui/theme'
import { useAppView } from '../ui/useAppView'
import { DashboardGrid } from './DashboardGrid'
import { EMPTY_SEL, useFacet } from './facet'
import { FacetContextBar } from './FacetContextBar'
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
 *  "Compare"). What's actually being compared lives in the hover tooltip (groupTitle).
 *
 *  Reads the ROOT NODE's kind, not `group.kind`: the latter is the group's OUTPUT kind, so a Merge
 *  (which emits a Clean-data result) would otherwise label its tab "Clean data". */
function groupLabel(group: AnalysisGroup, root?: StepNode): string {
  return root ? stepTitle(root) : NODE_SPECS[group.kind].label
}

/** Full comparison list for the tab's hover tooltip (the label itself is trimmed). */
function groupTitle(group: AnalysisGroup, results: Record<string, NodeResult>): string {
  const comps = groupComparisons(group, results)
  return comps.length ? comps.join(', ') : group.label
}

export function ResultsView(): ReactNode {
  const nodes = useGraph((s) => s.nodes)
  const edges = useGraph((s) => s.edges)
  const results = useGraph((s) => s.results)
  const groupLayouts = useGraph((s) => s.groupLayouts)
  const setGroupLayout = useGraph((s) => s.setGroupLayout)
  const groupMeta = useGraph((s) => s.groupMeta)
  const reorderGroups = useGraph((s) => s.reorderGroups)
  // Active tab lives in the app-view store (not local state) so it survives Results unmounting
  // when you switch to the canvas — returning lands on the same tab, not the first.
  const activeId = useAppView((s) => s.resultsTab)
  const setResultsTab = useAppView((s) => s.setResultsTab)
  const setView = useAppView((s) => s.setView)
  // Back to the canvas — the counterpart of the canvas's "Results →" button.
  const backToWorkflow = (
    <button
      style={styles.backBtn}
      onClick={() => setView('canvas')}
      title="Back to the workflow canvas"
    >
      ← Workflow
    </button>
  )
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

  if (groups.length === 0) {
    return (
      <div style={styles.view}>
        <div style={styles.tabRow}>{backToWorkflow}</div>
        <div style={styles.empty}>
          No analyses yet. Add a Clean data, Compare, or Contrast step with its plots on the canvas.
        </div>
      </div>
    )
  }

  return (
    <div style={styles.view}>
      <div style={styles.header}>
        <div style={styles.tabRow}>
          {backToWorkflow}
          {/* Named like the condition switchers below ("DOSE", "TIME", …): this row picks the data. */}
          <span style={styles.tabLabel}>Data</span>
          <div
            className="oe-tabscroll"
            style={styles.tabs}
            // A plain mouse wheel only scrolls vertically; turn it sideways here so a long row of
            // tabs can be scrolled without a trackpad or shift. Horizontal input passes through.
            onWheel={(e) => {
              const el = e.currentTarget
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth)
                el.scrollLeft += e.deltaY
            }}
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
                    {groupLabel(g, nodeById.get(g.rootId))}
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
        {/* Controls row below the tabs: the shared condition switchers. Kept off the tab row so
            the tabs scroll horizontally on their own when many analyses don't fit. The gene
            selector lives in the top nav, shared with the workflow view. */}
        <div style={styles.controlRow}>
          {active && <FacetContextBar group={active} results={results} />}
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
                onLayout={setGroupLayout}
              />
            </div>
          ))}
      </div>
    </div>
  )
}

function GroupPane({
  group,
  nodeById,
  edges,
  results,
  saved,
  onLayout
}: {
  group: AnalysisGroup
  nodeById: Map<string, StepNode>
  edges: Edge[]
  results: Record<string, NodeResult>
  saved: PanelLayout | undefined
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
            // The dashboard is always editable: tiles drag by the header and resize at any edge.
            editing
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
  // The tab row: the way back to the workflow, then the analysis tabs, which fill the rest of the
  // row and scroll horizontally on overflow.
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 14px 2px'
  },
  // The data switcher's label — FacetContextBar's facetLabel, so it reads like the condition
  // switchers' labels. Its gap to the tabs matches theirs (7px) via a negative trim of the row gap.
  tabLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: UI.textMuted,
    flex: '0 0 auto',
    marginRight: -3
  },
  // A rounded square like the canvas's "Results →", sized to the tabs beside it.
  backBtn: {
    flex: '0 0 auto',
    // Extra space after it: it leaves the dashboard, the rest of the row works within it.
    marginRight: 14,
    background: UI.panel,
    color: UI.text,
    border: `1px solid ${UI.border}`,
    borderRadius: 8,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  // Controls row under the tabs: the condition switchers.
  controlRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '2px 14px 8px',
    minWidth: 0
  },

  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
    overflowX: 'auto',
    // Room under the tabs for the slim scrollbar (.oe-tabscroll in app.css), so it never touches
    // them — matched above, so the tabs stay centred on the button and label beside them (the
    // scrollbar itself, when there is one, adds 4px more below). The row's own padding gives
    // these 4px back.
    padding: '4px 0'
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
  tab: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    whiteSpace: 'nowrap',
    // Never shrink: `overflow: hidden` drops a flex item's minimum width to 0, so without this a
    // long row squeezed every tab to a sliver instead of overflowing into the scroller. Long names
    // still ellipsize at the max width.
    flex: '0 0 auto',
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
